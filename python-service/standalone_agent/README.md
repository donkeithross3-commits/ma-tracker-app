# IB Data Agent

Local agent that connects your Interactive Brokers account to the MA Tracker web app.

**Your API key is already configured** - just extract and run!

## Quick Start

### 1. Set Up IB TWS or Gateway

Open Interactive Brokers TWS or IB Gateway, then navigate to
**File → Global Configuration → API → Settings** (or **Edit → Global Configuration** on some versions).

Configure these three settings:

| # | Setting | Required Value | Why |
|---|---------|---------------|-----|
| 1 | **Enable ActiveX and Socket Clients** | ✅ Checked | Master switch — nothing works without this. TWS has it OFF by default. |
| 2 | **Read-Only API** | ❌ Unchecked | When checked (the IB default), order placement and order info are blocked. Market data still works, but our agent needs order access. |
| 3 | **Socket Port** | `7496` (paper) or `7497` (live) | Must match the `IB_PORT` in your `config.env`. Use 7496 for paper trading, 7497 for live. |

**Recommended** (optional but avoids popups):
- Add `127.0.0.1` to **Trusted IP Addresses** so TWS doesn't prompt you every time the agent connects.

Click **Apply** and **OK** when done.

> **IB Gateway users:** IB Gateway has "Enable ActiveX and Socket Clients" ON by default and uses ports 4002 (paper) / 4001 (live) instead of 7497/7496.

#### What each setting controls

- **Enable ActiveX and Socket Clients** — The master API switch. When off, TWS refuses all socket connections. No market data, no positions, no orders — the agent simply cannot connect.

- **Read-Only API** — Blocks order placement (`placeOrder`, `cancelOrder`) and hides order information (`reqOpenOrders`, `reqAutoOpenOrders`) from the API. Does NOT block market data (`reqMktData`), positions (`reqPositions`), contract lookups (`reqContractDetails`), or option parameters (`reqSecDefOptParams`). IB enables this by default as a safety measure.

- **Socket Port** — Determines which TWS session the agent connects to. If you run both paper and live TWS on the same machine, each listens on a different port. Our agent code is not sensitive to paper vs live — all API calls work identically on both. Just make sure the port in `config.env` matches the port shown in TWS.

### 2. Run the Agent

**Windows:**
- Double-click `start_windows.bat`
- No Python installation required - Python is bundled!

**Mac:**
```bash
# First time only - install Python if not already installed:
brew install python@3.11

# Then run the agent:
./start_unix.sh
```

**Linux:**
```bash
# First time only - install Python if not already installed:
sudo apt-get update && sudo apt-get install python3 python3-pip

# Then run the agent:
./start_unix.sh
```

That's it! The agent will connect to your IB TWS and relay data to the web app.

## Requirements

### Windows
No additional requirements! Python 3.11 is bundled in the download.

If the bundled Python is missing, the script will fall back to system Python (3.8+).

### Mac
Python 3.8 or newer is required. Install options:

**Option A: Homebrew (recommended)**
```bash
brew install python@3.11
```

**Option B: Official installer**
Download from https://www.python.org/downloads/macos/

After installation, the startup script will automatically install the required dependencies.

