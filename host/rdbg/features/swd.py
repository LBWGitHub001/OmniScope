"""SWD Live Memory Monitor feature — connects via OpenOCD telnet without halting MCU.

Beyond the legacy manual nm-symbol watch, this feature auto-discovers the
OmniScope embedded structures (sdk/embedded: plot.h / watch.h / mailbox.h)
via well-known ELF symbols and serves them under a bandwidth scheduler:

    priority 1: parameter entries      -> read at 1 Hz
    priority 2: monitor scalars (+nm)  -> read every tick (hz, default 30)
    priority 3: plot FIFO drain        -> idle time, adaptive batch
    priority 4: array payload fetch    -> idle time, version-gated chunks

A rolling 1-second byte meter caps total SWD traffic at `rate_limit_bps`;
low-priority work is skipped once the budget is exhausted.
"""

from __future__ import annotations

import base64
import json
import queue
import struct
import threading
import time
from pathlib import Path
from typing import Dict, List, Optional
from urllib.parse import parse_qs

from ..http.sse import SSEQueue, write_sse
from ..swd.client import (
    ACCESS_RW,
    BLOCK_CHUNK_BYTES,
    DEFAULT_HOST,
    DEFAULT_HZ,
    DEFAULT_SYMBOL,
    KIND_PARAM,
    PLOT_HEADER_SIZE,
    PLOT_MAX_CHANNELS,
    PLOT_CHANNEL_SIZE,
    PLOT_POINT_SIZE,
    PLOT_POINTS_OFFSET,
    WATCH_HEADER_SIZE,
    WATCH_ENTRY_SIZE,
    WATCH_MAX_ENTRIES,
    OpenOcdTelnet,
    Stats,
    _f32,
    _i32,
    _u32,
    candidate_ports,
    decode_scalar,
    encode_scalar,
    find_latest_elf,
    list_data_symbols,
    mdw_watch,
    mww_write,
    parse_plot_channels,
    parse_plot_header,
    parse_plot_points,
    parse_watch_table,
    read_block,
    resolve_symbol,
    tcp_open,
)
from ..swd.recorder import Recorder
from ..swd.serial_link import SerialLink, parse_hex_payload
from .base import Feature, json_body, send_json

MAX_SYMBOLS = 8

# Well-known firmware globals (sdk/embedded + radar user/omniscope_debug.c)
SYM_PLOT = "g_omniscope_plot"
SYM_WATCH = "g_omniscope_watch"
SYM_MAILBOX = "g_omniscope_mailbox"

MAX_ARRAY_BYTES = 256 * 1024      # refuse larger array payloads over telnet
PLOT_MAX_BATCH = 256              # points drained per tick at most
DEFAULT_RATE_LIMIT_BPS = 8192     # total SWD payload budget per second
TABLE_RELOAD_S = 2.0              # watch table re-read period
PARAM_PERIOD_S = 1.0              # parameter entries refresh period (1 Hz)


