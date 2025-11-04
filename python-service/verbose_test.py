"""Verbose IB Gateway test with detailed logging"""
from ibapi.client import EClient
from ibapi.wrapper import EWrapper
from threading import Thread, Event
import time
import sys

class VerboseTest(EWrapper, EClient):
    def __init__(self):
        EClient.__init__(self, self)
        self.connected = Event()

    def error(self, reqId, errorCode, errorString, advancedOrderRejectJson=""):
        print(f"[ERROR] Code={errorCode}: {errorString}")
        sys.stdout.flush()

    def connectAck(self):
        print("[INFO] connectAck received - socket connected")
        sys.stdout.flush()

    def nextValidId(self, orderId):
        print(f"[SUCCESS] nextValidId received - OrderID: {orderId}")
        print("[SUCCESS] API connection fully established!")
        sys.stdout.flush()
        self.connected.set()

    def connectionClosed(self):
        print("[INFO] Connection closed")
        sys.stdout.flush()

print("[1/4] Creating IB client...")
sys.stdout.flush()
app = VerboseTest()

print("[2/4] Calling connect() to 127.0.0.1:7497 with clientId=997...")
sys.stdout.flush()
app.connect("127.0.0.1", 7497, clientId=997)

print("[3/4] Starting message processing thread...")
sys.stdout.flush()
api_thread = Thread(target=app.run, daemon=True)
api_thread.start()

print("[4/4] Waiting for nextValidId (max 10 seconds)...")
sys.stdout.flush()

if app.connected.wait(timeout=10):
    print("\n=== CONNECTION TEST PASSED ===")
    sys.stdout.flush()
    app.disconnect()
    sys.exit(0)
else:
    print("\n=== CONNECTION TEST FAILED ===")
    print("The connection hung - never received nextValidId callback")
    print("\nPossible issues:")
    print("1. IB Gateway has too many active connections")
    print("2. IB Gateway is waiting for you to accept the connection (check for popup)")
    print("3. Client ID conflict with another connection")
    print("4. Master API Client ID setting is restricting connections")
    sys.stdout.flush()
    sys.exit(1)
