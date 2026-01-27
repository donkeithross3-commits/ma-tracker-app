# IB Data Agent

Local agent that connects your Interactive Brokers account to the MA Tracker web app.

## Quick Start

### 1. Install Dependencies

Run the installer:

**Windows:**
```
python install.py
```

**Mac/Linux:**
```
python3 install.py
```

### 2. Configure Your API Key

1. Copy `config.env.template` to `config.env`
2. Edit `config.env` and add your API key (from the MA Tracker web app)

### 3. Start IB TWS or Gateway

1. Open Interactive Brokers TWS or IB Gateway
2. Go to **File → Global Configuration → API → Settings**
3. Check **"Enable ActiveX and Socket Clients"**
4. Set **Socket Port** to `7497` (paper) or `7496` (live)
5. Click **Apply** and **OK**

### 4. Run the Agent

**Windows:**
- Double-click `start_windows.bat`
- Or run: `python ib_data_agent.py`

**Mac/Linux:**
```bash
./start_unix.sh
# Or: python3 ib_data_agent.py
```

## Configuration

Edit `config.env` to customize settings:

| Variable | Default | Description |
|----------|---------|-------------|
| `IB_PROVIDER_KEY` | (required) | Your API key from MA Tracker |
| `IB_HOST` | `127.0.0.1` | IB TWS/Gateway host |
| `IB_PORT` | `7497` | IB TWS/Gateway port (7497=paper, 7496=live) |
| `RELAY_URL` | `wss://dr3-dashboard.com/ws/data-provider` | WebSocket relay URL |

## Troubleshooting

### "Failed to connect to IB TWS"

1. Make sure IB TWS or Gateway is running
2. Check API is enabled (see Step 3 above)
3. Verify the port number matches your config
4. Try restarting TWS

### "Authentication failed"

1. Check your API key in `config.env`
2. Make sure the key matches the one shown in MA Tracker
3. Try regenerating your key in the web app

### "WebSocket connection failed"

1. Check your internet connection
2. The cloud server may be temporarily unavailable
3. The agent will automatically retry

### "Python not found"

Install Python 3.9 or newer:
- **Windows**: https://www.python.org/downloads/ (check "Add to PATH")
- **Mac**: `brew install python@3.11`
- **Linux**: `sudo apt-get install python3 python3-pip`

## Files

```
ib-data-agent/
├── ib_data_agent.py     # Main agent script
├── ib_scanner.py        # IB connection logic
├── ibapi/               # Bundled IB API (no install needed)
├── install.py           # Dependency installer
├── config.env.template  # Configuration template
├── config.env           # Your configuration (create this)
├── requirements.txt     # Python dependencies
├── start_windows.bat    # Windows starter
├── start_windows.ps1    # PowerShell starter
├── start_unix.sh        # Mac/Linux starter
└── README.md            # This file
```

## How It Works

1. The agent connects to your local IB TWS/Gateway
2. It establishes a secure WebSocket connection to the MA Tracker cloud
3. When you use the options scanner in the web app, requests are routed to your agent
4. The agent fetches data from IB and sends it back
5. Your IB credentials never leave your computer

## Support

For issues or questions, contact the MA Tracker support team.
