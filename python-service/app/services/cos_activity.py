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
    token_usage: dict = field(default_factory=dict)  # {input_tokens, output_tokens, cost_usd}
    feedback: Optional[dict] = None  # {escalation_worthy: bool, quality_good: bool}


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


def update_feedback(message_id: str, feedback: dict) -> bool:
    """Update feedback on an existing activity entry (rewrite matching line)."""
    path = _log_path()
    if not path.exists():
        return False

    lines = []
    found = False
    with open(path) as f:
        for line in f:
            stripped = line.strip()
            if not stripped:
                lines.append(line)
                continue
            try:
                entry = json.loads(stripped)
            except json.JSONDecodeError:
                lines.append(line)
                continue
            if entry.get("message_id") == message_id:
                entry["feedback"] = feedback
                lines.append(json.dumps(entry, default=str) + "\n")
                found = True
            else:
                lines.append(line)

    if found:
        with open(path, "w") as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            try:
                f.writelines(lines)
            finally:
                fcntl.flock(f, fcntl.LOCK_UN)
    return found


def get_escalation_stats() -> dict:
    """Aggregate feedback stats for Opus escalations to inject into routing prompt."""
    path = _log_path()
    if not path.exists():
        return {}

    total_escalations = 0
    total_cost = 0.0
    feedback_count = 0
    escalation_worthy_yes = 0
    escalation_worthy_no = 0
    quality_good_yes = 0
    quality_good_no = 0

    with open(path) as f:
        for line in f:
            stripped = line.strip()
            if not stripped:
                continue
            try:
                entry = json.loads(stripped)
            except json.JSONDecodeError:
                continue
            if not entry.get("escalated"):
                continue
            total_escalations += 1
            usage = entry.get("token_usage", {})
            total_cost += usage.get("cost_usd", 0)
            fb = entry.get("feedback")
            if fb:
                feedback_count += 1
                if fb.get("escalation_worthy") is True:
                    escalation_worthy_yes += 1
                elif fb.get("escalation_worthy") is False:
                    escalation_worthy_no += 1
                if fb.get("quality_good") is True:
                    quality_good_yes += 1
                elif fb.get("quality_good") is False:
                    quality_good_no += 1

    return {
        "total_escalations": total_escalations,
        "total_cost_usd": round(total_cost, 4),
        "feedback_count": feedback_count,
        "escalation_worthy_yes": escalation_worthy_yes,
        "escalation_worthy_no": escalation_worthy_no,
        "quality_good_yes": quality_good_yes,
        "quality_good_no": quality_good_no,
    }
