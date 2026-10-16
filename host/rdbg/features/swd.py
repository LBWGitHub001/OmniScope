"""SWD Live Memory Monitor feature — connects via OpenOCD telnet without halting MCU."""

from __future__ import annotations

import json
import queue
import time
from pathlib import Path
from typing import Dict, List, Optional
from urllib.parse import parse_qs

from ..http.sse import SSEQueue, write_sse
from ..swd.client import (
    DEFAULT_HOST,
    DEFAULT_HZ,
    DEFAULT_SYMBOL,
    OpenOcdTelnet,
    Stats,
    _f32,
    _i32,
    _u32,
    candidate_ports,
    find_latest_elf,
    list_data_symbols,
    mdw_watch,
    resolve_symbol,
    tcp_open,
)
from ..swd.recorder import Recorder
from ..swd.serial_link import SerialLink, parse_hex_payload
from .base import Feature, json_body, send_json

MAX_SYMBOLS = 8


class SwdFeature(Feature):
    id = "swd"
    title = "SWD Monitor"
    description = "OpenOCD SWD 内存符号非侵入式实时监视与调试"

    def __init__(self):
        super().__init__()
        self.sse = SSEQueue()
        self._clients: List[SSEQueue] = []
        self._swd_lock = self._lock

        # Default project fallback: check if ../radar or ./ exists
        default_proj = Path.cwd().parent / "radar"
        if not default_proj.exists():
            default_proj = Path.cwd()

        self.project = str(default_proj)
        self.symbols: List[str] = [DEFAULT_SYMBOL]
        self.hz = DEFAULT_HZ
        self.host = DEFAULT_HOST
        self.telnet_port: Optional[int] = None
        self.phase = "waiting"
        self.message = "等待 CLion / OpenOCD"
        self.elf: Optional[str] = None
        self.latest: Dict[str, dict] = {}
        self.stats = Stats()

        log_dir = Path.cwd() / "logs" / "swd"
        self.recorder = Recorder(log_dir)
        self.serial = SerialLink(self.publish)

    def attach(self, shell):
        p = getattr(self, "api_prefix", f"/api/{self.id}")
        shell.route(p + "/events", self._handle_events)
        shell.route(p + "/snapshot", self._handle_snapshot)
        shell.route(p + "/symbols", self._handle_symbols)
        shell.route(p + "/symbols/add", self._handle_symbols_add, methods=("POST",))
        shell.route(p + "/symbols/remove", self._handle_symbols_remove, methods=("POST",))
        shell.route(p + "/settings", self._handle_settings, methods=("POST",))
        shell.route(p + "/serial/ports", self._handle_serial_ports)
        shell.route(p + "/serial/open", self._handle_serial_open, methods=("POST",))
        shell.route(p + "/serial/close", self._handle_serial_close, methods=("POST",))
        shell.route(p + "/serial/send", self._handle_serial_send, methods=("POST",))
        shell.route(p + "/logs", self._handle_logs)
        shell.route(p + "/logs/stop", self._handle_logs_stop, methods=("POST",))
        shell.route(p + "/logs/resume", self._handle_logs_resume, methods=("POST",))

    def on_start(self, config):
        if "project" in config and config["project"]:
            self.project = str(Path(config["project"]).expanduser())
        if "symbols" in config and isinstance(config["symbols"], list):
            self.symbols = [str(s).strip() for s in config["symbols"] if str(s).strip()][:MAX_SYMBOLS]
        if "hz" in config:
            self.hz = float(config["hz"])
        if "host" in config:
            self.host = str(config["host"])
        if "telnet_port" in config:
            tp = config["telnet_port"]
            self.telnet_port = int(tp) if tp not in (None, "", 0) else None

    def on_stop(self):
        self.recorder.stop()
        self.serial.close()

    def publish(self, event: dict) -> None:
        line = json.dumps(event, ensure_ascii=False)
        self.sse.put(line)
        with self._swd_lock:
            clients = list(self._clients)
        for q in clients:
            try:
                q.put(line)
            except Exception:
                pass

    def snapshot(self) -> dict:
        with self._swd_lock:
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
        with self._swd_lock:
            changed = phase != self.phase or message != self.message
            self.phase = phase
            self.message = message
            if reset_stats:
                self.stats = Stats()
        if changed or reset_stats:
            self.publish({"type": "state", **self.snapshot()})
            if phase == "streaming" and self.recorder is not None:
                self.recorder.ensure_started()

    def update_settings(self, body: dict) -> None:
        with self._swd_lock:
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
        with self._swd_lock:
            if name in self.symbols:
                return
            if len(self.symbols) >= MAX_SYMBOLS:
                raise ValueError(f"at most {MAX_SYMBOLS} symbols")
            self.symbols.append(name)
        self.publish({"type": "state", **self.snapshot()})

    def remove_symbol(self, name: str) -> None:
        with self._swd_lock:
            self.symbols = [s for s in self.symbols if s != name]
            self.latest.pop(name, None)
        self.publish({"type": "state", **self.snapshot()})

    def note_elf(self, elf: str) -> None:
        with self._swd_lock:
            self.elf = elf

    def note_error(self, name: str, message: str) -> None:
        row = {"name": name, "error": message, "t": time.time()}
        with self._swd_lock:
            self.latest[name] = row
            self.stats.record_fail()
        self.publish({"type": "sample", **row})

    def note_sample(self, sample) -> None:
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
        with self._swd_lock:
            self.latest[sample.symbol] = row
            self.stats.record_ok(sample.latency_ms)
            row["hz"] = round(self.stats.hz(), 2)
        self.publish({"type": "sample", **row})
        if self.recorder is not None:
            self.recorder.write({"kind": "sample", **row})

    def run(self, stop_event):
        while not stop_event.is_set():
            cfg = self.snapshot()
            ports = candidate_ports(cfg["telnet_port"])
            port = next((p for p in ports if tcp_open(cfg["host"], p)), None)
            if port is None:
                self.set_phase("waiting", f"等待 OpenOCD telnet {cfg['host']}:{','.join(map(str, ports))}")
                stop_event.wait(0.4)
                continue

            self.set_phase("connecting", f"连接 {cfg['host']}:{port}", reset_stats=True)
            time.sleep(0.2)
            fail_streak = 0
            resolved: Dict[str, tuple] = {}
            elf_key = None
            try:
                with OpenOcdTelnet(cfg["host"], port, timeout=2.5) as client:
                    self.set_phase("streaming", f"正在读取 {cfg['host']}:{port}")
                    while not stop_event.is_set():
                        cfg = self.snapshot()
                        interval = 1.0 / max(0.1, cfg["hz"])
                        t_loop = time.monotonic()
                        try:
                            elf = find_latest_elf(Path(cfg["project"]))
                        except RuntimeError as exc:
                            self.set_phase("error", str(exc))
                            stop_event.wait(1.0)
                            break

                        key = (str(elf), elf.stat().st_mtime, tuple(self.symbols))
                        if key != elf_key:
                            resolved = {}
                            self.note_elf(str(elf))
                            for name in self.symbols:
                                try:
                                    resolved[name] = resolve_symbol(elf, name)
                                except RuntimeError as exc:
                                    self.note_error(name, str(exc))
                            elf_key = key

                        if not self.symbols:
                            self.set_phase("idle", "OpenOCD 已连接，添加一个符号开始监视")
                            stop_event.wait(0.4)
                            continue

                        if self.phase != "streaming":
                            self.set_phase("streaming", f"正在读取 {cfg['host']}:{port}")

                        try:
                            for name in self.symbols:
                                if name not in resolved:
                                    continue
                                addr, size = resolved[name]
                                try:
                                    sample = mdw_watch(client, addr, size, name)
                                except RuntimeError as exc:
                                    self.note_error(name, str(exc))
                                    fail_streak += 1
                                    continue
                                self.note_sample(sample)
                                fail_streak = 0
                        except (OSError, ConnectionError, TimeoutError) as exc:
                            self.set_phase("reconnecting", str(exc))
                            break

                        if fail_streak >= 40:
                            self.set_phase("reconnecting", "连续读取失败")
                            break
                        if fail_streak:
                            time.sleep(min(interval * (1.5 ** min(fail_streak, 6)), 1.0))
                            try:
                                client.connect()
                            except OSError:
                                break
                            continue

                        spent = time.monotonic() - t_loop
                        stop_event.wait(max(0.0, interval - spent))
            except (OSError, ConnectionError, TimeoutError, RuntimeError) as exc:
                self.set_phase("reconnecting", str(exc))
            stop_event.wait(0.5)

    def _handle_events(self, handler):
        q = SSEQueue()
        with self._swd_lock:
            self._clients.append(q)

        def _cleanup():
            with self._swd_lock:
                if q in self._clients:
                    self._clients.remove(q)

        # Send initial snapshot on connect
        snap = self.snapshot()
        q.put(json.dumps({"type": "state", **snap}, ensure_ascii=False))

        try:
            write_sse(handler, q)
        finally:
            _cleanup()

    def _handle_snapshot(self, handler):
        send_json(handler, self.snapshot())

    def _handle_symbols(self, handler):
        query = (handler.query.get("q") or [""])[0] if handler.query else ""
        try:
            elf = find_latest_elf(Path(self.project))
            rows = list_data_symbols(elf, query)
            send_json(handler, {"elf": str(elf), "symbols": rows})
        except RuntimeError as exc:
            send_json(handler, {"error": str(exc)}, code=400)

    def _handle_symbols_add(self, handler):
        body = json_body(handler)
        name = str(body.get("name", "")).strip()
        try:
            self.add_symbol(name)
            send_json(handler, {"ok": True, **self.snapshot()})
        except ValueError as exc:
            send_json(handler, {"error": str(exc)}, code=400)

    def _handle_symbols_remove(self, handler):
        body = json_body(handler)
        name = str(body.get("name", "")).strip()
        self.remove_symbol(name)
        send_json(handler, {"ok": True, **self.snapshot()})

    def _handle_settings(self, handler):
        body = json_body(handler)
        try:
            self.update_settings(body)
            send_json(handler, {"ok": True, **self.snapshot()})
        except ValueError as exc:
            send_json(handler, {"error": str(exc)}, code=400)

    def _handle_serial_ports(self, handler):
        send_json(handler, {"ports": self.serial.list_ports(), **self.serial.status()})

    def _handle_serial_open(self, handler):
        body = json_body(handler)
        try:
            st = self.serial.open(str(body.get("port", "")), int(body.get("baud", 115200)))
            send_json(handler, st)
        except Exception as exc:
            send_json(handler, {"error": str(exc)}, code=400)

    def _handle_serial_close(self, handler):
        st = self.serial.close()
        send_json(handler, st)

    def _handle_serial_send(self, handler):
        body = json_body(handler)
        mode = str(body.get("mode", "text"))
        payload = str(body.get("data", ""))
        try:
            if mode == "hex":
                data = parse_hex_payload(payload)
            else:
                if body.get("newline"):
                    payload += "\n"
                data = payload.encode("utf-8")
            st = self.serial.send(data)
            send_json(handler, st)
        except Exception as exc:
            send_json(handler, {"error": str(exc)}, code=400)

    def _handle_logs(self, handler):
        name = (handler.query.get("name") or [""])[0] if handler.query else ""
        if not name:
            send_json(handler, {
                "logs": self.recorder.names(),
                "recording": self.recorder.active,
                "log": self.snapshot()["log"],
            })
            return
        log_dir = self.recorder.directory
        path = (log_dir / Path(name).name).resolve()
        if path.parent != log_dir.resolve() or not path.is_file():
            send_json(handler, {"error": "找不到日志"}, code=404)
            return
        lines = []
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                try:
                    lines.append(json.loads(line))
                except Exception:
                    pass
        send_json(handler, {"name": path.name, "events": lines})

    def _handle_logs_stop(self, handler):
        self.recorder.stop()
        send_json(handler, self.snapshot())

    def _handle_logs_resume(self, handler):
        self.recorder.resume()
        send_json(handler, self.snapshot())
