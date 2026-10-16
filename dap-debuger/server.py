#!/usr/bin/env python3
"""Local UI server for the SWD symbol monitor.

Serves the built Vue app and a small JSON/SSE API. Memory reads still go
through the OpenOCD telnet session CLion already started.
"""

from __future__ import annotations

import argparse
import errno
import json
import sys
import math
import mimetypes
import queue
import struct
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Dict, List, Optional
from urllib.parse import parse_qs, urlparse

import watch_swd as swd

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "frontend" / "dist"
DEFAULT_PROJECT = (ROOT.parent / "radar").resolve()
LOG_DIR = ROOT / "logs"
MAX_SYMBOLS = 8


def _f32(word: int) -> Optional[float]:
    value = struct.unpack("<f", struct.pack("<I", word & 0xFFFFFFFF))[0]
    if not math.isfinite(value) or abs(value) > 1e12:
        return None
    return value


def _i32(word: int) -> int:
    return struct.unpack("<i", struct.pack("<I", word & 0xFFFFFFFF))[0]


class Hub:
    def __init__(self, project: Path, symbols: List[str], hz: float, host: str, telnet_port: Optional[int]) -> None:
        self.lock = threading.Lock()
        self.clients: List[queue.Queue] = []
        self.stop = threading.Event()
        self.project = str(project)
        self.symbols = list(symbols)
        self.hz = hz
        self.host = host
        self.telnet_port = telnet_port
        self.phase = "waiting"
        self.message = "等待 CLion / OpenOCD"
        self.elf: Optional[str] = None
        self.latest: Dict[str, dict] = {}
        self.stats = swd.Stats()
        self.recorder = None
        self._session = 0

    def subscribe(self) -> queue.Queue:
        q: queue.Queue = queue.Queue(maxsize=200)
        with self.lock:
            self.clients.append(q)
        return q

    def unsubscribe(self, q: queue.Queue) -> None:
        with self.lock:
            if q in self.clients:
                self.clients.remove(q)

    def publish(self, event: dict) -> None:
        with self.lock:
            clients = list(self.clients)
        for q in clients:
            try:
                q.put_nowait(event)
            except queue.Full:
                pass

    def snapshot(self) -> dict:
        with self.lock:
            return {
                "phase": self.phase,
                "message": self.message,
                "project": self.project,
                "elf": self.elf,
                "hz": self.hz,
                "host": self.host,
                "telnet_port": self.telnet_port,
                "symbols": [self.latest.get(name, {"name": name}) for name in self.symbols],
                "stats": {
                    "ok": self.stats.ok,
                    "fail": self.stats.fail,
                    "hz": round(self.stats.hz(), 2),
                    "rtt_p50": round(self.stats.percentile(50), 2),
                    "rtt_p95": round(self.stats.percentile(95), 2),
                },
                "recording": bool(self.recorder and self.recorder.active),
                "log": self.recorder.path.name if self.recorder and self.recorder.path else "",
            }

    def set_phase(self, phase: str, message: str, reset_stats: bool = False) -> None:
        with self.lock:
            changed = phase != self.phase or message != self.message
            self.phase = phase
            self.message = message
            if reset_stats:
                self.stats = swd.Stats()
                self._session += 1
        if changed or reset_stats:
            self.publish({"type": "state", **self.snapshot()})
            if phase == "streaming" and self.recorder is not None:
                self.recorder.ensure_started()

    def update_settings(self, body: dict) -> None:
        with self.lock:
            if "project" in body and body["project"]:
                self.project = str(Path(body["project"]).expanduser())
            if "hz" in body:
                hz = float(body["hz"])
                if hz <= 0 or hz > 50:
                    raise ValueError("hz must be in (0, 50]")
                self.hz = hz
            if "host" in body and body["host"]:
                self.host = str(body["host"])
            if "telnet_port" in body:
                port = body["telnet_port"]
                self.telnet_port = int(port) if port not in (None, "", 0) else None
        self.publish({"type": "state", **self.snapshot()})

    def add_symbol(self, name: str) -> None:
        name = name.strip()
        if not name:
            raise ValueError("empty symbol")
        with self.lock:
            if name in self.symbols:
                return
            if len(self.symbols) >= MAX_SYMBOLS:
                raise ValueError(f"at most {MAX_SYMBOLS} symbols")
            self.symbols.append(name)
        self.publish({"type": "state", **self.snapshot()})

    def remove_symbol(self, name: str) -> None:
        with self.lock:
            self.symbols = [s for s in self.symbols if s != name]
            self.latest.pop(name, None)
        self.publish({"type": "state", **self.snapshot()})

    def config(self) -> dict:
        with self.lock:
            return {
                "project": self.project,
                "symbols": list(self.symbols),
                "hz": self.hz,
                "host": self.host,
                "telnet_port": self.telnet_port,
            }

    def note_elf(self, elf: str) -> None:
        with self.lock:
            self.elf = elf

    def note_error(self, name: str, message: str) -> None:
        row = {"name": name, "error": message, "t": time.time()}
        with self.lock:
            self.latest[name] = row
            self.stats.record_fail()
        self.publish({"type": "sample", **row})

    def note_sample(self, sample: swd.WatchSample) -> None:
        word = sample.words[0] if sample.words else 0
        row = {
            "name": sample.symbol,
            "addr": f"0x{sample.addr:08X}",
            "size": sample.size,
            "words": [f"{w:08x}" for w in sample.words],
            "u32": word,
            "i32": _i32(word),
            "f32": _f32(word) if sample.size <= 4 else None,
            "rtt_ms": round(sample.latency_ms, 2),
            "error": None,
            "t": time.time(),
        }
        with self.lock:
            self.latest[sample.symbol] = row
            self.stats.record_ok(sample.latency_ms)
            row["hz"] = round(self.stats.hz(), 2)
        self.publish({"type": "sample", **row})
        if self.recorder is not None:
            self.recorder.write({"kind": "sample", **row})


