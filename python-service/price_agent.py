#!/usr/bin/env python3
"""
Price Agent - Runs on user machine with IB TWS
Fetches option prices and sends to server

CRITICAL: This file WRAPS existing scanner.py logic.
DO NOT modify scanner.py or ib_client.py.
"""

import sys
import argparse
import logging
import random
from datetime import datetime
from typing import List, Dict, Any, Optional
import requests
from agent_config import AgentConfig
from app.options.ib_client import IBClient
from app.scanner import OptionData

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class PriceAgent:
    """
    Price Agent - Fetches prices from IB TWS and sends to server
    
    This class WRAPS the existing IBClient and scanner logic.
    It does NOT replace or modify the proven IB integration.
    """
    
    def __init__(self, config: AgentConfig):
        self.config = config
        self.ib_client = IBClient()  # Existing singleton, unchanged
        
        logger.info(f"Price Agent initialized: {config.agent_id}")
        logger.info(f"Server URL: {config.server_url}")
    
    def connect_to_ib(self) -> bool:
        """
        Connect to local IB TWS
        Uses existing IBClient.connect() - UNCHANGED
        """
        try:
            # Generate random client ID for agent (avoids conflicts)
            # Client ID allocation:
            # - 100: Manual testing / local scripts
            # - 200-299: Status checks (randomized)
            # - 300-399: Price agents (randomized, auto-assigned)
            agent_client_id = random.randint(300, 399)
            
            logger.info(f"Connecting to IB TWS at {self.config.ib_host}:{self.config.ib_port}")
            logger.info(f"Using agent client ID: {agent_client_id}")
            
            connected = self.ib_client.connect(
                host=self.config.ib_host,
                port=self.config.ib_port,
                client_id=agent_client_id
            )
            
            if connected:
                logger.info("✓ Connected to IB TWS")
            else:
                logger.error("✗ Failed to connect to IB TWS")
            
            return connected
        except Exception as e:
            logger.error(f"Error connecting to IB TWS: {e}")
            return False
    
    def fetch_and_send_chain(
        self,
        ticker: str,
        deal_price: float,
        expected_close_date: str,
        scan_params: Optional[Dict[str, Any]] = None,
        dry_run: bool = False
    ) -> Dict[str, Any]:
        """
        Fetch option chain from IB and send to server
        """
        try:
            # Get scanner instance (existing, unchanged)
            scanner = self.ib_client.get_scanner()
            if not scanner:
                raise Exception("IB TWS not connected. Call connect_to_ib() first.")
            
            logger.info(f"Fetching option chain for {ticker}")
            
            # 1. Fetch underlying price (with more retries for better stability)
            spot_price = None
            max_attempts = 3
            for attempt in range(max_attempts):
                logger.info(f"Fetching underlying price for {ticker} (Attempt {attempt + 1}/{max_attempts})...")
                underlying_data = scanner.fetch_underlying_data(ticker)
                if underlying_data and underlying_data.get('price'):
                    spot_price = underlying_data['price']
                    break
                
                if attempt < max_attempts - 1:
                    wait_time = (attempt + 1) * 3 # Incremental backoff: 3s, 6s
                    logger.warning(f"Failed to fetch price for {ticker}, retrying in {wait_time}s...")
                    import time
                    time.sleep(wait_time)
            
            if not spot_price:
                raise Exception(f"Could not fetch price for {ticker} after 2 attempts. IB might need more time or market is closed.")
            
            logger.info(f"Spot price for {ticker}: ${spot_price:.2f}")
            
            # 2. Parse close date
            close_date = datetime.strptime(expected_close_date, "%Y-%m-%d")
            
            # 3. Fetch option chain (broadened for distributed agent)
            params = scan_params or {}
            options = scanner.fetch_option_chain(
                ticker=ticker,
                current_price=spot_price,
                deal_close_date=close_date,
                days_before_close=params.get('daysBeforeClose', 0),
                deal_price=deal_price,
                # Broaden bounds to ensure we catch all watched spreads
                strike_lower_pct=params.get('strikeLowerBound', 30.0) / 100,
                strike_upper_pct=params.get('strikeUpperBound', 30.0) / 100,
            )
            
            logger.info(f"✓ Fetched {len(options)} option contracts for {ticker}")
            
            # 4. Build payload with agent metadata
            agent_timestamp = datetime.utcnow().isoformat() + 'Z'
            
            payload = {
                'agentId': self.config.agent_id,
                'ticker': ticker,
                'agentTimestamp': agent_timestamp,
                'spotPrice': spot_price,
                'dealPrice': deal_price,
                'expectedCloseDate': expected_close_date,
                'contracts': [self._serialize_option(opt) for opt in options]
            }
            
            if dry_run:
                logger.info("DRY RUN - Would send payload:")
                logger.info(f"  Agent ID: {payload['agentId']}")
                logger.info(f"  Ticker: {payload['ticker']}")
                logger.info(f"  Contracts: {len(payload['contracts'])}")
                logger.info(f"  Timestamp: {payload['agentTimestamp']}")
                return {
                    'success': True,
                    'dry_run': True,
                    'contracts_fetched': len(options),
                    'payload': payload
                }
            
            # 5. POST to server (new)
            response = self._post_to_server(payload)
            
            return response
            
        except Exception as e:
            logger.error(f"Error fetching and sending chain: {e}")
            raise
    
    def _serialize_option(self, opt: OptionData) -> Dict[str, Any]:
        """
        Convert OptionData to JSON
        Preserves exact structure from scanner.py
        """
        return {
            'symbol': opt.symbol,
            'strike': float(opt.strike),
            'expiry': opt.expiry,
            'right': opt.right,
            'bid': float(opt.bid),
            'ask': float(opt.ask),
            'mid': float(opt.mid_price),
            'last': float(opt.last),
            'volume': int(opt.volume),
            'openInterest': int(opt.open_interest),
            'impliedVol': float(opt.implied_vol) if opt.implied_vol else 0.0,
            'delta': float(opt.delta) if opt.delta else 0.0,
            'bidSize': int(opt.bid_size),
            'askSize': int(opt.ask_size),
        }
    
    def _post_to_server(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        POST price data to server
        
        Args:
            payload: Price data with agentId, ticker, contracts, etc.
        
        Returns:
            Server response
        """
        url = f"{self.config.server_url}/api/price-agent/ingest-chain"
        headers = {
            'Authorization': f'Bearer {self.config.api_key}',
            'Content-Type': 'application/json',
        }
        
        try:
            logger.info(f"Posting to {url}")
            response = requests.post(
                url,
                json=payload,
                headers=headers,
                timeout=30
            )
            
            if response.status_code == 200:
                result = response.json()
                logger.info(f"✓ Server accepted data: {result}")
                return result
            elif response.status_code == 409:
                # Conflict - newer data already exists (informational, not error)
                result = response.json()
                logger.warning(f"⚠ Conflict: {result.get('message', 'Newer data exists')}")
                return result
            else:
                error_detail = response.text
                try:
                    error_json = response.json()
                    error_detail = error_json.get('error', error_detail)
                except:
                    pass
                
                logger.error(f"✗ Server returned {response.status_code}: {error_detail}")
                raise Exception(f"Server error: {response.status_code} - {error_detail}")
        
        except requests.exceptions.RequestException as e:
            logger.error(f"✗ Network error: {e}")
            raise
    
    def disconnect(self):
        """Disconnect from IB TWS"""
        if self.ib_client:
            self.ib_client.disconnect()
            logger.info("Disconnected from IB TWS")


def main():
    """Command-line interface for price agent"""
    parser = argparse.ArgumentParser(description='Price Agent - Fetch prices from IB TWS')
    parser.add_argument('--ticker', required=True, help='Stock ticker (e.g., CSGS)')
    parser.add_argument('--deal-price', type=float, required=True, help='Deal price')
    parser.add_argument('--close-date', required=True, help='Expected close date (YYYY-MM-DD)')
    parser.add_argument('--dry-run', action='store_true', help='Fetch but do not send to server')
    parser.add_argument('--days-before-close', type=int, default=0, help='Days before close to scan')
    
    args = parser.parse_args()
    
    try:
        # Load configuration
        logger.info("Loading configuration from .env.local")
        config = AgentConfig.from_env()
        config.validate()
        
        # Create agent
        agent = PriceAgent(config)
        
        # Connect to IB TWS
        if not agent.connect_to_ib():
            logger.error("Failed to connect to IB TWS. Ensure TWS/Gateway is running.")
            sys.exit(1)
        
        try:
            # Fetch and send
            result = agent.fetch_and_send_chain(
                ticker=args.ticker,
                deal_price=args.deal_price,
                expected_close_date=args.close_date,
                scan_params={'daysBeforeClose': args.days_before_close},
                dry_run=args.dry_run
            )
            
            logger.info("✓ Success!")
            # Use print to ensure something goes to stdout even if logger is captured
            print(f"RESULT_SUCCESS: {result.get('success', False)}")
            
        finally:
            # Always disconnect to allow background threads to exit
            agent.disconnect()
        
    except KeyboardInterrupt:
        logger.info("\nInterrupted by user")
        sys.exit(0)
    except Exception as e:
        logger.error(f"Error: {e}")
        # Ensure we exit with 1 on error
        import os
        os._exit(1)


if __name__ == '__main__':
    main()

