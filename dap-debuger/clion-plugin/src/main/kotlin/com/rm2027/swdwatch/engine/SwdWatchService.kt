package com.rm2027.swdwatch.engine

import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.xdebugger.XDebugProcess
import com.intellij.xdebugger.XDebuggerManager
import com.intellij.xdebugger.XDebuggerManagerListener
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.atomic.AtomicInteger

data class WatchItem(
    val id: String,
    val name: String,
    val address: Long = 0,
    val size: Int = 4,
    val file: String = "",
    val words: List<Long> = emptyList(),
    val error: String? = null,
    val expression: Boolean = false,
    val source: String = "",
    val value: Double? = null,
    val plotted: Boolean = true,
    val field: String = "u32",
    val view: String = "value",
    val matrixRows: Int = 1,
    val matrixCols: Int = 1,
    val matrixCell: String = "u32",
)

data class SamplePoint(
    val t: Double,
    val u32: Double,
    val f32: Double,
    val i32: Double = Double.NaN,
    val i16: Double = Double.NaN,
    val u16: Double = Double.NaN,
    val i8: Double = Double.NaN,
    val u8: Double = Double.NaN,
)

data class SerialLine(val dir: String, val text: String, val hex: String)

@Service(Service.Level.PROJECT)
class SwdWatchService(private val project: Project) : Disposable {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val generation = AtomicInteger()
    private var poll: Job? = null
    private var replayJob: Job? = null
    private val symbolCache = mutableListOf<SymbolInfo>()
    private var cachedElf = ""
    private var cachedMtime = -1L
    private var exprSeq = 1
    val phase = MutableStateFlow("等待调试")
    val elf = MutableStateFlow<String?>(null)
    val port = MutableStateFlow(0)
    val matches = MutableStateFlow<List<SymbolInfo>>(emptyList())
    val watches = MutableStateFlow<List<WatchItem>>(emptyList())
    val history = MutableStateFlow<Map<String, List<SamplePoint>>>(emptyMap())
    val chartMode = MutableStateFlow("time")
    val recording = MutableStateFlow(false)
    val logName = MutableStateFlow("")
    val logFiles = MutableStateFlow<List<String>>(emptyList())
    val replaying = MutableStateFlow(false)
    val searchError = MutableStateFlow("")
    val serialPorts = MutableStateFlow<List<String>>(emptyList())
    val serialOpen = MutableStateFlow(false)
    val serialDevice = MutableStateFlow("")
    val serialBaud = MutableStateFlow(115200)
    val serialLines = MutableStateFlow<List<SerialLine>>(emptyList())
    val serialError = MutableStateFlow("")
    private val projectDir = Path.of(project.basePath ?: ".")
    val log = SessionLog(projectDir.resolve(".idea").resolve("swd-watch-logs"))
    private val configPath = configFile(projectDir)
    private val serial = SerialLink(::onSerialRx) { message -> serialError.value = message }

    init {
        load()
        refreshLogFiles()
        project.messageBus.connect(this).subscribe(XDebuggerManager.TOPIC, object : XDebuggerManagerListener {
            override fun processStarted(debugProcess: XDebugProcess) = onDebugStarted(debugProcess)
            override fun processStopped(debugProcess: XDebugProcess) = onDebugStopped()
        })
        XDebuggerManager.getInstance(project).currentSession?.debugProcess?.let { onDebugStarted(it) }
    }

    fun onDebugStarted(debugProcess: XDebugProcess) {
        val path = locateElf(project, debugProcess)
        elf.value = path?.toString()
        if (path != null) refreshSearch("")
        phase.value = "已开始调试，正在连接 OpenOCD"
        val token = generation.incrementAndGet()
        poll?.cancel()
        poll = scope.launch {
            var client: OpenOcdClient? = null
            try {
                while (isActive && generation.get() == token) {
                    if (replaying.value) {
                        delay(80)
                        continue
                    }
                    if (client == null) {
                        val telnet = discoverTelnetPort()
                        port.value = telnet
                        val opened = OpenOcdClient(port = telnet)
                        try {
                            opened.connect()
                            client = opened
                            phase.value = "实时监视 :$telnet"
                            if (!log.hold) {
                                log.ensureStarted()
                                syncLogState()
                            }
                        } catch (error: Exception) {
                            opened.close()
                            phase.value = "等待 OpenOCD :$telnet"
                            delay(400)
                            continue
                        }
                    }
                    try {
                        sample(client)
                    } catch (error: Exception) {
                        client.close()
                        client = null
                        phase.value = error.message ?: "重新连接 OpenOCD"
                        delay(400)
                        continue
                    }
                    delay(50)
                }
            } finally {
                client?.close()
                if (generation.get() == token) {
                    log.finishSession()
                    recording.value = false
                }
            }
        }
    }

