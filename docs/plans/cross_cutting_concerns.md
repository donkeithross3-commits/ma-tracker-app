# Cross-Cutting Concerns Plan: Prediction-Assessment-Score Loop

> Covers migration safety, cost impact, testing, error handling, backward compatibility,
> observability, and reusable patterns across all 5 phases.
>
> Reference: `python-service/app/risk/engine.py`, `prompts.py`, `context_hash.py`,
> `estimate_tracker.py`, `model_config.py`, `scheduler/jobs.py`.

---

## 1. Migration Plan

### 1.1 Existing Convention

Migrations live in `python-service/migrations/` as raw SQL files numbered `NNN_description.sql`.
Current highest: `036_canonical_deals.sql`. All migrations use:

- `CREATE TABLE IF NOT EXISTS` or `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for idempotency
- `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;` for enum types
- `ON CONFLICT ... DO UPDATE SET` for upsert safety
- `CREATE INDEX IF NOT EXISTS` for index creation

### 1.2 Migration Sequence

| File | Phase | Purpose | Additive? | Rollback |
|------|-------|---------|-----------|----------|
| `037_options_implied_context.sql` | 1 | `deal_options_context` table (ATM IV, put skew, vol surface snapshot per deal per day) | Yes | `DROP TABLE deal_options_context` |
| `038_milestone_enrichment.sql` | 1 | Add `enrichment_status` and `enrichment_data` JSONB columns to `canonical_deal_milestones` | Yes | `ALTER TABLE canonical_deal_milestones DROP COLUMN enrichment_status, DROP COLUMN enrichment_data` |
| `039_prediction_registry.sql` | 2 | `deal_predictions` table (prediction_type, predicted_value, confidence, horizon, outcome) | Yes | `DROP TABLE deal_predictions` |
| `040_prediction_resolution.sql` | 2 | `prediction_resolutions` table (actual_value, resolution_date, brier_score, linked prediction_id) | Yes | `DROP TABLE prediction_resolutions` |
| `041_calibration_metrics.sql` | 3 | `calibration_snapshots` table (date, bucket, predicted_mean, actual_rate, count, reliability) | Yes | `DROP TABLE calibration_snapshots` |
| `042_human_review_queue.sql` | 4 | `assessment_reviews` table (assessment_id, reviewer, rating, notes, overrides JSONB) | Yes | `DROP TABLE assessment_reviews` |
| `043_signal_weights.sql` | 5 | `signal_weight_config` table (signal_name, weight, effective_date) + `signal_divergence_log` | Yes | `DROP TABLE signal_divergence_log; DROP TABLE signal_weight_config` |

### 1.3 Migration Rules

1. **Every migration is additive**: No `DROP COLUMN`, no `ALTER TYPE`, no `DROP TABLE` on existing tables.
   New tables and new columns only.
2. **Every migration is idempotent**: Re-running it produces no errors (via `IF NOT EXISTS`, `IF NOT EXISTS`).
3. **No NOT NULL on new columns without defaults**: Existing rows must not break.
   Use `DEFAULT NULL` or `DEFAULT '{}'::jsonb` on new columns added to existing tables.
4. **Rollback = separate undo script**: Each migration ships with a `037_rollback.sql` companion
   that can be run manually if needed. These are never run automatically.
5. **Apply order**: Migrations must be applied in numeric order. Within a phase, they can
   share a single `psql` session. Cross-phase migrations must wait for the previous phase
   to be tested in production.

### 1.4 Data Backfill Strategy

- **Phase 1 (options context)**: No backfill needed. The `deal_options_context` table starts
  accumulating data from the first morning run after deploy. Historical options data does
  not exist in the system.
- **Phase 1 (milestones)**: Milestones already exist in `canonical_deal_milestones` from
  migration 036. The enrichment columns are nullable; existing milestones are simply un-enriched.
- **Phase 2 (predictions)**: No backfill. Predictions start being generated with the first
  enriched assessment. Historical assessments in `deal_risk_assessments` do not retroactively
  generate predictions.
- **Phase 3-5**: No backfill. Calibration, reviews, and signal weights start from day one
  of their respective phases.

---

## 2. Cost Impact Analysis

### 2.1 Current Baseline

From `model_config.py`, the production model is `claude-sonnet-4-20250514` at $3/M input, $15/M output.

Typical morning run (from engine.py run metrics):
- ~15-20 active deals
- Strategy split: ~40% reuse, ~30% delta, ~30% full
- Full assessment prompt: ~2,500-3,500 input tokens
- Delta assessment prompt: ~1,200-1,800 input tokens
- Output: ~800-1,200 tokens per deal
- System prompt cached via `cache_control: ephemeral` (90% discount on read)
- Estimated total cost per run: ~$0.15-$0.25

### 2.2 Per-Phase Token Impact

| Phase | New Prompt Section | Est. Additional Input Tokens | Impact on Strategy Split | Notes |
|-------|-------------------|------------------------------|------------------------|-------|
| 1 (options) | `## Options-Implied Signals` — ATM IV, put skew, vol term structure, IV vs historical | +150-250 tokens per deal | Minimal: options data changes daily but is numeric (compact) | Skipped when no options data available |
| 1 (milestones) | `## Deal Milestones` — timeline of pending/completed milestones, risk factor links | +100-200 tokens per deal | Moderate: milestone completions trigger MODERATE significance, shifting some reuse->delta | Only pending milestones included; completed ones summarized as count |
| 2 (predictions) | `## Previous Predictions` — list of open predictions with horizons and confidence | +100-150 tokens per deal | Minimal: predictions are compact structured data | Grows linearly with open prediction count; cap at 10 most recent |
| 2 (output) | Additional JSON output fields: `predictions` array in response | +200-400 output tokens | N/A (output cost is 5x input) | This is the most expensive addition per deal |
| 3 (calibration) | `## Calibration Context` — model's historical accuracy by bucket | +50-100 tokens (cacheable) | None: identical across all deals, lives in system prompt | Cache-eligible via ephemeral; only paid once per run |
| 4 (review) | No prompt change | 0 | None | Human review is offline; does not affect AI prompt |
| 5 (weights) | `## Signal Divergence` — where options and AI disagree | +50-100 tokens per deal | Minimal | Only included when divergence exceeds threshold |