def _monitor(hub: Hub) -> None:
    while not hub.stop.is_set():
        cfg = hub.config()
        ports = swd.candidate_ports(cfg["telnet_port"])
        port = next((p for p in ports if swd.tcp_open(cfg["host"], p)), None)
        if port is None:
            hub.set_phase("waiting", f"等待 OpenOCD telnet {cfg['host']}:{','.join(map(str, ports))}")
            hub.stop.wait(0.4)
            continue

        hub.set_phase("connecting", f"连接 {cfg['host']}:{port}", reset_stats=True)
        time.sleep(0.2)
        fail_streak = 0
        resolved: Dict[str, tuple] = {}
        elf_key = None
        try:
            with swd.OpenOcdTelnet(cfg["host"], port, timeout=2.5) as client:
                hub.set_phase("streaming", f"正在读取 {cfg['host']}:{port}")
                while not hub.stop.is_set():
                    cfg = hub.config()
                    interval = 1.0 / cfg["hz"]
                    t_loop = time.monotonic()
                    try:
                        elf = swd.find_latest_elf(Path(cfg["project"]))
                    except RuntimeError as exc:
                        hub.set_phase("error", str(exc))
                        hub.stop.wait(1.0)
                        break
                    key = (str(elf), elf.stat().st_mtime, tuple(cfg["symbols"]))
                    if key != elf_key:
                        resolved = {}
                        hub.note_elf(str(elf))
                        for name in cfg["symbols"]:
                            try:
                                resolved[name] = swd.resolve_symbol(elf, name)
                            except RuntimeError as exc:
                                hub.note_error(name, str(exc))
                        elf_key = key
                    if not cfg["symbols"]:
                        hub.set_phase("idle", "OpenOCD 已连接，添加一个符号开始监视")
                        hub.stop.wait(0.4)
                        continue
                    if hub.snapshot()["phase"] != "streaming":
                        hub.set_phase("streaming", f"正在读取 {cfg['host']}:{port}")
                    try:
                        for name in cfg["symbols"]:
                            if name not in resolved:
                                continue
                            addr, size = resolved[name]
                            try:
                                sample = swd.mdw_watch(client, addr, size, name)
                            except RuntimeError as exc:
                                hub.note_error(name, str(exc))
                                fail_streak += 1
                                continue
                            hub.note_sample(sample)
                            fail_streak = 0
                    except (OSError, ConnectionError, TimeoutError) as exc:
                        hub.set_phase("reconnecting", str(exc))
                        break
                    if fail_streak >= 40:
                        hub.set_phase("reconnecting", "连续读取失败")
                        break
                    if fail_streak:
                        time.sleep(min(interval * (1.5 ** min(fail_streak, 6)), 1.0))
                        try:
                            client.connect()
                        except OSError:
                            break
                        continue
                    spent = time.monotonic() - t_loop
                    hub.stop.wait(max(0.0, interval - spent))
        except (OSError, ConnectionError, TimeoutError, RuntimeError) as exc:
            hub.set_phase("reconnecting", str(exc))
        hub.stop.wait(0.5)


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
    """Raw serial console. Bytes are not parsed into watch channels."""

    def __init__(self, hub: Hub) -> None:
        self.hub = hub
        self.lock = threading.Lock()
        self.ser = None
        self.stop = threading.Event()
        self.thread: Optional[threading.Thread] = None
        self.port = ""
        self.baud = 115200

    def status(self) -> dict:
        with self.lock:
            open_ = self.ser is not None and bool(getattr(self.ser, "is_open", False))
            return {"open": open_, "port": self.port, "baud": self.baud}

    def list_ports(self) -> List[dict]:
        from serial.tools import list_ports

        return [
            {"device": item.device, "description": item.description or ""}
            for item in list_ports.comports()
        ]

    def open(self, port: str, baud: int) -> dict:
        import serial

        self.close()
        ser = serial.Serial(port, baudrate=int(baud), timeout=0.2)
        self.stop.clear()
        with self.lock:
            self.ser = ser
            self.port = port
            self.baud = int(baud)
        self.thread = threading.Thread(target=self._read_loop, name="serial-rx", daemon=True)
        self.thread.start()
        state = self.status()
        self.hub.publish({"type": "serial", "dir": "status", **state})
        return state

    def close(self) -> dict:
        self.stop.set()
        with self.lock:
            ser = self.ser
            self.ser = None
        if ser is not None:
            try:
                ser.close()
            except OSError:
                pass
        state = self.status()
        self.hub.publish({"type": "serial", "dir": "status", **state})
        return state

    def send(self, data: bytes) -> dict:
        with self.lock:
            ser = self.ser
        if ser is None or not getattr(ser, "is_open", False):
            raise RuntimeError("串口未打开")
        ser.write(data)
        self.hub.publish(
            {
                "type": "serial",
                "dir": "tx",
                "hex": data.hex(" "),
                "text": _serial_text(data),
            }
        )
        if self.hub.recorder is not None:
            self.hub.recorder.write({"kind": "serial", "dir": "tx", "hex": data.hex(" "), "text": _serial_text(data), "t": time.time()})
        return self.status()

    def _read_loop(self) -> None:
        while not self.stop.is_set():
            with self.lock:
                ser = self.ser
            if ser is None:
                return
            try:
                chunk = ser.read(4096)
            except OSError as exc:
                self.hub.publish({"type": "serial", "dir": "error", "text": str(exc)})
                self.close()
                return
            if not chunk:
                continue
            self.hub.publish(
                {
                    "type": "serial",
                    "dir": "rx",
                    "hex": chunk.hex(" "),
                    "text": _serial_text(chunk),
                }
            )
            if self.hub.recorder is not None:
                self.hub.recorder.write(
                    {"kind": "serial", "dir": "rx", "hex": chunk.hex(" "), "text": _serial_text(chunk), "t": time.time()}
                )