    fun onDebugStopped() {
        generation.incrementAndGet()
        poll?.cancel()
        poll = null
        log.finishSession()
        recording.value = false
        phase.value = "调试已结束"
    }

    fun refreshSearch(query: String) {
        val path = elf.value?.let { Path.of(it) } ?: locateElf(project, null)
        if (path == null) {
            searchError.value = "还没有 ELF"
            matches.value = emptyList()
            return
        }
        elf.value = path.toString()
        try {
            val mtime = Files.getLastModifiedTime(path).toMillis()
            if (cachedElf != path.toString() || cachedMtime != mtime) {
                symbolCache.clear()
                symbolCache += readSymbols(path)
                cachedElf = path.toString()
                cachedMtime = mtime
                refreshAddresses()
            }
            val needle = query.lowercase()
            matches.value = symbolCache
                .filter { needle.isEmpty() || needle in it.name.lowercase() }
                .sortedWith(compareBy({ !it.name.lowercase().startsWith(needle) }, { it.name.lowercase() }))
                .take(80)
            searchError.value = ""
        } catch (error: Exception) {
            searchError.value = error.message ?: "搜索失败"
        }
    }

    fun addSymbol(info: SymbolInfo) {
        if (watches.value.any { !it.expression && it.name == info.name }) return
        watches.update { it + WatchItem("sym:${info.name}", info.name, info.address, info.size, info.file) }
        save()
    }

    fun addExpression(expr: String, source: String) {
        val text = expr.trim()
        compileExpr(text)
        if (watches.value.none { !it.expression && it.name == source }) throw IllegalArgumentException("先选择变量 x")
        val id = "expr:${exprSeq++}"
        watches.update { it + WatchItem(id, text, expression = true, source = source) }
        save()
    }

    fun remove(id: String) {
        watches.update { it.filterNot { item -> item.id == id } }
        save()
    }

    fun togglePlotted(id: String, plotted: Boolean) {
        edit(id) { it.copy(plotted = plotted) }
    }

    fun setField(id: String, field: String) {
        edit(id) { item ->
            val point = item.words.firstOrNull()?.let { pointOf(now(), item.words) }
            val value = point?.let { chosen(field, it) }
            item.copy(field = field, value = value ?: item.value)
        }
    }

    fun setView(id: String, view: String) {
        edit(id) { it.copy(view = view) }
    }

    fun writeSymbol(id: String, valueText: String) {
        val item = watches.value.find { it.id == id } ?: throw IllegalArgumentException("未找到监视项")
        if (item.expression) throw IllegalArgumentException("表达式不能写入")
        val activePort = port.value
        if (activePort <= 0) throw IllegalStateException("未连接 OpenOCD")
        val client = OpenOcdClient(port = activePort)
        try {
            client.connect()
            writeMemory(client, item.address, item.size, valueText, item.field)
            val refreshed = readAlignedMemory(client, item.address, item.size)
            val point = pointOf(now(), refreshed)
            watches.update { list ->
                list.map {
                    if (it.id == id) it.copy(words = refreshed, value = chosen(it.field, point), error = null)
                    else it
                }
            }
        } finally {
            client.close()
        }
    }

    fun setMatrix(id: String, rows: Int, cols: Int, cell: String) {
        edit(id) {
            it.copy(
                matrixRows = rows.coerceIn(1, 64),
                matrixCols = cols.coerceIn(1, 64),
                matrixCell = cell,
            )
        }
    }

    fun setChartMode(mode: String) {
        chartMode.value = if (mode == "fn") "fn" else "time"
        save()
    }

    fun stopLog() {
        log.stop()
        syncLogState()
    }

    fun resumeLog() {
        log.resume()
        syncLogState()
    }

    fun replay(name: String) {
        val file = log.file(name) ?: return
        replayJob?.cancel()
        replaying.value = true
        phase.value = "回放 $name"
        replayJob = scope.launch {
            history.value = emptyMap()
            val frames = mutableListOf<Pair<Double, List<String>>>()
            var bucket = mutableListOf<String>()
            var stamp = Double.NaN
            for (line in Files.readAllLines(file)) {
                if (line.isBlank()) continue
                val time = jsonNumber(line, "t") ?: continue
                if (!stamp.isNaN() && kotlin.math.abs(time - stamp) > 0.0005) {
                    frames += stamp to bucket
                    bucket = mutableListOf()
                }
                stamp = time
                bucket += line
            }
            if (bucket.isNotEmpty()) frames += stamp to bucket
            var previous = Double.NaN
            for ((time, lines) in frames) {
                if (!isActive || !replaying.value) break
                if (!previous.isNaN()) delay(((time - previous) * 1000).toLong().coerceIn(0, 1500))
                previous = time
                for (line in lines) applyRecord(line)
                recomputeExpressions()
            }
            replaying.value = false
            phase.value = if (poll?.isActive == true) "实时监视 :${port.value}" else "调试已结束"
        }
    }

