"""Optional serial link handler for MCU UART monitoring."""

from __future__ import annotations

import threading
import time
from typing import Callable, List, Optional


def _serial_text(data: bytes) -> str:
    text = data.decode("utf-8", errors="replace")
    return "".join(ch if ch in "\r\n\t" or ord(ch) >= 32 else "." for ch in text)


def parse_hex_payload(text: str) -> bytes:
    raw = text.replace(",", " ").replace("0x", " ").replace("0X", " ").strip()
    if not raw:
        raise ValueError("empty hex")
    parts = raw.split()
    if len(parts) == 1 and len(parts[0]) % 2 == 0:
        return bytes.fromhex(parts[0])
    return bytes(int(part, 16) for part in parts)


class SerialLink:
    def __init__(self, publish_cb: Callable[[dict], None]) -> None:
        self.publish = publish_cb
        self.lock = threading.Lock()
        self.ser = None
        self.stop_ev = threading.Event()
        self.thread: Optional[threading.Thread] = None
        self.port = ""
        self.baud = 115200

    def status(self) -> dict:
        with self.lock:
            open_ = self.ser is not None and bool(getattr(self.ser, "is_open", False))
            return {"open": open_, "port": self.port, "baud": self.baud}

    def list_ports(self) -> List[dict]:
        try:
            from serial.tools import list_ports
            return [{"device": item.device, "description": item.description or ""} for item in list_ports.comports()]
        except ImportError:
            return []

    def open(self, port: str, baud: int) -> dict:
        import serial
        self.close()
        ser = serial.Serial(port, baudrate=int(baud), timeout=0.2)
        self.stop_ev.clear()
        with self.lock:
            self.ser = ser
            self.port = port
            self.baud = int(baud)
        self.thread = threading.Thread(target=self._read_loop, name="serial-rx", daemon=True)
        self.thread.start()
        st = self.status()
        self.publish({"type": "serial", "dir": "status", **st})
        return st

    def close(self) -> dict:
        self.stop_ev.set()
        with self.lock:
            ser = self.ser
            self.ser = None
        if ser is not None:
            try:
                ser.close()
            except OSError:
                pass
        st = self.status()
        self.publish({"type": "serial", "dir": "status", **st})
        return st

    def send(self, data: bytes) -> dict:
        with self.lock:
            ser = self.ser
        if ser is None or not getattr(ser, "is_open", False):
            raise RuntimeError("串口未打开")
        ser.write(data)
        self.publish({
            "type": "serial",
            "dir": "tx",
            "hex": data.hex(" "),
            "text": _serial_text(data),
        })
        return self.status()

    def _read_loop(self) -> None:
        while not self.stop_ev.is_set():
            with self.lock:
                ser = self.ser
            if ser is None:
                return
            try:
                chunk = ser.read(4096)
            except OSError as exc:
                self.publish({"type": "serial", "dir": "error", "text": str(exc)})
                self.close()
                return
            if not chunk:
                continue
            self.publish({
                "type": "serial",
                "dir": "rx",
                "hex": chunk.hex(" "),
                "text": _serial_text(chunk),
            })
