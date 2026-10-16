#!/usr/bin/env bash
# Open the SWD monitor UI. Extra args are passed to server.py.
#   ./start.sh
#   SYMBOL=foo ./start.sh
#   PROJECT=/path/to/fw ./start.sh --hz 20

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="${PROJECT:-$ROOT/../radar}"
SYMBOL="${SYMBOL:-aRGB}"
UI_PORT="${UI_PORT:-8765}"

if [[ ! -f "$ROOT/frontend/dist/index.html" ]]; then
  echo "构建 Vue 界面…"
  (cd "$ROOT/frontend" && npm install && npm run build)
fi

if curl -fsS --max-time 0.4 "http://127.0.0.1:${UI_PORT}/api/snapshot" >/dev/null 2>&1; then
  echo "监视界面已在运行: http://127.0.0.1:${UI_PORT}"
  exit 0
fi

exec python3 "$ROOT/server.py" \
  --project "$PROJECT" \
  --symbol "$SYMBOL" \
  --ui-port "$UI_PORT" \
  "$@"
