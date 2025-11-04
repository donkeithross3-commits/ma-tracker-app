"""
Simple test script to verify IB Gateway connection and ES futures data
"""
from ibapi.client import EClient
from ibapi.wrapper import EWrapper
from ibapi.contract import Contract
from threading import Thread, Event
import time

class IBTest(EWrapper, EClient):
    def __init__(self):
        EClient.__init__(self, self)
        self.connected_event = Event()
        self.data_event = Event()
        self.price_data = {}

    def error(self, reqId, errorCode, errorString, advancedOrderRejectJson=""):
        print(f"Error {errorCode}: {errorString}")

    def nextValidId(self, orderId):
        print(f"✓ Connected to IB Gateway! Next Order ID: {orderId}")
        self.connected_event.set()

    def tickPrice(self, reqId, tickType, price, attrib):
        print(f"✓ Received price data - Type: {tickType}, Price: {price}")
        self.price_data[tickType] = price
        self.data_event.set()

def test_connection():
    """Test IB Gateway connection and ES futures data"""
    print("=" * 60)
    print("Testing IB Gateway Connection and ES Futures Data")
    print("=" * 60)

    # Create connection
    app = IBTest()

    print("\n1. Connecting to IB Gateway (127.0.0.1:7497)...")
    app.connect("127.0.0.1", 7497, clientId=999)

    # Start message processing thread
    api_thread = Thread(target=app.run, daemon=True)
    api_thread.start()

    # Wait for connection
    if not app.connected_event.wait(timeout=10):
        print("✗ Failed to connect to IB Gateway within 10 seconds")
        print("\nPossible issues:")
        print("  - IB Gateway not running on port 7497")
        print("  - API settings not enabled in IB Gateway")
        print("  - Firewall blocking connection")
        return False

    # Create ES futures contract
    print("\n2. Creating ES futures contract...")
    contract = Contract()
    contract.symbol = "ES"
    contract.secType = "FUT"
    contract.exchange = "CME"
    contract.currency = "USD"
    contract.lastTradeDateOrContractMonth = "202512"  # December 2025 contract (ESZ5)

    # Request market data
    print("3. Requesting ES futures market data...")
    app.reqMktData(reqId=1, contract=contract, genericTickList="", snapshot=False, regulatorySnapshot=False, mktDataOptions=[])

    # Wait for data
    print("4. Waiting for price data...")
    if not app.data_event.wait(timeout=15):
        print("✗ No market data received within 15 seconds")
        print("\nPossible issues:")
        print("  - No market data subscription for ES futures")
        print("  - Wrong contract month (try updating lastTradeDateOrContractMonth)")
        print("  - Market closed or no data available")
        return False

    print(f"\n✓ SUCCESS! Received ES futures data:")
    for tick_type, price in app.price_data.items():
        print(f"  Tick {tick_type}: ${price}")

    # Disconnect
    app.disconnect()
    print("\n" + "=" * 60)
    print("Test completed successfully!")
    print("=" * 60)
    return True

if __name__ == "__main__":
    try:
        success = test_connection()
        exit(0 if success else 1)
    except Exception as e:
        print(f"\n✗ Test failed with exception: {e}")
        import traceback
        traceback.print_exc()
        exit(1)
