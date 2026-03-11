"""Chief of Staff — append-only JSONL activity log."""

import json
import os
import uuid
import fcntl
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


@dataclass
class ActivityEntry:
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    message_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    user_message: str = ""
    specialist: str = ""
    escalated: bool = False
    thinking: str = ""
    response: str = ""
    confidence: float = 0.0
    latency_ms: int = 0
    model: str = ""
    context_sources: list = field(default_factory=list)


_DATA_DIR = os.environ.get("COS_DATA_DIR", "/home/don/apps/data/cos")


def _log_path() -> Path:
    p = Path(_DATA_DIR)
    p.mkdir(parents=True, exist_ok=True)
    return p / "activity.jsonl"


def append_activity(entry: ActivityEntry) -> None:
    """Append a single activity entry with file locking."""
    path = _log_path()
    line = json.dumps(asdict(entry), default=str) + "\n"
    with open(path, "a") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            f.write(line)
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


def read_activity(
    limit: int = 50,
    offset: int = 0,
    specialist_filter: Optional[str] = None,
) -> list[dict]:
    """Read activity entries from tail of file."""
    path = _log_path()
    if not path.exists():
        return []

    entries = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if specialist_filter and entry.get("specialist") != specialist_filter:
                continue
            entries.append(entry)

    # Return from tail (newest first)
    entries.reverse()
    return entries[offset : offset + limit]
