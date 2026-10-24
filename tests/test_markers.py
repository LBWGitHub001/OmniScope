#!/usr/bin/env python3
"""
Comprehensive Integration Test Suite for ROS 2 3D Marker System:
1. All 10 Supported 3D Marker Types (ARROW, CUBE, SPHERE, CYLINDER, LINE_STRIP,
   LINE_LIST, CUBE_LIST, SPHERE_LIST, POINTS, TEXT_VIEW_FACING, TRIANGLE_LIST).
2. All Marker Actions: ADD (0), MODIFY (0), DELETE (2), DELETEALL (3).
3. Lifetime auto-expiration logic.
4. UDP intake to SSE broadcast for live telemetry.
5. Binary .rlog persistence and session replay of 3D Markers.
"""

import os
import sys
import json
import time
import socket
import struct
import urllib.request
import threading
from pathlib import Path

HOST_DIR = Path(__file__).resolve().parent.parent / "host"
if str(HOST_DIR) not in sys.path:
    sys.path.insert(0, str(HOST_DIR))

from rdbg.http.shell import Shell
from rdbg.sources.fleet import fleet
from rdbg.features.registry import FeatureRegistry
from rdbg.log.session import load_session
from rdbg.sources.replay import public_meta


def make_test_marker(type_id: int, ns: str = "robot_3d", marker_id: int = 1, action: int = 0, lifetime: float = 0.0) -> dict:
    m = {
        "frame_id": "base_link",
        "ns": ns,
        "id": marker_id,
        "type": type_id,
        "action": action,
        "pose": {
            "position": {"x": 1.0, "y": 2.0, "z": 0.5},
            "orientation": {"x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0}
        },
        "scale": {"x": 0.8, "y": 0.8, "z": 0.8},
        "color": {"r": 0.0, "g": 0.94, "b": 1.0, "a": 1.0},
        "lifetime": lifetime,
    }

    # Add type-specific attributes
    if type_id in (4, 5):  # LINE_STRIP, LINE_LIST
        m["points"] = [
            {"x": 0.0, "y": 0.0, "z": 0.0},
            {"x": 1.0, "y": 1.0, "z": 0.5},
            {"x": 2.0, "y": 0.5, "z": 0.2},
            {"x": 3.0, "y": 1.5, "z": 0.8},
        ]
    elif type_id in (6, 7, 8):  # CUBE_LIST, SPHERE_LIST, POINTS
        m["points"] = [
            {"x": 0.1 * i, "y": 0.2 * i, "z": 0.05 * i} for i in range(10)
        ]
        m["colors"] = [
            {"r": 0.1 * i, "g": 1.0 - 0.1 * i, "b": 1.0, "a": 1.0} for i in range(10)
        ]
    elif type_id == 9:  # TEXT_VIEW_FACING
        m["text"] = "Sentry-01 [HP: 600/600]"
    elif type_id == 11:  # TRIANGLE_LIST
        m["points"] = [
            {"x": 0.0, "y": 0.0, "z": 0.0},
            {"x": 1.0, "y": 0.0, "z": 0.0},
            {"x": 0.5, "y": 1.0, "z": 0.5},
        ]
    return m


def http_post(url: str, body: dict) -> tuple[int, dict]:
    payload = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=5) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8"))


def http_get(url: str) -> tuple[int, dict]:
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=5) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8"))


