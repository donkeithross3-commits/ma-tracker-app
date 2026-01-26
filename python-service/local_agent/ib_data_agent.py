#!/usr/bin/env python3
"""
IB Data Agent - Local agent that connects to IB TWS and relays data to the droplet.

This script runs on your local machine where TWS is running. It:
1. Connects to IB TWS locally
2. Establishes a WebSocket connection to the droplet
3. Listens for data requests and fetches data from IB
4. Sends responses back through the WebSocket

Usage:
    python ib_data_agent.py

Environment variables:
    IB_HOST         - IB TWS host (default: 127.0.0.1)
    IB_PORT         - IB TWS port (default: 7497)
    RELAY_URL       - WebSocket relay URL (default: wss://dr3-dashboard.com/ws/data-provider)
    IB_PROVIDER_KEY - API key for authentication (required)
"""

import asyncio
import json
import logging
import os
import signal
import sys
import time
from datetime import datetime
from pathlib import Path

import websockets
from websockets.exceptions import ConnectionClosed

# Add parent directory to path so we can import from app
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.scanner import IBMergerArbScanner, DealInput

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration
IB_HOST = os.environ.get("IB_HOST", "127.0.0.1")
IB_PORT = int(os.environ.get("IB_PORT", "7497"))
RELAY_URL = os.environ.get("RELAY_URL", "wss://dr3-dashboard.com/ws/data-provider")
IB_PROVIDER_KEY = os.environ.get("IB_PROVIDER_KEY", "")
HEARTBEAT_INTERVAL = 10  # seconds
RECONNECT_DELAY = 5  # seconds


