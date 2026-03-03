# Latency Checklist

## Baseline Capture

1. Capture endpoint timer stages and total latency.
2. Capture provider round-trip and timeout frequency.
3. Capture payload size and contract count.
4. Capture reconnect count and heartbeat misses.

## High-Value Fixes

1. Replace sleep polling with event/callback completion.
2. Batch per-symbol operations where protocol permits.
3. Avoid repeated heavy object re-creation in loops.
4. Keep websocket message schemas lean.

## Regression Checks

1. Positions/orders still require own-user provider only.
2. External scan throttling still enforced on execution-active agents.
3. Error messages remain actionable (no generic 500 replacement).
