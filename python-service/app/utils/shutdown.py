"""Graceful shutdown utilities for long-running services"""
import signal
import asyncio
import logging
from typing import Callable, Optional

logger = logging.getLogger(__name__)


class GracefulShutdown:
    """Handle graceful shutdown on SIGTERM/SIGINT"""

    def __init__(self):
        self.shutdown_initiated = False
        self.cleanup_callbacks = []

    def register_cleanup(self, callback: Callable):
        """Register a cleanup callback to run on shutdown"""
        self.cleanup_callbacks.append(callback)

    async def shutdown(self):
        """Execute all cleanup callbacks"""
        if self.shutdown_initiated:
            logger.warning("Shutdown already initiated, skipping...")
            return

        self.shutdown_initiated = True
        logger.info("=" * 60)
        logger.info("GRACEFUL SHUTDOWN INITIATED")
        logger.info("=" * 60)

        for i, callback in enumerate(self.cleanup_callbacks, 1):
            try:
                logger.info(f"Running cleanup {i}/{len(self.cleanup_callbacks)}: {callback.__name__}")
                if asyncio.iscoroutinefunction(callback):
                    await callback()
                else:
                    callback()
                logger.info(f"✓ Cleanup {i} complete")
            except Exception as e:
                logger.error(f"✗ Cleanup {i} failed: {e}", exc_info=True)

        logger.info("=" * 60)
        logger.info("GRACEFUL SHUTDOWN COMPLETE")
        logger.info("=" * 60)


# Global shutdown handler
_shutdown_handler: Optional[GracefulShutdown] = None


def get_shutdown_handler() -> GracefulShutdown:
    """Get or create global shutdown handler"""
    global _shutdown_handler
    if _shutdown_handler is None:
        _shutdown_handler = GracefulShutdown()
    return _shutdown_handler


def setup_signal_handlers():
    """Setup SIGTERM and SIGINT handlers for graceful shutdown"""
    handler = get_shutdown_handler()

    def signal_handler(signum, frame):
        """Handle shutdown signals"""
        sig_name = signal.Signals(signum).name
        logger.info(f"Received {sig_name} signal - initiating graceful shutdown...")

        # Run shutdown in event loop
        loop = asyncio.get_event_loop()
        if loop.is_running():
            loop.create_task(handler.shutdown())
        else:
            asyncio.run(handler.shutdown())

    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)

    logger.info("Signal handlers registered (SIGTERM, SIGINT)")
