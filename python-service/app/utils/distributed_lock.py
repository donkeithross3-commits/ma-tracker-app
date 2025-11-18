"""
Distributed Lock Implementation for Multi-Instance Safety
=========================================================
Prevents multiple backend instances from running the same background
services simultaneously using PostgreSQL-based locking.

Usage:
    lock = DistributedLock("edgar_monitor", ttl_seconds=120)

    async with get_db_connection() as conn:
        if await lock.acquire(conn):
            try:
                # Do work
                while running:
                    await do_work()
                    await lock.renew(conn)  # Heartbeat
                    await asyncio.sleep(60)
            finally:
                await lock.release(conn)
        else:
            print("Another instance is already running this service")
"""

import asyncpg
import os
import socket
import logging
from datetime import datetime, timedelta
from typing import Optional

logger = logging.getLogger(__name__)


class DistributedLock:
    """PostgreSQL-based distributed lock for multi-instance coordination."""

    def __init__(self, lock_name: str, ttl_seconds: int = 300):
        """
        Initialize a distributed lock.

        Args:
            lock_name: Unique identifier for this lock (e.g., "edgar_monitor")
            ttl_seconds: Time-to-live in seconds (default: 5 minutes)
        """
        self.lock_name = lock_name
        self.ttl_seconds = ttl_seconds
        self.instance_id = f"{socket.gethostname()}-{os.getpid()}"
        self.hostname = socket.gethostname()
        self.pid = os.getpid()
        self.acquired = False
        self.acquired_at: Optional[datetime] = None

    async def acquire(self, conn: asyncpg.Connection, metadata: dict = None) -> bool:
        """
        Try to acquire the lock.

        Args:
            conn: Active database connection
            metadata: Optional metadata to store with lock (for debugging)

        Returns:
            True if lock was acquired, False if another instance holds it
        """
        try:
            # Clean up expired locks first
            deleted = await conn.fetchval("""
                SELECT cleanup_expired_locks()
            """)
            if deleted > 0:
                logger.info(f"Cleaned up {deleted} expired lock(s)")

            # Try to insert lock
            metadata_json = metadata or {}
            metadata_json.update({
                "acquired_at_utc": datetime.utcnow().isoformat(),
                "ttl_seconds": self.ttl_seconds
            })

            await conn.execute("""
                INSERT INTO service_locks (
                    lock_name, instance_id, hostname, pid, expires_at, metadata
                )
                VALUES ($1, $2, $3, $4, NOW() + ($5 || ' seconds')::INTERVAL, $6)
                ON CONFLICT (lock_name) DO NOTHING
            """, self.lock_name, self.instance_id, self.hostname, self.pid,
                str(self.ttl_seconds), metadata_json)

            # Check if we got the lock
            result = await conn.fetchrow("""
                SELECT instance_id, hostname, pid, acquired_at, expires_at
                FROM service_locks
                WHERE lock_name = $1
            """, self.lock_name)

            if result and result['instance_id'] == self.instance_id:
                self.acquired = True
                self.acquired_at = result['acquired_at']
                logger.info(
                    f"✅ Acquired lock: {self.lock_name} "
                    f"(instance: {self.instance_id}, ttl: {self.ttl_seconds}s)"
                )
                return True

            # Someone else has the lock
            if result:
                logger.info(
                    f"⏸️  Lock '{self.lock_name}' held by another instance: "
                    f"{result['instance_id']} (acquired: {result['acquired_at']}, "
                    f"expires: {result['expires_at']})"
                )
            return False

        except Exception as e:
            logger.error(f"❌ Error acquiring lock '{self.lock_name}': {e}", exc_info=True)
            return False

    async def renew(self, conn: asyncpg.Connection) -> bool:
        """
        Renew the lock (heartbeat). Call this periodically while doing work.

        Args:
            conn: Active database connection

        Returns:
            True if renewal succeeded, False otherwise
        """
        if not self.acquired:
            logger.warning(f"Attempted to renew lock '{self.lock_name}' but it's not acquired")
            return False

        try:
            result = await conn.execute("""
                UPDATE service_locks
                SET last_heartbeat = NOW(),
                    expires_at = NOW() + ($3 || ' seconds')::INTERVAL
                WHERE lock_name = $1 AND instance_id = $2
            """, self.lock_name, self.instance_id, str(self.ttl_seconds))

            # Check if update actually happened
            if result == "UPDATE 0":
                logger.error(
                    f"❌ Failed to renew lock '{self.lock_name}' - "
                    f"lock was lost (possibly expired or stolen)"
                )
                self.acquired = False
                return False

            logger.debug(f"♻️  Renewed lock: {self.lock_name}")
            return True

        except Exception as e:
            logger.error(f"❌ Error renewing lock '{self.lock_name}': {e}", exc_info=True)
            self.acquired = False
            return False

    async def release(self, conn: asyncpg.Connection) -> bool:
        """
        Release the lock when done.

        Args:
            conn: Active database connection

        Returns:
            True if release succeeded, False otherwise
        """
        if not self.acquired:
            return True  # Already released

        try:
            result = await conn.execute("""
                DELETE FROM service_locks
                WHERE lock_name = $1 AND instance_id = $2
            """, self.lock_name, self.instance_id)

            if result == "DELETE 1":
                logger.info(f"✅ Released lock: {self.lock_name}")
            else:
                logger.warning(f"⚠️  Lock '{self.lock_name}' was already released")

            self.acquired = False
            self.acquired_at = None
            return True

        except Exception as e:
            logger.error(f"❌ Error releasing lock '{self.lock_name}': {e}", exc_info=True)
            return False

    async def force_release(self, conn: asyncpg.Connection) -> bool:
        """
        Force release a lock (admin operation - use with caution!).
        This releases the lock regardless of who holds it.

        Args:
            conn: Active database connection

        Returns:
            True if lock was released, False otherwise
        """
        try:
            result = await conn.fetchrow("""
                DELETE FROM service_locks
                WHERE lock_name = $1
                RETURNING instance_id, hostname, pid
            """, self.lock_name)

            if result:
                logger.warning(
                    f"🔓 Force-released lock '{self.lock_name}' "
                    f"(was held by {result['instance_id']})"
                )
                return True
            else:
                logger.info(f"Lock '{self.lock_name}' was not held")
                return False

        except Exception as e:
            logger.error(f"❌ Error force-releasing lock '{self.lock_name}': {e}", exc_info=True)
            return False

    async def get_holder(self, conn: asyncpg.Connection) -> Optional[dict]:
        """
        Get information about who currently holds the lock.

        Args:
            conn: Active database connection

        Returns:
            Dict with lock holder info, or None if lock is not held
        """
        try:
            result = await conn.fetchrow("""
                SELECT
                    instance_id,
                    hostname,
                    pid,
                    acquired_at,
                    expires_at,
                    last_heartbeat,
                    EXTRACT(EPOCH FROM (NOW() - acquired_at)) as held_for_seconds,
                    EXTRACT(EPOCH FROM (expires_at - NOW())) as expires_in_seconds,
                    metadata
                FROM service_locks
                WHERE lock_name = $1
            """, self.lock_name)

            if result:
                return dict(result)
            return None

        except Exception as e:
            logger.error(f"❌ Error getting lock holder for '{self.lock_name}': {e}", exc_info=True)
            return None

    def __repr__(self) -> str:
        status = "acquired" if self.acquired else "not acquired"
        return (
            f"DistributedLock(name='{self.lock_name}', "
            f"instance='{self.instance_id}', status='{status}')"
        )


