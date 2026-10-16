package com.rm2027.swdwatch.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import com.intellij.openapi.project.Project
import com.rm2027.swdwatch.engine.SamplePoint
import com.rm2027.swdwatch.engine.SerialLine
import com.rm2027.swdwatch.engine.SwdWatchService
import com.rm2027.swdwatch.engine.WatchItem
import com.rm2027.swdwatch.engine.buildMatrix
import com.rm2027.swdwatch.engine.compact
import com.rm2027.swdwatch.engine.compileExpr
import com.rm2027.swdwatch.engine.hexAddr
import com.rm2027.swdwatch.engine.hexWord
import com.rm2027.swdwatch.engine.parseHexPayload
import com.rm2027.swdwatch.engine.unsignedWord
import com.rm2027.swdwatch.engine.wordToFloat
import org.jetbrains.jewel.ui.component.Checkbox
import org.jetbrains.jewel.ui.component.DefaultButton
import org.jetbrains.jewel.ui.component.OutlinedButton
import org.jetbrains.jewel.ui.component.Text
import org.jetbrains.jewel.ui.component.TextField

@Composable
fun SwdWatchApp(project: Project) {
    val service = SwdWatchService.getInstance(project)
    var page by remember { mutableStateOf("watch") }
    Column(Modifier.fillMaxSize().padding(8.dp)) {
        Row {
            OutlinedButton(onClick = { page = "watch" }) { Text(if (page == "watch") "[ 监视 ]" else "监视") }
            OutlinedButton(onClick = { page = "serial" }) { Text(if (page == "serial") "[ 串口 ]" else "串口") }
        }
        if (page == "watch") WatchPage(service) else SerialPage(service)
    }
}

@Composable
private fun WatchPage(service: SwdWatchService) {
    val phase by service.phase.collectAsState()
    val elf by service.elf.collectAsState()
    val port by service.port.collectAsState()
    val matches by service.matches.collectAsState()
    val watches by service.watches.collectAsState()
    val history by service.history.collectAsState()
    val chartMode by service.chartMode.collectAsState()
    val recording by service.recording.collectAsState()
    val logName by service.logName.collectAsState()
    val logFiles by service.logFiles.collectAsState()
    val replaying by service.replaying.collectAsState()
    val searchError by service.searchError.collectAsState()
    var query by remember { mutableStateOf(TextFieldValue("")) }
    var expr by remember { mutableStateOf(TextFieldValue("")) }
    var source by remember { mutableStateOf("") }
    var selected by remember { mutableStateOf("") }
    var exprError by remember { mutableStateOf("") }
    val symbols = watches.filter { !it.expression }
    val activeSource = symbols.firstOrNull { it.name == source }?.name ?: symbols.firstOrNull()?.name ?: ""
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Text(phase + if (port > 0) "  :$port" else "")
        Text(elf?.substringAfterLast('/') ?: "尚无 ELF")
        Text(if (recording) "● 录制中 $logName" else "○ 未录制")
        Row {
            OutlinedButton(onClick = { service.stopLog() }) { Text("停止") }
            OutlinedButton(onClick = { service.resumeLog() }) { Text("继续") }
            if (replaying) OutlinedButton(onClick = { service.stopReplay() }) { Text("停止回放") }
        }
        logFiles.take(4).forEach { name ->
            OutlinedButton(onClick = { service.replay(name) }) { Text("回放 $name") }
        }
        TextField(
            value = query,
            onValueChange = {
                query = it
                service.refreshSearch(it.text)
            },
            modifier = Modifier.fillMaxWidth(),
        )
        if (searchError.isNotEmpty()) Text(searchError)
        matches.take(30).forEach { symbol ->
            OutlinedButton(onClick = {
                service.addSymbol(symbol)
                selected = "sym:${symbol.name}"
            }) { Text("${symbol.name}  ${symbol.file}  ${hexAddr(symbol.address)}") }
        }
        TextField(
            value = expr,
            onValueChange = { expr = it },
            modifier = Modifier.fillMaxWidth(),
        )
        Row {
            symbols.take(6).forEach { item ->
                OutlinedButton(onClick = { source = item.name }) { Text(if (activeSource == item.name) "x=${item.name}" else item.name) }
            }
        }
        Row {
            DefaultButton(onClick = {
                exprError = runCatching {
                    service.addExpression(expr.text, activeSource)
                    ""
                }.getOrElse { it.message ?: "表达式无效" }
                if (exprError.isEmpty()) expr = TextFieldValue("")
            }) { Text("添加表达式") }
            OutlinedButton(onClick = { service.setChartMode("time") }) { Text(if (chartMode == "time") "[ 时间 ]" else "时间") }
            OutlinedButton(onClick = { service.setChartMode("fn") }) { Text(if (chartMode == "fn") "[ 函数 ]" else "函数") }
        }
        if (exprError.isNotEmpty()) Text(exprError)
        Chart(watches, history, chartMode, selected)
        watches.forEach { item ->
            Row {
                Checkbox(checked = item.plotted, onCheckedChange = { service.togglePlotted(item.id, it) })
                OutlinedButton(onClick = { selected = item.id }) {
                    val where = if (item.expression) "x=${item.source}" else hexAddr(item.address)
                    val shown = item.error ?: item.value?.let { compact(it) } ?: "—"
                    Text((if (selected == item.id) "▸ " else "") + "${item.name}  $where  $shown")
                }
                OutlinedButton(onClick = { service.remove(item.id) }) { Text("移除") }
            }
        }
        val current = watches.find { it.id == selected }
        if (current != null) Detail(service, current)
    }
}

