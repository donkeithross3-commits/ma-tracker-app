#!/usr/bin/env python3
"""
AI Usage Collector — pushes Claude Code session telemetry to the central DB.

Runs on each machine (Mac, droplet) and:
1. Invokes `npx ccusage@latest session --json` to parse JSONL session files
2. Diffs against last-collected state to find new/updated sessions
3. POSTs session data to the FastAPI /ai-usage/ingest endpoint
4. Updates local state file so we don't double-count

Usage:
    python ai_usage_collector.py --once --verbose          # Single run
    python ai_usage_collector.py --since 20260315          # Backfill from date
    python ai_usage_collector.py --machine mac             # Override machine name

Scheduled via:
    Mac:     launchd (com.dr3.ai-usage-collector.plist) every 15 min
    Droplet: cron (*/15 * * * *)
"""

import argparse
import json
import logging
import os
import platform
import subprocess
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

STATE_DIR = Path(os.environ.get("AI_USAGE_STATE_DIR", os.path.expanduser("~/.dr3-ai-usage")))
STATE_FILE = STATE_DIR / "last_collected.json"
LOG_FILE = STATE_DIR / "collector.log"
ENV_FILE = STATE_DIR / ".env"

# Load .env from state dir (FLEET_API_KEY lives there, not in the repo)
if ENV_FILE.exists():
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())

# Where to push data
INGEST_URL = os.environ.get(
    "AI_USAGE_INGEST_URL",
    "https://dr3-dashboard.com/api/ai-usage/ingest",
)

# Auth key (same as fleet monitoring)
FLEET_KEY = os.environ.get("FLEET_API_KEY", "")

# Machine name auto-detection
def _detect_machine() -> str:
    hostname = platform.node().lower()
    if "gaming" in hostname:
        return "gaming-pc"
    elif "garage" in hostname:
        return "garage-pc"
    elif "prod" in hostname or "dr3" in hostname:
        return "droplet"
    elif platform.system() == "Darwin":
        return "mac"
    return hostname[:30]


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(),
    ],
)
logger = logging.getLogger("ai_usage_collector")


# ---------------------------------------------------------------------------
# ccusage integration
# ---------------------------------------------------------------------------

def run_ccusage(since: str | None = None, breakdown: bool = True) -> list[dict]:
    """Run ccusage session command and return parsed JSON output."""
    cmd = ["npx", "ccusage@latest", "session", "--json"]
    if since:
        cmd.extend(["--since", since])
    if breakdown:
        cmd.append("--breakdown")

    logger.info("Running: %s", " ".join(cmd))

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=120,
            env={**os.environ, "NO_COLOR": "1"},
        )

        if result.returncode != 0:
            logger.warning("ccusage failed (exit %d): %s", result.returncode, result.stderr[:500])
            return []

        # ccusage outputs JSON to stdout (may have info lines on stderr)
        stdout = result.stdout.strip()
        if not stdout:
            logger.info("ccusage returned empty output")
            return []

        data = json.loads(stdout)

        # ccusage session --json returns a structure with data array and totals
        if isinstance(data, dict):
            sessions = data.get("data", data.get("sessions", []))
        elif isinstance(data, list):
            sessions = data
        else:
            logger.warning("Unexpected ccusage output type: %s", type(data))
            return []

        logger.info("ccusage returned %d sessions", len(sessions))
        return sessions

    except subprocess.TimeoutExpired:
        logger.warning("ccusage timed out after 120s")
        return []
    except json.JSONDecodeError as e:
        logger.warning("Failed to parse ccusage JSON: %s", e)
        return []
    except FileNotFoundError:
        logger.error("npx not found — is Node.js installed?")
        return []


# ---------------------------------------------------------------------------
# State management
# ---------------------------------------------------------------------------

def load_state() -> dict:
    """Load last-collected state."""
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text())
        except Exception:
            pass
    return {"collected_sessions": {}, "last_run": None}


def save_state(state: dict) -> None:
    """Save collection state."""
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    state["last_run"] = datetime.now(timezone.utc).isoformat()
    STATE_FILE.write_text(json.dumps(state, indent=2))


# ---------------------------------------------------------------------------
# Session normalization
# ---------------------------------------------------------------------------