### 2.3 Total Estimated Impact

| Metric | Current | After Phase 1 | After Phase 2 | After Phase 5 |
|--------|---------|---------------|---------------|---------------|
| Full prompt tokens | ~3,000 | ~3,400 (+13%) | ~3,650 (+22%) | ~3,800 (+27%) |
| Delta prompt tokens | ~1,500 | ~1,750 (+17%) | ~1,900 (+27%) | ~2,000 (+33%) |
| Output tokens | ~1,000 | ~1,000 (unchanged) | ~1,300 (+30%) | ~1,300 (+30%) |
| Cost per run (20 deals) | ~$0.20 | ~$0.23 | ~$0.28 | ~$0.30 |
| Monthly cost (22 runs) | ~$4.40 | ~$5.06 | ~$6.16 | ~$6.60 |

### 2.4 Cost Control Strategies

1. **Cache the calibration context in system prompt**: Phase 3 adds calibration data that is
   identical across all deals. Place it in the system prompt (already cached via `cache_control:
   ephemeral`). First deal pays 1.25x write cost; remaining deals pay 0.1x read cost.

2. **Truncate options context for delta assessments**: When strategy is "delta", include only
   the options signals that changed (IV spike/crush), not the full surface snapshot.

3. **Cap prediction list**: Include at most 10 open predictions in the prompt. If a deal
   accumulates more (unlikely in practice), summarize older ones as a count.

4. **Skip empty sections**: If no options data is available for a deal, omit the entire
   `## Options-Implied Signals` section rather than including "No data available" text.
   The prompt builder already follows this pattern (see `build_deal_assessment_prompt` lines
   316-327 for the filings section).

5. **Context hash includes new fields**: Update `compute_context_hash` to include options IV
   and milestone status. This ensures unchanged options data triggers reuse, not full re-assessment.

---

## 3. Testing Strategy

### 3.1 Existing Test Infrastructure

