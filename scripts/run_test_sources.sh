#!/usr/bin/env bash
# OmniScope Test Data Sources Launcher
# Usage:
#   ./scripts/run_test_sources.sh [sentry|nav|markers|fleet|stress]

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$DIR/test/build/omniscope_data_sources"

if [ ! -f "$BIN" ]; then
    echo "[!] Building test data sources binary in test/..."
    cmake -B "$DIR/test/build" -S "$DIR/test"
    cmake --build "$DIR/test/build"
fi

SCENARIO="${1:-sentry}"

echo "======================================================================"
echo " OmniScope Test Data Sources Generator"
echo " Active Scenario: $SCENARIO"
echo " Target Hub Host: http://127.0.0.1:8080/watch"
echo "======================================================================"

case "$SCENARIO" in
    sentry)
        echo "Launching Sentry Auto-Aim data source (3D armor, ballistics, HUD)..."
        exec "$BIN" --scenario=sentry --rate=50
        ;;
    nav|navigation)
        echo "Launching Navigation data source (3D obstacles, paths, BEV map)..."
        exec "$BIN" --scenario=navigation --rate=50
        ;;
    markers|markers_all|3d)
        echo "Launching ROS 2 3D Markers Showcase (All 10 3D Marker Types)..."
        exec "$BIN" --scenario=markers_all --rate=50
        ;;
    stress)
        echo "Launching High-Frequency Stress Benchmark (200Hz)..."
        exec "$BIN" --scenario=stress --rate=200
        ;;
    fleet)
        echo "Launching Multi-Robot Fleet (3 Concurrent Robots)..."
        trap 'kill $(jobs -p) 2>/dev/null || true' EXIT
        "$BIN" --scenario=sentry --rate=30 &
        "$BIN" --scenario=navigation --rate=30 &
        "$BIN" --scenario=markers_all --rate=30 &
        echo "[Fleet] All 3 robots running in parallel. Press Ctrl+C to stop."
        wait
        ;;
    *)
        echo "Usage: $0 [sentry | nav | markers | fleet | stress]"
        exit 1
        ;;
esac