def normalize_session(raw: dict, machine: str) -> dict:
    """Convert ccusage session data to our SessionIngest format.

    ccusage `session --json` groups by project directory, not individual session.
    Fields: sessionId (project dir), totalCost, totalTokens, lastActivity,
    modelsUsed, modelBreakdowns (array of per-model stats).
    """
    # sessionId from ccusage is actually the project directory name
    raw_session_id = raw.get("sessionId", raw.get("session_id", ""))
    project_path = raw.get("projectPath", raw.get("project", ""))
    last_activity = raw.get("lastActivity", "")

    # Build a deterministic unique session_id from machine + project + date range
    # so that each collection window produces a unique record
    session_id = f"{machine}:{raw_session_id}:{last_activity}" if raw_session_id else f"{machine}:unknown:{last_activity}"

    # Extract project and agent persona from project path or sessionId
    project = project_path or raw_session_id
    agent_persona = _infer_agent_persona(project, raw)

    # Token counts
    input_tokens = raw.get("inputTokens", 0) or 0
    output_tokens = raw.get("outputTokens", 0) or 0
    cache_creation = raw.get("cacheCreationTokens", 0) or 0
    cache_read = raw.get("cacheReadTokens", 0) or 0
    cost = raw.get("totalCost", raw.get("cost", 0)) or 0

    # Time range — ccusage provides lastActivity (date string), not start/end
    ended_at = f"{last_activity}T23:59:59Z" if last_activity else None
    started_at = None  # ccusage doesn't track session start time at this level

    # Model breakdown (from ccusage --breakdown via modelBreakdowns array)
    models = raw.get("modelBreakdowns", raw.get("models", []))
    model_breakdown = None
    model_primary = None
    if isinstance(models, list) and models:
        model_breakdown = {}
        max_tokens = 0
        for m in models:
            name = m.get("modelName", m.get("model", "unknown"))
            m_total = (m.get("inputTokens", 0) or 0) + (m.get("outputTokens", 0) or 0)
            model_breakdown[name] = {
                "input": m.get("inputTokens", 0) or 0,
                "output": m.get("outputTokens", 0) or 0,
                "cache_creation": m.get("cacheCreationTokens", 0) or 0,
                "cache_read": m.get("cacheReadTokens", 0) or 0,
                "cost": round(m.get("cost", 0) or 0, 4),
            }
            if m_total > max_tokens:
                max_tokens = m_total
                model_primary = name
    elif isinstance(raw.get("modelsUsed"), list) and raw["modelsUsed"]:
        # No breakdown data, just model names
        model_primary = raw["modelsUsed"][0]

    # ccusage doesn't track message/subagent counts at session level
    message_count = raw.get("messageCount", 0) or 0
    subagent_count = raw.get("subagentCount", 0) or 0

    return {
        "session_id": str(session_id)[:80],
        "machine": machine,
        "provider": "anthropic",
        "account_id": "primary",
        "project": str(project)[:200] if project else None,
        "agent_persona": agent_persona,
        "model_primary": model_primary,
        "started_at": started_at,
        "ended_at": ended_at,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cache_creation_tokens": cache_creation,
        "cache_read_tokens": cache_read,
        "cost_equivalent": round(float(cost), 4),
        "message_count": message_count,
        "subagent_count": subagent_count,
        "model_breakdown": model_breakdown,
    }


def _infer_agent_persona(project: str, raw: dict) -> str | None:
    """Try to infer which agent persona was used from the project path.

    ccusage groups sessions by project directory. We map known directories
    to the most likely agent persona. Home directory and ma-tracker sessions
    are labeled "interactive" — they represent mixed agent work that can't
    be attributed to a single persona from ccusage data alone.
    """
    if not project:
        return "interactive"
    project_lower = project.lower()

    # Subagent sessions (spawned by agents) — label as "subagent"
    session_id = raw.get("sessionId", "")
    if session_id == "subagents" or "/subagents" in project_lower:
        return "subagent"

    # Project-path heuristics
    if "py_proj" in project_lower or "py-proj" in project_lower:
        return "bmc-quant"
    if "parkinsons" in project_lower:
        return "parkinsons-research"

    # ma-tracker-app on the droplet is likely ops-deploy or deal-intel
    # On mac it could be any agent — label as "interactive"
    if "ma-tracker" in project_lower:
        return "interactive"

    # Home directory sessions — mixed agent usage
    return "interactive"


# ---------------------------------------------------------------------------
# Push to central DB
# ---------------------------------------------------------------------------

def push_sessions(sessions: list[dict]) -> bool:
    """POST session data to the central ingest endpoint.

    Uses curl subprocess to bypass Cloudflare TLS fingerprint blocking
    (Python urllib gets error 1010). Same pattern as fleet_collector.py.
    """
    if not sessions:
        logger.info("No sessions to push")
        return True

    if not FLEET_KEY:
        logger.error("FLEET_API_KEY not set — cannot push to central DB")
        return False

    payload = json.dumps({"sessions": sessions})
    logger.info("Pushing %d sessions to %s (%d bytes)", len(sessions), INGEST_URL, len(payload))

    try:
        result = subprocess.run(
            [
                "curl", "-s", "-X", "POST",
                INGEST_URL,
                "-H", "Content-Type: application/json",
                "-H", f"X-Fleet-Key: {FLEET_KEY}",
                "-d", payload,
                "--max-time", "30",
            ],
            capture_output=True,
            text=True,
            timeout=35,
        )

        if result.returncode != 0:
            logger.error("curl failed (exit %d): %s", result.returncode, result.stderr[:500])
            return False

        try:
            body = json.loads(result.stdout)
            logger.info("Ingest response: %s", body)
            return True
        except json.JSONDecodeError:
            # Non-JSON response — could be Cloudflare error page
            logger.error("Non-JSON response: %s", result.stdout[:500])
            return False

    except subprocess.TimeoutExpired:
        logger.error("curl timed out after 35s")
        return False
    except FileNotFoundError:
        logger.error("curl not found — falling back to urllib")
        # Fallback to urllib (works on droplet where there's no Cloudflare)
        return _push_urllib(sessions)
    except Exception as e:
        logger.error("Push failed: %s", e)
        return False