class SwdFeature(Feature):
    id = "swd"
    title = "SWD Monitor"
    description = "OpenOCD SWD 内存符号非侵入式实时监视与调试"

    def __init__(self):
        super().__init__()
        self.sse = SSEQueue()
        self._clients: List[SSEQueue] = []
        self._swd_lock = self._lock
        self._io_lock = threading.Lock()  # serialize telnet traffic (run loop vs HTTP handlers)

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

        # --- OmniScope embedded discovery / scheduler state ---
        self.rate_limit_bps = DEFAULT_RATE_LIMIT_BPS
        self._meter: List[tuple] = []  # (monotonic_ts, payload_bytes)
        self.plot_addr: Optional[int] = None
        self.watch_addr: Optional[int] = None
        self.mailbox_addr: Optional[int] = None
        self.plot_ok = False
        self.watch_ok = False
        self.plot_channels: List[dict] = []
        self.plot_last_seq = 0
        self.plot_dropped = 0
        self.plot_fifo_size = 0
        self.watch_table: Optional[dict] = None
        self.watch_values: Dict[str, dict] = {}
        self.array_versions: Dict[str, int] = {}
        self.array_fetch: Optional[dict] = None
        self._param_due = 0.0
        self._table_due = 0.0
        self._state_due = 0.0

        log_dir = Path.cwd() / "logs" / "swd"
        self.recorder = Recorder(log_dir)
        self.serial = SerialLink(self.publish)
        self._client: Optional[OpenOcdTelnet] = None

    def attach(self, shell):
        p = getattr(self, "api_prefix", f"/api/{self.id}")
        shell.route(p + "/events", self._handle_events)
        shell.route(p + "/snapshot", self._handle_snapshot)
        shell.route(p + "/symbols", self._handle_symbols)
        shell.route(p + "/symbols/add", self._handle_symbols_add, methods=("POST",))
        shell.route(p + "/symbols/remove", self._handle_symbols_remove, methods=("POST",))
        shell.route(p + "/symbols/write", self._handle_symbols_write, methods=("POST",))
        shell.route(p + "/mailbox/write", self._handle_mailbox_write, methods=("POST",))
        shell.route(p + "/watch/table", self._handle_watch_table)
        shell.route(p + "/watch/array", self._handle_watch_array)
        shell.route(p + "/watch/write", self._handle_watch_write, methods=("POST",))
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
        if "rate_limit_bps" in config:
            try:
                self.rate_limit_bps = int(config["rate_limit_bps"])
            except (TypeError, ValueError):
                pass

    def on_stop(self):
        self.recorder.stop()
        self.serial.close()

    # ------------------------------------------------------------------
    # Bandwidth meter
    # ------------------------------------------------------------------
    def _meter_add(self, nbytes: int) -> None:
        now = time.monotonic()
        self._meter.append((now, nbytes))
        cutoff = now - 1.0
        self._meter = [(t, n) for (t, n) in self._meter if t >= cutoff]

    def _meter_bps(self) -> float:
        now = time.monotonic()
        return float(sum(n for (t, n) in self._meter if t >= now - 1.0))

    def _budget_ok(self, nbytes: int) -> bool:
        return self._meter_bps() + nbytes <= self.rate_limit_bps

    # ------------------------------------------------------------------
    # Serialized telnet I/O helpers (metered)
    # ------------------------------------------------------------------
    def _io_read(self, addr: int, nbytes: int) -> bytes:
        with self._io_lock:
            return read_block(self._client, addr, nbytes, on_bytes=self._meter_add)

    def _io_mww(self, addr: int, val, fmt: str = "u32") -> int:
        with self._io_lock:
            r = mww_write(self._client, addr, val, fmt)
        self._meter_add(4)
        return r

    # ------------------------------------------------------------------
    # SSE / state
    # ------------------------------------------------------------------
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

    @staticmethod
    def _hex(addr: Optional[int]) -> Optional[str]:
        return f"0x{addr:08X}" if addr is not None else None

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
                "rate_limit_bps": self.rate_limit_bps,
                "bps_used": round(self._meter_bps(), 1),
                "omniscope": {
                    "plot_addr": self._hex(self.plot_addr),
                    "watch_addr": self._hex(self.watch_addr),
                    "mailbox_addr": self._hex(self.mailbox_addr),
                    "plot_ok": self.plot_ok,
                    "watch_ok": self.watch_ok,
                    "plot_channels": list(self.plot_channels),
                    "plot_dropped": self.plot_dropped,
                    "watch_count": len(self.watch_table["entries"]) if self.watch_table else 0,
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
            if "rate_limit_bps" in body and body["rate_limit_bps"] is not None:
                bps = int(body["rate_limit_bps"])
                if bps < 512 or bps > 1048576:
                    raise ValueError("rate_limit_bps must be in [512, 1048576]")
                self.rate_limit_bps = bps
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

    # ------------------------------------------------------------------
    # OmniScope embedded: discovery, probe, tick phases
    # ------------------------------------------------------------------
    def _resolve_well_known(self, elf: Path) -> None:
        addrs = {"plot": None, "watch": None, "mailbox": None}
        for key, sym in (("plot", SYM_PLOT), ("watch", SYM_WATCH), ("mailbox", SYM_MAILBOX)):
            try:
                addr, _size = resolve_symbol(elf, sym)
                addrs[key] = addr
            except RuntimeError:
                pass
        with self._swd_lock:
            self.plot_addr = addrs["plot"]
            self.watch_addr = addrs["watch"]
            self.mailbox_addr = addrs["mailbox"]
            self.plot_ok = False
            self.watch_ok = False
            self.plot_channels = []
            self.plot_last_seq = 0
            self.plot_dropped = 0
            self.watch_table = None
            self.array_fetch = None

    def _probe_omniscope(self) -> None:
        """Validate magics and load channel/table descriptors (retried until ok)."""
        if self.plot_addr is not None and not self.plot_ok:
            try:
                hdr = parse_plot_header(self._io_read(self.plot_addr, PLOT_HEADER_SIZE))
            except RuntimeError:
                hdr = {"valid": False}
            if hdr["valid"]:
                raw = self._io_read(self.plot_addr + PLOT_HEADER_SIZE,
                                    PLOT_MAX_CHANNELS * PLOT_CHANNEL_SIZE)
                channels = parse_plot_channels(raw, hdr["channel_count"])
                with self._swd_lock:
                    self.plot_ok = True
                    self.plot_channels = channels
                    self.plot_fifo_size = hdr["fifo_size"] or 1
                    # start at the live edge; history before connect is dropped
                    self.plot_last_seq = hdr["write_seq"]
                self.publish({"type": "state", **self.snapshot()})

        if self.watch_addr is not None and (not self.watch_ok or time.monotonic() >= self._table_due):
            try:
                raw = self._io_read(self.watch_addr,
                                    WATCH_HEADER_SIZE + WATCH_ENTRY_SIZE * WATCH_MAX_ENTRIES)
                table = parse_watch_table(raw)
            except RuntimeError:
                table = {"valid": False}
            if table.get("valid"):
                first = not self.watch_ok
                with self._swd_lock:
                    self.watch_ok = True
                    self.watch_table = table
                    self._table_due = time.monotonic() + TABLE_RELOAD_S
                self.publish({"type": "watch_table", "entries": table["entries"]})
                if first:
                    self.publish({"type": "state", **self.snapshot()})

    def _tick_params(self, now: float) -> None:
        """Priority 1: parameter entries at 1 Hz."""
        if not self.watch_ok or now < self._param_due:
            return
        self._param_due = now + PARAM_PERIOD_S
        table = self.watch_table or {}
        for e in table.get("entries", []):
            if e["kind"] != KIND_PARAM or e["is_array"]:
                continue
            self._read_watch_scalar(e)

    def _tick_monitors(self) -> None:
        """Priority 2: monitor scalars every tick; array version probes."""
        if not self.watch_ok:
            return
        table = self.watch_table or {}
        for e in table.get("entries", []):
            if e["kind"] == KIND_PARAM:
                continue
            if e["is_array"]:
                # version-gated: only the 4-byte version word is read here
                try:
                    ver_addr = self.watch_addr + WATCH_HEADER_SIZE + e["index"] * WATCH_ENTRY_SIZE + 36
                    ver = struct.unpack("<I", self._io_read(ver_addr, 4))[0]
                except RuntimeError:
                    continue
                e["version"] = ver
                if ver != self.array_versions.get(e["name"], None) and self.array_fetch is None:
                    if e["nbytes"] <= MAX_ARRAY_BYTES:
                        self.array_fetch = {"entry": dict(e), "offset": 0,
                                            "buf": bytearray(), "version": ver}
                continue
            self._read_watch_scalar(e)

    def _read_watch_scalar(self, e: dict) -> None:
        try:
            raw = self._io_read(e["ptr"], e["elem_size"])
            value = decode_scalar(e["elem_type"], raw)
        except RuntimeError as exc:
            self.note_error(e["name"], str(exc))
            return
        row = {
            "type": "watch_sample",
            "name": e["name"],
            "value": value,
            "kind": e["kind"],
            "elem_name": e["elem_name"],
            "t": time.time(),
        }
        with self._swd_lock:
            self.watch_values[e["name"]] = row
        self.publish(row)

    def _tick_plot(self) -> None:
        """Priority 3: drain plot FIFO with leftover budget (adaptive batch)."""
        if not self.plot_ok or not self._budget_ok(PLOT_HEADER_SIZE):
            return
        try:
            hdr = parse_plot_header(self._io_read(self.plot_addr, PLOT_HEADER_SIZE))
        except RuntimeError:
            return
        if not hdr["valid"]:
            with self._swd_lock:
                self.plot_ok = False  # firmware re-initialized; re-probe
            return
        new = hdr["write_seq"] - self.plot_last_seq
        if new <= 0:
            return
        fifo = hdr["fifo_size"] or 1
        skipped = 0
        start = self.plot_last_seq
        if new > fifo:
            skipped = new - fifo
            start = hdr["write_seq"] - fifo
            new = fifo
        budget_bytes = max(0, int(self.rate_limit_bps - self._meter_bps()))
        batch = min(new, PLOT_MAX_BATCH, budget_bytes // PLOT_POINT_SIZE)
        if batch <= 0:
            return

        base = self.plot_addr + PLOT_POINTS_OFFSET
        first_idx = start % fifo
        first_cnt = min(batch, fifo - first_idx)
        points: List[tuple] = []
        try:
            raw1 = self._io_read(base + first_idx * PLOT_POINT_SIZE, first_cnt * PLOT_POINT_SIZE)
            points.extend(parse_plot_points(raw1, first_cnt))
            rest = batch - first_cnt
            if rest > 0:  # wrapped around the ring end
                raw2 = self._io_read(base, rest * PLOT_POINT_SIZE)
                points.extend(parse_plot_points(raw2, rest))
        except RuntimeError:
            return

        consumed = start + len(points)
        try:
            self._io_mww(self.plot_addr + 12, consumed, "u32")  # publish read_seq
        except RuntimeError:
            pass
        with self._swd_lock:
            self.plot_last_seq = consumed
            self.plot_dropped += skipped
            dropped = self.plot_dropped
        self.publish({
            "type": "swd_plot",
            "channels": {c["index"]: c["name"] for c in self.plot_channels},
            "points": [[ch, ts, val] for (_seq, ch, ts, val) in points],
            "dropped": dropped,
        })

    def _tick_array(self) -> None:
        """Priority 4: one payload chunk per tick for the in-progress array fetch."""
        fetch = self.array_fetch
        if fetch is None:
            return
        if not self._budget_ok(BLOCK_CHUNK_BYTES):
            return
        entry = fetch["entry"]
        remaining = entry["nbytes"] - fetch["offset"]
        chunk = min(BLOCK_CHUNK_BYTES, remaining)
        try:
            data = self._io_read(entry["ptr"] + fetch["offset"], chunk)
        except RuntimeError:
            self.array_fetch = None
            return
        fetch["buf"].extend(data)
        fetch["offset"] += len(data)
        if fetch["offset"] >= entry["nbytes"]:
            self.array_versions[entry["name"]] = fetch["version"]
            self.array_fetch = None
            self.publish({
                "type": "watch_array",
                "name": entry["name"],
                "rows": entry["rows"],
                "cols": entry["cols"],
                "elem_type": entry["elem_type"],
                "min": entry["min"],
                "max": entry["max"],
                "nbytes": entry["nbytes"],
                "b64": base64.b64encode(bytes(fetch["buf"])).decode("ascii"),
                "t": time.time(),
            })

    # ------------------------------------------------------------------
    # Main loop
    # ------------------------------------------------------------------
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
                    with self._swd_lock:
                        self._client = client
                    try:
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
                                self._resolve_well_known(elf)

                            # OmniScope structures: magic probe / table reload
                            try:
                                self._probe_omniscope()
                            except (OSError, ConnectionError, TimeoutError):
                                raise
                            except Exception:
                                pass

                            if self.phase != "streaming":
                                self.set_phase("streaming", f"正在读取 {cfg['host']}:{port}")

                            now = time.monotonic()
                            try:
                                # priority 1: parameters @1Hz
                                self._tick_params(now)
                                # priority 2: monitor scalars + array version probes
                                self._tick_monitors()

                                # legacy manual nm symbols (same priority tier)
                                if self.symbols:
                                    for name in self.symbols:
                                        if name not in resolved:
                                            continue
                                        addr, size = resolved[name]
                                        try:
                                            with self._io_lock:
                                                sample = mdw_watch(client, addr, size, name)
                                            self._meter_add(size)
                                        except RuntimeError as exc:
                                            self.note_error(name, str(exc))
                                            fail_streak += 1
                                            continue
                                        self.note_sample(sample)
                                        fail_streak = 0

                                # priority 3: plot FIFO drain (idle budget)
                                self._tick_plot()
                                # priority 4: array payload chunk (idle budget)
                                self._tick_array()
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

                            # publish bandwidth stats ~1 Hz
                            if t_loop >= self._state_due:
                                self._state_due = t_loop + 1.0
                                self.publish({"type": "state", **self.snapshot()})

                            spent = time.monotonic() - t_loop
                            stop_event.wait(max(0.0, interval - spent))
                    finally:
                        with self._swd_lock:
                            self._client = None
            except (OSError, ConnectionError, TimeoutError, RuntimeError) as exc:
                self.set_phase("reconnecting", str(exc))
            stop_event.wait(0.5)

    # ------------------------------------------------------------------
    # HTTP handlers
    # ------------------------------------------------------------------
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

    def _handle_symbols_write(self, handler):
        body = json_body(handler)
        name = str(body.get("name", "")).strip()
        value = body.get("value")
        fmt = str(body.get("fmt", "f32")).lower()
        addr_in = body.get("addr")
        if value is None:
            send_json(handler, {"ok": False, "error": "value is required"}, code=400)
            return

        with self._swd_lock:
            client = getattr(self, "_client", None)
            if client is None or client.sock is None:
                send_json(handler, {"ok": False, "error": "OpenOCD SWD 未连接，无法写入内存"}, code=503)
                return

            try:
                if addr_in is not None:
                    addr = int(str(addr_in), 16) if str(addr_in).startswith("0x") else int(addr_in)
                elif name in self.latest and "addr" in self.latest[name] and self.latest[name]["addr"]:
                    addr = int(self.latest[name]["addr"], 16)
                else:
                    elf = find_latest_elf(Path(self.project))
                    addr, _ = resolve_symbol(elf, name)

                with self._io_lock:
                    val_int = mww_write(client, addr, value, fmt)
                self._meter_add(4)
            except Exception as e:
                send_json(handler, {"ok": False, "error": str(e)}, code=500)
                return

        send_json(handler, {"ok": True, "name": name, "addr": f"0x{addr:08X}", "val_int": f"0x{val_int:08X}"})

    def _handle_mailbox_write(self, handler):
        body = json_body(handler)
        mb_addr_in = body.get("mailbox_addr")
        slot = int(body.get("slot", 0))
        value = float(body.get("value", 0.0))
        if mb_addr_in is None:
            send_json(handler, {"ok": False, "error": "mailbox_addr is required"}, code=400)
            return
        if not (0 <= slot < 16):
            send_json(handler, {"ok": False, "error": "slot must be in [0, 15]"}, code=400)
            return

        with self._swd_lock:
            client = getattr(self, "_client", None)
            if client is None or client.sock is None:
                send_json(handler, {"ok": False, "error": "OpenOCD SWD 未连接"}, code=503)
                return

            try:
                base_addr = int(str(mb_addr_in), 16) if str(mb_addr_in).startswith("0x") else int(mb_addr_in)
                # params[slot] is located at base_addr + 16 + slot * 4
                slot_addr = base_addr + 16 + slot * 4
                with self._io_lock:
                    mww_write(client, slot_addr, value, "f32")
                    # mark status dirty (OMNISCOPE_STATUS_HOST_DIRTY = 0x01)
                    mww_write(client, base_addr + 12, 1, "u32")
                self._meter_add(8)
            except Exception as e:
                send_json(handler, {"ok": False, "error": str(e)}, code=500)
                return

        send_json(handler, {"ok": True, "slot": slot, "value": value})

    # ------------------------------------------------------------------
    # Watch table / parameter handlers
    # ------------------------------------------------------------------
    def _public_watch(self) -> dict:
        table = self.watch_table or {"entries": []}
        return {
            "ok": True,
            "valid": bool(self.watch_ok),
            "entries": table.get("entries", []),
            "values": self.watch_values,
        }

    def _handle_watch_table(self, handler):
        send_json(handler, self._public_watch())

    def _handle_watch_array(self, handler):
        name = (handler.query.get("name") or [""])[0] if handler.query else ""
        table = self.watch_table or {}
        entry = next((e for e in table.get("entries", []) if e["name"] == name), None)
        if entry is None:
            send_json(handler, {"ok": False, "error": f"未找到监视项 {name}"}, code=404)
            return
        if not entry["is_array"]:
            send_json(handler, {"ok": False, "error": "目标不是数组项"}, code=400)
            return
        if entry["nbytes"] > MAX_ARRAY_BYTES:
            send_json(handler, {"ok": False, "error": f"数组过大 ({entry['nbytes']}B > {MAX_ARRAY_BYTES}B)"}, code=400)
            return
        with self._swd_lock:
            client = getattr(self, "_client", None)
        if client is None or client.sock is None:
            send_json(handler, {"ok": False, "error": "OpenOCD SWD 未连接"}, code=503)
            return
        try:
            data = self._io_read(entry["ptr"], entry["nbytes"])
        except Exception as exc:
            send_json(handler, {"ok": False, "error": str(exc)}, code=500)
            return
        send_json(handler, {
            "ok": True,
            "name": entry["name"],
            "rows": entry["rows"],
            "cols": entry["cols"],
            "elem_type": entry["elem_type"],
            "min": entry["min"],
            "max": entry["max"],
            "nbytes": entry["nbytes"],
            "b64": base64.b64encode(data).decode("ascii"),
        })

    def _handle_watch_write(self, handler):
        body = json_body(handler)
        name = str(body.get("name", "")).strip()
        value = body.get("value")
        if value is None:
            send_json(handler, {"ok": False, "error": "value is required"}, code=400)
            return
        table = self.watch_table or {}
        entry = next((e for e in table.get("entries", []) if e["name"] == name), None)
        if entry is None:
            send_json(handler, {"ok": False, "error": f"未找到监视项 {name}"}, code=404)
            return
        # Permission gate: only RW parameter scalars may be written.
        if entry["kind"] != KIND_PARAM or entry["access"] != ACCESS_RW or entry["is_array"]:
            send_json(handler, {"ok": False, "error": "只读监视项，禁止写入"}, code=403)
            return

        v = float(value)
        vmin, vmax, vstep = entry["min"], entry["max"], entry["step"]
        if vmax > vmin:
            v = min(max(v, vmin), vmax)
        if vstep > 0:
            v = round(v / vstep) * vstep

        with self._swd_lock:
            client = getattr(self, "_client", None)
        if client is None or client.sock is None:
            send_json(handler, {"ok": False, "error": "OpenOCD SWD 未连接"}, code=503)
            return

        try:
            data = encode_scalar(entry["elem_type"], v)
            if len(data) == 4:
                word = struct.unpack("<I", data)[0]
                self._io_mww(entry["ptr"], word, "u32")
            else:
                # sub-word read-modify-write on the aligned containing word
                base = entry["ptr"] & ~0x3
                off = entry["ptr"] - base
                merged = bytearray(self._io_read(base, 4))
                merged[off:off + len(data)] = data
                self._io_mww(base, struct.unpack("<I", bytes(merged))[0], "u32")
        except Exception as exc:
            send_json(handler, {"ok": False, "error": str(exc)}, code=500)
            return

        self.publish({
            "type": "watch_sample",
            "name": entry["name"],
            "value": v,
            "kind": entry["kind"],
            "elem_name": entry["elem_name"],
            "t": time.time(),
        })
        send_json(handler, {"ok": True, "name": name, "value": v})
