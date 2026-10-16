package com.rm2027.swdwatch.engine

import java.nio.file.Files
import java.nio.file.Path
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

class SessionLog(private val directory: Path) {
    private var writer: java.io.BufferedWriter? = null
    var active: Boolean = false
        private set
    var hold: Boolean = false
        private set
    var path: Path? = null
        private set

    @Synchronized
    fun ensureStarted() {
        if (hold || active) return
        Files.createDirectories(directory)
        cleanupOldLogs(20)
        val name = "session-" + DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss").format(LocalDateTime.now()) + ".jsonl"
        path = directory.resolve(name)
        writer = Files.newBufferedWriter(path)
        active = true
    }

    private fun cleanupOldLogs(maxRetention: Int) {
        runCatching {
            if (!Files.isDirectory(directory)) return
            val files = Files.list(directory).use { stream ->
                stream.filter { it.toString().endsWith(".jsonl") }
                    .sorted { p1, p2 -> Files.getLastModifiedTime(p2).compareTo(Files.getLastModifiedTime(p1)) }
                    .toList()
            }
            if (files.size >= maxRetention) {
                files.drop(maxRetention - 1).forEach { oldFile ->
                    runCatching { Files.deleteIfExists(oldFile) }
                }
            }
        }
    }

    @Synchronized
    fun write(line: String) {
        val out = writer ?: return
        if (!active) return
        out.write(line)
        out.newLine()
        out.flush()
    }

    @Synchronized
    fun stop() {
        hold = true
        closeWriter()
    }

    @Synchronized
    fun finishSession() {
        closeWriter()
    }

    @Synchronized
    fun resume() {
        hold = false
        ensureStarted()
    }

    fun names(): List<String> {
        if (!Files.isDirectory(directory)) return emptyList()
        return Files.list(directory).use { stream ->
            stream.filter { it.toString().endsWith(".jsonl") }
                .map { it.fileName.toString() }
                .sorted()
                .toList()
                .asReversed()
        }
    }

    fun file(name: String): Path? {
        val resolved = directory.resolve(name).normalize()
        if (!resolved.startsWith(directory.normalize())) return null
        return resolved.takeIf { Files.isRegularFile(it) }
    }

    @Synchronized
    private fun closeWriter() {
        active = false
        writer?.flush()
        writer?.close()
        writer = null
    }
}
