#!/usr/bin/env bash
# OmniScope Comprehensive Pure C++ Test Runner
# (Explicitly excludes embedded hardware & SWD tests)

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "======================================================================"
echo " Building OmniScope C++ Test Suite..."
echo "======================================================================"
cmake -B "$DIR/sdk/build" -S "$DIR/sdk"
cmake --build "$DIR/sdk/build" --target omniscope_tests omniscope_data_sources

echo ""
echo "======================================================================"
echo " Running OmniScope Pure C++ Test Executable..."
echo "======================================================================"
exec "$DIR/sdk/build/tools/omniscope_tests" "$@"
