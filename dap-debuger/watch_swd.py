#!/usr/bin/env python3
"""Non-intrusive live watch via OpenOCD telnet (mdw).

Looks up an agreed ELF symbol (no extra firmware block) and reads its RAM
through the OpenOCD session CLion already started. Never issues halt/reset
and never starts a second OpenOCD instance.
"""

from __future__ import annotations

import argparse
import re
import shutil
import socket
import struct
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Sequence, Tuple

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 4444
DEFAULT_SYMBOL = "aRGB"
DEFAULT_HZ = 20.0
DEFAULT_BYTES = 4
MAX_READ_BYTES = 64
PROMPT_MARKERS = ("> ", "\n> ")
CCM_WARN_LO = 0x10000000
CCM_WARN_HI = 0x10010000  # STM32F4 CCM size window (advisory)


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------


@dataclass
class Stats:
    ok: int = 0
    fail: int = 0
    latencies_ms: List[float] = field(default_factory=list)
    t0: float = field(default_factory=time.monotonic)
    window: List[float] = field(default_factory=list)  # success timestamps

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

    def summary(self) -> str:
        elapsed = max(time.monotonic() - self.t0, 1e-9)
        avg_hz = self.ok / elapsed
        return (
            f"ok={self.ok} fail={self.fail} "
            f"avg_hz={avg_hz:.1f} "
            f"rtt_p50={self.percentile(50):.2f}ms "
            f"rtt_p95={self.percentile(95):.2f}ms "
            f"elapsed={elapsed:.1f}s"
        )


# ---------------------------------------------------------------------------
# ELF / project helpers
# ---------------------------------------------------------------------------


def find_nm() -> str:
    for name in ("arm-none-eabi-nm", "nm"):
        path = shutil.which(name)
        if path:
            return path
    raise RuntimeError("neither arm-none-eabi-nm nor nm found in PATH")


def resolve_symbol(elf: Path, symbol: str) -> Tuple[int, int]:
    """Return (address, size_bytes) for an existing global. Size defaults to 4."""
    nm = find_nm()
    proc = subprocess.run(
        [nm, "-S", str(elf)],
        check=False,
        capture_output=True,
        text=True,
    )
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
    """Globals and statics with a fixed address. Includes the source file name when nm has it."""
    nm = find_nm()
    proc = subprocess.run(
        [nm, "-l", "-S", str(elf)],
        check=False,
        capture_output=True,
        text=True,
    )
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
        rows.append(
            {
                "name": name,
                "addr": int(addr_s, 16),
                "size": min(size, MAX_READ_BYTES),
                "file": source,
            }
        )
    rows.sort(key=lambda row: (not row["name"].lower().startswith(needle), row["name"].lower()))
    return rows[:limit]


def find_latest_elf(project: Path) -> Path:
    if not project.is_dir():
        raise RuntimeError(f"project path is not a directory: {project}")

    candidates: List[Path] = []
    for pattern in ("cmake-build*/**/*.elf", "build*/**/*.elf", "**/*.elf"):
        candidates.extend(p for p in project.glob(pattern) if p.is_file())

    # Prefer cmake-build* when present
    cmake_ones = [p for p in candidates if "cmake-build" in p.parts]
    pool = cmake_ones or candidates
    if not pool:
        raise RuntimeError(f"no .elf found under {project}")

    pool.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return pool[0]


def warn_if_ccm(addr: int) -> None:
    if CCM_WARN_LO <= addr < CCM_WARN_HI:
        print(
            f"[warn] address 0x{addr:08X} looks like STM32 CCM/TCM; "
            "AHB-AP (DAP) often cannot read it — put WatchBlock in SRAM",
            file=sys.stderr,
        )


# ---------------------------------------------------------------------------
# OpenOCD port discovery
# ---------------------------------------------------------------------------


def _read_cmdline(pid: int) -> str:
    try:
        raw = Path(f"/proc/{pid}/cmdline").read_bytes()
    except OSError:
        return ""
    return raw.replace(b"\x00", b" ").decode("utf-8", errors="replace")


def discover_openocd_telnet_ports() -> List[int]:
    """Return telnet ports advertised in openocd process command lines."""
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
            # Also match via cmdline for wrappers
            cmdline = _read_cmdline(int(entry.name))
            if "openocd" not in cmdline.lower():
                continue
        else:
            cmdline = _read_cmdline(int(entry.name))

        # -c "telnet_port 4444" or telnet_port 4444
        for m in re.finditer(r"telnet_port\s+(disabled|\d+)", cmdline, re.I):
            val = m.group(1)
            if val.lower() == "disabled":
                continue
            ports.append(int(val))

    # unique preserve order
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