### Linux
Python 3.8 or newer is required.

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install python3 python3-pip
```

**Fedora/RHEL:**
```bash
sudo dnf install python3 python3-pip
```

After installation, the startup script will automatically install the required dependencies.

## Configuration

Your `config.env` file is pre-configured with your API key. You only need to edit it if:

- You want to connect to live instead of paper (or change the IB port)
- You're connecting to IB Gateway on a different machine

| Variable | Default | Description |
|----------|---------|-------------|
| `IB_PROVIDER_KEY` | (your key) | Your API key - already set! |
| `IB_HOST` | `127.0.0.1` | IB TWS/Gateway host |
| `IB_PORT` | (see below) | IB port; overrides `IB_MODE` if set |
| `IB_MODE` | `paper` | `paper` → port 7496, `live` → port 7497 (TWS). Use when you don't set `IB_PORT`. |

You can set either **`IB_PORT`** (e.g. `7496` or `7497`) or **`IB_MODE`** (`paper` / `live`). If both are set, `IB_PORT` wins.

## Troubleshooting

### "Failed to connect to IB TWS"

1. Make sure IB TWS or Gateway is running and logged in
2. Check **Enable ActiveX and Socket Clients** is checked (see Step 1 above)
3. Verify the port number in `config.env` matches TWS (7496 for paper, 7497 for live; or 4002/4001 for IB Gateway)
4. Try restarting TWS — API setting changes sometimes require a restart to take effect

### Agent connects but orders don't work / order book is empty

1. Check that **Read-Only API** is **unchecked** in TWS API Settings
2. IB enables Read-Only by default — this blocks order placement and order info
3. Market data and positions will still work with Read-Only on, so the agent may appear healthy
4. Uncheck it, click Apply, and restart the agent

### "Authentication failed"

Your API key may have been regenerated. Download a fresh copy of the agent from the MA Tracker web app.

### "WebSocket connection failed"

1. Check your internet connection
2. The cloud server may be temporarily unavailable
3. The agent will automatically retry

### "Python not found" (Windows)

This shouldn't happen if you have the bundled Python. Try:
1. Re-download the agent from the MA Tracker web app
2. Make sure you extracted the ZIP file (don't run from inside the ZIP)

If you prefer to install system Python:
1. Download Python from https://www.python.org/downloads/
2. **Important:** Check "Add Python to PATH" during installation
3. Restart your computer
4. Run the start script again

### "Python not found" (Mac)

Install Python via Homebrew:
```bash
brew install python@3.11
```

Or download from https://www.python.org/downloads/macos/

### "Python not found" (Linux)

```bash
sudo apt-get update
sudo apt-get install python3 python3-pip
```

### "Permission denied" (Mac/Linux)

Make the start script executable:
```bash
chmod +x start_unix.sh
./start_unix.sh
```

## How It Works

1. The agent connects to your local IB TWS/Gateway
2. It establishes a secure WebSocket connection to the MA Tracker cloud
3. When you use the options scanner in the web app, requests are routed to your agent
4. The agent fetches data from IB and sends it back
5. Your IB credentials never leave your computer

### Options market data (unified batch path)

Options market data is requested from three places in the UI; all use the same backend path and `ib_scanner.get_option_data_batch` for robustness and lower latency:

| UI | Action | Relay message | Scanner usage |
|----|--------|---------------|---------------|
| **Curate** | Load chain | `fetch-chain` | `fetch_option_chain` → `get_available_expirations` + `get_option_data_batch` |
| **Monitor** | Refresh spread prices | `fetch-prices` | `get_option_data_batch` (grouped by ticker) |
| **Account** | Sell calls / Sell puts | `sell-scan` | `get_available_expirations` + `get_option_data_batch` |

Single-contract `get_option_data` remains available for one-off use; all bulk flows use the batch API and chunking (e.g. 50 contracts per chunk, 2.5s wait) to stay within IB limits.

## Files

```
ib-data-agent/
├── python_bundle/        # Bundled Python (Windows only)
├── ib_data_agent.exe     # Standalone executable (if included)
├── ib_data_agent.py      # Main agent script
├── ib_scanner.py         # IB connection logic
├── ibapi/                # Bundled IB API
├── config.env            # Your configuration (pre-configured!)
├── requirements.txt      # Python dependencies
├── start_windows.bat     # Windows starter
├── start_windows.ps1     # Windows starter (PowerShell)
├── start_unix.sh         # Mac/Linux starter
└── README.md             # This file
```

## Security

- Your IB credentials never leave your computer
- The agent only relays market data requests
- Your API key authenticates the agent to the cloud service
- All communication uses encrypted WebSocket connections (WSS)

## Support

For issues or questions, contact the MA Tracker support team.