@Composable
private fun Chart(
    watches: List<WatchItem>,
    history: Map<String, List<SamplePoint>>,
    mode: String,
    selected: String,
) {
    val built = remember(watches, history, mode, selected) { chartSeries(watches, history, mode, selected) }
    val points = built.series.flatMap { it.points }
    val hasPoints = points.isNotEmpty()
    val rawMinY = if (hasPoints) points.minOf { it.second } else 0.0
    val rawMaxY = if (hasPoints) points.maxOf { it.second } else 1.0
    val midY = (rawMinY + rawMaxY) / 2.0

    Row(Modifier.fillMaxWidth().height(180.dp).padding(vertical = 4.dp)) {
        Column(
            modifier = Modifier.fillMaxHeight().padding(end = 6.dp),
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(if (hasPoints) compact(rawMaxY) else "—")
            Text(if (hasPoints) compact(midY) else "—")
            Text(if (hasPoints) compact(rawMinY) else "—")
        }
        Canvas(Modifier.weight(1f).fillMaxHeight()) {
            val gridColor = Color(0x22888888)
            val borderColor = Color(0x44888888)
            drawLine(borderColor, Offset(0f, 0f), Offset(size.width, 0f), strokeWidth = 1f)
            drawLine(gridColor, Offset(0f, size.height * 0.25f), Offset(size.width, size.height * 0.25f), strokeWidth = 1f)
            drawLine(gridColor, Offset(0f, size.height * 0.5f), Offset(size.width, size.height * 0.5f), strokeWidth = 1f)
            drawLine(gridColor, Offset(0f, size.height * 0.75f), Offset(size.width, size.height * 0.75f), strokeWidth = 1f)
            drawLine(borderColor, Offset(0f, size.height), Offset(size.width, size.height), strokeWidth = 1f)

            if (!hasPoints) return@Canvas
            val minX = points.minOf { it.first }
            var maxX = points.maxOf { it.first }
            if (maxX <= minX) maxX = minX + 1
            var minY = rawMinY
            var maxY = rawMaxY
            if (maxY <= minY) {
                minY -= 1
                maxY += 1
            }
            val pad = (maxY - minY) * 0.08
            minY -= pad
            maxY += pad
            fun xOf(x: Double) = ((x - minX) / (maxX - minX) * size.width).toFloat()
            fun yOf(y: Double) = (size.height - (y - minY) / (maxY - minY) * size.height).toFloat()
            built.series.forEachIndexed { index, line ->
                if (line.points.isEmpty()) return@forEachIndexed
                val path = Path()
                line.points.forEachIndexed { i, point ->
                    val x = xOf(point.first)
                    val y = yOf(point.second)
                    if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
                }
                drawPath(path, colors[index % colors.size], style = Stroke(width = 2f))
            }
            built.marker?.let { marker ->
                val x = xOf(marker)
                drawLine(Color.White, Offset(x, 0f), Offset(x, size.height), strokeWidth = 1.5f)
            }
        }
    }
    Text(built.series.joinToString("   ") { it.label })
    built.marker?.let { Text("最新 x = ${compact(it)}") }
}

private data class Curve(val label: String, val points: List<Pair<Double, Double>>)
private data class ChartData(val series: List<Curve>, val marker: Double?)