    fun stopReplay() {
        replaying.value = false
        replayJob?.cancel()
    }

    fun refreshPorts() {
        serialPorts.value = serial.ports().map { it.first }
    }

    fun openSerial(device: String, baud: Int) {
        try {
            serial.open(device, baud)
            serialOpen.value = serial.isOpen
            serialDevice.value = serial.device
            serialBaud.value = serial.baud
            serialError.value = ""
        } catch (error: Exception) {
            serialOpen.value = false
            serialError.value = error.message ?: "打不开串口"
        }
    }

    fun closeSerial() {
        serial.close()
        serialOpen.value = false
    }

    fun sendSerial(payload: ByteArray) {
        try {
            serial.write(payload)
            noteSerial("tx", payload)
            serialError.value = ""
        } catch (error: Exception) {
            serialError.value = error.message ?: "发送失败"
        }
    }

    private fun onSerialRx(data: ByteArray) {
        noteSerial("rx", data)
    }

    private fun noteSerial(dir: String, data: ByteArray) {
        val line = SerialLine(dir, serialText(data), data.joinToString(" ") { "%02x".format(it) })
        serialLines.update { (it + line).takeLast(400) }
        if (log.active) {
            log.write("""{"kind":"serial","dir":${quote(dir)},"t":${jsonTime(now())},"hex":${quote(line.hex)},"text":${quote(line.text)}}""")
        }
    }

    private fun sample(client: OpenOcdClient) {
        val symbols = watches.value.filter { !it.expression }
        if (symbols.isEmpty()) return
        val frameTime = now()
        val reads = symbols.associate { item ->
            item.id to runCatching {
                readAlignedMemory(client, item.address, item.size)
            }
        }
        val points = mutableMapOf<String, SamplePoint>()
        watches.update { list ->
            list.map { item ->
                if (item.expression) return@map item
                val result = reads[item.id] ?: return@map item
                result.fold(
                    onSuccess = { words ->
                        val point = pointOf(frameTime, words)
                        points[item.name] = point
                        if (log.active) log.write(sampleLine(item, frameTime, words, point))
                        item.copy(words = words, error = null, value = chosen(item.field, point))
                    },
                    onFailure = { error -> item.copy(error = error.message) },
                )
            }
        }
        if (points.isNotEmpty()) {
            history.update { map ->
                val next = map.toMutableMap()
                points.forEach { (name, point) -> next[name] = ((next[name] ?: emptyList()) + point).takeLast(240) }
                next
            }
        }
        val failed = reads.values.count { it.isFailure }
        if (symbols.isNotEmpty() && failed == symbols.size) {
            throw reads.values.first { it.isFailure }.exceptionOrNull() ?: IllegalStateException("mdw 失败")
        }
        recomputeExpressions()
    }

    private fun recomputeExpressions() {
        watches.update { list ->
            list.map { item ->
                if (!item.expression) return@map item
                val source = list.find { !it.expression && it.name == item.source }
                if (source == null) return@map item.copy(error = "找不到 x", value = null)
                val x = source.value
                if (x == null) return@map item.copy(value = null, error = null)
                val value = runCatching { compileExpr(item.name)(x) }.getOrElse { error ->
                    return@map item.copy(error = error.message, value = null)
                }
                item.copy(value = value.takeIf { it.isFinite() }, error = if (value.isFinite()) null else "结果无效")
            }
        }
    }

    private fun applyRecord(line: String) {
        when (jsonString(line, "kind")) {
            "serial" -> {
                val dir = jsonString(line, "dir") ?: "rx"
                val text = jsonString(line, "text") ?: ""
                val hex = jsonString(line, "hex") ?: ""
                serialLines.update { (it + SerialLine(dir, text, hex)).takeLast(400) }
            }
            "sample" -> {
                val name = jsonString(line, "name") ?: return
                val time = jsonNumber(line, "t") ?: return
                val words = Regex("""\[(.*)]""").find(line.substringAfter("\"words\""))?.groupValues?.get(1)
                    ?.split(',')
                    ?.mapNotNull { it.trim().trim('"').toLongOrNull(16) }
                    ?: emptyList()
                val point = pointOf(time, words)
                history.update { map -> map + (name to ((map[name] ?: emptyList()) + point).takeLast(240)) }
                watches.update { list ->
                    list.map { item ->
                        if (item.expression || item.name != name) item
                        else item.copy(words = words, error = null, value = chosen(item.field, point))
                    }
                }
            }
        }
    }

