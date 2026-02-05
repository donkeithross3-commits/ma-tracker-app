# IB Live Testing: Positions and Orders – Scenarios and Robustness

This document covers scenarios, design choices, and testing guidance for using the IB TWS API to read positions and send orders through the local agent and relay, so we can run live tests with high confidence in real-time position status and correct order parameters.

---

## 0. User Permission Model (Account Scoping)

**Positions and orders are strictly scoped to the requesting user’s own account. Quotes (market data) may be served from any connected agent.**

| Request type | Permission rule | Routing behavior |
|--------------|-----------------|------------------|
| **Positions** | User may only see positions for **their own** account. | Relay requires `user_id` and routes **only** to the provider that belongs to that user (`allow_fallback_to_any_provider=False`). If that user’s agent is not connected, the request fails with 503. |
| **Place order / Cancel order** | User may only send or cancel orders for **their own** account. | Same as positions: relay requires `user_id` and routes only to that user’s provider. Never uses another user’s agent. |
| **Quotes (test-futures, fetch-chain, stock-quote, fetch-prices)** | Read-only market data; different users may pull quotes from any connected account. | Relay may route to the requesting user’s agent when provided; if that user has no connected agent, it **may fall back** to any other connected provider so any user can get quotes when at least one agent is connected. |

Implementation details:

- Each agent registers with a `user_id` (from API key validation). Positions and orders are sent with the session `user_id` from the Next.js API; the relay uses `get_active_provider(user_id, allow_fallback_to_any=False)` for positions and orders so it never returns another user’s provider.
- Quote endpoints use `allow_fallback_to_any=True` (default) so that if the requesting user has no agent, the request can still be satisfied by another connected agent (read-only data only).
- Next.js positions and order routes require authentication and pass the current user’s id; they never accept a different user id from the client for these endpoints.

---

## 1. Architecture Summary

- **Agent** (user machine): Connects to TWS, implements `reqPositions`/`position`/`positionEnd` and `placeOrder`/`orderStatus`/`openOrder`/`error`. Runs in a single process with a dedicated IB reader thread.
- **Relay** (server): Routes requests by `user_id` to the correct agent over WebSocket.
- **Dashboard** (Next.js): Calls relay endpoints with session `user_id`; displays positions and sends orders.

**Data flow**

- Positions: Dashboard → GET `/api/ib-connection/positions` → relay GET `/options/relay/positions?user_id=...` → agent `get_positions` → TWS `reqPositions()` → `position()` × N → `positionEnd()` → response.
- Orders: Dashboard → POST `/api/ib-connection/place-order` (body: contract, order) → relay POST `/options/relay/place-order?user_id=...` → agent `place_order` → TWS `placeOrder()` → `orderStatus` / `error` → response.

---

## 2. Scenarios Considered

### 2.1 Position accuracy and real-time confidence

| Scenario | Handling |
|----------|----------|
| **Single get_positions call** | Agent calls `reqPositions()`, collects all `position()` until `positionEnd()`, then `cancelPositions()`. Snapshot is consistent for that request. |
| **Concurrent get_positions** | A single lock (`_positions_lock`) ensures only one snapshot runs at a time. Second caller blocks until the first completes, then gets a fresh snapshot. |
| **Position change between snapshot and order** | Positions are point-in-time. For high confidence before order: call get_positions, then send order; after order, call get_positions again to refresh. UI should refetch positions after placing/cancelling an order. |
| **TWS sends positionEnd with zero positions** | Valid (empty account). We return an empty list; no special case. |
| **positionEnd before all position() callbacks** | Unlikely; TWS sends positionEnd after the initial dump. If it did, we’d return a partial list; lock + single flight limits corruption. |
| **Multiple accounts (managedAccounts)** | We store `_managed_accounts` from `managedAccounts()`. Each position() includes `account`. Dashboard can group by account. |
| **FA/IB with many subaccounts** | Current code uses `reqPositions()`. For 50+ subaccounts, IB recommends `reqPositionsMulti`; not yet implemented. |

### 2.2 Order parameter confidence

| Scenario | Handling |
|----------|----------|
| **Wrong or missing contract/order fields** | **Pre-validation** in agent: `validate_contract_for_order()` and `validate_order_params()` before `placeOrder`. Returns clear error (e.g. "Contract symbol is required", "Order totalQuantity must be positive") without hitting TWS. |
| **Correct parameters but TWS rejects** | We wait for `orderStatus` or `error()`. Known codes (103, 201, 202, 399, 404, 10167) are mapped to **human-readable messages** in `_order_error_message()`. |
| **Order id collision with data requests** | **Separate id spaces**: `get_next_req_id()` for market data/contract details; `get_next_order_id()` for `placeOrder`. Both are synced from `nextValidId` on connect; only order ids are used for orders, so TWS never sees duplicate or wrong order ids from our side. |
| **Duplicate order id (103)** | If agent restarts and reuses an old id, TWS returns 103. We surface it via `_order_error_message`. For recovery, user can restart TWS/agent to get a fresh `nextValidId`. |
| **Large size (201) / price cap (202)** | Error callback delivers code and text; we map to clear messages and return in place_order response. |
| **whatIf (preview)** | Order payload can set `whatIf: true`. We set `order.whatIf`; TWS returns commission/margin via `openOrder` without placing. We unblock on `openOrder` for whatIf so the caller gets the preview. |
| **Timeout waiting for orderStatus** | We wait up to `timeout_sec` (default 30s). On timeout we return `{"error": "Order response timeout. Check TWS and try again.", "orderId": ...}`. Caller can use orderId to check open orders or retry. |