async def list_all_locks(conn: asyncpg.Connection) -> list[dict]:
    """
    List all currently held locks (utility function for monitoring).

    Args:
        conn: Active database connection

    Returns:
        List of dicts with lock information
    """
    try:
        results = await conn.fetch("""
            SELECT
                lock_name,
                instance_id,
                hostname,
                pid,
                acquired_at,
                expires_at,
                last_heartbeat,
                EXTRACT(EPOCH FROM (NOW() - acquired_at)) as held_for_seconds,
                EXTRACT(EPOCH FROM (expires_at - NOW())) as expires_in_seconds,
                EXTRACT(EPOCH FROM (NOW() - last_heartbeat)) as seconds_since_heartbeat,
                metadata
            FROM service_locks
            ORDER BY acquired_at DESC
        """)

        return [dict(row) for row in results]

    except Exception as e:
        logger.error(f"❌ Error listing locks: {e}", exc_info=True)
        return []


async def cleanup_all_expired_locks(conn: asyncpg.Connection) -> int:
    """
    Manually trigger cleanup of all expired locks (utility function).

    Args:
        conn: Active database connection

    Returns:
        Number of locks cleaned up
    """
    try:
        deleted = await conn.fetchval("SELECT cleanup_expired_locks()")
        if deleted > 0:
            logger.info(f"🧹 Cleaned up {deleted} expired lock(s)")
        return deleted

    except Exception as e:
        logger.error(f"❌ Error cleaning up expired locks: {e}", exc_info=True)
        return 0
