#!/usr/bin/env bash
# Check WebSocket relay and IB status (for debugging "agent connected but dashboard disconnected").
#
# On the DROPLET (with KRJ's agent running), run:
#   ssh droplet
#   cd ~/apps/ma-tracker-app  # or wherever the app lives
#   PYTHON_URL=http://localhost:8000 ./scripts/check-relay-status.sh
# Steps 1–2 hit the Python service directly (no auth). Steps 3–4 need a logged-in session (browser).
#
# Usage:
#   ./scripts/check-relay-status.sh                         # local Python at localhost:8000
#   PYTHON_URL=http://localhost:8000 ./scripts/check-relay-status.sh
#   PYTHON_URL=http://134.199.204.12:8000 ./scripts/check-relay-status.sh  # from your machine to droplet (if 8000 is exposed)
#   NEXT_URL=https://dr3-dashboard.com ./scripts/check-relay-status.sh     # 3–4 require login; curl will get redirect

set -e
PYTHON_URL="${PYTHON_URL:-http://localhost:8000}"
NEXT_URL="${NEXT_URL:-}"

echo "=============================================="
echo "Relay diagnostics (Python: $PYTHON_URL)"
echo "=============================================="
echo ""

echo "1. Registry (who is connected to the relay?)"
echo "   GET $PYTHON_URL/options/relay/registry"
curl -s "$PYTHON_URL/options/relay/registry" | python3 -m json.tool 2>/dev/null || curl -s "$PYTHON_URL/options/relay/registry"
echo ""
echo ""

echo "2. IB status (does any provider report IB connected?)"
echo "   GET $PYTHON_URL/options/relay/ib-status"
curl -s "$PYTHON_URL/options/relay/ib-status" | python3 -m json.tool 2>/dev/null || curl -s "$PYTHON_URL/options/relay/ib-status"
echo ""
echo ""

if [ -n "$NEXT_URL" ]; then
  echo "3. Next.js relay-registry proxy (same as 1 via dashboard host; requires auth)"
  echo "   GET $NEXT_URL/api/ib-connection/relay-registry"
  OUT=$(curl -s -w "\n%{http_code}" "$NEXT_URL/api/ib-connection/relay-registry")
  CODE=$(echo "$OUT" | tail -n1)
  BODY=$(echo "$OUT" | sed '$d')
  if [ "$CODE" = "200" ]; then
    echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
  else
    echo "[HTTP $CODE] $BODY"
  fi
  echo ""
  echo ""

  echo "4. Next.js status (what the dashboard uses; requires auth)"
  echo "   GET $NEXT_URL/api/ib-connection/status"
  OUT=$(curl -s -w "\n%{http_code}" "$NEXT_URL/api/ib-connection/status")
  CODE=$(echo "$OUT" | tail -n1)
  BODY=$(echo "$OUT" | sed '$d')
  if [ "$CODE" = "200" ]; then
    echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
  else
    echo "[HTTP $CODE] $BODY"
  fi
  echo ""
fi

echo "=============================================="
echo "Done. If providers_connected=0 in (1), the agent is not registered."
echo "If (1) shows providers but (2) has timeout/error for that provider, relay->agent request is failing."
echo "=============================================="