### 2.3 Connection and lifecycle

| Scenario | Handling |
|----------|----------|
| **Agent not connected** | `get_positions` and `place_order` return `{"error": "IB not connected"}`. |
| **TWS connection lost during request** | `error(1100)` sets `connection_lost`; next request sees "IB not connected". In-flight position/order request may timeout. |
| **Relay has no provider for user_id** | Relay returns 503 with message to start the local agent. |
| **Multiple tabs / sessions same user** | Same agent serves all; one order id sequence per agent. No duplicate order ids as long as one agent per user. |

### 2.4 Security and permissions

| Scenario | Handling |
|----------|----------|
| **TWS read-only API** | `placeOrder` will fail at TWS; we surface the error from `error()` in the response. |
| **No trading permission for product** | TWS/IB returns an error (e.g. 10167); we map known codes and pass through message. |
| **user_id from session** | Next.js routes use `getCurrentUser()` and pass `user_id` to the relay so only that user’s agent is used. |

---

## 3. Validation and Error Mapping (Implementation)

- **Contract**: Symbol required; `secType` in allowed set (STK, OPT, FOP, FUT, etc.); for OPT, expiry (or localSymbol), strike, and right (C/P) required.
- **Order**: Action BUY/SELL/SSHORT; `totalQuantity` positive number; `orderType` in allowed set; for LMT/STP LMT, non-negative `lmtPrice`.
- **Order errors**: 103, 201, 202, 399, 404, 10167 get short, actionable messages; others get "IB error {code}: {text}".

See `ib_scanner.py`: `validate_contract_for_order()`, `validate_order_params()`, `_order_error_message()`.

---

### 3.1 Options chain and IB Error 200 ("No security definition")

When fetching an option chain, the agent:

1. **Resolves the stock contract first** (`reqContractDetails`) to get `conId` and `primaryExchange`. Using a resolved contract for market data avoids error 200 on accounts where symbol+SMART alone is ambiguous or where the security-definition service is slow to respond.
2. **Requests underlying price** with that resolved contract when available; otherwise falls back to symbol/SMART/USD.
3. **On error 200** for the underlying request, **retries once with delayed market data** (`reqMarketDataType(3)`) in case the account has delayed but not real-time stock data.

If you see "Market data farm connection is broken:secdefil" or "Sec-def data farm connection is broken" at agent startup, and then error 200 for every symbol:

- The security-definition farm may be temporarily unavailable. **Restart TWS/IB Gateway** and wait until TWS shows data farms as connected (or wait 30–60 seconds after connect) before scanning.
- Ensure the account has at least **delayed** US equities (and options) market data; real-time is not required for options scanning.

---

## 4. Simulated / Manual Testing Checklist

Before live trading:

1. **Positions**
   - [ ] Connect agent; call get_positions; confirm list matches TWS Account window (and accounts list if multi-account).
   - [ ] Call get_positions from two clients concurrently; confirm both succeed and return consistent snapshots (no mixed/corrupt list).
   - [ ] Place an order in TWS, then call get_positions again; confirm new position appears (or size updated).

2. **Orders – validation**
   - [ ] Send place_order with missing symbol → expect "Contract symbol is required".
   - [ ] Send totalQuantity 0 or negative → expect "Order totalQuantity must be positive".
   - [ ] Send LMT with no lmtPrice → expect limit-order validation error.

3. **Orders – TWS rejections**
   - [ ] (If possible) Trigger 201 (size too large) or 202 (price too far) and confirm response contains the mapped message and errorCode/errorString.

4. **Order id**
   - [ ] Place several orders in sequence; confirm each gets a distinct orderId and status (e.g. Submitted).
   - [ ] Restart agent, place order; confirm no 103 duplicate id (next_order_id synced from nextValidId).

5. **Connection**
   - [ ] Disconnect TWS or kill gateway; call get_positions or place_order; expect "IB not connected".
   - [ ] Reconnect TWS; confirm next request can succeed.

6. **Relay**
   - [ ] Call positions/place-order without session (or wrong user); expect 401 or 503 as designed.
   - [ ] With session, stop agent; expect 503 "Your agent is not connected".

---

## 5. High-Confidence Workflow for the UI

To keep **real-time position status** and **correct order parameters** when going live:

1. **Before showing “Place order”**
   - Optionally call get_positions and show current positions so the user sees up-to-date state.
   - Use **whatIf: true** in the order payload to get a preview (margin/commission) without sending a live order.

2. **When sending an order**
   - Send only after client-side checks (e.g. quantity > 0, limit price when required). Agent validation is the final guard.
   - On success, refetch positions (call get_positions again) so the UI reflects the new or updated position.
   - On error, show the `error` string (and optional `errorCode`/`errorString`) and do not refetch until the user corrects and resubmits.

3. **After cancel**
   - Refetch positions (and optionally open orders if we add that) so the UI stays in sync with TWS.

This gives a robust, predictable environment for live testing with clear validation, error messages, and position refresh behavior.