# ---------------------------------------------------------------------------
# OpenOCD telnet client
# ---------------------------------------------------------------------------


def _strip_telnet_iac(data: bytes) -> bytes:
    """Remove Telnet IAC negotiations and NULs so OpenOCD text stays parseable."""
    out = bytearray()
    i = 0
    n = len(data)
    while i < n:
        b = data[i]
        if b == 0x00:
            i += 1
            continue
        if b == 0xFF and i + 1 < n:  # IAC
            cmd = data[i + 1]
            if cmd == 0xFF:  # escaped 0xFF
                out.append(0xFF)
                i += 2
                continue
            if cmd in (0xFB, 0xFC, 0xFD, 0xFE) and i + 2 < n:  # WILL/WONT/DO/DONT
                i += 3
                continue
            if cmd == 0xFA:  # SB ... SE
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
    # Drop leftover controls except newline/tab
    return "".join(ch for ch in s if ch == "\n" or ch == "\t" or ord(ch) >= 32)


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
        # Drain banner until prompt
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
            # Prefer newline-prompt; bare ">" also appears
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
        """Send one command; return (response_text, latency_ms). Never halt."""
        if self.sock is None:
            raise ConnectionError("not connected")
        # Safety: refuse destructive verbs
        first = command.strip().split(None, 1)[0].lower() if command.strip() else ""
        if first in {"halt", "reset", "soft_reset_halt", "resume"}:
            raise RuntimeError(f"refusing to send '{first}' (non-intrusive monitor)")

        payload = (command.strip() + "\n").encode("utf-8")
        t0 = time.perf_counter()
        self.sock.sendall(payload)
        body = self._read_until_prompt(overall_timeout=self.timeout)
        latency_ms = (time.perf_counter() - t0) * 1000.0
        body = _clean_text(body)
        # Strip echo of the command if present
        lines = body.splitlines()
        if lines and lines[0].strip() == command.strip():
            lines = lines[1:]
        # Drop trailing prompt-only line
        while lines and lines[-1].strip() in {"", ">"}:
            lines.pop()
        return "\n".join(lines), latency_ms


