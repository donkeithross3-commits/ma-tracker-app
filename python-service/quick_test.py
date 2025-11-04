"""Quick IB Gateway connection test - completes in 5 seconds"""
from ibapi.client import EClient
from ibapi.wrapper import EWrapper
from threading import Thread, Event
import time
import sys

class QuickTest(EWrapper, EClient):
    def __init__(self):
        EClient.__init__(self, self)
        self.connected = Event()

    def error(self, reqId, errorCode, errorString, advancedOrderRejectJson=""):
        print(f"ERROR {errorCode}: {errorString}")
        sys.stdout.flush()

    def nextValidId(self, orderId):
        print(f"SUCCESS: Connected to IB Gateway! OrderID: {orderId}")
        sys.stdout.flush()
        self.connected.set()

print("Connecting to IB Gateway on 127.0.0.1:7497...")
sys.stdout.flush()

app = QuickTest()
app.connect("127.0.0.1", 7497, clientId=998)

api_thread = Thread(target=app.run, daemon=True)
api_thread.start()

if app.connected.wait(timeout=5):
    print("CONNECTION TEST PASSED")
    sys.stdout.flush()
    app.disconnect()
    sys.exit(0)
else:
    print("CONNECTION TEST FAILED - No response in 5 seconds")
    sys.stdout.flush()
    sys.exit(1)
