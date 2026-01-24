#!/usr/bin/env python3
"""
Lightweight price fetcher for specific option contracts.
Used by Monitor tab to refresh prices for known spreads.
"""

import sys
import json
import argparse
import logging
import os
from datetime import datetime
from typing import List, Dict, Any, Optional
from app.options.ib_client import IBClient
import random
from dotenv import load_dotenv

# Load .env.local if it exists (optional for this script)
load_dotenv('.env.local')

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class PriceFetcher:
    """Fetches prices for specific option contracts (no chain scanning)"""
    
    def __init__(self, ib_host: str = "127.0.0.1", ib_port: int = 7497):
        self.ib_host = ib_host
        self.ib_port = ib_port
        self.ib_client = IBClient()
        logger.info(f"Price Fetcher initialized")
    
    def connect_to_ib(self) -> bool:
        """Connect to IB TWS with random client ID"""
        try:
            # Use 300-399 range for price fetchers
            client_id = random.randint(300, 399)
            logger.info(f"Connecting to IB TWS at {self.ib_host}:{self.ib_port}")
            logger.info(f"Using client ID: {client_id}")
            
            connected = self.ib_client.connect(
                host=self.ib_host,
                port=self.ib_port,
                client_id=client_id
            )
            
            if connected:
                logger.info("✓ Connected to IB TWS")
            else:
                logger.error("✗ Failed to connect to IB TWS")
            
            return connected
        except Exception as e:
            logger.error(f"Error connecting to IB TWS: {e}")
            return False
    
    def fetch_contract_prices(
        self,
        contracts: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Fetch prices for specific contracts.
        
        Args:
            contracts: List of dicts with {ticker, strike, expiry, right}
        
        Returns:
            List of dicts with price data
        """
        scanner = self.ib_client.get_scanner()
        if not scanner:
            raise Exception("IB TWS not connected")
        
        logger.info(f"Fetching prices for {len(contracts)} specific contracts")
        
        # Convert contract specs to scanner format
        requests = []
        for contract in contracts:
            # Normalize expiry: "2026-02-20" -> "20260220"
            expiry = contract['expiry'].replace('-', '')
            requests.append((expiry, float(contract['strike']), contract['right']))
        
        # Use scanner's batch fetching (but we control exactly which contracts)
        ticker = contracts[0]['ticker']  # Assume all same ticker for now
        
        results = scanner.get_option_data_batch(ticker, requests)
        
        # Convert to output format
        output = []
        for i, result in enumerate(results):
            if result:
                output.append({
                    'ticker': result.symbol,
                    'strike': float(result.strike),
                    'expiry': result.expiry,
                    'right': result.right,
                    'bid': float(result.bid),
                    'ask': float(result.ask),
                    'mid': float(result.mid_price),
                    'last': float(result.last),
                    'volume': int(result.volume),
                    'openInterest': int(result.open_interest),
                    'timestamp': datetime.utcnow().isoformat() + 'Z',
                })
            else:
                # Contract not found or no price
                contract_spec = contracts[i]
                logger.warning(f"No price data for {contract_spec}")
                output.append(None)
        
        return output
    
    def disconnect(self):
        """Disconnect from IB TWS"""
        if self.ib_client:
            self.ib_client.disconnect()
            logger.info("Disconnected from IB TWS")


def main():
    """CLI for fetching specific contract prices"""
    parser = argparse.ArgumentParser(description='Fetch prices for specific option contracts')
    parser.add_argument('--contracts', required=True, help='JSON string of contracts to fetch')
    
    args = parser.parse_args()
    
    try:
        # Parse contracts
        contracts = json.loads(args.contracts)
        
        if not isinstance(contracts, list) or len(contracts) == 0:
            logger.error("Contracts must be a non-empty list")
            sys.exit(1)
        
        # Get IB connection settings from env (with defaults)
        ib_host = os.getenv('IB_HOST', '127.0.0.1')
        ib_port = int(os.getenv('IB_PORT', '7497'))
        
        logger.info(f"IB settings: {ib_host}:{ib_port}")
        
        # Create fetcher (no config needed - just IB connection)
        fetcher = PriceFetcher(ib_host=ib_host, ib_port=ib_port)
        
        # Connect to IB
        if not fetcher.connect_to_ib():
            logger.error("Failed to connect to IB TWS")
            print(json.dumps({
                'success': False,
                'error': 'Failed to connect to IB TWS',
            }))
            sys.exit(1)
        
        try:
            # Fetch prices
            results = fetcher.fetch_contract_prices(contracts)
            
            # Output results as JSON
            print(json.dumps({
                'success': True,
                'contracts': results,
                'timestamp': datetime.utcnow().isoformat() + 'Z',
            }))
            
            logger.info(f"✓ Successfully fetched {len([r for r in results if r])} prices")
            
        finally:
            fetcher.disconnect()
        
    except KeyboardInterrupt:
        logger.info("\nInterrupted by user")
        sys.exit(0)
    except Exception as e:
        logger.error(f"Error: {e}", exc_info=True)
        print(json.dumps({
            'success': False,
            'error': str(e),
        }))
        sys.exit(1)


if __name__ == '__main__':
    main()

