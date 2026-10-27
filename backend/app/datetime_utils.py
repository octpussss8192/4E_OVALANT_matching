"""Datetime utilities for timezone normalization and flexible ISO parsing."""

import re
from datetime import datetime, timezone
from typing import Optional, Union


def now_utc() -> datetime:
    """Return the current datetime in UTC timezone."""
    return datetime.now(timezone.utc)


def ensure_utc(dt: Optional[Union[datetime, str]]) -> datetime:
    """Ensure a datetime object or ISO string is timezone-aware in UTC.
    If naive, assume it represents UTC. If None, returns now_utc().
    """
    if dt is None:
        return now_utc()
    if isinstance(dt, str):
        return parse_iso_datetime(dt)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def parse_iso_datetime(dt_val: Union[str, datetime, None]) -> datetime:
    """Safely parse an ISO format datetime string into a UTC-aware datetime.
    Handles irregular microsecond digit lengths (e.g. 5 digits) for Python 3.10 compatibility,
    as well as 'Z' suffix.
    """
    if dt_val is None:
        return now_utc()
    if isinstance(dt_val, datetime):
        if dt_val.tzinfo is None:
            return dt_val.replace(tzinfo=timezone.utc)
        return dt_val

    s = str(dt_val).strip()
    # Replace 'Z' with explicit UTC offset
    s = s.replace("Z", "+00:00")

    # Normalize microsecond fraction to 6 digits for Python 3.10 fromisoformat
    s = re.sub(r"\.([0-9]+)", lambda m: "." + m.group(1).ljust(6, "0")[:6], s)

    try:
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return now_utc()
