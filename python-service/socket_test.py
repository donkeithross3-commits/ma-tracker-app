"""Ultra-simple socket test - just tries to connect to port 7497"""
import socket
import sys

print("Testing raw socket connection to 127.0.0.1:7497...")
sys.stdout.flush()

try:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(3)  # 3 second timeout

    result = sock.connect_ex(('127.0.0.1', 7497))

    if result == 0:
        print("SUCCESS: Port 7497 is open and accepting connections")
        sock.close()
        sys.exit(0)
    else:
        print(f"FAILED: Cannot connect to port 7497 (error code: {result})")
        sys.exit(1)

except socket.timeout:
    print("FAILED: Connection timed out after 3 seconds")
    sys.exit(1)
except Exception as e:
    print(f"FAILED: {e}")
    sys.exit(1)