# Allow leading junk (NUL/IAC leftovers) before the address dump
_MDW_LINE = re.compile(
    r"(0x[0-9a-fA-F]+):\s+((?:[0-9a-fA-F]{8}\s*)+)"
)


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
        raise RuntimeError(
            f"mdw returned {len(words)} words, expected {expect_words}: {response!r}"
        )
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
    offset = addr & 3
    aligned_addr = addr & ~3
    needed_bytes = offset + max(1, min(size, MAX_READ_BYTES))
    count = max(1, (needed_bytes + 3) // 4)
    resp, latency = client.cmd(f"mdw 0x{aligned_addr:08X} {count}")
    raw_words = parse_mdw(resp, count)
    if offset == 0 and size % 4 == 0 and len(raw_words) == (size // 4):
        words = raw_words
    else:
        raw_bytes = bytearray()
        for w in raw_words:
            raw_bytes.extend(struct.pack("<I", w & 0xFFFFFFFF))
        sub = bytes(raw_bytes[offset : offset + size])
        if len(sub) % 4 != 0:
            sub = sub + b"\x00" * (4 - (len(sub) % 4))
        words = [struct.unpack("<I", sub[i : i + 4])[0] for i in range(0, len(sub), 4)]
    return WatchSample(
        symbol=symbol,
        addr=addr,
        size=size,
        words=words,
        latency_ms=latency,
    )


# ---------------------------------------------------------------------------
# Address resolution context
# ---------------------------------------------------------------------------


@dataclass
class AddrSource:
    addr: Optional[int] = None
    size: int = DEFAULT_BYTES
    elf: Optional[Path] = None
    symbol: str = DEFAULT_SYMBOL
    project: Optional[Path] = None
    _elf_mtime: Optional[float] = None

    def resolve(self, force: bool = False) -> Tuple[int, Optional[Path]]:
        if self.addr is not None and self.elf is None and self.project is None:
            warn_if_ccm(self.addr)
            return self.addr, None

        elf = self.elf
        if elf is None and self.project is not None:
            elf = find_latest_elf(self.project)
        if elf is None:
            if self.addr is not None:
                warn_if_ccm(self.addr)
                return self.addr, None
            raise RuntimeError("need --addr and/or --elf/--project to resolve a symbol")

        elf = elf.resolve()
        mtime = elf.stat().st_mtime
        if (
            not force
            and self.addr is not None
            and self._elf_mtime is not None
            and self._elf_mtime == mtime
            and self.elf == elf
        ):
            return self.addr, elf

        addr, size = resolve_symbol(elf, self.symbol)
        self.addr = addr
        self.size = size
        self.elf = elf
        self._elf_mtime = mtime
        warn_if_ccm(addr)
        return addr, elf

    def elf_changed(self) -> bool:
        if self.elf is None or self._elf_mtime is None:
            if self.project is not None:
                try:
                    latest = find_latest_elf(self.project)
                except RuntimeError:
                    return False
                return self.elf is None or latest != self.elf or (
                    self._elf_mtime is not None
                    and latest.stat().st_mtime != self._elf_mtime
                )
            return False
        try:
            if self.project is not None:
                latest = find_latest_elf(self.project)
                if latest.resolve() != self.elf.resolve():
                    return True
                return latest.stat().st_mtime != self._elf_mtime
            return self.elf.stat().st_mtime != self._elf_mtime
        except OSError:
            return False


# ---------------------------------------------------------------------------
# Streaming loops
# ---------------------------------------------------------------------------


def log(msg: str) -> None:
    print(msg, flush=True)


def format_sample(sample: WatchSample, hz: float) -> str:
    hexes = " ".join(f"{w:08x}" for w in sample.words)
    as_u32 = f" u32={sample.words[0]}" if len(sample.words) == 1 else ""
    return (
        f"{sample.symbol} @0x{sample.addr:08X} [{sample.size}B] {hexes}{as_u32} "
        f"rtt={sample.latency_ms:.2f}ms hz~{hz:.1f}"
    )


def wait_for_telnet(host: str, ports: Sequence[int]) -> int:
    """Block until one of ports accepts TCP. Returns the open port."""
    log(f"[waiting] OpenOCD telnet on {host}:{','.join(str(p) for p in ports)} ...")
    while True:
        for port in ports:
            if tcp_open(host, port):
                log(f"[connected] {host}:{port}")
                return port
        time.sleep(0.4)


def wait_for_symbol(host: str, port: int, addr_src: AddrSource) -> Tuple[int, Optional[Path]]:
    """Poll ELF until symbol resolves, or raise ConnectionError if telnet dies."""
    last_err = ""
    while True:
        if not tcp_open(host, port):
            raise ConnectionError("OpenOCD telnet closed while waiting for symbol")
        try:
            return addr_src.resolve(force=True)
        except RuntimeError as exc:
            msg = str(exc)
            if msg != last_err:
                log(f"[resolve] {msg}")
                log(
                    f"[resolve] '{addr_src.symbol}' is not in this ELF; "
                    "set SYMBOL= to an existing global (no new firmware). retrying ..."
                )
                last_err = msg
            time.sleep(1.5)


def stream_session(
    host: str,
    port: int,
    addr_src: AddrSource,
    hz: float,
    stats: Stats,
    max_frames: Optional[int] = None,
    max_fail_streak: int = 40,
) -> str:
    """
    Run one debug session until disconnect / fail streak.
    Returns reason: 'lost' | 'done'
    """
    interval = 1.0 / hz if hz > 0 else 0.05
    backoff = interval
    fail_streak = 0

    try:
        addr, elf = wait_for_symbol(host, port, addr_src)
    except ConnectionError as exc:
        log(f"[session] lost: {exc}")
        return "lost"

    elf_note = f" elf={elf}" if elf else ""
    log(
        f"[streaming] symbol={addr_src.symbol} addr=0x{addr:08X} "
        f"size={addr_src.size}{elf_note} hz={hz}"
    )

    try:
        with OpenOcdTelnet(host, port) as client:
            frames = 0
            while True:
                if addr_src.elf_changed():
                    try:
                        addr, elf = addr_src.resolve(force=True)
                        log(
                            f"[resolve] ELF updated -> {addr_src.symbol} "
                            f"0x{addr:08X} size={addr_src.size} ({elf})"
                        )
                    except RuntimeError as exc:
                        log(f"[resolve] {exc}")
                        stats.record_fail()
                        fail_streak += 1

                t_loop = time.monotonic()
                try:
                    sample = mdw_watch(client, addr, addr_src.size, addr_src.symbol)
                except (OSError, ConnectionError, TimeoutError, RuntimeError) as exc:
                    stats.record_fail()
                    fail_streak += 1
                    frames += 1
                    log(f"[fail] {exc} (streak={fail_streak})")
                    if max_frames is not None and frames >= max_frames:
                        return "done"
                    if fail_streak >= max_fail_streak:
                        return "lost"
                    time.sleep(backoff)
                    backoff = min(backoff * 1.5, 1.0)
                    try:
                        client.connect()
                    except OSError:
                        return "lost"
                    continue

                fail_streak = 0
                backoff = interval
                stats.record_ok(sample.latency_ms)
                log(format_sample(sample, stats.hz()))
                frames += 1
                if max_frames is not None and frames >= max_frames:
                    return "done"

                spent = time.monotonic() - t_loop
                sleep_for = interval - spent
                if sleep_for > 0:
                    time.sleep(sleep_for)
    except (OSError, ConnectionError, TimeoutError) as exc:
        log(f"[session] lost: {exc}")
        return "lost"

    return "lost"


def run_auto(args: argparse.Namespace) -> int:
    addr_src = AddrSource(
        addr=args.addr,
        elf=Path(args.elf).resolve() if args.elf else None,
        symbol=args.symbol,
        project=Path(args.project).resolve() if args.project else None,
    )
    stats = Stats()
    host = args.host

    log("[mode] auto — waiting for CLion/OpenOCD; Ctrl+C to stop")
    try:
        while True:
            ports = candidate_ports(args.port)
            port = wait_for_telnet(host, ports)
            # Brief settle so OpenOCD finishes init
            time.sleep(0.3)
            reason = stream_session(
                host=host,
                port=port,
                addr_src=addr_src,
                hz=args.hz,
                stats=stats,
                max_frames=None,
                max_fail_streak=args.max_fail_streak,
            )
            log(f"[reconnecting] reason={reason}")
            time.sleep(0.5)
    except KeyboardInterrupt:
        log(f"\n[summary] {stats.summary()}")
        return 0


def run_once(args: argparse.Namespace) -> int:
    addr_src = AddrSource(
        addr=args.addr,
        elf=Path(args.elf).resolve() if args.elf else None,
        symbol=args.symbol,
        project=Path(args.project).resolve() if args.project else None,
    )
    stats = Stats()
    host = args.host
    ports = candidate_ports(args.port)

    if args.wait:
        port = wait_for_telnet(host, ports)
        time.sleep(0.3)
    else:
        port = None
        for p in ports:
            if tcp_open(host, p):
                port = p
                break
        if port is None:
            log(f"[error] OpenOCD telnet not reachable on {host}:{ports}")
            return 1
        log(f"[connected] {host}:{port}")

    reason = stream_session(
        host=host,
        port=port,
        addr_src=addr_src,
        hz=args.hz,
        stats=stats,
        max_frames=args.frames,
        max_fail_streak=args.max_fail_streak,
    )
    log(f"[summary] {stats.summary()} reason={reason}")
    return 0 if stats.ok > 0 else 1


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Live-watch an existing ELF symbol over OpenOCD telnet (non-intrusive mdw).",
    )
    p.add_argument(
        "--once",
        action="store_true",
        help="single session; exit after --frames or disconnect (default is --auto daemon)",
    )
    p.add_argument(
        "--auto",
        action="store_true",
        help="daemon mode (default if --once is not set)",
    )

    p.add_argument("--host", default=DEFAULT_HOST, help="OpenOCD host (default 127.0.0.1)")
    p.add_argument(
        "--port",
        type=int,
        default=None,
        help="telnet port (default: discover openocd cmdline, else 4444)",
    )
    p.add_argument("--elf", default=None, help="path to firmware .elf")
    p.add_argument(
        "--project",
        default=None,
        help="firmware project root; pick newest cmake-build*/**/*.elf",
    )
    p.add_argument(
        "--symbol",
        default=DEFAULT_SYMBOL,
        help="existing global symbol to read (default aRGB)",
    )
    p.add_argument(
        "--addr",
        type=lambda s: int(s, 0),
        default=None,
        help="override WatchBlock address (0x... or decimal)",
    )
    p.add_argument("--hz", type=float, default=DEFAULT_HZ, help="target sample rate")
    p.add_argument(
        "--frames",
        type=int,
        default=50,
        help="with --once: number of successful-or-attempted frames before exit",
    )
    p.add_argument(
        "--wait",
        action="store_true",
        help="with --once: wait for telnet like --auto before connecting",
    )
    p.add_argument(
        "--max-fail-streak",
        type=int,
        default=40,
        help="consecutive failures before treating session as lost",
    )
    return p


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    if args.once:
        args.auto = False
    if args.addr is None and not args.elf and not args.project:
        print(
            "error: provide --addr and/or --elf/--project",
            file=sys.stderr,
        )
        return 2
    if args.hz <= 0:
        print("error: --hz must be > 0", file=sys.stderr)
        return 2

    if args.once:
        return run_once(args)
    return run_auto(args)


if __name__ == "__main__":
    sys.exit(main())
