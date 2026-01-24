"""
IB TWS Connection Manager - Singleton Pattern
"""

import logging
import random
import time
from typing import Optional
from ..scanner import IBMergerArbScanner

logger = logging.getLogger(__name__)


class IBClient:
    """Singleton IB TWS connection manager"""
    
    _instance: Optional['IBClient'] = None
    _scanner: Optional[IBMergerArbScanner] = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    def connect(self, host: str = "127.0.0.1", port: int = 7497, client_id: int = None) -> bool:
        """Connect to IB TWS/Gateway"""
        if self._scanner is None or not self._scanner.isConnected():
            # Use random client_id to avoid conflicts with existing connections
            if client_id is None:
                client_id = random.randint(100, 999)
            
            logger.info(f"Connecting to IB at {host}:{port} with client_id={client_id}")
            self._scanner = IBMergerArbScanner()
            connected = self._scanner.connect_to_ib(host, port, client_id)
            if connected:
                logger.info("Successfully connected to IB TWS")
            else:
                logger.error("Failed to connect to IB TWS")
            return connected
        logger.info("Already connected to IB TWS")
        return True
    
    def disconnect(self):
        """Enhanced disconnect with proper cleanup"""
        if self._scanner:
            try:
                if self._scanner.isConnected():
                    logger.info("Disconnecting from IB TWS...")
                    self._scanner.disconnect()
                    time.sleep(0.5)  # Allow disconnect to complete
                    logger.info("✓ IB TWS disconnected")
            except Exception as e:
                logger.error(f"Error during disconnect: {e}")
            finally:
                self._scanner = None
                logger.info("Scanner instance cleared")
    
    def get_scanner(self) -> Optional[IBMergerArbScanner]:
        """Get the scanner instance"""
        return self._scanner
    
    def is_connected(self) -> bool:
        """Enhanced connection check with staleness detection"""
        if self._scanner is None:
            return False
        
        # Check basic socket connection
        if not self._scanner.isConnected():
            logger.debug("Scanner reports not connected")
            return False
        
        # Check for connection loss flag
        if hasattr(self._scanner, 'connection_lost') and self._scanner.connection_lost:
            logger.warning("Connection marked as lost, forcing cleanup")
            self.disconnect()
            return False
        
        # Check heartbeat age (stale connection detection)
        if hasattr(self._scanner, 'last_heartbeat'):
            age = time.time() - self._scanner.last_heartbeat
            if age > 300:  # 5 minutes without heartbeat
                logger.warning(f"Stale connection detected: no heartbeat for {age:.0f}s")
                self.disconnect()
                return False
        
        return True