class Recorder:
    def __init__(self, directory: Path) -> None:
        self.directory = directory
        self.lock = threading.Lock()
        self.file = None
        self.path: Optional[Path] = None
        self.active = False
        self.hold = False

    def ensure_started(self) -> None:
        with self.lock:
            if self.hold or self.active:
                return
            self.directory.mkdir(parents=True, exist_ok=True)
            existing = sorted(self.directory.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
            for old in existing[19:]:
                try:
                    old.unlink()
                except OSError:
                    pass
            self.path = self.directory / time.strftime("session-%Y%m%d-%H%M%S.jsonl")
            self.file = self.path.open("a", encoding="utf-8")
            self.active = True

    def stop(self) -> None:
        with self.lock:
            self.hold = True
            self.active = False
            if self.file is not None:
                self.file.flush()
                self.file.close()
                self.file = None

    def resume(self) -> None:
        with self.lock:
            self.hold = False
        self.ensure_started()

    def write(self, row: dict) -> None:
        line = json.dumps(row, ensure_ascii=False) + "\n"
        with self.lock:
            if not self.active or self.file is None:
                return
            self.file.write(line)
            self.file.flush()

    def names(self) -> List[str]:
        if not self.directory.is_dir():
            return []
        return sorted((path.name for path in self.directory.glob("*.jsonl")), reverse=True)


class Handler(BaseHTTPRequestHandler):
    hub: Hub
    serial: SerialLink
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:
        return

    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length > 65536:
            raise ValueError("body too large")
        raw = self.rfile.read(length) if length else b"{}"
        data = json.loads(raw.decode() or "{}")
        if not isinstance(data, dict):
            raise ValueError("expected object")
        return data

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/snapshot":
            self._json(200, self.hub.snapshot())
            return
        if parsed.path == "/api/symbols":
            qs = parse_qs(parsed.query)
            query = (qs.get("q") or [""])[0]
            try:
                elf = swd.find_latest_elf(Path(self.hub.config()["project"]))
                rows = swd.list_data_symbols(elf, query)
            except RuntimeError as exc:
                self._json(400, {"error": str(exc)})
                return
            self._json(200, {"elf": str(elf), "symbols": rows})
            return
        if parsed.path == "/api/serial/ports":
            try:
                self._json(200, {"ports": self.serial.list_ports(), **self.serial.status()})
            except ImportError:
                self._json(500, {"error": "未安装 pyserial，请 pip install pyserial"})
            return
        if parsed.path == "/api/logs":
            name = (parse_qs(parsed.query).get("name") or [""])[0]
            if not name:
                self._json(200, {"logs": self.hub.recorder.names(), "recording": self.hub.recorder.active, "log": self.hub.snapshot()["log"]})
                return
            path = (LOG_DIR / Path(name).name).resolve()
            if path.parent != LOG_DIR.resolve() or not path.is_file():
                self._json(404, {"error": "找不到日志"})
                return
            lines = []
            for line in path.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    lines.append(json.loads(line))
            self._json(200, {"name": path.name, "events": lines})
            return
        if parsed.path == "/api/events":
            self._sse()
            return
        self._static(parsed.path)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        try:
            body = self._read_json()
            if parsed.path == "/api/settings":
                self.hub.update_settings(body)
            elif parsed.path == "/api/symbols/add":
                self.hub.add_symbol(str(body.get("name", "")))
            elif parsed.path == "/api/logs/stop":
                self.hub.recorder.stop()
                self._json(200, self.hub.snapshot())
                return
            elif parsed.path == "/api/logs/resume":
                self.hub.recorder.resume()
                self._json(200, self.hub.snapshot())
                return
            elif parsed.path == "/api/symbols/remove":
                self.hub.remove_symbol(str(body.get("name", "")))
            elif parsed.path == "/api/serial/open":
                state = self.serial.open(str(body.get("port", "")), int(body.get("baud", 115200)))
                self._json(200, state)
                return
            elif parsed.path == "/api/serial/close":
                self._json(200, self.serial.close())
                return
            elif parsed.path == "/api/serial/send":
                mode = str(body.get("mode", "text"))
                payload = str(body.get("data", ""))
                if mode == "hex":
                    data = parse_hex_payload(payload)
                else:
                    if body.get("newline"):
                        payload += "\n"
                    data = payload.encode("utf-8")
                self._json(200, self.serial.send(data))
                return
            else:
                self._json(404, {"error": "not found"})
                return
        except (ValueError, json.JSONDecodeError, KeyError, OSError, RuntimeError, ImportError) as exc:
            self._json(400, {"error": str(exc)})
            return
        self._json(200, self.hub.snapshot())

    def _sse(self) -> None:
        q = self.hub.subscribe()
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        try:
            hello = json.dumps({"type": "state", **self.hub.snapshot()}, ensure_ascii=False)
            self.wfile.write(f"data: {hello}\n\n".encode())
            self.wfile.flush()
            while not self.hub.stop.is_set():
                try:
                    event = q.get(timeout=15)
                except queue.Empty:
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
                    continue
                line = json.dumps(event, ensure_ascii=False)
                self.wfile.write(f"data: {line}\n\n".encode())
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            self.hub.unsubscribe(q)

    def _static(self, path: str) -> None:
        if not DIST.is_dir():
            body = "前端还没构建。请运行 ./start.sh\n".encode()
            self.send_response(503)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        rel = "index.html" if path in ("", "/") else path.lstrip("/")
        target = (DIST / rel).resolve()
        if not str(target).startswith(str(DIST.resolve())) or not target.is_file():
            target = DIST / "index.html"
        data = target.read_bytes()
        mime = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)


