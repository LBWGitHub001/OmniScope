package com.rm2027.swdwatch.engine

import com.fazecast.jSerialComm.SerialPort
import java.util.concurrent.atomic.AtomicBoolean

class SerialLink(
    private val onRx: (ByteArray) -> Unit,
    private val onError: (String) -> Unit,
) {
    private var port: SerialPort? = null
    private val running = AtomicBoolean(false)
    private var reader: Thread? = null
    var device: String = ""
        private set
    var baud: Int = 115200
        private set
    val isOpen: Boolean get() = port?.isOpen == true

    fun ports(): List<Pair<String, String>> =
        SerialPort.getCommPorts().map { it.systemPortName to (it.descriptivePortName ?: "") }

    fun open(name: String, rate: Int) {
        close()
        val opened = SerialPort.getCommPort(name)
        opened.setBaudRate(rate)
        opened.setComPortTimeouts(SerialPort.TIMEOUT_READ_SEMI_BLOCKING, 200, 0)
        if (!opened.openPort()) throw IllegalStateException("打开失败 $name")
        port = opened
        device = name
        baud = rate
        running.set(true)
        reader = Thread({
            val buffer = ByteArray(1024)
            while (running.get()) {
                val count = opened.readBytes(buffer, buffer.size)
                if (count > 0) onRx(buffer.copyOf(count))
            }
        }, "swd-serial").also { it.isDaemon = true; it.start() }
    }

    fun write(data: ByteArray) {
        val current = port ?: throw IllegalStateException("串口未打开")
        val wrote = current.writeBytes(data, data.size)
        if (wrote < 0) throw IllegalStateException("发送失败")
    }

    fun close() {
        running.set(false)
        reader?.interrupt()
        reader = null
        port?.closePort()
        port = null
    }
}

fun parseHexPayload(text: String): ByteArray {
    val raw = text.replace(",", " ").replace("0x", " ").replace("0X", " ").trim()
    if (raw.isEmpty()) return ByteArray(0)
    val parts = raw.split(Regex("\\s+"))
    if (parts.size == 1 && parts[0].length % 2 == 0) return parts[0].chunked(2).map { it.toInt(16).toByte() }.toByteArray()
    return parts.map { it.toInt(16).toByte() }.toByteArray()
}

fun serialText(data: ByteArray): String =
    data.toString(Charsets.UTF_8).map { ch -> if (ch == '\n' || ch == '\r' || ch == '\t' || ch.code >= 32) ch else '.' }.joinToString("")