    private fun refreshAddresses() {
        if (symbolCache.isEmpty()) return
        watches.update { list ->
            list.map { item ->
                if (item.expression) item
                else symbolCache.find { it.name == item.name }?.let { info ->
                    item.copy(address = info.address, size = info.size, file = info.file)
                } ?: item
            }
        }
    }

    private fun edit(id: String, block: (WatchItem) -> WatchItem) {
        watches.update { list -> list.map { if (it.id == id) block(it) else it } }
        save()
    }

    private fun load() {
        val stored = runCatching { loadConfig(configPath) }.getOrElse { return }
        chartMode.value = stored.chartMode
        watches.value = stored.watches.map { item ->
            WatchItem(
                id = item.id,
                name = item.name,
                address = item.address,
                size = if (item.size > 0) item.size else 4,
                file = item.file,
                expression = item.expression,
                source = item.source,
                plotted = item.plotted,
                field = item.field,
                view = item.view,
                matrixRows = item.matrixRows,
                matrixCols = item.matrixCols,
                matrixCell = item.matrixCell,
            )
        }
        exprSeq = stored.watches.mapNotNull { it.id.removePrefix("expr:").toIntOrNull() }.maxOrNull()?.plus(1) ?: 1
    }

    private fun save() {
        val config = StoredConfig(
            chartMode.value,
            watches.value.map { item ->
                StoredWatch(
                    item.id, item.name, item.expression, item.source, item.address, item.size, item.file,
                    item.plotted, item.field, item.view, item.matrixRows, item.matrixCols, item.matrixCell,
                )
            },
        )
        runCatching { saveConfig(configPath, config) }
    }

    private fun syncLogState() {
        recording.value = log.active
        logName.value = log.path?.fileName?.toString() ?: ""
        refreshLogFiles()
    }

    private fun refreshLogFiles() {
        logFiles.value = log.names()
    }

    override fun dispose() {
        poll?.cancel()
        replayJob?.cancel()
        serial.close()
        log.finishSession()
        scope.cancel()
    }

    companion object {
        fun getInstance(project: Project): SwdWatchService = project.service()
    }
}

private fun pointOf(time: Double, words: List<Long>): SamplePoint {
    val first = words.firstOrNull()
    val u32 = first?.let { unsignedWord(it).toDouble() } ?: Double.NaN
    val f32 = first?.let { wordToFloat(it) } ?: Double.NaN
    val i32 = first?.let { signedWord32(it).toDouble() } ?: Double.NaN
    val i16 = first?.let { signedWord16(it).toDouble() } ?: Double.NaN
    val u16 = first?.let { (unsignedWord(it) and 0xFFFFL).toDouble() } ?: Double.NaN
    val i8 = first?.let { signedWord8(it).toDouble() } ?: Double.NaN
    val u8 = first?.let { (unsignedWord(it) and 0xFFL).toDouble() } ?: Double.NaN
    return SamplePoint(time, u32, f32, i32, i16, u16, i8, u8)
}

private fun chosen(field: String, point: SamplePoint): Double? {
    val value = when (field) {
        "i32" -> point.i32
        "i16" -> point.i16
        "u16" -> point.u16
        "i8" -> point.i8
        "u8" -> point.u8
        "f32" -> point.f32
        else -> point.u32
    }
    return value.takeIf { it.isFinite() }
}

private fun sampleLine(item: WatchItem, time: Double, words: List<Long>, point: SamplePoint): String {
    val encoded = words.joinToString(",") { "\"${hexWord(it)}\"" }
    return """{"kind":"sample","t":${jsonTime(time)},"name":${quote(item.name)},"addr":${item.address},"size":${item.size},"words":[$encoded],"u32":${jsonDouble(point.u32)},"i32":${jsonDouble(point.i32)},"f32":${jsonDouble(point.f32)}}"""
}

private fun jsonDouble(value: Double): String = if (value.isFinite()) "%.6g".format(value) else "null"

private fun jsonTime(value: Double): String = "%.3f".format(value)

private fun now(): Double = System.currentTimeMillis() / 1000.0

private fun jsonNumber(body: String, key: String): Double? =
    Regex(""""$key"\s*:\s*(-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)""").find(body)?.groupValues?.get(1)?.toDoubleOrNull()
