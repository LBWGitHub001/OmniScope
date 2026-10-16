package com.rm2027.swdwatch.engine

import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException
import java.nio.charset.StandardCharsets
import java.nio.file.Files

class OpenOcdClient(private val host: String = "127.0.0.1", private val port: Int = 4444) {
    private var socket: Socket? = null
    private val pending = StringBuilder()

    fun connect() {
        close()
        val opened = Socket()
        opened.connect(InetSocketAddress(host, port), 1500)
        opened.soTimeout = 400
        socket = opened
        pending.clear()
        readUntilPrompt(2000)
    }

    fun close() {
        runCatching { socket?.close() }
        socket = null
        pending.clear()
    }

    fun mdw(address: Long, words: Int): List<Long> {
        val count = words.coerceAtLeast(1)
        val body = command("mdw 0x%08x %d".format(address, count))
        return parseMdw(body, count)
    }

    fun mww(address: Long, value: Long) {
        command("mww 0x%08x 0x%08x".format(address, value and 0xFFFFFFFFL))
    }

    fun mwh(address: Long, value: Int) {
        command("mwh 0x%08x 0x%04x".format(address, value and 0xFFFF))
    }

    fun mwb(address: Long, value: Int) {
        command("mwb 0x%08x 0x%02x".format(address, value and 0xFF))
    }

    private fun command(text: String): String {
        val verb = text.trim().substringBefore(' ').lowercase()
        if (verb !in setOf("mdw", "mww", "mwh", "mwb")) throw IllegalStateException("只支持只读/只写指令，拒绝 $verb")
        val out = socket?.getOutputStream() ?: throw IllegalStateException("未连接")
        out.write((text.trim() + "\n").toByteArray(StandardCharsets.UTF_8))
        out.flush()
        val raw = readUntilPrompt(2000)
        return raw.lineSequence()
            .map { it.trim() }
            .filter { it.isNotEmpty() && it != text.trim() && it != ">" }
            .joinToString("\n")
    }

    private fun readUntilPrompt(timeoutMs: Int): String {
        val input = socket?.getInputStream() ?: throw IllegalStateException("未连接")
        val deadline = System.currentTimeMillis() + timeoutMs
        val chunk = ByteArray(4096)
        while (System.currentTimeMillis() < deadline) {
            val ready = takePrompt()
            if (ready != null) return ready
            val remain = (deadline - System.currentTimeMillis()).toInt().coerceAtLeast(50)
            socket?.soTimeout = remain.coerceAtMost(400)
            try {
                val count = input.read(chunk)
                if (count < 0) throw IllegalStateException("OpenOCD 已断开")
                pending.append(stripTelnet(chunk.copyOf(count)))
            } catch (_: SocketTimeoutException) {
            }
        }
        throw IllegalStateException("等待 OpenOCD 提示符超时")
    }

    private fun takePrompt(): String? {
        val text = pending.toString()
        val mark = text.lastIndexOf('>')
        if (mark < 0) return null
        val ready = text.contains("\n>") || text.endsWith(">") || text.endsWith("> ")
        if (!ready) return null
        pending.clear()
        pending.append(text.substring(mark + 1))
        return text.substring(0, mark + 1)
    }
}

private val mdwLine = Regex("""0x[0-9a-fA-F]+:\s+((?:[0-9a-fA-F]{8}\s*)+)""")

fun parseMdw(body: String, expectWords: Int): List<Long> {
    val words = mutableListOf<Long>()
    for (raw in body.lineSequence()) {
        val line = raw.trim()
        if (line.isEmpty()) continue
        if (Regex("""\b(error|fail|unable|invalid)\b""", RegexOption.IGNORE_CASE).containsMatchIn(line) && "0x" !in line.lowercase()) {
            throw IllegalStateException(line)
        }
        val match = mdwLine.find(line) ?: continue
        match.groupValues[1].trim().split(Regex("\\s+")).forEach { words += it.toLong(16) }
    }
    if (words.size < expectWords) {
        throw IllegalStateException("mdw 返回 ${words.size} 个字，需要 $expectWords")
    }
    return words.take(expectWords)
}

private fun stripTelnet(data: ByteArray): String {
    val out = StringBuilder()
    var index = 0
    while (index < data.size) {
        val value = data[index].toInt() and 0xFF
        if (value == 0x00) {
            index++
            continue
        }
        if (value == 0xFF && index + 1 < data.size) {
            val command = data[index + 1].toInt() and 0xFF
            if (command == 0xFF) {
                out.append('\u00FF')
                index += 2
                continue
            }
            if (command == 0xFA) {
                index += 2
                while (index < data.size) {
                    val byte = data[index].toInt() and 0xFF
                    if (byte == 0xFF && index + 1 < data.size && (data[index + 1].toInt() and 0xFF) == 0xF0) {
                        index += 2
                        break
                    }
                    index++
                }
                continue
            }
            index += if (command in setOf(0xFB, 0xFC, 0xFD, 0xFE) && index + 2 < data.size) 3 else 2
            continue
        }
        if (value >= 32 || value == 10 || value == 13 || value == 9) out.append(value.toChar())
        index++
    }
    return out.toString()
}

fun discoverTelnetPort(): Int {
    val ports = mutableListOf<Int>()
    // 1. Universal modern JVM process scan (Linux, Windows, macOS)
    runCatching {
        ProcessHandle.allProcesses().forEach { handle ->
            val info = handle.info()
            val cmd = (info.command().orElse("") + " " + info.commandLine().orElse("")).lowercase()
            if (cmd.contains("openocd")) {
                val full = info.commandLine().orElse("")
                for (match in Regex("telnet_port\\s+(disabled|\\d+)", RegexOption.IGNORE_CASE).findAll(full)) {
                    val value = match.groupValues[1]
                    if (!value.equals("disabled", ignoreCase = true)) ports += value.toInt()
                }
            }
        }
    }

    // 2. Linux fallback via /proc if ProcessHandle command details are restricted
    if (ports.isEmpty()) {
        val root = java.nio.file.Path.of("/proc")
        if (Files.isDirectory(root)) {
            runCatching {
                Files.newDirectoryStream(root).use { entries ->
                    for (entry in entries) {
                        if (!entry.fileName.toString().all { it.isDigit() }) continue
                        val command = runCatching { Files.readString(entry.resolve("cmdline")).replace('\u0000', ' ') }.getOrNull() ?: continue
                        if (!command.contains("openocd", ignoreCase = true)) continue
                        for (match in Regex("telnet_port\\s+(disabled|\\d+)", RegexOption.IGNORE_CASE).findAll(command)) {
                            val value = match.groupValues[1]
                            if (!value.equals("disabled", ignoreCase = true)) ports += value.toInt()
                        }
                    }
                }
            }
        }
    }

    val candidates = (ports.distinct() + listOf(4444, 4445)).distinct()
    for (p in candidates) {
        if (isPortOpen("127.0.0.1", p)) return p
    }
    return candidates.firstOrNull() ?: 4444
}

fun isPortOpen(host: String, port: Int): Boolean {
    return runCatching {
        java.net.Socket().use { s ->
            s.connect(java.net.InetSocketAddress(host, port), 120)
            true
        }
    }.getOrDefault(false)
}
