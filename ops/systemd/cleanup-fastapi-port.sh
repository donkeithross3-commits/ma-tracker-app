#!/usr/bin/env bash
set -euo pipefail

PORT="${FASTAPI_PORT:-8000}"
LISTENER_PIDS="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | awk '!seen[$0]++')"

if [[ -z "$LISTENER_PIDS" ]]; then
  exit 0
fi

unexpected_owner=0
evicted_listener=0

for pid in $LISTENER_PIDS; do
  cmdline="$(ps -o args= -p "$pid" 2>/dev/null || true)"
  if [[ -z "$cmdline" ]]; then
    continue
  fi

  case "$cmdline" in
    *start_server.py*)
      echo "Evicting legacy start_server.py listener on port $PORT (pid $pid)"
      kill "$pid"
      evicted_listener=1
      ;;
    *uvicorn\ app.main:app*)
      echo "Evicting manual uvicorn listener on port $PORT (pid $pid)"
      kill "$pid"
      evicted_listener=1
      ;;
    *)
      echo "Refusing to evict unexpected listener on port $PORT (pid $pid): $cmdline" >&2
      unexpected_owner=1
      ;;
  esac
done

if [[ "$unexpected_owner" -ne 0 ]]; then
  exit 1
fi

if [[ "$evicted_listener" -eq 0 ]]; then
  exit 0
fi

for _ in {1..20}; do
  if ! lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    exit 0
  fi
  sleep 0.5
done

echo "Port $PORT is still occupied after evicting legacy FastAPI listeners" >&2
lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >&2 || true
exit 1
