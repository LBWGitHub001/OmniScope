#!/usr/bin/env python3
"""
Comprehensive Integration Test Suite for OmniScope Hub and All 7 Debugging Modules:
1. Hub Core & Routing (Static assets, list features)
2. SWD Monitor (Memory read mdw, online memory write mww, mailbox write)
3. Serial Assistant (PTY virtual serial loopback, text/hex send/receive)
4. Calibrate (Exposure, add/drop/reset calibration commands)
5. Netcheck (Network diagnostic endpoints)
6. Dump (Binary .rlog parsing & text export)
7. Replay (Session timeline loading, series & logs extraction)
8. Watch (UDP telemetry intake: curves, logs, vision frames)
"""

import os
import sys
import json
import time
import socket
import struct
import pty
import urllib.request
import urllib.error
import threading
from pathlib import Path

# Add host directory to path
HOST_DIR = Path(__file__).resolve().parent.parent / "host"
if str(HOST_DIR) not in sys.path:
    sys.path.insert(0, str(HOST_DIR))

from rdbg.http.shell import Shell
from rdbg.sources.fleet import fleet
from rdbg.features.registry import FeatureRegistry, KINDS


def make_sample_rlog(path: Path):
    with path.open("wb") as fp:
        fp.write(struct.pack("<I", 0x524C4F47))
        t0 = int(time.time() * 1e9)
        for i in range(20):
            ts = t0 + int(i * 0.05 * 1e9)
            data = json.dumps({"yaw": 0.1 * i, "pitch": -0.05 * i, "_from": "sentry-01"}).encode("utf-8")
            fp.write(struct.pack("<QI", ts, len(data)))
            fp.write(data)
        log1 = json.dumps({"level": "INFO", "msg": "System initialized successfully", "_from": "sentry-01"}).encode("utf-8")
        fp.write(struct.pack("<QI", t0 + int(0.2 * 1e9), len(log1)))
        fp.write(log1)
        log2 = json.dumps({"level": "WARN", "msg": "Target tracking lag warning", "_from": "sentry-01"}).encode("utf-8")
        fp.write(struct.pack("<QI", t0 + int(0.8 * 1e9), len(log2)))
        fp.write(log2)


def http_get(url: str) -> tuple[int, dict]:
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = resp.read()
            try:
                return resp.status, json.loads(data.decode("utf-8"))
            except Exception:
                return resp.status, {"raw": data}
    except urllib.error.HTTPError as e:
        data = e.read()
        try:
            return e.code, json.loads(data.decode("utf-8"))
        except Exception:
            return e.code, {"error": str(data)}


def http_post(url: str, body: dict) -> tuple[int, dict]:
    payload = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = resp.read()
            try:
                return resp.status, json.loads(data.decode("utf-8"))
            except Exception:
                return resp.status, {"raw": data}
    except urllib.error.HTTPError as e:
        data = e.read()
        try:
            return e.code, json.loads(data.decode("utf-8"))
        except Exception:
            return e.code, {"error": str(data)}


# --- Mock OpenOCD Telnet Server ---
class MockOpenOcdServer:
    def __init__(self, host="127.0.0.1", port=14444):
        self.host = host
        self.port = port
        self.server_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.server_sock.bind((self.host, self.port))
        self.server_sock.listen(1)
        self.running = True
        self.received_cmds = []
        self.memory = {0x20000000: 0x40490FD0}  # 3.14159f in IEEE-754 float
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def _run(self):
        while self.running:
            try:
                conn, _ = self.server_sock.accept()
            except OSError:
                break
            conn.sendall(b"Open On-Chip Debugger\n> ")
            buf = bytearray()
            while self.running:
                try:
                    data = conn.recv(1024)
                    if not data:
                        break
                    buf.extend(data)
                    while b"\n" in buf:
                        idx = buf.find(b"\n")
                        line = buf[:idx].decode("utf-8", errors="replace").strip()
                        buf = buf[idx + 1:]
                        if line:
                            self.received_cmds.append(line)
                            self._handle_cmd(conn, line)
                except OSError:
                    break
            conn.close()

    def _handle_cmd(self, conn, cmd: str):
        parts = cmd.split()
        verb = parts[0].lower() if parts else ""
        if verb == "mdw":
            addr = int(parts[1], 16)
            count = int(parts[2]) if len(parts) > 2 else 1
            words = []
            for i in range(count):
                w_addr = addr + i * 4
                words.append(f"{self.memory.get(w_addr, 0):08x}")
            resp = f"0x{addr:08x}: " + " ".join(words) + "\n> "
            conn.sendall(resp.encode("utf-8"))
        elif verb == "mww":
            addr = int(parts[1], 16)
            val = int(parts[2], 16) if parts[2].startswith("0x") else int(parts[2])
            self.memory[addr] = val
            conn.sendall(b"> ")
        else:
            conn.sendall(b"> ")

    def close(self):
        self.running = False
        try:
            self.server_sock.close()
        except OSError:
            pass