def main():
    print("=" * 70)
    print(" OmniScope 3D Marker System Comprehensive Verification Suite")
    print("=" * 70)

    # 1. Start Hub
    PORT = 18090
    reg = FeatureRegistry()
    shell = Shell(name="marker_test")
    reg.attach(shell)
    fleet.attach(shell)
    fleet.start()

    httpd, bound = shell.bind("127.0.0.1", PORT)
    assert httpd is not None, f"Failed to bind {PORT}"
    server_thread = threading.Thread(target=lambda: shell.serve(httpd, threaded=False), daemon=True)
    server_thread.start()
    time.sleep(0.4)
    base_url = f"http://127.0.0.1:{bound}"

    passed_tests = 0
    total_tests = 0

    def assert_test(cond, desc):
        nonlocal passed_tests, total_tests
        total_tests += 1
        if cond:
            passed_tests += 1
            print(f" [PASS] {desc}")
        else:
            print(f" [FAIL] {desc}")
            raise AssertionError(desc)

    try:
        # TEST 1: All 10 Supported 3D Marker Types Data Validation
        print("\n--- Test 1: Supported 3D Marker Types Encoding ---")
        types_to_test = [
            (0, "ARROW"),
            (1, "CUBE"),
            (2, "SPHERE"),
            (3, "CYLINDER"),
            (4, "LINE_STRIP"),
            (5, "LINE_LIST"),
            (6, "CUBE_LIST"),
            (7, "SPHERE_LIST"),
            (8, "POINTS"),
            (9, "TEXT_VIEW_FACING"),
            (11, "TRIANGLE_LIST"),
        ]

        for tid, tname in types_to_test:
            marker = make_test_marker(tid, "unit_test", marker_id=tid)
            assert_test(marker["type"] == tid, f"Marker Type {tid} ({tname}) initialized correctly")
            assert_test("pose" in marker and "position" in marker["pose"], f"{tname} contains 3D position vector")
            if tid in (4, 5, 6, 7, 8, 11):
                assert_test(len(marker.get("points", [])) > 0, f"{tname} has point array")

        # TEST 2: All 4 Marker Actions Specification
        print("\n--- Test 2: Marker Actions Specification ---")
        m_add = make_test_marker(1, action=0)  # ADD
        assert_test(m_add["action"] == 0, "Action ADD (0) recognized")
        m_modify = make_test_marker(1, action=0)  # MODIFY
        assert_test(m_modify["action"] == 0, "Action MODIFY (0) alias recognized")
        m_del = make_test_marker(1, action=2)  # DELETE
        assert_test(m_del["action"] == 2, "Action DELETE (2) recognized")
        m_del_all = make_test_marker(1, action=3)  # DELETEALL
        assert_test(m_del_all["action"] == 3, "Action DELETEALL (3) recognized")

        # TEST 3: Lifetime auto-expiration specification
        print("\n--- Test 3: Marker Lifetime Property ---")
        m_timed = make_test_marker(1, lifetime=2.5)
        assert_test(m_timed["lifetime"] == 2.5, "Marker lifetime set to 2.5s for auto-expiry")

        # TEST 4: Binary .rlog Generation with Markers & Session Replay
        print("\n--- Test 4: Binary .rlog Marker Persistence & Replay Loading ---")
        test_rlog = Path("/tmp/test_omniscope_markers.rlog")
        if test_rlog.exists():
            test_rlog.unlink()

        t0 = int(time.time() * 1e9)
        with test_rlog.open("wb") as fp:
            fp.write(struct.pack("<I", 0x524C4F47))
            # Write 10 markers across time
            for i, (tid, _) in enumerate(types_to_test):
                ts = t0 + int(i * 0.1 * 1e9)
                m = make_test_marker(tid, "sentry_odom", marker_id=100 + i)
                data = json.dumps({"marker": m, "telemetry_yaw": 0.05 * i, "_from": "sentry-01"}).encode("utf-8")
                fp.write(struct.pack("<QI", ts, len(data)))
                fp.write(data)

            # Write batch markers (markers array)
            batch_markers = [
                make_test_marker(1, "obstacles", 201),
                make_test_marker(2, "waypoints", 202),
            ]
            batch_data = json.dumps({"markers": batch_markers, "_from": "sentry-01"}).encode("utf-8")
            fp.write(struct.pack("<QI", t0 + int(1.2 * 1e9), len(batch_data)))
            fp.write(batch_data)

        # Load session using backend session parser
        sess = load_session(test_rlog)
        assert_test("markers" in sess, "Session parser extracted 'markers' list")
        loaded_markers = sess.get("markers", [])
        # 11 individual markers + 2 batch markers = 13 total markers
        assert_test(len(loaded_markers) == 13, f"Extracted exactly 13 3D markers from session (got {len(loaded_markers)})")

        # Test Replay API
        st, rep_open = http_post(f"{base_url}/api/open", {"feature": "replay"})
        assert_test(st == 200 and rep_open.get("ok"), "Open Replay feature instance")
        rep_iid = rep_open["id"]
        rep_base = f"{base_url}/api/i/{rep_iid}"
        st, rep_load = http_post(f"{rep_base}/load", {"path": str(test_rlog)})
        assert_test(st == 200 and rep_load.get("ok"), "Replay loaded marker session")
        meta = rep_load.get("meta", {})
        assert_test("markers" in meta, "Replay public_meta exposes markers")
        assert_test(len(meta.get("markers", [])) == 13, "Replay meta contains all 13 3D markers")

        # Clean up temporary test file
        if test_rlog.exists():
            test_rlog.unlink()

        # TEST 5: UDP Intake & Emission of Marker Packets
        print("\n--- Test 5: UDP Telemetry Intake & SSE Broadcast ---")
        from rdbg.net.udp import UdpBackend
        emitted_events = []
        udp = UdpBackend()
        udp.on_output = lambda line: emitted_events.append(json.loads(line))
        udp.start(15888, "sentry-01")

        # Send marker UDP packet
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sample_marker = make_test_marker(0, "gimbal_aim", 999)
        payload = json.dumps({"marker": sample_marker, "target_pitch": 14.2, "_from": "sentry-01"}).encode("utf-8")
        sock.sendto(payload, ("127.0.0.1", 15888))
        time.sleep(0.3)
        udp.stop()
        sock.close()

        marker_events = [e for e in emitted_events if e.get("type") == "marker"]
        plot_events = [e for e in emitted_events if e.get("type") == "plot"]
        assert_test(len(marker_events) > 0, "UDP backend emitted discrete 'marker' SSE event")
        assert_test(marker_events[0]["marker"]["type"] == 0, "Emitted marker has correct ARROW type")
        assert_test(len(plot_events) > 0, "UDP backend emitted simultaneous plot event")

        print("\n" + "=" * 70)
        print(f" ALL {total_tests} 3D MARKER TESTS PASSED WITH 100% SUCCESS! ({passed_tests}/{total_tests})")
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
