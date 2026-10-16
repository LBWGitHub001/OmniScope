package com.rm2027.swdwatch.engine

import java.nio.file.Files
import java.nio.file.Path
import java.util.Comparator

data class SymbolInfo(val name: String, val address: Long, val size: Int, val file: String)

private val sized = Regex("""^([0-9a-fA-F]+)\s+([0-9a-fA-F]+)\s+([A-Za-z])\s+(\S+)$""")
private val plain = Regex("""^([0-9a-fA-F]+)\s+([A-Za-z])\s+(\S+)$""")
private val dataTypes = "BbDdGgSsVvRr".toSet()
const val MAX_READ_BYTES = 1024

fun listSymbols(elf: Path, query: String, limit: Int = 80): List<SymbolInfo> {
    val needle = query.lowercase()
    return readSymbols(elf)
        .filter { needle.isEmpty() || needle in it.name.lowercase() }
        .sortedWith(compareBy({ !it.name.lowercase().startsWith(needle) }, { it.name.lowercase() }))
        .take(limit)
}

fun readSymbols(elf: Path): List<SymbolInfo> {
    val nm = findNm(elf)
    val process = ProcessBuilder(nm, "-l", "-S", elf.toString()).redirectErrorStream(true).start()
    val text = process.inputStream.bufferedReader().readText()
    if (process.waitFor() != 0) throw IllegalStateException(text.lineSequence().firstOrNull { it.isNotBlank() } ?: "nm 失败")
    val rows = mutableListOf<SymbolInfo>()
    for (line in text.lineSequence()) {
        val parts = line.trim().split('\t', limit = 2)
        val body = parts[0].trim()
        val match = sized.matchEntire(body) ?: plain.matchEntire(body) ?: continue
        val typed = match.groupValues.size > 4
        val type = match.groupValues[if (typed) 3 else 2]
        if (type.first() !in dataTypes) continue
        val name = match.groupValues.last()
        val address = match.groupValues[1].toLong(16)
        val rawSize = if (typed) match.groupValues[2].toLong(16).toInt() else 0
        val size = (if (rawSize > 0) rawSize else 4).coerceAtMost(MAX_READ_BYTES)
        val file = parts.getOrNull(1)?.substringBefore(':')?.substringAfterLast('/') ?: ""
        rows += SymbolInfo(name, address, size, file)
    }
    return rows
}

fun newestElf(projectDir: Path): Path? {
    if (!Files.isDirectory(projectDir)) return null
    val found = ArrayList<Path>()
    Files.walk(projectDir, 6).use { stream ->
        val iterator = stream.iterator()
        while (iterator.hasNext()) {
            val path = iterator.next()
            val text = path.toString()
            if (text.endsWith(".elf") && "cmake-build" in text && Files.isRegularFile(path)) found.add(path)
        }
    }
    return found.maxWithOrNull(Comparator.comparingLong { Files.getLastModifiedTime(it).toMillis() })
}

private fun findNm(elf: Path): String {
    searchPath("arm-none-eabi-nm")?.let { return it }
    searchPath("nm")?.let { return it }
    var dir = elf.parent
    repeat(5) {
        val cache = dir?.resolve("CMakeCache.txt") ?: return@repeat
        if (Files.isRegularFile(cache)) {
            for (line in Files.readAllLines(cache)) {
                if (line.startsWith("CMAKE_NM:")) {
                    val candidate = line.substringAfter('=').trim()
                    if (candidate.isNotEmpty() && Files.isExecutable(Path.of(candidate))) return candidate
                }
            }
        }
        dir = dir.parent
    }
    throw IllegalStateException("找不到 arm-none-eabi-nm 或 nm")
}

private fun searchPath(name: String): String? {
    val path = System.getenv("PATH") ?: return null
    val separator = java.io.File.pathSeparatorChar
    val isWindows = System.getProperty("os.name").lowercase().contains("win")
    val extensions = if (isWindows) listOf("", ".exe", ".cmd", ".bat") else listOf("")
    for (dir in path.split(separator)) {
        if (dir.isBlank()) continue
        for (ext in extensions) {
            val file = Path.of(dir, name + ext)
            if (Files.isExecutable(file) && !Files.isDirectory(file)) {
                return file.toString()
            }
        }
    }
    return null
}