class IBDataAgent:
    """Local agent that bridges IB TWS to the remote WebSocket relay"""
    
    def __init__(self):
        self.scanner: IBMergerArbScanner = None
        self.websocket = None
        self.running = False
        self.provider_id = None
        
    def connect_to_ib(self) -> bool:
        """Connect to IB TWS"""
        import random
        
        logger.info(f"Connecting to IB TWS at {IB_HOST}:{IB_PORT}...")
        
        # Use random client ID to avoid conflicts
        client_id = random.randint(100, 999)
        
        self.scanner = IBMergerArbScanner()
        connected = self.scanner.connect_to_ib(
            host=IB_HOST,
            port=IB_PORT,
            client_id=client_id
        )
        
        if connected:
            logger.info("Successfully connected to IB TWS")
        else:
            logger.error("Failed to connect to IB TWS")
            
        return connected
    
    def disconnect_from_ib(self):
        """Disconnect from IB TWS"""
        if self.scanner and self.scanner.isConnected():
            logger.info("Disconnecting from IB TWS...")
            self.scanner.disconnect()
    
    async def handle_request(self, request: dict) -> dict:
        """Handle a data request from the relay"""
        request_type = request.get("request_type")
        payload = request.get("payload", {})
        
        logger.info(f"Handling request: {request_type}")
        
        try:
            if request_type == "ib_status":
                return await self._handle_ib_status()
            
            elif request_type == "fetch_chain":
                # Run in thread pool to not block heartbeats
                return await self._run_in_thread(self._handle_fetch_chain_sync, payload)
            
            elif request_type == "check_availability":
                return await self._handle_check_availability(payload)
            
            elif request_type == "fetch_underlying":
                return await self._handle_fetch_underlying(payload)
            
            elif request_type == "test_futures":
                return await self._handle_test_futures(payload)
            
            else:
                return {"error": f"Unknown request type: {request_type}"}
                
        except Exception as e:
            logger.error(f"Error handling request {request_type}: {e}")
            return {"error": str(e)}
    
    async def _run_in_thread(self, func, *args):
        """Run a blocking function in a thread pool to not block the event loop"""
        import concurrent.futures
        loop = asyncio.get_event_loop()
        with concurrent.futures.ThreadPoolExecutor() as pool:
            return await loop.run_in_executor(pool, func, *args)
    
    async def _handle_ib_status(self) -> dict:
        """Check IB connection status"""
        connected = self.scanner and self.scanner.isConnected()
        return {
            "connected": connected,
            "message": "IB TWS connected" if connected else "IB TWS not connected"
        }
    
    async def _handle_check_availability(self, payload: dict) -> dict:
        """Check if options are available for a ticker"""
        ticker = payload.get("ticker", "").upper()
        
        if not self.scanner or not self.scanner.isConnected():
            return {"available": False, "expirationCount": 0, "error": "IB not connected"}
        
        # Resolve contract
        contract_id = self.scanner.resolve_contract(ticker)
        if not contract_id:
            return {"available": False, "expirationCount": 0, "error": f"Could not resolve {ticker}"}
        
        # Get available expirations
        expirations = self.scanner.get_available_expirations(ticker, contract_id)
        
        return {
            "available": len(expirations) > 0,
            "expirationCount": len(expirations)
        }
    
    async def _handle_fetch_underlying(self, payload: dict) -> dict:
        """Fetch underlying stock data"""
        ticker = payload.get("ticker", "").upper()
        
        if not self.scanner or not self.scanner.isConnected():
            return {"error": "IB not connected"}
        
        data = self.scanner.fetch_underlying_data(ticker)
        return {
            "ticker": ticker,
            "price": data.get("price"),
            "bid": data.get("bid"),
            "ask": data.get("ask")
        }
    
    async def _handle_test_futures(self, payload: dict) -> dict:
        """Fetch ES futures quote as a connectivity test"""
        if not self.scanner or not self.scanner.isConnected():
            return {"error": "IB not connected"}
        
        # Get contract month from payload or use front month
        contract_month = payload.get("contract_month", "")
        
        # If no contract month specified, calculate front month
        if not contract_month:
            from datetime import datetime
            now = datetime.now()
            # ES futures expire 3rd Friday, so use next month if we're past 15th
            if now.day > 15:
                month = now.month + 1
                year = now.year
                if month > 12:
                    month = 1
                    year += 1
            else:
                month = now.month
                year = now.year
            # ES contracts are Mar (H), Jun (M), Sep (U), Dec (Z)
            # Find the next quarterly month
            quarterly_months = [3, 6, 9, 12]
            for qm in quarterly_months:
                if qm >= month:
                    month = qm
                    break
            else:
                month = 3
                year += 1
            contract_month = f"{year}{month:02d}"
        
        logger.info(f"Fetching ES futures quote for contract month {contract_month}")
        
        try:
            # Create ES futures contract
            from ibapi.contract import Contract
            contract = Contract()
            contract.symbol = "ES"
            contract.secType = "FUT"
            contract.exchange = "CME"
            contract.currency = "USD"
            contract.lastTradeDateOrContractMonth = contract_month
            
            # Request market data
            req_id = self.scanner.get_next_req_id()
            
            # Store data
            futures_data = {"bid": None, "ask": None, "last": None}
            data_received = False
            
            # Override tickPrice temporarily
            original_tickPrice = self.scanner.tickPrice
            
            def handle_tick(reqId, tickType, price, attrib):
                nonlocal futures_data, data_received
                if reqId == req_id:
                    if tickType == 1:  # Bid
                        futures_data["bid"] = price
                    elif tickType == 2:  # Ask
                        futures_data["ask"] = price
                    elif tickType == 4:  # Last
                        futures_data["last"] = price
                        data_received = True
            
            self.scanner.tickPrice = handle_tick
            
            # Request snapshot data
            self.scanner.reqMktData(req_id, contract, "", True, False, [])
            
            # Wait for data (up to 5 seconds)
            import time
            for _ in range(50):
                time.sleep(0.1)
                if data_received and futures_data["bid"] and futures_data["ask"]:
                    break
            
            # Cancel and restore
            self.scanner.cancelMktData(req_id)
            self.scanner.tickPrice = original_tickPrice
            
            if not data_received and not futures_data["bid"]:
                return {"error": "No futures data received - market may be closed"}
            
            # Format contract name
            month_codes = {3: 'H', 6: 'M', 9: 'U', 12: 'Z'}
            year_digit = contract_month[3]
            month_num = int(contract_month[4:6])
            month_code = month_codes.get(month_num, '?')
            contract_name = f"ES{month_code}{year_digit}"
            
            return {
                "success": True,
                "contract": contract_name,
                "contract_month": contract_month,
                "bid": futures_data["bid"],
                "ask": futures_data["ask"],
                "last": futures_data["last"],
                "mid": (futures_data["bid"] + futures_data["ask"]) / 2 if futures_data["bid"] and futures_data["ask"] else None,
                "timestamp": datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Error fetching futures: {e}")
            return {"error": str(e)}

    def _handle_fetch_chain_sync(self, payload: dict) -> dict:
        """Fetch option chain from IB (synchronous version for thread pool)"""
        ticker = payload.get("ticker", "").upper()
        deal_price = payload.get("dealPrice", 0)
        expected_close_date = payload.get("expectedCloseDate", "")
        scan_params = payload.get("scanParams", {})
        
        if not self.scanner or not self.scanner.isConnected():
            return {"error": "IB not connected"}
        
        # Fetch underlying data first
        underlying_data = self.scanner.fetch_underlying_data(ticker)
        if not underlying_data.get("price"):
            return {"error": f"Could not fetch price for {ticker}"}
        
        spot_price = underlying_data["price"]
        
        # Parse close date
        try:
            close_date = datetime.strptime(expected_close_date, "%Y-%m-%d")
        except ValueError:
            return {"error": "Invalid date format. Use YYYY-MM-DD"}
        
        # Get scan parameters
        days_before_close = scan_params.get("daysBeforeClose", 60)
        
        logger.info(f"Fetching chain for {ticker}, spot={spot_price}, deal={deal_price}")
        
        # Fetch option chain
        options = self.scanner.fetch_option_chain(
            ticker,
            expiry_months=6,
            current_price=spot_price,
            deal_close_date=close_date,
            days_before_close=days_before_close,
            deal_price=deal_price
        )
        
        # Convert to serializable format
        contracts = []
        expirations = set()
        
        for opt in options:
            expirations.add(opt.expiry)
            contracts.append({
                "symbol": opt.symbol,
                "strike": opt.strike,
                "expiry": opt.expiry,
                "right": opt.right,
                "bid": opt.bid,
                "ask": opt.ask,
                "mid": opt.mid_price,
                "last": opt.last,
                "volume": opt.volume,
                "open_interest": opt.open_interest,
                "implied_vol": opt.implied_vol,
                "delta": opt.delta,
                "bid_size": opt.bid_size,
                "ask_size": opt.ask_size
            })
        
        return {
            "ticker": ticker,
            "spotPrice": spot_price,
            "expirations": sorted(list(expirations)),
            "contracts": contracts
        }
    
    async def _handle_fetch_chain(self, payload: dict) -> dict:
        """Async wrapper for fetch chain - kept for compatibility"""
        return self._handle_fetch_chain_sync(payload)
    
    async def send_heartbeat(self):
        """Send periodic heartbeats to keep connection alive"""
        while self.running and self.websocket:
            try:
                await self.websocket.send(json.dumps({"type": "heartbeat"}))
                # Wait for heartbeat ack
                await asyncio.sleep(HEARTBEAT_INTERVAL)
            except Exception as e:
                logger.error(f"Heartbeat error: {e}")
                break
    
    async def _process_request(self, request_id: str, data: dict):
        """Process a single request and send response (runs as separate task)"""
        try:
            result = await self.handle_request(data)
            
            # Send response
            response = {
                "type": "response",
                "request_id": request_id,
                "success": "error" not in result,
                "data": result if "error" not in result else None,
                "error": result.get("error")
            }
            if self.websocket:
                await self.websocket.send(json.dumps(response))
        except Exception as e:
            logger.error(f"Error processing request {request_id}: {e}")
            try:
                if self.websocket:
                    await self.websocket.send(json.dumps({
                        "type": "response",
                        "request_id": request_id,
                        "success": False,
                        "error": str(e)
                    }))
            except:
                pass

    async def message_handler(self):
        """Handle incoming messages from the relay"""
        pending_tasks = set()
        
        while self.running and self.websocket:
            try:
                message = await self.websocket.recv()
                data = json.loads(message)
                
                msg_type = data.get("type")
                
                if msg_type == "heartbeat_ack":
                    # Heartbeat acknowledged, all good
                    pass
                
                elif msg_type == "request":
                    # Handle data request in background task (don't block message loop)
                    request_id = data.get("request_id")
                    task = asyncio.create_task(self._process_request(request_id, data))
                    pending_tasks.add(task)
                    task.add_done_callback(pending_tasks.discard)
                    
                else:
                    logger.warning(f"Unknown message type: {msg_type}")
                    
            except ConnectionClosed:
                logger.warning("WebSocket connection closed")
                break
            except Exception as e:
                logger.error(f"Message handler error: {e}")
        
        # Cancel any pending tasks on shutdown
        for task in pending_tasks:
            task.cancel()
    
    async def connect_to_relay(self) -> bool:
        """Connect to the WebSocket relay on the droplet"""
        if not IB_PROVIDER_KEY:
            logger.error("IB_PROVIDER_KEY environment variable not set!")
            return False
        
        logger.info(f"Connecting to relay at {RELAY_URL}...")
        
        try:
            self.websocket = await websockets.connect(
                RELAY_URL,
                ping_interval=30,
                ping_timeout=60  # Allow time for long option chain fetches
            )
            
            # Send authentication
            await self.websocket.send(json.dumps({
                "type": "auth",
                "api_key": IB_PROVIDER_KEY
            }))
            
            # Wait for auth response
            response = await asyncio.wait_for(
                self.websocket.recv(),
                timeout=10.0
            )
            
            auth_result = json.loads(response)
            
            if auth_result.get("success"):
                self.provider_id = auth_result.get("provider_id")
                logger.info(f"Authenticated with relay as provider {self.provider_id}")
                return True
            else:
                logger.error(f"Authentication failed: {auth_result.get('error')}")
                return False
                
        except Exception as e:
            logger.error(f"Failed to connect to relay: {e}")
            return False
    
    async def run(self):
        """Main run loop"""
        self.running = True
        
        # Connect to IB first
        if not self.connect_to_ib():
            logger.error("Cannot start agent without IB connection")
            return
        
        # Main loop - reconnect on disconnect
        while self.running:
            try:
                # Connect to relay
                if not await self.connect_to_relay():
                    logger.warning(f"Relay connection failed, retrying in {RECONNECT_DELAY}s...")
                    await asyncio.sleep(RECONNECT_DELAY)
                    continue
                
                # Start heartbeat and message handler tasks
                heartbeat_task = asyncio.create_task(self.send_heartbeat())
                handler_task = asyncio.create_task(self.message_handler())
                
                logger.info("Agent running - ready to handle requests")
                logger.info("Press Ctrl+C to stop")
                
                # Wait for either task to complete (usually means disconnect)
                done, pending = await asyncio.wait(
                    [heartbeat_task, handler_task],
                    return_when=asyncio.FIRST_COMPLETED
                )
                
                # Cancel remaining tasks
                for task in pending:
                    task.cancel()
                
                if self.running:
                    logger.warning(f"Connection lost, reconnecting in {RECONNECT_DELAY}s...")
                    await asyncio.sleep(RECONNECT_DELAY)
                    
            except Exception as e:
                logger.error(f"Agent error: {e}")
                if self.running:
                    await asyncio.sleep(RECONNECT_DELAY)
        
        # Cleanup
        self.disconnect_from_ib()
        if self.websocket:
            await self.websocket.close()
    
    def stop(self):
        """Stop the agent"""
        logger.info("Stopping agent...")
        self.running = False


def main():
    """Main entry point"""
    print("=" * 60)
    print("IB Data Agent")
    print("=" * 60)
    print(f"IB TWS:     {IB_HOST}:{IB_PORT}")
    print(f"Relay URL:  {RELAY_URL}")
    print(f"API Key:    {'*' * 8 if IB_PROVIDER_KEY else 'NOT SET!'}")
    print("=" * 60)
    
    if not IB_PROVIDER_KEY:
        print("\nERROR: IB_PROVIDER_KEY environment variable is required!")
        print("Set it with: export IB_PROVIDER_KEY='your-api-key'")
        sys.exit(1)
    
    agent = IBDataAgent()
    
    # Handle Ctrl+C gracefully
    def signal_handler(sig, frame):
        print("\nShutting down...")
        agent.stop()
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    # Run the agent
    asyncio.run(agent.run())


if __name__ == "__main__":
    main()