- Tests live in `python-service/tests/` using `pytest` + `freezegun`
- `conftest.py` provides fixtures for `DealInput`, `OptionData`, `MergerArbAnalyzer`
- All existing tests are for the options scanner module; **no tests exist for risk/**
- No database test infrastructure (no test DB, no fixtures for asyncpg)

### 3.2 New Test Files

| File | Phase | What It Tests |
|------|-------|---------------|
| `tests/risk/__init__.py` | 1 | Package init |
| `tests/risk/conftest.py` | 1 | Shared fixtures: mock context dicts, mock assessment responses, fake pool |
| `tests/risk/test_context_hash.py` | 1 | Context hashing with new fields (options, milestones) |
| `tests/risk/test_prompt_builder.py` | 1 | Prompt building: sections rendered, sections skipped, token count estimates |
| `tests/risk/test_options_context.py` | 1 | Options context collection: graceful degradation when no data, correct formatting |
| `tests/risk/test_milestone_context.py` | 1 | Milestone enrichment: pending vs completed, depends_on chains |
| `tests/risk/test_prediction_registry.py` | 2 | Prediction extraction from AI response, storage, duplicate prevention |
| `tests/risk/test_prediction_resolution.py` | 2 | Resolution matching, Brier score computation, edge cases (no outcome, partial data) |
| `tests/risk/test_calibration.py` | 3 | Calibration bucket computation, reliability scoring |
| `tests/risk/test_signal_comparison.py` | 5 | Options-implied vs AI probability divergence detection |
| `tests/risk/test_engine_integration.py` | 1+ | Integration: full pipeline with mocked Claude API and in-memory DB |

### 3.3 Test Fixtures (conftest.py for risk/)

```python
# tests/risk/conftest.py

import pytest
from datetime import date, datetime
from unittest.mock import AsyncMock, MagicMock

@pytest.fixture
def sample_context():
    """Minimal deal context dict matching engine.collect_deal_context() output."""
    return {
        "ticker": "ACME",
        "sheet_row": {
            "ticker": "ACME", "acquiror": "BigCorp", "category": "Cash",
            "deal_price": 100.0, "deal_price_raw": "$100.00",
            "current_price": 98.50, "current_price_raw": "$98.50",
            "gross_yield": 1.52, "gross_yield_raw": "1.52%",
            "current_yield": 4.5, "current_yield_raw": "4.50%",
            "price_change": -0.25, "price_change_raw": "-0.25",
            "countdown_days": 45, "countdown_raw": "45",
            "vote_risk": "Low", "finance_risk": "Low", "legal_risk": "Medium",
            "investable": "Yes", "go_shop_raw": "No", "cvr_flag": False,
        },
        "deal_details": {
            "cash_per_share": 100.0, "regulatory_approvals": "HSR clearance received",
            "expected_close_date": date(2026, 4, 15),
            "probability_of_success": 92.0, "termination_fee": "$150M",
        },
        "sheet_comparison": {
            "vote_risk": "Low", "finance_risk": "Low",
            "legal_risk": "Medium", "investable": "Yes", "prob_success": 92.0,
        },
        "recent_filings": [],
        "recent_halts": [],
        "sheet_diffs": [],
        "previous_assessment": None,
    }

@pytest.fixture
def sample_ai_response():
    """Minimal AI assessment response matching prompts.py JSON schema."""
    return {
        "grades": {
            "vote": {"grade": "Low", "detail": "No opposition", "confidence": 0.9, "vs_production": "agree"},
            "financing": {"grade": "Low", "detail": "Cash deal", "confidence": 0.95, "vs_production": "agree"},
            "legal": {"grade": "Medium", "detail": "Class action pending", "confidence": 0.8, "vs_production": "agree"},
            "regulatory": {"grade": "Low", "detail": "HSR cleared", "confidence": 0.85, "vs_production": "no_production_grade"},
            "mac": {"grade": "Low", "detail": "Stable business", "confidence": 0.9, "vs_production": "no_production_grade"},
        },
        "supplemental_scores": {
            "market": {"score": 2, "detail": "Tight spread"},
            "timing": {"score": 3, "detail": "On track"},
            "competing_bid": {"score": 1, "detail": "No interest"},
        },
        "investable_assessment": "Yes",
        "investable_reasoning": "Low risk profile",
        "probability_of_success": {"value": 93.0, "confidence": 0.85, "factors": []},
        "probability_of_higher_offer": {"value": 5.0, "confidence": 0.7, "factors": []},
        "break_price_estimate": {"value": 82.0, "confidence": 0.6, "anchors": [], "methodology": "Pre-deal VWAP"},
        "implied_downside_estimate": -16.8,
        "deal_summary": "Standard cash deal proceeding normally.",
        "key_risks": ["Class action litigation"],
        "watchlist_items": ["Next court date"],
        "needs_attention": False,
        "attention_reason": None,
        "production_disagreements": [],
        "assessment_changes": [],
    }

@pytest.fixture
def mock_pool():
    """AsyncMock of asyncpg.Pool for unit tests that don't need a real DB."""
    pool = AsyncMock()
    conn = AsyncMock()
    pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
    pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)
    conn.fetch = AsyncMock(return_value=[])
    conn.fetchrow = AsyncMock(return_value=None)
    conn.fetchval = AsyncMock(return_value=None)
    conn.execute = AsyncMock()
    return pool
```

### 3.4 Mocking Strategy

| Dependency | Mock Approach |
|-----------|---------------|
| **asyncpg pool** | `AsyncMock` with `acquire()` context manager returning a mock connection. Tests set `conn.fetchrow.return_value` per test case. |
| **Anthropic API** | Mock `self.anthropic.messages.create` to return a `MagicMock` with `.content[0].text` set to a JSON string and `.usage` with token counts. |
| **Date/time** | `freezegun.freeze_time` (already in use, see conftest.py). |
| **Options data** | Fixture dicts mimicking Polygon API responses or `deal_options_snapshots` rows. |
| **Environment** | `monkeypatch.setenv` for feature flags. |

### 3.5 Regression Testing

**Goal**: Ensure that adding new prompt sections does not degrade existing assessment quality.

**Approach**: Golden-file comparison.

1. **Capture baseline**: Before Phase 1, run the prompt builder against 5 representative
   deal contexts and save the generated prompts as `.txt` files in `tests/risk/golden/`.
2. **After each phase**: Re-run the prompt builder against the same contexts. Assert that:
   - All original sections are present and unchanged
   - New sections appear in the correct position
   - Total token count (via `tiktoken` or character-based estimate) is within expected bounds
3. **AI response compatibility**: Parse the golden-file AI responses through the existing
   `_store_assessment` path. Assert no exceptions and correct column mapping.

### 3.6 Integration Test Approach

For `test_engine_integration.py`:
- Use a real (local) PostgreSQL database or `testing.postgresql` fixture
- Apply migrations 031-043 in order
- Run `collect_deal_context` -> `assess_single_deal` (mocked Claude) -> `_store_assessment`
- Verify data flows through the entire pipeline including:
  - Context hashing with new fields
  - Strategy routing (reuse/delta/full)
  - Prediction extraction and storage
  - Estimate snapshot capture

---

## 4. Error Handling Patterns

### 4.1 Existing Pattern

The engine uses a **per-deal try/except** in the assessment loop (engine.py:642-645):
```python
except Exception as e:
    failed += 1
    results.append({"ticker": ticker, "status": "failed", "error": str(e)})
    logger.error("Failed to assess %s: %s", ticker, e, exc_info=True)
```
A single deal failure never crashes the entire morning run. This pattern MUST be preserved.

### 4.2 Graceful Degradation Matrix

| What Fails | Impact | Behavior | Log Level |
|-----------|--------|----------|-----------|
| Options data query raises exception | Phase 1 section missing from prompt | Skip `## Options-Implied Signals` section; add `"options_data": "unavailable"` to context | WARNING |
| Options data returns empty/null | No options section in prompt | Skip section (same as no data) | DEBUG |
| Milestone query raises exception | Phase 1 section missing from prompt | Skip `## Deal Milestones` section | WARNING |
| Milestone query returns no milestones | No milestone section | Skip section | DEBUG |
| AI response missing `predictions` array | Phase 2 prediction extraction fails | Log warning, skip prediction storage for this deal, continue with assessment | WARNING |
| AI response `predictions` has malformed entries | Some predictions lost | Parse each prediction independently; skip malformed ones, store valid ones | WARNING |
| Prediction resolution query fails | Phase 3 calibration data stale | Use last successful calibration snapshot; if none, omit calibration from prompt | WARNING |
| `deal_predictions` INSERT fails (DB error) | Prediction not stored | Log error, continue — assessment is still stored successfully | ERROR |
| `calibration_snapshots` query returns empty | No calibration context | Omit `## Calibration Context` section from prompt | DEBUG |
| Human review INSERT fails | Review not recorded | Log error, return error to API caller | ERROR |
| Signal weight config missing | Phase 5 defaults used | Fall back to equal weights (1.0 for all signals) | INFO |

### 4.3 Defensive JSON Parsing

The engine already strips markdown fences and parses JSON (engine.py:354-363). For new
prediction fields, add a post-parse validation layer:

```python
def _extract_predictions(parsed: dict) -> list[dict]:
    """Safely extract and validate predictions from AI response.

    Returns only well-formed predictions; silently drops malformed ones.
    """
    raw = parsed.get("predictions", [])
    if not isinstance(raw, list):
        logger.warning("predictions field is not a list: %s", type(raw))
        return []

    valid = []
    for i, pred in enumerate(raw):
        if not isinstance(pred, dict):
            logger.warning("Prediction %d is not a dict, skipping", i)
            continue
        # Required fields
        if not pred.get("prediction_type") or pred.get("predicted_value") is None:
            logger.warning("Prediction %d missing required fields, skipping", i)
            continue
        # Coerce numeric fields
        try:
            pred["predicted_value"] = float(pred["predicted_value"])
            pred["confidence"] = float(pred.get("confidence", 0.5))
            pred["confidence"] = max(0.0, min(1.0, pred["confidence"]))
        except (TypeError, ValueError):
            logger.warning("Prediction %d has non-numeric values, skipping", i)
            continue
        valid.append(pred)

    return valid
```

### 4.4 Database Error Handling for New Tables

All new table operations follow the existing pattern of wrapping non-critical writes
in try/except:

```python
# Pattern: non-critical write (predictions, calibration, etc.)
try:
    await self._store_predictions(assessment_id, predictions)
except Exception:
    logger.warning("Prediction storage failed for %s (non-critical)", ticker, exc_info=True)

# Pattern: critical write (assessment itself) — let it propagate
# This matches existing behavior where assessment storage failure
# causes the deal to be counted as "failed"
```

### 4.5 Timeout Handling

- **Database queries**: asyncpg has a default statement timeout. New queries for options
  data and milestones should use `statement_cache_size=0` for one-off queries or rely
  on the pool-level timeout. No explicit timeout needed unless queries are expected to
  be slow (they shouldn't be — all have indexed lookups).
- **AI API calls**: Already handled by Anthropic SDK's internal timeout. No change needed.
- **Options data fetch** (if from external API): Use `asyncio.wait_for(coro, timeout=5.0)`
  to prevent a slow external API from blocking the morning run.

---

## 5. Backward Compatibility

### 5.1 Feature Flag Design

Use environment variables (matching existing `model_config.py` pattern and CLAUDE.md guidance):

```python
# In app/risk/feature_flags.py (new file, single source of truth)
import os

ENABLE_OPTIONS_CONTEXT    = os.environ.get("RISK_ENABLE_OPTIONS_CONTEXT", "false").lower() == "true"
ENABLE_MILESTONE_CONTEXT  = os.environ.get("RISK_ENABLE_MILESTONE_CONTEXT", "false").lower() == "true"
ENABLE_PREDICTIONS        = os.environ.get("RISK_ENABLE_PREDICTIONS", "false").lower() == "true"
ENABLE_CALIBRATION        = os.environ.get("RISK_ENABLE_CALIBRATION", "false").lower() == "true"
ENABLE_HUMAN_REVIEW       = os.environ.get("RISK_ENABLE_HUMAN_REVIEW", "false").lower() == "true"
ENABLE_SIGNAL_WEIGHTS     = os.environ.get("RISK_ENABLE_SIGNAL_WEIGHTS", "false").lower() == "true"
```

**Usage in prompt builder**:
```python
from .feature_flags import ENABLE_OPTIONS_CONTEXT, ENABLE_MILESTONE_CONTEXT

def build_deal_assessment_prompt(context: dict) -> str:
    sections = []
    # ... existing sections ...

    if ENABLE_OPTIONS_CONTEXT:
        options = context.get("options_context")
        if options:
            sections.append("## Options-Implied Signals")
            # ... render options data ...

    if ENABLE_MILESTONE_CONTEXT:
        milestones = context.get("milestones")
        if milestones:
            sections.append("## Deal Milestones")
            # ... render milestone data ...

    # ... rest of existing sections ...
```

**Usage in engine**:
```python
from .feature_flags import ENABLE_PREDICTIONS

# After assess_single_deal returns:
if ENABLE_PREDICTIONS:
    predictions = _extract_predictions(assessment)
    try:
        await self._store_predictions(assessment_id, predictions)
    except Exception:
        logger.warning("Prediction storage failed (non-critical)", exc_info=True)
```

### 5.2 Rollback Checklist Per Phase

**Phase 1 Rollback**:
1. Set `RISK_ENABLE_OPTIONS_CONTEXT=false` and `RISK_ENABLE_MILESTONE_CONTEXT=false`
2. Restart the portfolio service
3. Morning run reverts to pre-Phase-1 behavior immediately
4. Options context and milestone enrichment data remain in DB but are unused
5. No migration rollback needed (tables are additive and dormant)

**Phase 2 Rollback**:
1. Set `RISK_ENABLE_PREDICTIONS=false`
2. Restart
3. Predictions stop being generated or stored
4. Existing predictions remain in DB
5. AI prompt reverts to Phase 1 format (no prediction section)

**Phase 3-5 Rollback**: Same pattern — disable the env var, restart.

### 5.3 Data Compatibility

- **Old assessments** (before Phase 1): The `ai_response` JSONB column will not contain
  `predictions` or `options_context_used` fields. All code reading these must use
  `.get("predictions", [])` (never assume the key exists).
- **New assessments read by old code**: New JSONB fields in `ai_response` are ignored
  by code that doesn't reference them. No conflict.
- **Mixed-phase runs**: If a run is interrupted mid-way and restarted with different flags,
  the `ON CONFLICT (assessment_date, ticker) DO UPDATE` ensures the latest assessment wins.
  Predictions from the interrupted run are orphaned but harmless.

### 5.4 API Backward Compatibility

The risk routes (`app/api/risk_routes.py`) return assessment data from the database.
New fields are additive to the JSON response:

- Clients that don't expect `predictions` will ignore the key (standard JSON behavior)
- No existing endpoint signatures change
- New endpoints for predictions/calibration/reviews are added, not modified

---

## 6. Observability

### 6.1 New Metrics (Logged to `job_runs.result` JSONB)

The morning run's `result` dict (returned by `run_morning_assessment`) should be extended:

```python
# Phase 1 additions to run result
"options_context_deals": 12,        # deals with options data included
"options_context_skipped": 3,       # deals where options data was unavailable
"milestone_context_deals": 15,      # deals with milestone data included
"milestone_context_skipped": 0,

# Phase 2 additions
"predictions_generated": 28,        # total new predictions stored
"predictions_resolved": 5,          # predictions that resolved this run
"avg_predictions_per_deal": 1.9,

# Phase 3 additions
"calibration_snapshot_stored": True,
"calibration_reliability": 0.82,    # overall calibration reliability score

# Phase 5 additions
"signal_divergences_detected": 3,   # deals where options and AI significantly disagree
```

### 6.2 Logging Strategy

All new log messages follow the existing pattern: `logger.info/warning/error` with
structured data in the message.

**New log points**:

```python
# Phase 1: Options context
logger.info("Options context for %s: IV=%.2f, skew=%.2f, included=%s", ticker, iv, skew, included)
logger.warning("Options context unavailable for %s: %s", ticker, reason)

# Phase 1: Milestones
logger.info("Milestones for %s: %d pending, %d completed", ticker, pending, completed)

# Phase 2: Predictions
logger.info("Extracted %d predictions for %s", len(predictions), ticker)
logger.info("Resolved %d predictions for %s (avg brier=%.4f)", resolved_count, ticker, avg_brier)

# Phase 3: Calibration
logger.info("Calibration snapshot: %d buckets, reliability=%.3f", bucket_count, reliability)

# Phase 5: Signal divergence
logger.info("Signal divergence for %s: options_implied=%.1f%% vs ai=%.1f%% (gap=%.1f%%)",
            ticker, options_prob, ai_prob, gap)
```

### 6.3 Dashboard Queries

These can be run directly against the production database or exposed via risk_routes.py:

```sql
-- Phase 1: Options context coverage
SELECT assessment_date,
       COUNT(*) FILTER (WHERE input_data::jsonb ? 'options_context') AS with_options,
       COUNT(*) AS total
FROM deal_risk_assessments
WHERE assessment_date >= CURRENT_DATE - 7
GROUP BY assessment_date ORDER BY assessment_date;

-- Phase 2: Prediction accuracy over time
SELECT DATE_TRUNC('week', r.resolution_date) AS week,
       AVG(r.brier_score) AS avg_brier,
       COUNT(*) AS resolved_count
FROM prediction_resolutions r
GROUP BY week ORDER BY week;

-- Phase 2: Open predictions by type
SELECT prediction_type, COUNT(*) AS open_count,
       AVG(confidence) AS avg_confidence
FROM deal_predictions
WHERE resolved_at IS NULL
GROUP BY prediction_type;

-- Phase 3: Calibration reliability trend
SELECT snapshot_date, AVG(reliability) AS avg_reliability,
       SUM(sample_count) AS total_samples
FROM calibration_snapshots
GROUP BY snapshot_date ORDER BY snapshot_date;

-- Run cost trend (existing view, now includes new context costs)
SELECT * FROM risk_cost_summary WHERE assessment_date >= CURRENT_DATE - 14;
```

### 6.4 Alerting Thresholds

| Metric | Threshold | Action |
|--------|-----------|--------|
| Morning run cost per deal | > $0.05 (2.5x current) | Log WARNING, investigate prompt bloat |
| Morning run total cost | > $1.00 (5x current) | Log ERROR, consider disabling new sections |
| Prediction resolution rate | < 10% after 30 days | Log WARNING, check resolution logic |
| Calibration reliability | < 0.5 (poorly calibrated) | Log WARNING, consider recalibrating |
| Options context failure rate | > 50% of deals | Log WARNING, check data source |
| Signal divergence count | > 50% of deals | Log INFO (expected during transition) |

---

## 7. Reusable Patterns

### 7.1 Context Enrichment Plugin Pattern

New data sources for the assessment pipeline follow this interface:

```python
# Pattern: Context Enrichment Plugin
# Each plugin is a standalone async function that:
# 1. Takes a ticker and pool
# 2. Returns a dict (or None) to merge into the context
# 3. Handles its own errors (returns None on failure, never raises)
# 4. Is gated by a feature flag

async def collect_options_context(pool, ticker: str) -> dict | None:
    """Collect options-implied signals for a deal.

    Returns dict with keys: atm_iv, put_skew, vol_term_structure, iv_percentile
    or None if data is unavailable.
    """
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM deal_options_context WHERE ticker = $1 ORDER BY snapshot_date DESC LIMIT 1",
                ticker,
            )
        if not row:
            return None
        return {
            "atm_iv": float(row["atm_iv"]) if row["atm_iv"] else None,
            "put_skew": float(row["put_skew"]) if row["put_skew"] else None,
            # ... etc
        }
    except Exception as e:
        logger.warning("Options context failed for %s: %s", ticker, e)
        return None
```

**Registration in `collect_deal_context`**:

```python
async def collect_deal_context(self, ticker: str) -> dict:
    context = {"ticker": ticker}
    # ... existing data collection ...

    # Plugin pattern: each enrichment is independent and failure-tolerant
    if ENABLE_OPTIONS_CONTEXT:
        options = await collect_options_context(self.pool, ticker)
        if options:
            context["options_context"] = options

    if ENABLE_MILESTONE_CONTEXT:
        milestones = await collect_milestone_context(self.pool, ticker)
        if milestones:
            context["milestones"] = milestones

    return context
```

### 7.2 Prompt Section Builder Pattern

New prompt sections follow the existing pattern in `prompts.py`:

```python
# Pattern: Prompt Section Builder
# Each section:
# 1. Checks if data exists in context
# 2. Formats it as markdown with ## header
# 3. Returns list of lines (or empty list to skip)
# 4. Is called from build_deal_assessment_prompt in a defined order

def _build_options_section(context: dict) -> list[str]:
    """Build the options-implied signals section for the prompt."""
    options = context.get("options_context")
    if not options:
        return []

    lines = ["## Options-Implied Signals"]
    if options.get("atm_iv") is not None:
        lines.append(f"ATM Implied Volatility: {options['atm_iv']:.2%}")
    if options.get("put_skew") is not None:
        lines.append(f"Put Skew (25-delta): {options['put_skew']:.2f}")
    if options.get("iv_percentile") is not None:
        lines.append(f"IV Percentile (30-day): {options['iv_percentile']:.0f}th")
    if options.get("vol_term_structure"):
        lines.append(f"Vol Term Structure: {options['vol_term_structure']}")
    lines.append("")
    return lines


def _build_milestone_section(context: dict) -> list[str]:
    """Build the deal milestones section for the prompt."""
    milestones = context.get("milestones")
    if not milestones:
        return []

    lines = ["## Deal Milestones"]
    pending = [m for m in milestones if m.get("status") == "pending"]
    completed = [m for m in milestones if m.get("status") == "completed"]

    if completed:
        lines.append(f"Completed: {len(completed)} milestones")
        for m in completed[-3:]:  # Last 3 completed
            lines.append(f"  - [{m['milestone_type']}] {m.get('milestone_date', 'N/A')}")

    if pending:
        lines.append(f"Pending: {len(pending)} milestones")
        for m in pending:
            expected = m.get("expected_date", "TBD")
            lines.append(f"  - [{m['milestone_type']}] Expected: {expected} (affects: {m.get('risk_factor_affected', 'general')})")

    lines.append("")
    return lines
```

**Integration into `build_deal_assessment_prompt`**:
```python
def build_deal_assessment_prompt(context: dict) -> str:
    sections = []
    # ... existing sections 1-10 ...

    # New sections (feature-flag gated at context collection time,
    # but also safe here: if context key is missing, builder returns [])
    sections.extend(_build_options_section(context))
    sections.extend(_build_milestone_section(context))

    return "\n".join(sections)
```

### 7.3 Prediction-Resolution-Score Pipeline

This is the core reusable pipeline for Phase 2-3:

```
AI Assessment Response
    |
    v
_extract_predictions(parsed_response)
    |  Returns: list[dict] with prediction_type, predicted_value, confidence, horizon
    v
_store_predictions(pool, assessment_id, predictions)
    |  Inserts into deal_predictions table
    |  ON CONFLICT: updates if same (ticker, prediction_type, horizon) is open
    v
--- (next morning run) ---
    |
_resolve_predictions(pool, ticker, context)
    |  Checks each open prediction against actual outcomes
    |  Computes brier_score = (predicted - actual)^2
    v
_store_resolutions(pool, resolutions)
    |  Inserts into prediction_resolutions table
    |  Marks deal_predictions.resolved_at
    v
--- (after N resolutions accumulate) ---
    |
_compute_calibration(pool, min_samples=20)
    |  Groups predictions by confidence bucket (0-10%, 10-20%, ..., 90-100%)
    |  Computes: predicted_mean, actual_rate, sample_count, reliability per bucket
    v
_store_calibration_snapshot(pool, buckets)
    |  Inserts into calibration_snapshots
    v
_build_calibration_context(pool)
    |  Returns compact summary for injection into system prompt
    |  e.g. "Your 80-90% predictions resolve correctly 72% of the time"
```

### 7.4 Signal Comparison Pattern

Reusable for comparing any two signals:

```python
def compute_signal_divergence(
    signal_a: float | None,
    signal_b: float | None,
    signal_a_name: str = "signal_a",
    signal_b_name: str = "signal_b",
    threshold: float = 10.0,
) -> dict | None:
    """Compare two probability signals and detect meaningful divergence.

    Args:
        signal_a: First signal value (0-100 scale)
        signal_b: Second signal value (0-100 scale)
        threshold: Minimum absolute difference to flag as divergent

    Returns:
        Divergence dict if threshold exceeded, None otherwise.
    """
    if signal_a is None or signal_b is None:
        return None

    gap = abs(signal_a - signal_b)
    if gap < threshold:
        return None

    higher = signal_a_name if signal_a > signal_b else signal_b_name
    return {
        signal_a_name: signal_a,
        signal_b_name: signal_b,
        "gap": round(gap, 2),
        "higher_signal": higher,
        "interpretation": f"{higher} is {gap:.1f}pp more optimistic",
    }
```

**Usage**:
```python
# Phase 5: Compare options-implied probability vs AI probability
divergence = compute_signal_divergence(
    signal_a=options_implied_prob,
    signal_b=ai_prob_success,
    signal_a_name="options_implied",
    signal_b_name="ai_assessment",
    threshold=10.0,
)
if divergence:
    context["signal_divergence"] = divergence
```

---

## 8. Deployment Checklist Per Phase

### Phase 1 Deployment

1. **Pre-deploy**:
   - [ ] Run migration `037_options_implied_context.sql` and `038_milestone_enrichment.sql` on production
   - [ ] Verify tables created: `SELECT * FROM deal_options_context LIMIT 1` (should return 0 rows, no error)
   - [ ] Verify column added: `SELECT enrichment_status FROM canonical_deal_milestones LIMIT 1`

2. **Deploy with flags OFF**:
   - [ ] Push code with `RISK_ENABLE_OPTIONS_CONTEXT=false` and `RISK_ENABLE_MILESTONE_CONTEXT=false`
   - [ ] Restart portfolio service
   - [ ] Verify morning run works identically to before (check `job_runs` result)

3. **Enable Phase 1**:
   - [ ] Set `RISK_ENABLE_OPTIONS_CONTEXT=true`
   - [ ] Restart portfolio service
   - [ ] Wait for next morning run
   - [ ] Verify: `SELECT COUNT(*) FROM deal_options_context WHERE snapshot_date = CURRENT_DATE`
   - [ ] Verify: Morning run cost is within expected bounds (< $0.30)
   - [ ] Verify: No new failures in `job_runs`

4. **Enable milestones** (can be same day or next):
   - [ ] Set `RISK_ENABLE_MILESTONE_CONTEXT=true`
   - [ ] Restart and verify

### Phase 2 Deployment

1. **Pre-deploy**:
   - [ ] Run migrations `039_prediction_registry.sql` and `040_prediction_resolution.sql`
   - [ ] Verify tables created

2. **Deploy with flag OFF**:
   - [ ] Push code with `RISK_ENABLE_PREDICTIONS=false`
   - [ ] Verify morning run unchanged

3. **Enable Phase 2**:
   - [ ] Set `RISK_ENABLE_PREDICTIONS=true`
   - [ ] Wait for morning run
   - [ ] Verify: `SELECT COUNT(*) FROM deal_predictions WHERE created_at > CURRENT_DATE`
   - [ ] Verify: AI response includes predictions array
   - [ ] Verify: Cost per deal < $0.05

### Phase 3-5 Deployment

Same pattern: migrate, deploy with flag off, verify, enable, verify.

---

## 9. Context Hash Update Plan

The context hash (`context_hash.py`) determines the reuse/delta/full routing strategy.
New context fields must be included to prevent stale reuse decisions.

### Fields to Add to `compute_context_hash`

```python
# Phase 1: Options context
options = context.get("options_context") or {}
parts.append(f"options_iv:{_bucket_price(options.get('atm_iv'))}")  # Bucketed to 1% bands
parts.append(f"options_skew:{_safe_str(options.get('put_skew'))}")

# Phase 1: Milestone status
milestones = context.get("milestones") or []
pending_types = sorted(m.get("milestone_type", "") for m in milestones if m.get("status") == "pending")
parts.append(f"milestones_pending:{','.join(pending_types)}")
```

### Fields to Add to `build_context_summary`

```python
# Phase 1
"options_atm_iv": options.get("atm_iv") if options else None,
"options_put_skew": options.get("put_skew") if options else None,
"pending_milestones": [m.get("milestone_type") for m in milestones if m.get("status") == "pending"],
```

### Fields to Add to `classify_changes`

```python
# Phase 1: Options IV change > 5% absolute triggers MODERATE
old_iv = prev_summary.get("options_atm_iv")
new_iv = current.get("options_atm_iv")
if old_iv and new_iv:
    iv_change = abs(float(new_iv) - float(old_iv))
    if iv_change > 0.05:  # 5% IV change
        changes.append(f"IV change: {old_iv:.2%} -> {new_iv:.2%}")
        _upgrade(ChangeSignificance.MODERATE)

# Phase 1: New milestone completion triggers MODERATE
old_pending = set(prev_summary.get("pending_milestones") or [])
new_pending = set(current.get("pending_milestones") or [])
completed_milestones = old_pending - new_pending
if completed_milestones:
    changes.append(f"milestones completed: {completed_milestones}")
    _upgrade(ChangeSignificance.MODERATE)
```

---

## 10. File Organization

### New Files (by phase)

```
python-service/
  app/risk/
    feature_flags.py              # Phase 1 — single source of truth for all flags
    options_context.py            # Phase 1 — collect_options_context()
    milestone_context.py          # Phase 1 — collect_milestone_context()
    prediction_registry.py        # Phase 2 — extract, store, resolve predictions
    calibration.py                # Phase 3 — compute_calibration(), build_calibration_context()
    signal_comparison.py          # Phase 5 — compute_signal_divergence()
  migrations/
    037_options_implied_context.sql
    038_milestone_enrichment.sql
    039_prediction_registry.sql
    040_prediction_resolution.sql
    041_calibration_metrics.sql
    042_human_review_queue.sql
    043_signal_weights.sql
  tests/risk/
    __init__.py
    conftest.py
    test_context_hash.py
    test_prompt_builder.py
    test_options_context.py
    test_milestone_context.py
    test_prediction_registry.py
    test_prediction_resolution.py
    test_calibration.py
    test_signal_comparison.py
    test_engine_integration.py
    golden/                       # Golden files for regression testing
      full_prompt_baseline.txt
      delta_prompt_baseline.txt
```

### Modified Files (by phase)

```
Phase 1:
  app/risk/engine.py              # Add context enrichment calls in collect_deal_context()
  app/risk/prompts.py             # Add _build_options_section, _build_milestone_section
  app/risk/context_hash.py        # Add options + milestone fields to hash/summary/classify

Phase 2:
  app/risk/engine.py              # Add prediction extraction after assess_single_deal()
  app/risk/prompts.py             # Add _build_predictions_section, update system prompt JSON schema

Phase 3:
  app/risk/prompts.py             # Add calibration context to system prompt (cached)

Phase 5:
  app/risk/engine.py              # Add signal divergence computation
  app/risk/prompts.py             # Add _build_signal_divergence_section
```