def main() -> int:
    parser = argparse.ArgumentParser(description="DAP SWD monitor UI server")
    parser.add_argument("--project", default=str(DEFAULT_PROJECT))
    parser.add_argument("--symbol", action="append", default=None)
    parser.add_argument("--hz", type=float, default=swd.DEFAULT_HZ)
    parser.add_argument("--host", default=swd.DEFAULT_HOST)
    parser.add_argument("--telnet-port", type=int, default=None)
    parser.add_argument("--ui-port", type=int, default=8765)
    args = parser.parse_args()
    symbols = args.symbol if args.symbol else [swd.DEFAULT_SYMBOL]
    hub = Hub(Path(args.project), symbols, args.hz, args.host, args.telnet_port)
    hub.recorder = Recorder(LOG_DIR)
    Handler.hub = hub
    Handler.serial = SerialLink(hub)
    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.ui_port), Handler)
    except OSError as exc:
        if exc.errno == errno.EADDRINUSE:
            print(
                f"端口 {args.ui_port} 已被占用。打开 http://127.0.0.1:{args.ui_port} ，"
                f"或换一个端口：UI_PORT=8766 ./start.sh",
                file=sys.stderr,
            )
            return 1
        raise
    thread = threading.Thread(target=_monitor, args=(hub,), name="swd-monitor", daemon=True)
    thread.start()
    print(f"DAP SWD monitor  http://127.0.0.1:{args.ui_port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstop", flush=True)
    finally:
        hub.stop.set()
        if hub.recorder is not None:
            hub.recorder.stop()
        Handler.serial.close()
        server.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
