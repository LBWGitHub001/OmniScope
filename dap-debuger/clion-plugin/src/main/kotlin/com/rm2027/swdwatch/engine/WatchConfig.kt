package com.rm2027.swdwatch.engine

import java.nio.file.Files
import java.nio.file.Path

data class StoredWatch(
    val id: String,
    val name: String,
    val expression: Boolean,
    val source: String,
    val address: Long,
    val size: Int,
    val file: String,
    val plotted: Boolean,
    val field: String,
    val view: String,
    val matrixRows: Int,
    val matrixCols: Int,
    val matrixCell: String,
)

data class StoredConfig(val chartMode: String, val watches: List<StoredWatch>)

fun configFile(projectDir: Path): Path = projectDir.resolve(".idea").resolve("swd-watch.json")

fun loadConfig(file: Path): StoredConfig {
    if (!Files.isRegularFile(file)) return StoredConfig("time", emptyList())
    val text = Files.readString(file)
    val mode = jsonString(text, "chartMode") ?: "time"
    val watchesSection = text.substringAfter("\"watches\"", "")
    val watches = extractJsonObjects(watchesSection).mapNotNull { body ->
        StoredWatch(
            id = jsonString(body, "id") ?: return@mapNotNull null,
            name = jsonString(body, "name") ?: return@mapNotNull null,
            expression = jsonBool(body, "expression"),
            source = jsonString(body, "source") ?: "",
            address = jsonLong(body, "address"),
            size = jsonLong(body, "size").toInt().coerceAtLeast(0),
            file = jsonString(body, "file") ?: "",
            plotted = if (body.contains("\"plotted\"")) jsonBool(body, "plotted") else true,
            field = jsonString(body, "field") ?: "u32",
            view = jsonString(body, "view") ?: "value",
            matrixRows = jsonLong(body, "matrixRows").toInt().coerceAtLeast(1),
            matrixCols = jsonLong(body, "matrixCols").toInt().coerceAtLeast(1),
            matrixCell = jsonString(body, "matrixCell") ?: "u32",
        )
    }
    return StoredConfig(if (mode == "fn") "fn" else "time", watches)
}

private fun extractJsonObjects(text: String): List<String> {
    val results = mutableListOf<String>()
    var inString = false
    var escape = false
    var depth = 0
    var start = -1
    for (i in text.indices) {
        val c = text[i]
        if (escape) {
            escape = false
            continue
        }
        if (c == '\\' && inString) {
            escape = true
            continue
        }
        if (c == '"') {
            inString = !inString
            continue
        }
        if (!inString) {
            if (c == '{') {
                if (depth == 0) start = i
                depth++
            } else if (c == '}') {
                depth--
                if (depth == 0 && start != -1) {
                    results.add(text.substring(start, i + 1))
                    start = -1
                }
            }
        }
    }
    return results
}

fun saveConfig(file: Path, config: StoredConfig) {
    Files.createDirectories(file.parent)
    val rows = config.watches.joinToString(",\n") { item ->
        """    {"id":${quote(item.id)},"name":${quote(item.name)},"expression":${item.expression},"source":${quote(item.source)},"address":${item.address},"size":${item.size},"file":${quote(item.file)},"plotted":${item.plotted},"field":${quote(item.field)},"view":${quote(item.view)},"matrixRows":${item.matrixRows},"matrixCols":${item.matrixCols},"matrixCell":${quote(item.matrixCell)}}"""
    }
    Files.writeString(file, "{\n  \"chartMode\": ${quote(config.chartMode)},\n  \"watches\": [\n$rows\n  ]\n}\n")
}

fun quote(text: String): String {
    val escaped = buildString {
        for (ch in text) {
            when (ch) {
                '\\' -> append("\\\\")
                '"' -> append("\\\"")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> append(ch)
            }
        }
    }
    return "\"$escaped\""
}

internal fun jsonString(body: String, key: String): String? {
    val match = Regex(""""$key"\s*:\s*"((?:\\.|[^"])*)"""").find(body) ?: return null
    return unescape(match.groupValues[1])
}

private fun unescape(text: String): String = buildString {
    var index = 0
    while (index < text.length) {
        val ch = text[index]
        if (ch == '\\' && index + 1 < text.length) {
            append(when (val next = text[index + 1]) {
                'n' -> '\n'
                'r' -> '\r'
                't' -> '\t'
                else -> next
            })
            index += 2
        } else {
            append(ch)
            index++
        }
    }
}

private fun jsonBool(body: String, key: String): Boolean =
    Regex(""""$key"\s*:\s*(true|false)""").find(body)?.groupValues?.get(1) == "true"

private fun jsonLong(body: String, key: String): Long =
    Regex(""""$key"\s*:\s*(-?\d+)""").find(body)?.groupValues?.get(1)?.toLongOrNull() ?: 0