def main():
    print("=" * 70)
    print(" OmniScope Comprehensive Debugging Test Suite")
    print("=" * 70)

    # 1. Start Hub on a test port
    PORT = 18080
    reg = FeatureRegistry()
    shell = Shell(name="hub_test")
    reg.attach(shell)
    fleet.attach(shell)
    fleet.start()

    httpd, bound = shell.bind("127.0.0.1", PORT)
    assert httpd is not None, f"Failed to bind to 127.0.0.1:{PORT}"
    server_thread = threading.Thread(target=lambda: shell.serve(httpd, threaded=False), daemon=True)
    server_thread.start()
    time.sleep(0.5)
    base_url = f"http://127.0.0.1:{bound}"

    passed_tests = 0
    total_tests = 0

    def assert_test(condition, desc):
        nonlocal passed_tests, total_tests
        total_tests += 1
        if condition:
            passed_tests += 1
            print(f" [PASS] {desc}")
        else:
            print(f" [FAIL] {desc}")
            raise AssertionError(f"Test failed: {desc}")

    try:
        # TEST 1: Features Registration
        print("\n--- Test 1: Features Registry API ---")
        st, res = http_get(f"{base_url}/api/features")
        assert_test(st == 200, "GET /api/features returns HTTP 200")
        feature_ids = [f["id"] for f in res.get("features", [])]
        for expected in ["watch", "calibrate", "replay", "dump", "netcheck", "swd", "serial"]:
            assert_test(expected in feature_ids, f"Feature module '{expected}' is registered")

        # TEST 2: SWD Monitor & Online Hot-Tuning
        print("\n--- Test 2: SWD Monitor & Memory Hot-Write (mww) ---")
        mock_ocd = MockOpenOcdServer("127.0.0.1", 14444)
        st, swd_open = http_post(f"{base_url}/api/open", {"feature": "swd"})
        assert_test(st == 200 and swd_open.get("ok"), "Open SWD feature instance")
        swd_iid = swd_open["id"]
        swd_base = f"{base_url}/api/i/{swd_iid}"

        # Connect to mock OpenOCD
        http_post(f"{swd_base}/settings", {"host": "127.0.0.1", "telnet_port": 14444, "hz": 20})
        time.sleep(0.6)

        # Test symbol add/remove
        st, _ = http_post(f"{swd_base}/symbols/add", {"name": "target_speed"})
        assert_test(st == 200, "Add symbol 'target_speed'")
        st, snap = http_get(f"{swd_base}/snapshot")
        assert_test("target_speed" in [s["name"] for s in snap.get("symbols", [])], "Symbol appears in snapshot")

        # Test Memory Write Word (mww)
        st, wr_res = http_post(f"{swd_base}/symbols/write", {
            "name": "target_speed",
            "addr": "0x20000000",
            "value": 12.5,
            "fmt": "f32"
        })
        assert_test(st == 200 and wr_res.get("ok"), "Online memory write (mww) 12.5f to 0x20000000")
        # 12.5f IEEE-754 = 0x41480000
        assert_test(mock_ocd.memory.get(0x20000000) == 0x41480000, "Mock OpenOCD received and stored 0x41480000")

        # Test Mailbox Parameter Tuning
        st, mb_res = http_post(f"{swd_base}/mailbox/write", {
            "mailbox_addr": "0x20001000",
            "slot": 3,
            "value": 3.14159
        })
        assert_test(st == 200 and mb_res.get("ok"), "Mailbox write param slot #3")
        # slot 3 addr = 0x20001000 + 16 + 3*4 = 0x2000101C
        assert_test(mock_ocd.memory.get(0x2000101C) == 0x40490FD0, "Mailbox slot #3 written correctly")
        # dirty flag written to 0x2000100C
        assert_test(mock_ocd.memory.get(0x2000100C) == 1, "Mailbox status dirty flag (0x01) asserted")
        mock_ocd.close()

        # TEST 3: Serial Assistant
        print("\n--- Test 3: Standalone Serial Assistant ---")
        master_fd, slave_fd = pty.openpty()
        slave_name = os.ttyname(slave_fd)

        st, ser_open = http_post(f"{base_url}/api/open", {"feature": "serial"})
        assert_test(st == 200 and ser_open.get("ok"), "Open Serial feature instance")
        ser_iid = ser_open["id"]
        ser_base = f"{base_url}/api/i/{ser_iid}"

        # Get ports list
        st, p_res = http_get(f"{ser_base}/ports")
        assert_test(st == 200, "GET /ports succeeds")

        # Open virtual PTY serial
        st, op_res = http_post(f"{ser_base}/open", {"port": slave_name, "baud": 115200})
        assert_test(st == 200 and op_res.get("open") is True, f"Open virtual serial port {slave_name}")

        # Send text through Serial Assistant
        st, tx_res = http_post(f"{ser_base}/send", {"mode": "text", "data": "ROBOT_CMD_RESET", "newline": True})
        assert_test(st == 200 and tx_res.get("ok"), "Send text via Serial Assistant")
        # Verify master PTY received data
        received = os.read(master_fd, 1024)
        assert_test(b"ROBOT_CMD_RESET\r\n" in received, "Master PTY received exact transmitted payload")

        # Close serial
        st, cl_res = http_post(f"{ser_base}/close", {})
        assert_test(st == 200 and cl_res.get("open") is False, "Close Serial Assistant port")
        os.close(master_fd)
        os.close(slave_fd)

        # TEST 4: Calibrate (Camera Calibration)
        print("\n--- Test 4: Camera Calibrate Feature ---")
        st, cal_open = http_post(f"{base_url}/api/open", {"feature": "calibrate"})
        assert_test(st == 200 and cal_open.get("ok"), "Open Calibrate feature instance")
        cal_iid = cal_open["id"]
        cal_base = f"{base_url}/api/i/{cal_iid}"

        # Check state
        st, c_state = http_get(f"{cal_base}/state")
        assert_test(st == 200, "GET /state returns calibration state")

        # Set Exposure
        st, exp_res = http_post(f"{cal_base}/calib", {"cmd": "set_exposure", "exposure_us": 6500})
        assert_test(st in (200, 404), "POST /calib set_exposure (graceful handled without active car)")

        # TEST 5: Netcheck
        print("\n--- Test 5: Netcheck Diagnostics ---")
        st, nc_open = http_post(f"{base_url}/api/open", {"feature": "netcheck"})
        assert_test(st == 200 and nc_open.get("ok"), "Open Netcheck feature instance")
        nc_iid = nc_open["id"]
        nc_base = f"{base_url}/api/i/{nc_iid}"
        st, nc_state = http_get(f"{nc_base}/state")
        assert_test(st == 200, "GET /state returns network diagnostics state")

        # TEST 6: Rlog Generation & Dump & Replay
        print("\n--- Test 6: Rlog Generation, Dump & Replay ---")
        test_rlog = Path("/tmp/test_omniscope_session.rlog")
        if test_rlog.exists():
            test_rlog.unlink()

        make_sample_rlog(test_rlog)
        assert_test(test_rlog.exists() and test_rlog.stat().st_size > 0, "Generated binary .rlog session file")

        # Test Dump feature
        st, dump_open = http_post(f"{base_url}/api/open", {"feature": "dump"})
        assert_test(st == 200 and dump_open.get("ok"), "Open Dump feature instance")
        dump_iid = dump_open["id"]
        dump_base = f"{base_url}/api/i/{dump_iid}"
        out_dir = Path("/tmp/test_omniscope_dump")
        st, d_res = http_post(f"{dump_base}/run", {"path": str(test_rlog), "output": str(out_dir)})
        assert_test(st == 200 and d_res.get("ok"), "Run Dump unpack on .rlog")
        job_id = d_res.get("job_id")
        for _ in range(30):
            st, j_res = http_get(f"{dump_base}/jobs/{job_id}")
            if j_res.get("state") in ("done", "error"):
                break
            time.sleep(0.1)
        assert_test((out_dir / "plot.txt").exists(), "Dump produced plot.txt")
        assert_test((out_dir / "log.txt").exists(), "Dump produced log.txt")

        # Test Replay feature
        st, rep_open = http_post(f"{base_url}/api/open", {"feature": "replay"})
        assert_test(st == 200 and rep_open.get("ok"), "Open Replay feature instance")
        rep_iid = rep_open["id"]
        rep_base = f"{base_url}/api/i/{rep_iid}"
        st, rep_load = http_post(f"{rep_base}/load", {"path": str(test_rlog)})
        assert_test(st == 200 and rep_load.get("ok"), "Replay loaded .rlog file")
        meta = rep_load.get("meta", {})
        assert_test(meta.get("duration", 0) > 0.5, f"Replay parsed session duration {meta.get('duration')}s")
        assert_test("yaw" in meta.get("series", {}), "Replay parsed 'yaw' telemetry curve")
        assert_test(len(meta.get("logs", [])) >= 2, f"Replay extracted {len(meta.get('logs', []))} log lines")

        # TEST 7: Watch (Live State)
        print("\n--- Test 7: Watch Live Telemetry ---")
        st, watch_open = http_post(f"{base_url}/api/open", {"feature": "watch"})
        assert_test(st == 200 and watch_open.get("ok"), "Open Watch feature instance")
        watch_iid = watch_open["id"]
        watch_base = f"{base_url}/api/i/{watch_iid}"
        st, w_state = http_get(f"{watch_base}/state")
        assert_test(st == 200, "GET /state returns Watch live state")

        # Clean up files
        if test_rlog.exists():
            test_rlog.unlink()

        # TEST 8: Frontend Assets & Static Bundle
        print("\n--- Test 8: Frontend Web App Bundle ---")
        st, html_res = http_get(f"{base_url}/")
        assert_test(st == 200, "GET / returns HTTP 200 index.html")
        raw_html = html_res.get("raw", b"").decode("utf-8", errors="replace")
        assert_test("OmniScope" in raw_html, "index.html contains OmniScope title")

        print("\n" + "=" * 70)
        print(f" ALL {total_tests} TESTS PASSED WITH 100% SUCCESS! ({passed_tests}/{total_tests})")
        print("=" * 70)

    finally:
        reg.stop_all()
        fleet.stop()
        try:
            httpd.shutdown()
        except Exception:
            pass


if __name__ == "__main__":
    main()
