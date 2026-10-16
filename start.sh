#!/bin/bash
# OmniScope unified portal entry point
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/host/start.sh" "$@"
