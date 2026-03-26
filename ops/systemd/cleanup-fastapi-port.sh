#!/usr/bin/env bash
set -euo pipefail

PORT="${FASTAPI_PORT:-8000}"
SYSTEMCTL_BIN="${SYSTEMCTL_BIN:-systemctl}"
LISTENER_PIDS="$(
  {
    lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true
  } | awk '!seen[$0]++'
)"

active_fastapi_main_pid() {
  if ! "$SYSTEMCTL_BIN" --user is-active --quiet dr3-fastapi 2>/dev/null; then
    return 0
  fi

  "$SYSTEMCTL_BIN" --user show dr3-fastapi -p MainPID --value 2>/dev/null || true
}

is_active_systemd_fastapi_pid() {
  local pid="$1"
  local main_pid="${2:-}"

  if [[ -n "$main_pid" && "$main_pid" != "0" && "$pid" == "$main_pid" ]]; then
    return 0
  fi

  local cgroup_data=""
  if [[ -r "/proc/$pid/cgroup" ]]; then
    cgroup_data="$(cat "/proc/$pid/cgroup" 2>/dev/null || true)"
  fi

  [[ "$cgroup_data" == *"dr3-fastapi.service"* ]]
}

if [[ -z "$LISTENER_PIDS" ]]; then
  exit 0
fi

unexpected_owner=0
evicted_listener=0
ACTIVE_FASTAPI_MAIN_PID="$(active_fastapi_main_pid)"

for pid in $LISTENER_PIDS; do
  cmdline="$(ps -o args= -p "$pid" 2>/dev/null || true)"
  if [[ -z "$cmdline" ]]; then
    continue
  fi

  case "$cmdline" in
    *start_server.py*)
      echo "Evicting legacy start_server.py listener on port $PORT (pid $pid)"
      kill "$pid" 2>/dev/null || true
      evicted_listener=1
      ;;
    *uvicorn\ app.main:app*)
      if is_active_systemd_fastapi_pid "$pid" "$ACTIVE_FASTAPI_MAIN_PID"; then
        echo "Leaving active systemd-managed dr3-fastapi listener on port $PORT (pid $pid)"
        continue
      fi
      echo "Evicting manual uvicorn listener on port $PORT (pid $pid)"
      kill "$pid" 2>/dev/null || true
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
