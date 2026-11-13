"""OpenOCD Telnet client and ELF/nm symbol resolver for SWD live watch."""

from __future__ import annotations

import math
import re
import shutil
import socket
import struct
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 4444
DEFAULT_SYMBOL = "aRGB"
DEFAULT_HZ = 30.0
DEFAULT_BYTES = 4
MAX_READ_BYTES = 64
CCM_WARN_LO = 0x10000000
CCM_WARN_HI = 0x10010000


def _f32(word: int) -> Optional[float]:
    val = struct.unpack("<f", struct.pack("<I", word & 0xFFFFFFFF))[0]
    if not math.isfinite(val) or abs(val) > 1e12:
        return None
    return val


def _i32(word: int) -> int:
    return struct.unpack("<i", struct.pack("<I", word & 0xFFFFFFFF))[0]


def _u32(word: int) -> int:
    return word & 0xFFFFFFFF


@dataclass
class Stats:
    ok: int = 0
    fail: int = 0
    latencies_ms: List[float] = field(default_factory=list)
    t0: float = field(default_factory=time.monotonic)
    window: List[float] = field(default_factory=list)

    def record_ok(self, latency_ms: float) -> None:
        self.ok += 1
        self.latencies_ms.append(latency_ms)
        now = time.monotonic()
        self.window.append(now)
        cutoff = now - 1.0
        self.window = [t for t in self.window if t >= cutoff]

    def record_fail(self) -> None:
        self.fail += 1

    def hz(self) -> float:
        return float(len(self.window))

    def percentile(self, p: float) -> float:
        if not self.latencies_ms:
            return 0.0
        xs = sorted(self.latencies_ms)
        if len(xs) == 1:
            return xs[0]
        k = (len(xs) - 1) * (p / 100.0)
        f = int(k)
        c = min(f + 1, len(xs) - 1)
        if f == c:
            return xs[f]
        return xs[f] + (xs[c] - xs[f]) * (k - f)


def find_nm() -> str:
    for name in ("arm-none-eabi-nm", "nm"):
        path = shutil.which(name)
        if path:
            return path
    raise RuntimeError("neither arm-none-eabi-nm nor nm found in PATH")


