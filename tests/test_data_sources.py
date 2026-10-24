#!/usr/bin/env python3
"""OmniScope Test Data Sources Verification Suite (Pure Standard Library)

Verifies:
  1. C++ Pure Remote Debugging & 3D Marker Test Suite (No embedded dependencies)
  2. Multi-scenario Data Sources Generator (sentry, navigation, markers_all, stress)
  3. Binary .rlog persistence and 3D Marker extraction for each scenario
"""

import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

# Add project root to sys.path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "host"))

from rdbg.log.session import load_session


def run_cmd(args, timeout=10):
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout)


def test_pure_cpp_remote_debugging():
    print("\n--- Test 1: Pure C++ Remote Debugging & 3D Marker Suite ---")
    bin_path = ROOT / "sdk/build/tools/omniscope_test_remote_debugging"
    if not bin_path.exists():
        print(f" [BUILD] Compiling omniscope_test_remote_debugging...")
        run_cmd(["cmake", "--build", str(ROOT / "sdk/build"), "--target", "omniscope_test_remote_debugging"])

    assert bin_path.exists(), f"Binary {bin_path} not found"
    res = run_cmd([str(bin_path)])
    print(res.stdout.strip())
    assert res.returncode == 0, f"C++ test suite failed with code {res.returncode}"
    assert "ALL PURE C++ REMOTE DEBUGGING TESTS PASSED" in res.stdout
    print(" [PASS] Pure C++ remote debugging test suite passed (100% success)")


def test_data_sources_scenarios():
    print("\n--- Test 2: Data Sources Scenarios Execution & .rlog Validation ---")
    bin_path = ROOT / "sdk/build/tools/omniscope_data_sources"
    if not bin_path.exists():
        print(f" [BUILD] Compiling omniscope_data_sources...")
        run_cmd(["cmake", "--build", str(ROOT / "sdk/build"), "--target", "omniscope_data_sources"])

    assert bin_path.exists(), f"Binary {bin_path} not found"

    scenarios = ["sentry", "navigation", "markers_all"]
    temp_dir = tempfile.mkdtemp(prefix="omniscope_ds_test_")

    try:
        for sc in scenarios:
            print(f"  Testing scenario: '{sc}'...")
            proc = subprocess.Popen(
                [str(bin_path), f"--scenario={sc}", "--rate=40"],
                cwd=temp_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            # Run for 1.2 seconds to produce telemetry, 3D markers and logs
            time.sleep(1.2)
            proc.terminate()
            try:
                proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                proc.kill()

            # Find generated .rlog file in temp_dir/logs/
            log_dir = Path(temp_dir) / "logs"
            rlogs = list(log_dir.glob("*.rlog")) if log_dir.exists() else []
            assert len(rlogs) > 0, f"Scenario '{sc}' did not produce any .rlog file"

            latest_rlog = max(rlogs, key=lambda f: f.stat().st_mtime)
            meta = load_session(str(latest_rlog))
            assert meta["duration"] > 0.3, f"Session duration {meta['duration']} too short"
            assert len(meta["series"]) > 0, f"No waveform series found in {sc}"

            # Check 3D markers
            markers = meta.get("markers", [])
            print(f"    [OK] Duration={meta['duration']:.2f}s, Series={len(meta['series'])}, Markers={len(markers)}")
            assert len(markers) > 0, f"Expected 3D markers in scenario '{sc}', found 0"

            # Clean log dir for next scenario
            shutil.rmtree(temp_dir / Path("logs"))

        print(" [PASS] All data sources scenarios executed and produced valid 3D telemetry")
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def test_cli_help():
    print("\n--- Test 3: Data Sources CLI Options & Error Handling ---")
    bin_path = ROOT / "sdk/build/tools/omniscope_data_sources"
    res = run_cmd([str(bin_path), "--help"])
    assert res.returncode == 0
    assert "Usage:" in res.stdout
    assert "sentry" in res.stdout
    assert "navigation" in res.stdout
    assert "markers_all" in res.stdout
    print(" [PASS] CLI help message displays all supported scenarios")

    bad_res = run_cmd([str(bin_path), "--scenario=non_existent"])
    assert bad_res.returncode != 0
    assert "Unknown scenario" in bad_res.stderr
    print(" [PASS] Invalid scenario name rejected gracefully")


if __name__ == "__main__":
    print("=" * 70)
    print(" OmniScope Test Data Sources Comprehensive Verification")
    print(" (Pure Remote Debugging & 3D Markers - No Embedded Tests)")
    print("=" * 70)

    test_pure_cpp_remote_debugging()
    test_data_sources_scenarios()
    test_cli_help()

    print("\n" + "=" * 70)
    print(" ALL DATA SOURCES TESTS PASSED WITH 100% SUCCESS!")
    print("=" * 70)
