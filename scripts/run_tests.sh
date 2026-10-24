#!/usr/bin/env bash
# OmniScope Comprehensive Pure C++ Test Runner (located in test/ folder)
# (Explicitly excludes embedded hardware & SWD tests)

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "======================================================================"
echo " Building OmniScope C++ Test Suite in test/..."
echo "======================================================================"
cmake -B "$DIR/test/build" -S "$DIR/test"
cmake --build "$DIR/test/build"

echo ""
echo "======================================================================"
echo " Running OmniScope Pure C++ Test Executable..."
echo "======================================================================"
exec "$DIR/test/build/omniscope_tests" "$@"
