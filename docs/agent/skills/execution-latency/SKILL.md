---
name: execution-latency
description: Diagnose and reduce end-to-end latency and throughput bottlenecks in DR3 trading paths (relay, execution engine, and quote flows). Use for slow scans, request timeouts, websocket instability, queue contention, callback lag, and performance regressions in IB/Polygon request handling.
---

# Execution Latency

## Quick Start

1. Trace the exact request path and owner boundaries first.
2. Baseline with existing timers/logs before changing logic.
3. Fix the narrowest bottleneck with the smallest safe diff.
4. Re-measure and report before/after timings.

## DR3 Hot Paths

- `python-service/app/api/options_routes.py`
- `python-service/app/api/ws_relay.py`
- `python-service/standalone_agent/ib_data_agent.py`
- `python-service/standalone_agent/execution_engine.py`
- `python-service/standalone_agent/quote_cache.py`

## Workflow

### 1) Baseline

- Use existing `RequestTimer` stages where available.
- Capture timeout, payload size, and queue depth symptoms.
- Separate transport latency from computation latency.

### 2) Classify Bottleneck

- `network`: relay timeouts, websocket stalls, reconnect churn
- `serialization`: oversized payloads, repeated JSON marshaling
- `sync waits`: blocking loops or sleep-based waiting
- `resource caps`: market data line limits and scan throttling

### 3) Apply Lowest-Risk Optimization

- Prefer event-based waits over polling sleeps.
- Move repeated expensive work out of hot loops.
- Keep per-request payloads minimal and predictable.
- Use bounded concurrency for external/borrowed scans.

### 4) Validate

- Verify no cross-user routing regressions.
- Verify no dropped responses under load.
- Confirm error behavior remains explicit (timeouts vs provider missing).

## Guardrails

- Do not bypass user isolation for account-sensitive requests.
- Do not trade correctness for speed in order/position routes.
- Do not widen fallback behavior without explicit approval.

## Output Contract

Return:

1. Hot path mapped (entry -> bottleneck -> fix)
2. Before/after timing numbers
3. Side effects and residual risks
4. Any follow-up load test needed
