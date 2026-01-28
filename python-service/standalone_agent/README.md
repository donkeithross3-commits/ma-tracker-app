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

**Mac/Linux:**
```bash
./start_unix.sh
```

That's it! The agent will connect to your IB TWS and relay data to the web app.

## Requirements

### Windows
- If `ib_data_agent.exe` is included: No additional requirements
- Otherwise: Python 3.9 or newer ([download here](https://www.python.org/downloads/))

### Mac
- Python 3.9 or newer
- Install via Homebrew: `brew install python@3.11`
- Or download from: https://www.python.org/downloads/

### Linux
- Python 3.9 or newer
- Install via apt: `sudo apt-get install python3 python3-pip`

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

1. Download Python from https://www.python.org/downloads/
2. **Important:** Check "Add Python to PATH" during installation
3. Restart the start script

### "Python not found" (Mac)

```bash
brew install python@3.11
```

Or download from https://www.python.org/downloads/

### "Python not found" (Linux)

```bash
sudo apt-get update
sudo apt-get install python3 python3-pip
```

## How It Works

1. The agent connects to your local IB TWS/Gateway
2. It establishes a secure WebSocket connection to the MA Tracker cloud
3. When you use the options scanner in the web app, requests are routed to your agent
4. The agent fetches data from IB and sends it back
5. Your IB credentials never leave your computer

## Files

```
ib-data-agent/
├── ib_data_agent.exe    # Standalone executable (Windows, if included)
├── ib_data_agent.py     # Main agent script
├── ib_scanner.py        # IB connection logic
├── ibapi/               # Bundled IB API
├── config.env           # Your configuration (pre-configured!)
├── start_windows.bat    # Windows starter
├── start_unix.sh        # Mac/Linux starter
└── README.md            # This file
```

## Security

- Your IB credentials never leave your computer
- The agent only relays market data requests
- Your API key authenticates the agent to the cloud service
- All communication uses encrypted WebSocket connections (WSS)

## Support

For issues or questions, contact the MA Tracker support team.