def resolve_symbol(elf: Path, symbol: str) -> Tuple[int, int]:
    nm = find_nm()
    proc = subprocess.run([nm, "-S", str(elf)], capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(f"nm failed on {elf}: {err or proc.returncode}")

    name = re.escape(symbol)
    sized = re.compile(rf"^([0-9a-fA-F]+)\s+([0-9a-fA-F]+)\s+[A-Za-z]\s+{name}$")
    plain = re.compile(rf"^([0-9a-fA-F]+)\s+[A-Za-z]\s+{name}$")
    for line in proc.stdout.splitlines():
        text = line.strip()
        m = sized.match(text)
        if m:
            addr = int(m.group(1), 16)
            size = int(m.group(2), 16) or DEFAULT_BYTES
            return addr, min(size, MAX_READ_BYTES)
        m = plain.match(text)
        if m:
            return int(m.group(1), 16), DEFAULT_BYTES
    raise RuntimeError(f"symbol '{symbol}' not found in {elf}")


_NM_SIZED = re.compile(r"^([0-9a-fA-F]+)\s+([0-9a-fA-F]+)\s+([A-Za-z])\s+(\S+)$")
_NM_PLAIN = re.compile(r"^([0-9a-fA-F]+)\s+([A-Za-z])\s+(\S+)$")
_DATA_TYPES = set("BbDdGgSsVvRr")


def list_data_symbols(elf: Path, query: str = "", limit: int = 80) -> List[dict]:
    nm = find_nm()
    proc = subprocess.run([nm, "-l", "-S", str(elf)], capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(f"nm failed on {elf}: {err or proc.returncode}")

    needle = query.lower()
    rows: List[dict] = []
    for line in proc.stdout.splitlines():
        body, _, loc = line.strip().partition("\t")
        sized = _NM_SIZED.match(body.strip())
        plain = None if sized else _NM_PLAIN.match(body.strip())
        if sized:
            addr_s, size_s, typ, name = sized.groups()
        elif plain:
            addr_s, typ, name = plain.groups()
            size_s = "0"
        else:
            continue
        if typ not in _DATA_TYPES:
            continue
        if needle and needle not in name.lower():
            continue
        source = ""
        if loc:
            source = Path(loc.split(":")[0]).name
        size = int(size_s, 16) or DEFAULT_BYTES
        rows.append({
            "name": name,
            "addr": int(addr_s, 16),
            "size": min(size, MAX_READ_BYTES),
            "file": source,
        })
    rows.sort(key=lambda r: (not r["name"].lower().startswith(needle), r["name"].lower()))
    return rows[:limit]


def find_latest_elf(project: Path) -> Path:
    if not project.is_dir():
        raise RuntimeError(f"project path is not a directory: {project}")

    candidates: List[Path] = []
    for pattern in ("cmake-build*/**/*.elf", "build*/**/*.elf", "**/*.elf"):
        candidates.extend(p for p in project.glob(pattern) if p.is_file())

    cmake_ones = [p for p in candidates if "cmake-build" in p.parts]
    pool = cmake_ones or candidates
    if not pool:
        raise RuntimeError(f"no .elf found under {project}")

    pool.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return pool[0]


def _read_cmdline(pid: int) -> str:
    try:
        raw = Path(f"/proc/{pid}/cmdline").read_bytes()
    except OSError:
        return ""
    return raw.replace(b"\x00", b" ").decode("utf-8", errors="replace")


def discover_openocd_telnet_ports() -> List[int]:
    ports: List[int] = []
    proc_root = Path("/proc")
    if not proc_root.is_dir():
        return ports

    for entry in proc_root.iterdir():
        if not entry.name.isdigit():
            continue
        try:
            comm = (entry / "comm").read_text(encoding="utf-8", errors="replace").strip()
        except OSError:
            continue
        if "openocd" not in comm.lower():
            cmdline = _read_cmdline(int(entry.name))
            if "openocd" not in cmdline.lower():
                continue
        else:
            cmdline = _read_cmdline(int(entry.name))

        for m in re.finditer(r"telnet_port\s+(disabled|\d+)", cmdline, re.I):
            val = m.group(1)
            if val.lower() != "disabled":
                ports.append(int(val))

    seen = set()
    out: List[int] = []
    for p in ports:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return out


def candidate_ports(explicit: Optional[int]) -> List[int]:
    if explicit is not None:
        return [explicit]
    found = discover_openocd_telnet_ports()
    if found:
        return found
    return [DEFAULT_PORT]


def tcp_open(host: str, port: int, timeout: float = 0.35) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _strip_telnet_iac(data: bytes) -> bytes:
    out = bytearray()
    i = 0
    n = len(data)
    while i < n:
        b = data[i]
        if b == 0x00:
            i += 1
            continue
        if b == 0xFF and i + 1 < n:
            cmd = data[i + 1]
            if cmd == 0xFF:
                out.append(0xFF)
                i += 2
                continue
            if cmd in (0xFB, 0xFC, 0xFD, 0xFE) and i + 2 < n:
                i += 3
                continue
            if cmd == 0xFA:
                i += 2
                while i < n:
                    if data[i] == 0xFF and i + 1 < n and data[i + 1] == 0xF0:
                        i += 2
                        break
                    i += 1
                continue
            i += 2
            continue
        out.append(b)
        i += 1
    return bytes(out)


def _clean_text(s: str) -> str:
    return "".join(ch for ch in s if ch in "\n\t" or ord(ch) >= 32)


class OpenOcdTelnet:
    def __init__(self, host: str, port: int, timeout: float = 2.0) -> None:
        self.host = host
        self.port = port
        self.timeout = timeout
        self.sock: Optional[socket.socket] = None
        self._buf = bytearray()

    def connect(self) -> None:
        self.close()
        s = socket.create_connection((self.host, self.port), timeout=self.timeout)
        s.settimeout(self.timeout)
        self.sock = s
        self._buf.clear()
        self._read_until_prompt(overall_timeout=self.timeout)

    def close(self) -> None:
        if self.sock is not None:
            try:
                self.sock.close()
            except OSError:
                pass
            self.sock = None
        self._buf.clear()

    def __enter__(self) -> "OpenOcdTelnet":
        self.connect()
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    def _recv_some(self) -> bytes:
        assert self.sock is not None
        try:
            data = self.sock.recv(4096)
        except socket.timeout as exc:
            raise TimeoutError("OpenOCD telnet recv timeout") from exc
        if not data:
            raise ConnectionError("OpenOCD telnet closed")
        return _strip_telnet_iac(data)

    def _read_until_prompt(self, overall_timeout: float) -> str:
        deadline = time.monotonic() + overall_timeout
        while time.monotonic() < deadline:
            text = _clean_text(self._buf.decode("utf-8", errors="replace"))
            if "\n> " in text or text.endswith("\n>") or text.endswith("> "):
                idx = text.rfind(">")
                consumed = text[: idx + 1]
                rest = text[idx + 1 :]
                self._buf = bytearray(rest.encode("utf-8", errors="replace"))
                return consumed
            if text.strip().endswith(">") and len(text) > 1:
                idx = text.rfind(">")
                consumed = text[: idx + 1]
                rest = text[idx + 1 :]
                self._buf = bytearray(rest.encode("utf-8", errors="replace"))
                return consumed
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            assert self.sock is not None
            self.sock.settimeout(min(self.timeout, max(remaining, 0.05)))
            self._buf.extend(self._recv_some())
        raise TimeoutError("timed out waiting for OpenOCD prompt")

    def cmd(self, command: str) -> Tuple[str, float]:
        if self.sock is None:
            raise ConnectionError("not connected")
        first = command.strip().split(None, 1)[0].lower() if command.strip() else ""
        if first in {"halt", "reset", "soft_reset_halt", "resume"}:
            raise RuntimeError(f"refusing destructive verb '{first}'")

        payload = (command.strip() + "\n").encode("utf-8")
        t0 = time.perf_counter()
        self.sock.sendall(payload)
        body = self._read_until_prompt(overall_timeout=self.timeout)
        latency_ms = (time.perf_counter() - t0) * 1000.0
        body = _clean_text(body)
        lines = body.splitlines()
        if lines and lines[0].strip() == command.strip():
            lines = lines[1:]
        while lines and lines[-1].strip() in {"", ">"}:
            lines.pop()
        return "\n".join(lines), latency_ms


_MDW_LINE = re.compile(r"(0x[0-9a-fA-F]+):\s+((?:[0-9a-fA-F]{8}\s*)+)")


def parse_mdw(response: str, expect_words: int) -> List[int]:
    words: List[int] = []
    cleaned = _clean_text(response).replace("\x00", "")
    for raw in cleaned.splitlines():
        line = raw.strip()
        if not line:
            continue
        if re.search(r"\b(error|fail|unable|invalid)\b", line, re.I) and "0x" not in line.lower():
            raise RuntimeError(f"mdw error: {line}")
        m = _MDW_LINE.search(line)
        if not m:
            continue
        hex_words = m.group(2).split()
        words.extend(int(w, 16) for w in hex_words)
    if len(words) < expect_words:
        raise RuntimeError(f"mdw returned {len(words)} words, expected {expect_words}: {response!r}")
    return words[:expect_words]


def words_for(size: int) -> int:
    nbytes = max(DEFAULT_BYTES, min(size, MAX_READ_BYTES))
    return max(1, (nbytes + 3) // 4)


@dataclass
class WatchSample:
    symbol: str
    addr: int
    size: int
    words: List[int]
    latency_ms: float


def mdw_watch(client: OpenOcdTelnet, addr: int, size: int, symbol: str) -> WatchSample:
    count = words_for(size)
    resp, latency_ms = client.cmd(f"mdw 0x{addr:08X} {count}")
    words = parse_mdw(resp, count)
    return WatchSample(symbol=symbol, addr=addr, size=size, words=words, latency_ms=latency_ms)


def mww_write(client: OpenOcdTelnet, addr: int, val: int | float | str, fmt: str = "f32") -> int:
    """Non-intrusive memory write word (mww) via OpenOCD telnet without halting target MCU."""
    if fmt == "f32":
        fval = float(val)
        val_int = struct.unpack("<I", struct.pack("<f", fval))[0]
    elif fmt == "i32":
        ival = int(val)
        val_int = struct.unpack("<I", struct.pack("<i", ival))[0]
    elif fmt == "u32":
        val_int = int(val) & 0xFFFFFFFF
    elif fmt == "hex":
        val_int = int(str(val), 16) & 0xFFFFFFFF
    else:
        try:
            val_int = struct.unpack("<I", struct.pack("<f", float(val)))[0]
        except Exception:
            val_int = int(val) & 0xFFFFFFFF

    resp, _ = client.cmd(f"mww 0x{addr:08X} 0x{val_int:08X}")
    if any(k in resp.lower() for k in ("error", "fail", "unable", "invalid")):
        raise RuntimeError(f"mww write failed: {resp}")
    return val_int


# ---------------------------------------------------------------------------
# OmniScope embedded structures (sdk/embedded/include/omniscope/mcu/)
# Offsets mirror the C layout locks (_Static_assert) on 32-bit targets.
# ---------------------------------------------------------------------------

PLOT_MAGIC = 0x4F4D504C          # "OMPL"
PLOT_VERSION = 1
PLOT_HEADER_SIZE = 28            # magic..channel_count (7 words)
PLOT_MAX_CHANNELS = 16
PLOT_CHANNEL_SIZE = 28           # name[24] + active u32
PLOT_POINT_SIZE = 16             # seq, ts_us, channel, value
PLOT_POINTS_OFFSET = PLOT_HEADER_SIZE + PLOT_MAX_CHANNELS * PLOT_CHANNEL_SIZE  # 476

WATCH_MAGIC = 0x4F4D5754         # "OMWT"
WATCH_VERSION = 1
WATCH_HEADER_SIZE = 16           # magic, version, count, capacity
WATCH_MAX_ENTRIES = 32
WATCH_ENTRY_SIZE = 52
WATCH_NAME_LEN = 24

# omniscope_watch_entry_t.kind
KIND_MONITOR = 0
KIND_PARAM = 1
# omniscope_watch_entry_t.access
ACCESS_RO = 0
ACCESS_RW = 1

# elem_type -> (struct fmt char, size in bytes)
ELEM_TYPES: Dict[int, Tuple[str, int]] = {
    0: ("f", 4),  # OMNISCOPE_TYPE_F32
    1: ("i", 4),  # OMNISCOPE_TYPE_I32
    2: ("I", 4),  # OMNISCOPE_TYPE_U32
    3: ("h", 2),  # OMNISCOPE_TYPE_I16
    4: ("H", 2),  # OMNISCOPE_TYPE_U16
    5: ("b", 1),  # OMNISCOPE_TYPE_I8
    6: ("B", 1),  # OMNISCOPE_TYPE_U8
}
ELEM_TYPE_NAMES = {0: "f32", 1: "i32", 2: "u32", 3: "i16", 4: "u16", 5: "i8", 6: "u8"}

BLOCK_CHUNK_BYTES = 256


def read_block(client: OpenOcdTelnet, addr: int, nbytes: int,
               chunk_bytes: int = BLOCK_CHUNK_BYTES,
               on_bytes=None) -> bytes:
    """Read an arbitrary-size memory block via chunked mdw (payload bytes only).

    on_bytes: optional callback invoked with the payload byte count of every
    chunk, used by the bandwidth scheduler to meter traffic.
    """
    if nbytes <= 0:
        return b""
    total_words = (nbytes + 3) // 4
    words: List[int] = []
    done = 0
    while done < total_words:
        n = min(total_words - done, max(1, chunk_bytes // 4))
        resp, _ = client.cmd(f"mdw 0x{addr + done * 4:08X} {n}")
        words.extend(parse_mdw(resp, n))
        done += n
        if on_bytes is not None:
            on_bytes(n * 4)
    return struct.pack("<" + "I" * len(words), *words)[:nbytes]


def parse_plot_header(data: bytes) -> dict:
    if len(data) < PLOT_HEADER_SIZE:
        raise RuntimeError("plot header short read")
    magic, version, write_seq, read_seq, dropped, fifo_size, channel_count = struct.unpack_from("<7I", data)
    return {
        "magic": magic,
        "valid": magic == PLOT_MAGIC,
        "version": version,
        "write_seq": write_seq,
        "read_seq": read_seq,
        "dropped": dropped,
        "fifo_size": fifo_size,
        "channel_count": min(channel_count, PLOT_MAX_CHANNELS),
    }


def parse_plot_channels(data: bytes, count: int) -> List[dict]:
    channels: List[dict] = []
    for i in range(min(count, PLOT_MAX_CHANNELS)):
        off = i * PLOT_CHANNEL_SIZE
        if len(data) < off + PLOT_CHANNEL_SIZE:
            break
        raw = data[off:off + 24].split(b"\x00", 1)[0]
        active = struct.unpack_from("<I", data, off + 24)[0]
        channels.append({
            "index": i,
            "name": raw.decode("utf-8", errors="replace"),
            "active": bool(active),
        })
    return channels


def parse_plot_points(data: bytes, count: int) -> List[Tuple[int, int, int, float]]:
    """Decode points as (seq, channel, ts_us, value) tuples."""
    pts: List[Tuple[int, int, int, float]] = []
    for i in range(count):
        off = i * PLOT_POINT_SIZE
        if len(data) < off + PLOT_POINT_SIZE:
            break
        seq, ts_us, channel, value = struct.unpack_from("<3If", data, off)
        pts.append((seq, channel, ts_us, value))
    return pts


def _decode_name(raw: bytes) -> str:
    return raw.split(b"\x00", 1)[0].decode("utf-8", errors="replace")


def parse_watch_table(data: bytes) -> dict:
    if len(data) < WATCH_HEADER_SIZE:
        raise RuntimeError("watch table header short read")
    magic, version, count, capacity = struct.unpack_from("<4I", data)
    entries: List[dict] = []
    n = min(count, WATCH_MAX_ENTRIES)
    for i in range(n):
        off = WATCH_HEADER_SIZE + i * WATCH_ENTRY_SIZE
        if len(data) < off + WATCH_ENTRY_SIZE:
            break
        name = _decode_name(data[off:off + WATCH_NAME_LEN])
        ptr = struct.unpack_from("<I", data, off + 24)[0]
        elem_type, kind, access, _flags = struct.unpack_from("<4B", data, off + 28)
        rows, cols = struct.unpack_from("<2H", data, off + 32)
        ver = struct.unpack_from("<I", data, off + 36)[0]
        vmin, vmax, vstep = struct.unpack_from("<3f", data, off + 40)
        etype = ELEM_TYPES.get(elem_type)
        entries.append({
            "index": i,
            "name": name,
            "ptr": ptr,
            "elem_type": elem_type,
            "elem_name": ELEM_TYPE_NAMES.get(elem_type, "?"),
            "elem_size": etype[1] if etype else 0,
            "kind": kind,
            "access": access,
            "rows": rows,
            "cols": cols,
            "version": ver,
            "min": vmin,
            "max": vmax,
            "step": vstep,
            "is_array": rows * cols > 1,
            "nbytes": (etype[1] if etype else 0) * rows * cols,
        })
    return {
        "magic": magic,
        "valid": magic == WATCH_MAGIC,
        "version": version,
        "count": n,
        "capacity": capacity,
        "entries": entries,
    }


def decode_scalar(elem_type: int, data: bytes, offset: int = 0):
    fmt_size = ELEM_TYPES.get(elem_type)
    if not fmt_size:
        raise RuntimeError(f"unknown elem_type {elem_type}")
    return struct.unpack_from("<" + fmt_size[0], data, offset)[0]


def encode_scalar(elem_type: int, value) -> bytes:
    fmt_size = ELEM_TYPES.get(elem_type)
    if not fmt_size:
        raise RuntimeError(f"unknown elem_type {elem_type}")
    fmt, _size = fmt_size
    if fmt == "f":
        value = float(value)
    else:
        value = int(float(value))
    return struct.pack("<" + fmt, value)

