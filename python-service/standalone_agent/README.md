# IB Data Agent

Local agent that connects your Interactive Brokers account to the MA Tracker web app.

**Your API key is already configured** - just extract and run!

## Quick Start

### 1. Set Up IB TWS or Gateway

1. Open Interactive Brokers TWS or IB Gateway
2. Go to **File → Global Configuration → API → Settings**
3. Check **"Enable ActiveX and Socket Clients"**
4. Set **Socket Port** to `7497` (paper) or `7496` (live)
5. Click **Apply** and **OK**

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

- You want to change the IB port (default: 7497 for paper trading)
- You're connecting to IB Gateway on a different machine

| Variable | Default | Description |
|----------|---------|-------------|
| `IB_PROVIDER_KEY` | (your key) | Your API key - already set! |
| `IB_HOST` | `127.0.0.1` | IB TWS/Gateway host |
| `IB_PORT` | `7497` | IB port (7497=paper, 7496=live) |

## Troubleshooting

### "Failed to connect to IB TWS"

1. Make sure IB TWS or Gateway is running
2. Check API is enabled (see Step 1 above)
3. Verify the port number matches (7497 for paper, 7496 for live)
4. Try restarting TWS

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
