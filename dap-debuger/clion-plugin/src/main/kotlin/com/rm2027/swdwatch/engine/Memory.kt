package com.rm2027.swdwatch.engine

fun wordsToBytes(words: List<Long>): ByteArray {
    val out = ByteArray(words.size * 4)
    words.forEachIndexed { index, word ->
        val value = word.toInt()
        val base = index * 4
        out[base] = (value and 0xFF).toByte()
        out[base + 1] = ((value ushr 8) and 0xFF).toByte()
        out[base + 2] = ((value ushr 16) and 0xFF).toByte()
        out[base + 3] = ((value ushr 24) and 0xFF).toByte()
    }
    return out
}

fun bytesToWords(bytes: ByteArray): List<Long> {
    if (bytes.isEmpty()) return emptyList()
    val wordCount = (bytes.size + 3) / 4
    val words = ArrayList<Long>(wordCount)
    for (index in 0 until wordCount) {
        val base = index * 4
        var word = 0L
        for (i in 0 until 4) {
            val bytePos = base + i
            if (bytePos < bytes.size) {
                word = word or ((bytes[bytePos].toLong() and 0xFF) shl (i * 8))
            }
        }
        words.add(word)
    }
    return words
}

fun readAlignedMemory(client: OpenOcdClient, address: Long, sizeBytes: Int): List<Long> {
    val size = sizeBytes.coerceAtLeast(1)
    val offset = (address and 3L).toInt()
    val alignedAddr = address and 3L.inv()
    val span = offset + size
    val wordCount = ((span + 3) / 4).coerceIn(1, MAX_READ_BYTES / 4)
    val rawWords = client.mdw(alignedAddr, wordCount)
    if (offset == 0 && size % 4 == 0 && rawWords.size == size / 4) {
        return rawWords
    }
    val rawBytes = wordsToBytes(rawWords)
    val end = (offset + size).coerceAtMost(rawBytes.size)
    if (offset >= rawBytes.size) return emptyList()
    val targetBytes = rawBytes.copyOfRange(offset, end)
    return bytesToWords(targetBytes)
}

fun wordToFloat(word: Long): Double = Float.fromBits(word.toInt()).toDouble()

fun unsignedWord(word: Long): Long = word and 0xFFFFFFFFL

fun signedWord32(word: Long): Long = word.toInt().toLong()

fun signedWord16(word: Long): Long = word.toInt().toShort().toLong()

fun signedWord8(word: Long): Long = word.toInt().toByte().toLong()

fun cellWidth(cell: String): Int = when (cell) {
    "u8", "i8" -> 1
    "u16", "i16" -> 2
    else -> 4
}

data class MatrixView(val note: String, val grid: List<List<String>>)

fun buildMatrix(words: List<Long>, rows: Int, cols: Int, cell: String): MatrixView {
    val width = cellWidth(cell)
    val rowCount = rows.coerceAtLeast(1)
    val colCount = cols.coerceAtLeast(1)
    val need = rowCount * colCount
    val raw = wordsToBytes(words)
    val values = mutableListOf<String>()
    var offset = 0
    while (offset + width <= raw.size && values.size < need) {
        values += formatCell(raw, offset, cell)
        offset += width
    }
    val note = if (need * width > raw.size) "内存只够 ${values.size} 个元素" else ""
    val grid = (0 until rowCount).map { row ->
        (0 until colCount).map { column -> values.getOrElse(row * colCount + column) { "" } }
    }
    return MatrixView(note, grid)
}

fun formatCell(raw: ByteArray, offset: Int, cell: String): String = when (cell) {
    "u8" -> (raw[offset].toInt() and 0xFF).toString()
    "i8" -> raw[offset].toInt().toString()
    "u16" -> ((raw[offset].toInt() and 0xFF) or ((raw[offset + 1].toInt() and 0xFF) shl 8)).toString()
    "i16" -> (((raw[offset].toInt() and 0xFF) or ((raw[offset + 1].toInt() and 0xFF) shl 8)).toShort()).toString()
    "i32" -> (u32(raw, offset).toInt()).toString()
    "f32" -> {
        val bits = (raw[offset].toInt() and 0xFF) or
            ((raw[offset + 1].toInt() and 0xFF) shl 8) or
            ((raw[offset + 2].toInt() and 0xFF) shl 16) or
            ((raw[offset + 3].toInt() and 0xFF) shl 24)
        val number = Float.fromBits(bits).toDouble()
        if (number.isFinite()) compact(number) else "—"
    }
    else -> u32(raw, offset).toString()
}

fun u32(raw: ByteArray, offset: Int): Long =
    (raw[offset].toLong() and 0xFF) or
        ((raw[offset + 1].toLong() and 0xFF) shl 8) or
        ((raw[offset + 2].toLong() and 0xFF) shl 16) or
        ((raw[offset + 3].toLong() and 0xFF) shl 24)

fun compact(value: Double): String {
    val abs = kotlin.math.abs(value)
    return when {
        !value.isFinite() -> "—"
        abs >= 10000 || (abs > 0 && abs < 0.001) -> "%.4g".format(value)
        else -> "%.6g".format(value)
    }
}

fun hexWord(word: Long): String = unsignedWord(word).toString(16).padStart(8, '0')

fun hexAddr(address: Long): String = "0x" + address.toString(16).padStart(8, '0')

fun writeMemory(client: OpenOcdClient, address: Long, sizeBytes: Int, valueText: String, field: String) {
    val text = valueText.trim()
    if (text.isEmpty()) throw IllegalArgumentException("写入值不能为空")

    val isFloat = field == "f32"
    val isHex = text.startsWith("0x", ignoreCase = true)

    val wordVal: Long = when {
        isFloat -> {
            val f = text.toFloatOrNull() ?: throw IllegalArgumentException("无效浮点数: $text")
            f.toBits().toLong() and 0xFFFFFFFFL
        }
        isHex -> text.removePrefix("0x").removePrefix("0X").toLongOrNull(16)
            ?: throw IllegalArgumentException("无效十六进制: $text")
        else -> {
            val num = text.toLongOrNull() ?: throw IllegalArgumentException("无效整数: $text")
            num and 0xFFFFFFFFL
        }
    }

    val offset = (address and 3L).toInt()
    if (sizeBytes <= 1) {
        client.mwb(address, (wordVal and 0xFFL).toInt())
    } else if (sizeBytes <= 2 && offset % 2 == 0) {
        client.mwh(address, (wordVal and 0xFFFFL).toInt())
    } else if (offset == 0) {
        client.mww(address, wordVal)
    } else {
        val alignedAddr = address and 3L.inv()
        val rawWords = client.mdw(alignedAddr, 2)
        val rawBytes = wordsToBytes(rawWords)
        val valBytes = ByteArray(4) { i -> ((wordVal ushr (i * 8)) and 0xFF).toByte() }
        val limit = minOf(sizeBytes, 4)
        for (i in 0 until limit) {
            if (offset + i < rawBytes.size) {
                rawBytes[offset + i] = valBytes[i]
            }
        }
        val updatedWords = bytesToWords(rawBytes)
        if (updatedWords.isNotEmpty()) client.mww(alignedAddr, updatedWords[0])
        if (updatedWords.size > 1) client.mww(alignedAddr + 4, updatedWords[1])
    }
}
