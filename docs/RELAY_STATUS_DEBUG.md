# Relay status debugging (agent connected but dashboard says disconnected)

Use this when a user’s IB Data Agent is running and connected to IB, but the dashboard shows “IB TWS: Disconnected”.

## 1. Run diagnostics on the droplet

With the user’s agent running and connected:

```bash
ssh droplet
cd ~/apps/ma-tracker-app   # or your app path
PYTHON_URL=http://localhost:8000 ./scripts/check-relay-status.sh
```

## 2. Interpret results

### Step 1 – Registry (`/options/relay/registry`)

- **`providers_connected: 0`**  
  The agent is **not** registered with the relay.  
  - Check the agent’s **RELAY_URL** (e.g. `wss://dr3-dashboard.com/ws/data-provider`).  
  - Check that the agent **downloaded from the app** (so it has a valid API key in `config.env`).  
  - Check Python service logs for “Invalid API key” or “Provider … authenticated for user …” when the agent connects.

- **`providers_connected: 1` (or more)**  
  The agent **is** registered. Move to step 2.

### Step 2 – IB status (`/options/relay/ib-status`)

- **`connected: true`**  
  At least one provider reported IB connected. The dashboard should show connected. If it still doesn’t, check that the **dashboard** is calling the same Python service (e.g. `PYTHON_SERVICE_URL` on the Next.js host).

- **`connected: false`** and in **`provider_statuses`** you see:
  - **`"error": "timeout"`** for that provider  
    The relay sent an `ib_status` request but got no response within 5s.  
    - Network or firewall between droplet and the user’s machine.  
    - Agent busy or stuck (e.g. long IB request).  
  - **`"connected": false`** (no error)  
    The agent answered but reported IB not connected.  
    - TWS/Gateway may have disconnected after the agent started.  
    - User should check the agent window and TWS.

### Python service logs

When the dashboard polls, the Python process should log something like:

```
relay_ib_status: querying 1 provider(s)
relay_ib_status: provider abc12 (user=clxxx) -> connected=True
relay_ib_status: result connected=True (connected_provider=abc12)
```

If you see `-> timeout` or an exception for that provider, the relay → agent request is failing.

## 3. Single worker

The relay keeps providers in **memory**. If uvicorn runs with **multiple workers** (e.g. `-w 2`), each process has its own registry. The agent might be connected to one process while the status request hits another.

**Fix:** Run the Python service with a **single worker** (default: no `-w`).

## 4. Dashboard error message

If the dashboard shows “Disconnected”, **hover the red status dot**. The tooltip shows the last message from the status API (e.g. “relay timeout”, “No IB data provider connected”). That comes from the backend and helps distinguish “no providers” from “timeout” or other errors.

## 5. Quick reference

| Symptom | Likely cause |
|--------|----------------|
| Registry: 0 providers | Agent not connected to this relay or auth failed (RELAY_URL / API key). |
| Registry: ≥1, ib-status: timeout for that provider | Relay → agent request not completing (network, agent busy). |
| Registry: ≥1, ib-status: connected false from agent | Agent says IB is not connected (TWS/Gateway or port). |
| ib-status says connected but dashboard says disconnected | Next.js not reaching Python (wrong PYTHON_SERVICE_URL or different host). |
| Sometimes connected, sometimes not | Multiple uvicorn workers; use one worker. |