private fun chartSeries(
    watches: List<WatchItem>,
    history: Map<String, List<SamplePoint>>,
    mode: String,
    selected: String,
): ChartData {
    val symbols = watches.filter { !it.expression && it.plotted }
    val expressions = watches.filter { it.expression && it.plotted }
    if (mode == "fn") {
        val focus = expressions.find { it.id == selected } ?: expressions.firstOrNull()
        val sourceName = focus?.source ?: symbols.firstOrNull()?.name
        val xs = history[sourceName].orEmpty().mapNotNull { sampleValue(watches, sourceName, it) }
        if (xs.isEmpty() || sourceName == null) return ChartData(emptyList(), null)
        val start = xs.min()
        val end = xs.max().let { if (it == start) it + 1e-6 else it }
        val grid = List(200) { index -> start + (end - start) * index / 199.0 }
        val lines = mutableListOf<Curve>()
        if (symbols.isNotEmpty()) lines += Curve("y = x", grid.map { it to it })
        expressions.forEach { item ->
            val own = history[item.source].orEmpty().mapNotNull { sampleValue(watches, item.source, it) }
            if (own.isEmpty()) return@forEach
            val from = own.min()
            val to = own.max().let { if (it == from) it + 1e-6 else it }
            val samples = List(200) { index -> from + (to - from) * index / 199.0 }
            val fn = runCatching { compileExpr(item.name) }.getOrNull() ?: return@forEach
            lines += Curve(item.name, samples.map { x -> x to fn(x) }.filter { it.second.isFinite() })
        }
        return ChartData(lines, xs.last())
    }
    val lines = symbols.map { item ->
        Curve(item.name, history[item.name].orEmpty().mapNotNull { point ->
            val y = sampleValue(watches, item.name, point)
            y?.let { point.t to it }
        })
    }.toMutableList()
    expressions.forEach { item ->
        val fn = runCatching { compileExpr(item.name) }.getOrNull() ?: return@forEach
        lines += Curve(item.name, history[item.source].orEmpty().mapNotNull { point ->
            val x = sampleValue(watches, item.source, point) ?: return@mapNotNull null
            val y = fn(x)
            if (!y.isFinite()) null else point.t to y
        })
    }
    return ChartData(lines, null)
}

