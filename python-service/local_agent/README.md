# IB Data Agent

Local agent that connects to IB TWS and relays market data to the droplet.

## Setup

1. Make sure you have TWS or IB Gateway running and accepting API connections on port 7497

2. Install dependencies:
```bash
cd python-service/local_agent
pip install -r requirements.txt
```

3. Set your API key:
```bash
export IB_PROVIDER_KEY="your-api-key-here"
```

4. Run the agent:
```bash
python ib_data_agent.py
```

## Configuration

Environment variables:
- `IB_HOST` - IB TWS host (default: 127.0.0.1)
- `IB_PORT` - IB TWS port (default: 7497 for paper, 7496 for live)
- `RELAY_URL` - WebSocket relay URL (default: wss://dr3-dashboard.com/ws/data-provider)
- `IB_PROVIDER_KEY` - API key for authentication (required)

## How it works

1. The agent connects to your local IB TWS
2. It establishes a secure WebSocket connection to the droplet
3. When you use the options scanner in the browser, requests are routed through this agent
4. The agent fetches data from IB and sends it back through the WebSocket

## Troubleshooting

**"Failed to connect to IB TWS"**
- Make sure TWS/Gateway is running
- Check API settings: File → Global Configuration → API → Settings
- Enable "Enable ActiveX and Socket Clients"
- Make sure port 7497 is configured

**"Authentication failed"**
- Check that IB_PROVIDER_KEY is set correctly
- The key must match the one configured on the droplet

**"WebSocket connection failed"**
- Check your internet connection
- Make sure the droplet is running
