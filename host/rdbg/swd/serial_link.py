"""Optional serial link handler for MCU UART monitoring."""

from __future__ import annotations

import glob
import os
import select
import sys
import threading
import time
from typing import Callable, List, Optional

try:
    import termios
except ImportError:
    termios = None


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


class _PosixSerial:
    """Zero-dependency POSIX serial/PTY wrapper using standard library os, termios, select."""

    def __init__(self, port: str, baudrate: int = 115200, timeout: float = 0.2):
        self.port = port
        self.baudrate = baudrate
        self.timeout = timeout
        self.is_open = False
        self.fd = os.open(port, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
        try:
            if termios and os.isatty(self.fd):
                attrs = termios.tcgetattr(self.fd)
                attrs[3] = attrs[3] & ~(termios.ECHO | termios.ECHONL | termios.ICANON | termios.ISIG | termios.IEXTEN)
                attrs[1] = attrs[1] & ~termios.OPOST
                cflags_mask = termios.CSIZE | termios.PARENB | termios.CSTOPB
                if hasattr(termios, "CRTSCTS"):
                    cflags_mask |= termios.CRTSCTS
                attrs[2] = (attrs[2] & ~cflags_mask) | termios.CS8 | termios.CREAD | termios.CLOCAL
                attrs[0] = attrs[0] & ~(termios.IXON | termios.IXOFF | termios.IXANY | termios.ICRNL | termios.INLCR | termios.IGNCR)

                baud_map = {
                    9600: termios.B9600,
                    19200: termios.B19200,
                    38400: termios.B38400,
                    57600: termios.B57600,
                    115200: termios.B115200,
                    230400: termios.B230400,
                    460800: getattr(termios, "B460800", termios.B115200),
                    921600: getattr(termios, "B921600", termios.B115200),
                    1000000: getattr(termios, "B1000000", termios.B115200),
                    2000000: getattr(termios, "B2000000", termios.B115200),
                }
                speed = baud_map.get(int(baudrate), termios.B115200)
                attrs[4] = speed
                attrs[5] = speed
                termios.tcsetattr(self.fd, termios.TCSANOW, attrs)
            self.is_open = True
        except Exception:
            try:
                os.close(self.fd)
            except OSError:
                pass
            raise

    def read(self, size: int = 4096) -> bytes:
        if not self.is_open:
            return b""
        r, _, _ = select.select([self.fd], [], [], self.timeout)
        if self.fd in r:
            try:
                return os.read(self.fd, size)
            except (BlockingIOError, OSError):
                return b""
        return b""

    def write(self, data: bytes) -> int:
        if not self.is_open:
            raise RuntimeError("Port not open")
        return os.write(self.fd, data)

    def close(self):
        if self.is_open:
            self.is_open = False
            try:
                os.close(self.fd)
            except OSError:
                pass


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
        ports = []
        try:
            from serial.tools import list_ports
            ports = [{"device": item.device, "description": item.description or ""} for item in list_ports.comports()]
        except Exception:
            pass
        if not ports:
            for p in sorted(glob.glob("/dev/ttyUSB*") + glob.glob("/dev/ttyACM*")):
                ports.append({"device": p, "description": "USB/ACM Serial Device"})
        return ports

    def open(self, port: str, baud: int) -> dict:
        self.close()
        ser = None
        try:
            import serial
            ser = serial.Serial(port, baudrate=int(baud), timeout=0.2)
        except ImportError:
            ser = _PosixSerial(port, baudrate=int(baud), timeout=0.2)

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