private fun sampleValue(watches: List<WatchItem>, name: String?, point: SamplePoint): Double? {
    val field = watches.find { it.name == name && !it.expression }?.field ?: "u32"
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

@Composable
private fun Detail(service: SwdWatchService, item: WatchItem) {
    var writeDraft by remember(item.id) { mutableStateOf(TextFieldValue("")) }
    var writeError by remember(item.id) { mutableStateOf("") }
    Column(Modifier.padding(top = 8.dp)) {
        Text(item.name)
        Text(item.error ?: item.value?.let { compact(it) } ?: "—")
        if (!item.expression) {
            Row {
                listOf("i32", "u32", "f32", "i16", "u16", "i8", "u8").forEach { field ->
                    OutlinedButton(onClick = { service.setField(item.id, field) }) {
                        Text(if (item.field == field) "[ $field ]" else field)
                    }
                }
            }
            Row {
                OutlinedButton(onClick = { service.setView(item.id, "value") }) { Text(if (item.view != "matrix") "[ 数值 ]" else "数值") }
                OutlinedButton(onClick = { service.setView(item.id, "matrix") }) { Text(if (item.view == "matrix") "[ 矩阵 ]" else "矩阵") }
            }
            Row(Modifier.padding(vertical = 4.dp)) {
                TextField(
                    value = writeDraft,
                    onValueChange = { writeDraft = it; writeError = "" },
                    modifier = Modifier.weight(1f),
                )
                DefaultButton(onClick = {
                    writeError = runCatching {
                        service.writeSymbol(item.id, writeDraft.text)
                        ""
                    }.getOrElse { it.message ?: "写入失败" }
                    if (writeError.isEmpty()) writeDraft = TextFieldValue("")
                }) { Text("写入") }
            }
            if (writeError.isNotEmpty()) Text(writeError)
            if (item.view == "matrix") MatrixEditor(service, item) else WordList(item)
        }
    }
}

@Composable
private fun WordList(item: WatchItem) {
    item.words.forEach { word ->
        val float = wordToFloat(word)
        val i32 = signedWord32(word)
        val u32 = unsignedWord(word)
        Text("${hexWord(word)}   i32: $i32   u32: $u32   ${if (float.isFinite()) "f32: ${compact(float)}" else ""}")
    }
}

@Composable
private fun MatrixEditor(service: SwdWatchService, item: WatchItem) {
    var rows by remember(item.id) { mutableStateOf(TextFieldValue(item.matrixRows.toString())) }
    var cols by remember(item.id) { mutableStateOf(TextFieldValue(item.matrixCols.toString())) }
    Row {
        TextField(value = rows, onValueChange = {
            rows = it
            service.setMatrix(item.id, it.text.toIntOrNull() ?: 1, item.matrixCols, item.matrixCell)
        })
        TextField(value = cols, onValueChange = {
            cols = it
            service.setMatrix(item.id, item.matrixRows, it.text.toIntOrNull() ?: 1, item.matrixCell)
        })
    }
    Row {
        listOf("u8", "i8", "u16", "i16", "u32", "i32", "f32").forEach { cell ->
            OutlinedButton(onClick = { service.setMatrix(item.id, item.matrixRows, item.matrixCols, cell) }) {
                Text(if (item.matrixCell == cell) "[ $cell ]" else cell)
            }
        }
    }
    val matrix = buildMatrix(item.words, item.matrixRows, item.matrixCols, item.matrixCell)
    if (matrix.note.isNotEmpty()) Text(matrix.note)
    matrix.grid.forEach { line -> Text(line.joinToString("  ")) }
}

@Composable
private fun SerialPage(service: SwdWatchService) {
    val ports by service.serialPorts.collectAsState()
    val opened by service.serialOpen.collectAsState()
    val device by service.serialDevice.collectAsState()
    val baudRate by service.serialBaud.collectAsState()
    val lines by service.serialLines.collectAsState()
    val error by service.serialError.collectAsState()
    var baud by remember { mutableStateOf(TextFieldValue(baudRate.toString())) }
    var draft by remember { mutableStateOf(TextFieldValue("")) }
    var mode by remember { mutableStateOf("text") }
    var view by remember { mutableStateOf("text") }
    var newline by remember { mutableStateOf(true) }
    var picked by remember { mutableStateOf(device) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(8.dp)) {
        Text(if (opened) "已打开 $device  $baudRate" else "未打开")
        if (error.isNotEmpty()) Text(error)
        OutlinedButton(onClick = { service.refreshPorts() }) { Text("刷新端口") }
        ports.forEach { name ->
            OutlinedButton(onClick = { picked = name }) { Text(if (picked == name) "[ $name ]" else name) }
        }
        TextField(value = baud, onValueChange = { baud = it }, modifier = Modifier.fillMaxWidth())
        Row {
            DefaultButton(onClick = {
                runCatching { service.openSerial(picked, baud.text.toIntOrNull() ?: 115200) }
            }) { Text("打开") }
            OutlinedButton(onClick = { service.closeSerial() }) { Text("关闭") }
            OutlinedButton(onClick = { view = "text" }) { Text(if (view == "text") "[ 文本 ]" else "文本") }
            OutlinedButton(onClick = { view = "hex" }) { Text(if (view == "hex") "[ HEX ]" else "HEX") }
        }
        Text(lines.joinToString("") { renderSerial(it, view) })
        Row {
            OutlinedButton(onClick = { mode = "text" }) { Text(if (mode == "text") "[ 文本发送 ]" else "文本发送") }
            OutlinedButton(onClick = { mode = "hex" }) { Text(if (mode == "hex") "[ HEX发送 ]" else "HEX发送") }
            Checkbox(checked = newline, onCheckedChange = { newline = it })
            Text("换行")
        }
        TextField(
            value = draft,
            onValueChange = { draft = it },
            modifier = Modifier.fillMaxWidth(),
        )
        DefaultButton(onClick = {
            val payload = if (mode == "hex") parseHexPayload(draft.text) else {
                val text = draft.text + if (newline) "\n" else ""
                text.toByteArray()
            }
            val bytes = if (mode == "hex" && newline) payload + byteArrayOf(0x0A) else payload
            runCatching { service.sendSerial(bytes) }
            draft = TextFieldValue("")
        }) { Text("发送") }
    }
}

private fun renderSerial(line: SerialLine, view: String): String {
    val prefix = if (line.dir == "tx") ">> " else "<< "
    val body = if (view == "hex") line.hex else line.text
    return prefix + body + "\n"
}

private val colors = listOf(Color(0xFFD6F56A), Color(0xFF7EC8FF), Color(0xFFEF7D6A), Color(0xFFE6C15A), Color(0xFFC9A0FF))
