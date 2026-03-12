"""Chief of Staff — static knowledge loader with TTL cache."""

import logging
import os
import time
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# --- Configuration via env vars ---
_REPO_DIR = os.environ.get("COS_KNOWLEDGE_BASE_DIR", "/home/don/apps/ma-tracker-app")
_MEMORY_DIR = os.environ.get("COS_MEMORY_DIR", "/home/don/.claude/projects/-Users-donross/memory")
_AGENTS_DIR = os.environ.get("COS_AGENTS_DIR", "/home/don/.claude/agents")

_MAX_LINES = 200
_CLAUDE_MD_MAX_LINES = 200
_TTL_SECONDS = 3600  # 1 hour

# --- Per-specialist memory files ---
SPECIALIST_KNOWLEDGE: dict[str, list[str]] = {
    "cos": [
        "trading-philosophy.md",
        "home-fleet.md",
        "active-session-state.md",
    ],
    "krj_signals": [],
    "deal_intel": [
        "portfolio-container-isolation.md",
        "baseline-comparison-findings.md",
        "prompting-patterns.md",
    ],
    "algo_trading": [
        "trading-engine-state.md",
    ],
    "bmc_research": [
        "trading-philosophy.md",
        "bmc-model-contracts.md",
        "bmc-quant-hardening.md",
        "bmc-production-testing.md",
        "gpu-perf-optimizations.md",
        "active-session-state.md",
    ],
    "trading_engine": [
        "trading-engine-state.md",
    ],
    "ops": [
        "ops-audit-hardening.md",
        "backup-system.md",
        "home-fleet.md",
        "droplet-py-proj.md",
    ],
}

SPECIALIST_PERSONAS: dict[str, str] = {
    "trading_engine": "trading-engine.md",
    "ops": "ops-deploy.md",
    "deal_intel": "deal-intel.md",
    "bmc_research": "bmc-quant.md",
}

# --- Cache ---
_cache: dict[str, tuple[float, str]] = {}  # key -> (timestamp, content)


def _read_file_truncated(path: Path, max_lines: int = _MAX_LINES) -> Optional[str]:
    """Read a file, truncated to max_lines. Returns None if missing/unreadable."""
    try:
        if not path.is_file():
            logger.warning(f"Knowledge file not found: {path}")
            return None
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        truncated = lines[:max_lines]
        content = "\n".join(truncated)
        if len(lines) > max_lines:
            content += f"\n\n[... truncated at {max_lines} lines, {len(lines)} total ...]"
        return content
    except Exception as e:
        logger.warning(f"Failed to read knowledge file {path}: {e}")
        return None


def _get_cached(key: str) -> Optional[str]:
    """Return cached value if within TTL, else None."""
    entry = _cache.get(key)
    if entry is None:
        return None
    ts, content = entry
    if time.monotonic() - ts > _TTL_SECONDS:
        return None
    return content


def _set_cached(key: str, content: str) -> None:
    _cache[key] = (time.monotonic(), content)


def _load_core_knowledge() -> str:
    """Load CLAUDE.md (truncated) + MEMORY.md index. Cached with TTL."""
    cached = _get_cached("__core__")
    if cached is not None:
        return cached

    parts: list[str] = []

    # CLAUDE.md — first ~200 lines (architecture overview)
    claude_md = Path(_REPO_DIR) / "CLAUDE.md"
    content = _read_file_truncated(claude_md, _CLAUDE_MD_MAX_LINES)
    if content:
        parts.append(f"## Reference: CLAUDE.md (architecture overview)\n{content}")

    # MEMORY.md — index of all memory files
    memory_index = Path(_MEMORY_DIR) / "MEMORY.md"
    content = _read_file_truncated(memory_index, _MAX_LINES)
    if content:
        parts.append(f"## Reference: MEMORY.md (memory index)\n{content}")

    result = "\n\n".join(parts)
    _set_cached("__core__", result)
    return result


def _load_memory_file(filename: str) -> Optional[str]:
    """Load a single memory file, cached with TTL."""
    cache_key = f"memory:{filename}"
    cached = _get_cached(cache_key)
    if cached is not None:
        return cached

    path = Path(_MEMORY_DIR) / filename
    content = _read_file_truncated(path, _MAX_LINES)
    if content:
        _set_cached(cache_key, content)
    return content


def _load_persona_file(filename: str) -> Optional[str]:
    """Load a single agent persona file, cached with TTL."""
    cache_key = f"persona:{filename}"
    cached = _get_cached(cache_key)
    if cached is not None:
        return cached

    path = Path(_AGENTS_DIR) / filename
    content = _read_file_truncated(path, _MAX_LINES)
    if content:
        _set_cached(cache_key, content)
    return content


def get_knowledge_base() -> str:
    """Return core knowledge (CLAUDE.md + MEMORY.md). Shared across all specialists."""
    return _load_core_knowledge()


def get_knowledge_for_specialist(specialist: str) -> str:
    """Return core knowledge + specialist-specific memory files + persona."""
    parts: list[str] = []

    # Core knowledge (always included)
    core = _load_core_knowledge()
    if core:
        parts.append(core)

    # Specialist memory files
    memory_files = SPECIALIST_KNOWLEDGE.get(specialist, [])
    for filename in memory_files:
        content = _load_memory_file(filename)
        if content:
            label = filename.replace(".md", "")
            parts.append(f"## Memory: {label}\n{content}")

    # Specialist persona
    persona_file = SPECIALIST_PERSONAS.get(specialist)
    if persona_file:
        content = _load_persona_file(persona_file)
        if content:
            label = persona_file.replace(".md", "")
            parts.append(f"## Agent Persona: {label}\n{content}")

    return "\n\n".join(parts) if parts else ""
