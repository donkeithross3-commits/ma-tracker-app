# M&A Options Scanner Python Service

Python FastAPI service for analyzing merger arbitrage options strategies using Interactive Brokers API.

## Requirements

- Python 3.11+
- Interactive Brokers TWS or IB Gateway running locally
- IB account with market data subscriptions

## Setup

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Ensure IB TWS or Gateway is running on port 7497 (paper trading) or 7496 (live)

3. Run the service:
```bash
cd app
python main.py
```

Or with uvicorn directly:
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## API Endpoints

### POST /scan
Scan for option opportunities for a merger deal.

Request body:
```json
{
  "ticker": "AAPL",
  "deal_price": 180.00,
  "expected_close_date": "2024-12-31",
  "dividend_before_close": 0.50,
  "ctr_value": 0.00,
  "confidence": 0.75
}
```

Response:
```json
{
  "success": true,
  "ticker": "AAPL",
  "current_price": 175.50,
  "deal_value": 180.50,
  "spread_pct": 2.85,
  "days_to_close": 60,
  "opportunities": [
    {
      "strategy": "call",
      "entry_cost": 5.50,
      "max_profit": 10.00,
      "breakeven": 180.50,
      "expected_return": 7.50,
      "annualized_return": 0.82,
      "probability_of_profit": 0.75,
      "edge_vs_market": 0.15,
      "notes": "Buy AAPL 175 Call @ $5.50",
      "contracts": [...]
    }
  ]
}
```

### GET /health
Health check endpoint.

## Docker

Build and run with Docker:
```bash
docker build -t ma-options-scanner .
docker run -p 8000:8000 ma-options-scanner
```

Note: IB Gateway must be accessible from within the container.

## Deployment

This service can be deployed to:
- Railway
- Render
- Heroku
- Any cloud provider supporting Docker

Environment variables:
- `IB_HOST`: IB Gateway host (default: 127.0.0.1)
- `IB_PORT`: IB Gateway port (default: 7497)
- `PORT`: Service port (default: 8000)
