"""Timezone utilities for converting UTC timestamps to user timezone (ET)

STANDARD PRACTICE:
- Always store datetimes as UTC in database (using NOW() or get_current_utc())
- Convert to ISO string with convert_to_et() when sending to frontend
- Frontend automatically displays in user's local timezone
"""
from datetime import datetime
from typing import Optional
import pytz

# User's timezone (Eastern Time - America/New_York)
USER_TIMEZONE = pytz.timezone('America/New_York')
UTC = pytz.UTC


def get_current_utc() -> datetime:
    """
    Get current time as timezone-aware UTC datetime.

    This is the STANDARD way to get current time in this codebase.
    Use this instead of datetime.now() or datetime.utcnow().

    Returns:
        Timezone-aware datetime in UTC

    Example:
        from app.utils.timezone import get_current_utc

        # In database inserts:
        await conn.execute("INSERT INTO table (created_at) VALUES ($1)", get_current_utc())

        # For timestamp comparisons:
        cutoff = get_current_utc() - timedelta(days=7)
    """
    return datetime.now(UTC)


def convert_to_et(dt: Optional[datetime]) -> Optional[str]:
    """
    Convert a naive or UTC datetime to UTC ISO string (for frontend compatibility).

    Args:
        dt: Datetime to convert (assumed to be UTC if naive)

    Returns:
        ISO 8601 formatted string (e.g., "2025-11-12T05:37:41.398Z"), or None if input is None

    Note:
        Returns UTC ISO format with Z suffix for maximum browser compatibility.
        Frontend JavaScript can parse this reliably with new Date() and will display in user's local timezone (ET).
    """
    if dt is None:
        return None

    # If datetime is naive, assume it's UTC (as set by PostgreSQL NOW())
    if dt.tzinfo is None:
        dt = UTC.localize(dt)

    # Return UTC ISO format with Z suffix for browser compatibility
    # The browser will automatically convert this to the user's local timezone for display
    return dt.astimezone(UTC).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'


def format_et_timestamp(dt: Optional[datetime]) -> Optional[str]:
    """
    Format a datetime as a string in UTC (browser will display in local time).

    Args:
        dt: Datetime to format

    Returns:
        ISO formatted string in UTC, or None if input is None
    """
    if dt is None:
        return None

    return convert_to_et(dt)


# Backward compatibility aliases
convert_to_cst = convert_to_et  # Alias for backward compatibility
format_cst_timestamp = format_et_timestamp  # Alias for backward compatibility