def _push_urllib(sessions: list[dict]) -> bool:
    """Fallback push using urllib (for droplet where Cloudflare isn't in the path)."""
    payload = json.dumps({"sessions": sessions}).encode()
    try:
        req = urllib.request.Request(
            INGEST_URL,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "X-Fleet-Key": FLEET_KEY,
            },
            method="POST",
        )
        resp = urllib.request.urlopen(req, timeout=30)
        body = json.loads(resp.read().decode())
        logger.info("Ingest response (urllib): %s", body)
        return True
    except Exception as e:
        logger.error("urllib push failed: %s", e)
        return False


# ---------------------------------------------------------------------------
# Main collection loop
# ---------------------------------------------------------------------------

def collect(machine: str, since: str | None = None, force: bool = False) -> int:
    """Run one collection cycle. Returns number of sessions pushed."""
    state = load_state()

    # Determine --since date for ccusage
    if since:
        since_date = since
    elif state.get("last_run") and not force:
        # Use last run date minus 1 day buffer for overlapping sessions
        try:
            last = datetime.fromisoformat(state["last_run"])
            since_date = (last - timedelta(days=1)).strftime("%Y%m%d")
        except Exception:
            since_date = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y%m%d")
    else:
        # First run or force: collect last 14 days
        since_date = (datetime.now(timezone.utc) - timedelta(days=14)).strftime("%Y%m%d")

    logger.info("Collecting sessions since %s for machine=%s", since_date, machine)

    raw_sessions = run_ccusage(since=since_date)
    if not raw_sessions:
        logger.info("No sessions found")
        save_state(state)
        return 0

    # Normalize and deduplicate against previous collection
    collected_ids = state.get("collected_sessions", {})
    sessions_to_push = []

    for raw in raw_sessions:
        normalized = normalize_session(raw, machine)
        sid = normalized["session_id"]

        # Check if this session has changed (more tokens, later end_at)
        prev = collected_ids.get(sid, {})
        prev_tokens = prev.get("total_tokens", 0)
        curr_tokens = (
            normalized["input_tokens"] + normalized["output_tokens"]
            + normalized["cache_creation_tokens"] + normalized["cache_read_tokens"]
        )

        if curr_tokens > prev_tokens or sid not in collected_ids:
            sessions_to_push.append(normalized)
            collected_ids[sid] = {
                "total_tokens": curr_tokens,
                "cost": normalized["cost_equivalent"],
                "collected_at": datetime.now(timezone.utc).isoformat(),
            }

    logger.info(
        "Found %d sessions total, %d new/updated to push",
        len(raw_sessions), len(sessions_to_push),
    )

    # Push in batches of 50
    pushed = 0
    for i in range(0, len(sessions_to_push), 50):
        batch = sessions_to_push[i:i + 50]
        if push_sessions(batch):
            pushed += len(batch)

    # Prune old state entries (keep last 30 days)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    collected_ids = {
        k: v for k, v in collected_ids.items()
        if v.get("collected_at", "") > cutoff
    }

    state["collected_sessions"] = collected_ids
    save_state(state)

    logger.info("Collection complete: %d sessions pushed", pushed)
    return pushed


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="AI Usage Collector for DR3")
    parser.add_argument("--once", action="store_true", help="Run once and exit")
    parser.add_argument("--machine", default=None, help="Override machine name")
    parser.add_argument("--since", default=None, help="Collect from date (YYYYMMDD)")
    parser.add_argument("--force", action="store_true", help="Force re-collection of all sessions")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose logging")
    parser.add_argument("--dry-run", action="store_true", help="Parse but don't push")
    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    # Setup file logging
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    file_handler = logging.FileHandler(LOG_FILE)
    file_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
    logging.getLogger().addHandler(file_handler)

    machine = args.machine or _detect_machine()
    logger.info("AI Usage Collector starting (machine=%s)", machine)

    if args.dry_run:
        raw_sessions = run_ccusage(since=args.since)
        for s in raw_sessions:
            n = normalize_session(s, machine)
            print(json.dumps(n, indent=2))
        print(f"\n{len(raw_sessions)} sessions found (dry run, not pushed)")
        return

    pushed = collect(machine, since=args.since, force=args.force)
    logger.info("Done. %d sessions pushed.", pushed)


if __name__ == "__main__":
    main()
