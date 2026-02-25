# Prediction-Assessment-Score Loop: Implementation Plan

> **Date**: 2026-02-25
> **Scope**: 5-phase enhancement to the Morning Risk Assessment engine
> **Principle**: Scalable, reusable, defensive. Don't break what works.

---

## Executive Summary

Transform the morning risk assessment from **opinion generation** to a **learning machine**.
Five phases, each independently deployable, each building on existing infrastructure:

| Phase | What | Files Changed | New Tables | Token Impact | Effort |
|-------|------|---------------|------------|-------------|--------|
| 1 | Enriched Context (options + milestones + triangulation) | 3 modified | 0 | +~400 tokens/deal | Small |
| 2 | Prediction Registry | 4 modified, 1 new | 1 | +~300 tokens/deal | Medium |
| 3 | Calibration Loop | 2 modified, 1 new | 0 | +~150 tokens/deal | Small |
| 4 | Human Review Queue | 1 modified, 2 new | 2 | 0 (separate system) | Medium |
| 5 | Signal Weighting | 2 modified, 1 new | 1 | +~100 tokens/deal | Small |

**Total estimated cost increase**: ~$0.003-0.005/deal/day (~$0.06-0.10/run for 20 deals).
Currently ~$0.40/run. Adds <25% cost for dramatically richer output.

---

## What Already Exists (Leverage, Don't Rebuild)

Before building anything new, understand what's already in place:

| Capability | Table | Status | Gap |
|-----------|-------|--------|-----|
| Milestone timeline | `canonical_deal_milestones` | Schema exists | Never queried by risk engine |
| Options snapshots | `deal_options_snapshots` | Schema exists | Never fed into prompt |
| Estimate tracking | `deal_estimate_snapshots` | Populated daily | Never fed back to AI |
| Brier scoring | `estimate_accuracy_scores` | Computed on outcome | Never fed back to AI |
| Deal outcomes | `deal_outcomes` | Manual entry | No auto-resolution |
| Three-strategy router | `context_hash.py` | Working | Needs new fields in hash |
| Dual-write canonical | `canonical_risk_grades` | Working | No options-implied column |
| Prompt caching | Anthropic API | Working | System prompt is cached |

---

## Phase 1: Enriched Context + Three-Signal Triangulation

**Goal**: Feed options-implied probability and milestone timeline into the prompt.
Add three-signal comparison section. Zero new tables required.

### 1.1 Changes to `collect_deal_context()` in `engine.py`

Add two new data fetches after the existing 8 queries (lines 186-296):

```python
# 9. Options-implied probability (from deal_options_snapshots)
try:
    options_snap = await conn.fetchrow(
        """SELECT snapshot_date, atm_iv, put_call_ratio,
                  total_call_volume, total_put_volume,
                  unusual_volume, unusual_detail, has_options
           FROM deal_options_snapshots
           WHERE ticker = $1
           ORDER BY snapshot_date DESC LIMIT 1""",
        ticker,
    )
    if options_snap and options_snap["has_options"]:
        context["options_snapshot"] = dict(options_snap)
except Exception:
    pass  # Table may not exist yet

# 10. Milestone timeline (from canonical_deal_milestones)
try:
    milestones = await conn.fetch(
        """SELECT milestone_type, milestone_date, expected_date,
                  status, source, risk_factor_affected, notes
           FROM canonical_deal_milestones
           WHERE ticker = $1
           ORDER BY COALESCE(expected_date, milestone_date) ASC NULLS LAST""",
        ticker,
    )
    if milestones:
        context["milestones"] = [dict(m) for m in milestones]
except Exception:
    pass  # Table may not exist yet
```

**Defensive pattern**: Both wrapped in `try/except` (matching existing pattern for `deal_attributes` and `existing_research`). Missing data = section omitted from prompt.

### 1.2 Compute Options-Implied Probability

Add a new helper module: `app/risk/signals.py`

```python
"""Signal computation helpers for three-signal triangulation."""


def compute_options_implied_probability(
    current_price: float | None,
    deal_price: float | None,
) -> float | None:
    """Compute a simple options-implied deal completion probability.

    Formula: 1 - (spread / deal_price)
    Where spread = deal_price - current_price.

    This is a simplified model: if the market prices the stock at $24
    and the deal is at $25, the spread is $1/$25 = 4%, implying
    ~96% probability of completion.

    Returns None if inputs are missing or invalid.
    """
    if current_price is None or deal_price is None:
        return None
    if deal_price <= 0:
        return None
    spread = deal_price - current_price
    if spread < 0:
        # Trading above deal price — likely competing bid
        return 1.0
    return round(1.0 - (spread / deal_price), 4)
```

This is called in `collect_deal_context()` to enrich the context:

```python
# After building sheet_comparison (line 293):
from .signals import compute_options_implied_probability

options_implied = compute_options_implied_probability(
    float(row["current_price"]) if row and row.get("current_price") else None,
    float(row["deal_price"]) if row and row.get("deal_price") else None,
)
if options_implied is not None:
    context["options_implied_probability"] = options_implied
```

### 1.3 Build Three-Signal Comparison

Add to `signals.py`:

```python
def build_signal_comparison(
    options_implied: float | None,
    sheet_prob: float | None,
    ai_prev_prob: float | None,
) -> dict | None:
    """Build a three-signal comparison dict.

    All probabilities are on 0-1 scale.
    Returns None if fewer than 2 signals are available.
    """
    signals = {}
    if options_implied is not None:
        signals["options"] = options_implied
    if sheet_prob is not None:
        signals["sheet"] = sheet_prob
    if ai_prev_prob is not None:
        signals["ai_previous"] = ai_prev_prob

    if len(signals) < 2:
        return None

    values = list(signals.values())
    mean = sum(values) / len(values)

    divergences = []
    signal_names = list(signals.keys())
    for i, name_a in enumerate(signal_names):
        for name_b in signal_names[i + 1:]:
            diff = abs(signals[name_a] - signals[name_b])
            if diff >= 0.05:  # 5pp threshold
                higher = name_a if signals[name_a] > signals[name_b] else name_b
                lower = name_b if higher == name_a else name_a
                divergences.append({
                    "higher": higher,
                    "lower": lower,
                    "gap_pp": round(diff * 100, 1),
                })

    return {
        "signals": signals,
        "consensus": round(mean, 4),
        "divergences": divergences,
    }
```

Add to `collect_deal_context()`:

```python
from .signals import build_signal_comparison

# Three-signal comparison
sheet_prob_raw = details.get("probability_of_success") if details else None
sheet_prob_decimal = float(sheet_prob_raw) / 100 if sheet_prob_raw else None

prev_prob_raw = prev.get("our_prob_success") if prev else None
prev_prob_decimal = float(prev_prob_raw) / 100 if prev_prob_raw else None

comparison = build_signal_comparison(
    options_implied,
    sheet_prob_decimal,
    prev_prob_decimal,
)
if comparison:
    context["signal_comparison"] = comparison
```

### 1.4 Prompt Additions to `prompts.py`

#### System prompt addition (append before "Be precise and concise" line 184):

```python
# Add to RISK_ASSESSMENT_SYSTEM_PROMPT, before the closing instruction:

SIGNAL_TRIANGULATION_INSTRUCTION = """
## Three-Signal Triangulation

When a SIGNAL COMPARISON section is provided, you MUST:
1. Note where the three signals agree (high confidence zone)
2. For each divergence >5pp, either:
   a. Justify YOUR estimate with specific evidence if you disagree with the market/sheet, OR
   b. Update your estimate toward the consensus if you lack contrary evidence
3. Never ignore the options-implied signal — it represents real money at risk
"""
```

#### User prompt additions in `build_deal_assessment_prompt()`:

Add two new sections after Section 10 (Live Market Data, line 387):

```python
# Section 11: Options-Implied Probability
options_snap = context.get("options_snapshot")
options_prob = context.get("options_implied_probability")
if options_prob is not None:
    sections.append("## Options-Implied Probability")
    sections.append(f"Deal Completion Probability (from spread): {options_prob:.1%}")
    if options_snap:
        sections.append(f"ATM Implied Vol: {options_snap.get('atm_iv', 'N/A')}")
        pcr = options_snap.get('put_call_ratio')
        if pcr:
            sections.append(f"Put/Call Ratio: {pcr}")
        if options_snap.get('unusual_volume'):
            sections.append(f"UNUSUAL VOLUME: {options_snap.get('unusual_detail', 'detected')}")
    sections.append("")

# Section 12: Milestone Timeline
milestones = context.get("milestones", [])
if milestones:
    sections.append("## Deal Milestone Timeline")
    for m in milestones:
        ms_type = str(m.get("milestone_type", "")).replace("_", " ").title()
        status = m.get("status", "pending")
        date_str = str(m.get("milestone_date") or m.get("expected_date") or "TBD")
        risk = m.get("risk_factor_affected", "")
        status_icon = {"completed": "DONE", "failed": "FAILED", "pending": "PENDING",
                       "extended": "EXTENDED", "waived": "WAIVED"}.get(status, status)
        line = f"- [{status_icon}] {ms_type}: {date_str}"
        if risk:
            line += f" (affects: {risk})"
        sections.append(line)
    sections.append("")

# Section 13: Three-Signal Comparison
sig_comp = context.get("signal_comparison")
if sig_comp:
    sections.append("## THREE-SIGNAL COMPARISON")
    sigs = sig_comp["signals"]
    if "options" in sigs:
        sections.append(f"Options market: {sigs['options']:.0%} success")
    if "sheet" in sigs:
        sections.append(f"Sheet analyst:  {sigs['sheet']:.0%} success")
    if "ai_previous" in sigs:
        sections.append(f"Your last AI:   {sigs['ai_previous']:.0%} success")
    divs = sig_comp.get("divergences", [])
    if divs:
        sections.append("Divergences:")
        for d in divs:
            sections.append(
                f"  {d['higher']} is {d['gap_pp']}pp more optimistic than {d['lower']}"
                " — explain why or update your estimate."
            )
    sections.append("")
```

#### Delta prompt additions in `build_delta_assessment_prompt()`:

Add the same three sections (options, milestones, signal comparison) with abbreviated format.
Only include if data changed or divergences exist:

```python
# After the "## GOOGLE SHEET GRADES (for comparison)" section (line 556):

# Include signal comparison if divergences exist
sig_comp = context.get("signal_comparison")
if sig_comp and sig_comp.get("divergences"):
    sections.append("## SIGNAL DIVERGENCES (address in your update)")
    for d in sig_comp["divergences"]:
        sections.append(
            f"- {d['higher']} is {d['gap_pp']}pp more optimistic than {d['lower']}"
        )
    sections.append("")
```

### 1.5 Context Hash Updates (`context_hash.py`)

Add options-implied probability to the hash so changes trigger re-assessment:

```python
# In compute_context_hash(), after the deal attributes section (line 100):

# Options-implied probability (bucketed to 2pp to avoid noise)
options_prob = context.get("options_implied_probability")
if options_prob is not None:
    bucketed = round(options_prob * 50) / 50  # 2pp buckets
    parts.append(f"options_prob:{bucketed:.2f}")

# Milestone count and statuses
milestones = context.get("milestones") or []
parts.append(f"milestone_count:{len(milestones)}")
pending = sum(1 for m in milestones if m.get("status") == "pending")
completed = sum(1 for m in milestones if m.get("status") == "completed")
parts.append(f"milestones_pending:{pending}")
parts.append(f"milestones_completed:{completed}")
```

Add milestone changes to `classify_changes()`:

```python
# In classify_changes(), add after expected_close_date check (line 199):

# Check milestone status changes
old_milestones_pending = prev_summary.get("milestones_pending", 0) or 0
new_milestones_pending = current.get("milestones_pending", 0) or 0
old_milestones_completed = prev_summary.get("milestones_completed", 0) or 0
new_milestones_completed = current.get("milestones_completed", 0) or 0

if new_milestones_completed > old_milestones_completed:
    changes.append(f"milestone completed: {old_milestones_completed} -> {new_milestones_completed}")
    _upgrade(ChangeSignificance.MODERATE)

# Check options-implied probability shift (>5pp)
old_options = _safe_float(prev_summary.get("options_prob"))
new_options = _safe_float(current.get("options_prob"))
if old_options is not None and new_options is not None:
    options_shift = abs(new_options - old_options)
    if options_shift >= 0.05:
        changes.append(f"options-implied probability shift: {old_options:.0%} -> {new_options:.0%}")
        _upgrade(ChangeSignificance.MODERATE)
```

Update `build_context_summary()` to include new fields:

```python
# Add to the return dict in build_context_summary():
"options_prob": context.get("options_implied_probability"),
"milestones_pending": sum(1 for m in (context.get("milestones") or [])
                          if m.get("status") == "pending"),
"milestones_completed": sum(1 for m in (context.get("milestones") or [])
                             if m.get("status") == "completed"),
```

### 1.6 Feature Flag

```python
# In engine.py, at module level:
import os
ENABLE_ENRICHED_CONTEXT = os.environ.get("RISK_ENRICHED_CONTEXT", "true").lower() == "true"
```

Guard all new queries and prompt sections:

```python
if ENABLE_ENRICHED_CONTEXT:
    # ... options/milestone queries ...
    # ... signal comparison computation ...
```

### 1.7 Token Cost Estimate

| Section | Estimated Tokens | When Included |
|---------|-----------------|---------------|
| Options-Implied Probability | ~50 | Has options data |
| Milestone Timeline | ~100-200 | Has milestones (varies by deal) |
| Three-Signal Comparison | ~80-120 | 2+ signals available |
| System prompt addition | ~80 | Always (cached after first call) |
| **Total per deal** | **~250-400** | |

At $3/M input tokens (Sonnet): ~$0.001/deal additional. Negligible.

### 1.8 Test Strategy

1. **Unit tests** (`tests/risk/test_signals.py`):
   - `test_compute_options_implied_probability()` — normal, edge cases (price > deal, zero deal price)
   - `test_build_signal_comparison()` — 2 signals, 3 signals, divergence detection, <2 signals returns None

2. **Integration test** (`tests/risk/test_prompts_enriched.py`):
   - Mock context with options + milestones → verify prompt contains new sections
   - Mock context without options → verify prompt omits section gracefully
   - Verify context hash changes when options probability shifts >5pp

3. **Regression test**: Run existing assessment on one deal with and without enriched context.
   Compare grades to ensure they don't diverge wildly.

---

## Phase 2: Prediction Registry

**Goal**: Store explicit, scoreable predictions alongside assessments.
Enhanced prompt outputs predictions; scoring resolves them automatically.

### 2.1 New Migration: `037_deal_predictions.sql`

```sql
-- 037_deal_predictions.sql
-- Prediction registry: explicit, scoreable predictions from AI assessments.

DO $$ BEGIN
    CREATE TYPE prediction_type AS ENUM (
        'deal_closes',           -- P(deal closes) by outside_date
        'milestone_completion',  -- P(specific milestone) by expected_date
        'spread_direction',      -- will spread narrow/widen in N days
        'break_price',           -- if deal breaks, target price
        'next_event'             -- what happens next (categorical)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE prediction_status AS ENUM (
        'open',       -- not yet resolvable
        'resolved',   -- outcome known, scored
        'expired',    -- by_date passed without clear resolution
        'superseded'  -- replaced by a newer prediction of same type
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS deal_predictions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticker              VARCHAR(10) NOT NULL,
    assessment_date     DATE NOT NULL,
    assessment_id       UUID,          -- FK to deal_risk_assessments

    -- The prediction
    prediction_type     prediction_type NOT NULL,
    claim               TEXT NOT NULL,  -- human-readable falsifiable statement
    by_date             DATE,           -- when this should resolve
    probability         NUMERIC(5,4),   -- 0.0000 to 1.0000
    confidence          NUMERIC(4,3),   -- AI's confidence in its own estimate

    -- Evidence
    evidence            JSONB,          -- [{source, date, detail, source_id}]

    -- Resolution
    status              prediction_status NOT NULL DEFAULT 'open',
    resolved_at         TIMESTAMPTZ,
    actual_outcome      BOOLEAN,        -- true = claim was correct
    actual_value        NUMERIC(12,4),  -- for numeric predictions (break_price)
    resolution_source   VARCHAR(50),    -- deal_outcome, milestone_status, manual, expired
    resolution_detail   TEXT,

    -- Scoring
    brier_score         NUMERIC(8,6),   -- (probability - actual)^2
    calibration_bucket  VARCHAR(10),    -- "90-100", "80-90", etc. for aggregation

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_pred_ticker_date
    ON deal_predictions (ticker, assessment_date DESC);
CREATE INDEX IF NOT EXISTS idx_pred_open
    ON deal_predictions (ticker, prediction_type) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_pred_calibration
    ON deal_predictions (calibration_bucket, status) WHERE status = 'resolved';
CREATE INDEX IF NOT EXISTS idx_pred_assessment
    ON deal_predictions (assessment_id);
```

### 2.2 JSON Schema Addition to System Prompt

Add to `RISK_ASSESSMENT_SYSTEM_PROMPT` after the `assessment_changes` field (line 181):

```
- **Predictions**: Make 2-5 explicit, falsifiable predictions about this deal.
  Each prediction is a structured object:
  - "type": one of "deal_closes", "milestone_completion", "spread_direction", "break_price"
  - "claim": a clear, falsifiable statement (e.g., "HSR clearance will be received")
  - "by_date": YYYY-MM-DD when the prediction should resolve
  - "probability": your probability estimate (0.00-1.00)
  - "confidence": how confident you are in THIS estimate (0.0-1.0)
  - "evidence": list of 1-3 evidence items from the context (same format as disagreement evidence)

  You MUST include at least one "deal_closes" prediction for every deal.
  Update or supersede previous predictions when new evidence changes your view.
```

Add to the JSON schema example:

```json
"predictions": [
    {
        "type": "deal_closes",
        "claim": "Deal will close at $25.50 per share",
        "by_date": "2026-06-30",
        "probability": 0.92,
        "confidence": 0.80,
        "evidence": [
            {"source": "HSR filing", "date": "2026-01-15", "detail": "No second request after 30 days"}
        ]
    },
    {
        "type": "milestone_completion",
        "claim": "Shareholder vote will pass",
        "by_date": "2026-04-15",
        "probability": 0.95,
        "confidence": 0.85,
        "evidence": [
            {"source": "DEFM14A filing", "date": "2026-02-10", "detail": "Board unanimously recommends"}
        ]
    }
]
```

### 2.3 Previous Predictions Context

Add to `collect_deal_context()`:

```python
# 11. Open predictions for this deal
try:
    open_preds = await conn.fetch(
        """SELECT prediction_type, claim, by_date, probability,
                  confidence, status, assessment_date
           FROM deal_predictions
           WHERE ticker = $1 AND status = 'open'
           ORDER BY assessment_date DESC""",
        ticker,
    )
    if open_preds:
        context["open_predictions"] = [dict(p) for p in open_preds]
except Exception:
    pass
```

Add corresponding prompt section in `build_deal_assessment_prompt()`:

```python
# Section 14: Open Predictions
open_preds = context.get("open_predictions", [])
if open_preds:
    sections.append("## YOUR OPEN PREDICTIONS (update or supersede if evidence changed)")
    for p in open_preds:
        sections.append(
            f"- [{p.get('prediction_type')}] {p.get('claim')} "
            f"(P={p.get('probability')}, by {p.get('by_date')}, "
            f"made {p.get('assessment_date')})"
        )
    sections.append("")
```

### 2.4 Prediction Parsing and Storage

New module: `app/risk/predictions.py`

```python
"""Prediction registry: parse, store, resolve, and score deal predictions."""

import logging
import uuid
from datetime import date, datetime

logger = logging.getLogger(__name__)

CALIBRATION_BUCKETS = [
    (0.9, 1.0, "90-100"),
    (0.8, 0.9, "80-90"),
    (0.7, 0.8, "70-80"),
    (0.6, 0.7, "60-70"),
    (0.5, 0.6, "50-60"),
    (0.0, 0.5, "0-50"),
]


def _get_calibration_bucket(prob: float) -> str:
    """Map a probability to its calibration bucket."""
    for low, high, label in CALIBRATION_BUCKETS:
        if low <= prob < high:
            return label
    return "90-100" if prob >= 1.0 else "0-50"


async def store_predictions(
    pool, ticker: str, assessment_date: date,
    assessment_id: uuid.UUID, predictions: list[dict],
):
    """Parse and store predictions from an AI assessment response.

    Supersedes open predictions of the same type for the same ticker.
    """
    if not predictions:
        return 0

    stored = 0
    async with pool.acquire() as conn:
        for pred in predictions:
            pred_type = pred.get("type")
            if pred_type not in (
                "deal_closes", "milestone_completion",
                "spread_direction", "break_price", "next_event",
            ):
                logger.warning("Unknown prediction type: %s", pred_type)
                continue

            probability = pred.get("probability")
            if probability is None:
                continue

            # Supersede previous open predictions of same type
            await conn.execute(
                """UPDATE deal_predictions
                   SET status = 'superseded', updated_at = NOW()
                   WHERE ticker = $1 AND prediction_type = $2
                     AND status = 'open'""",
                ticker, pred_type,
            )

            bucket = _get_calibration_bucket(float(probability))

            await conn.execute(
                """INSERT INTO deal_predictions
                   (ticker, assessment_date, assessment_id,
                    prediction_type, claim, by_date, probability,
                    confidence, evidence, calibration_bucket)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)""",
                ticker, assessment_date, assessment_id,
                pred_type, pred.get("claim", ""),
                pred.get("by_date"),  # may need date parsing
                float(probability),
                float(pred["confidence"]) if pred.get("confidence") else None,
                __import__("json").dumps(pred.get("evidence", [])),
                bucket,
            )
            stored += 1

    logger.info("Stored %d predictions for %s", stored, ticker)
    return stored


async def resolve_from_outcome(pool, ticker: str):
    """Auto-resolve deal_closes predictions when an outcome is recorded."""
    async with pool.acquire() as conn:
        outcome = await conn.fetchrow(
            "SELECT * FROM deal_outcomes WHERE ticker = $1", ticker
        )
        if not outcome:
            return

        deal_closed = outcome["outcome"] in ("closed_at_deal", "closed_higher")

        # Resolve all open deal_closes predictions
        open_preds = await conn.fetch(
            """SELECT id, probability FROM deal_predictions
               WHERE ticker = $1 AND prediction_type = 'deal_closes'
                 AND status = 'open'""",
            ticker,
        )
        for pred in open_preds:
            actual = 1.0 if deal_closed else 0.0
            brier = (float(pred["probability"]) - actual) ** 2
            await conn.execute(
                """UPDATE deal_predictions
                   SET status = 'resolved', resolved_at = NOW(),
                       actual_outcome = $2, brier_score = $3,
                       resolution_source = 'deal_outcome',
                       resolution_detail = $4, updated_at = NOW()
                   WHERE id = $1""",
                pred["id"], deal_closed, brier, outcome["outcome"],
            )

        # Resolve break_price predictions if deal broke
        if not deal_closed and outcome["outcome_price"]:
            break_preds = await conn.fetch(
                """SELECT id, probability FROM deal_predictions
                   WHERE ticker = $1 AND prediction_type = 'break_price'
                     AND status = 'open'""",
                ticker,
            )
            for pred in break_preds:
                await conn.execute(
                    """UPDATE deal_predictions
                       SET status = 'resolved', resolved_at = NOW(),
                           actual_value = $2,
                           resolution_source = 'deal_outcome',
                           updated_at = NOW()
                       WHERE id = $1""",
                    pred["id"], float(outcome["outcome_price"]),
                )


async def resolve_from_milestones(pool, ticker: str):
    """Auto-resolve milestone_completion predictions from milestone status changes."""
    async with pool.acquire() as conn:
        # Get completed/failed milestones
        resolved_milestones = await conn.fetch(
            """SELECT milestone_type, status, milestone_date
               FROM canonical_deal_milestones
               WHERE ticker = $1 AND status IN ('completed', 'failed')""",
            ticker,
        )

        for ms in resolved_milestones:
            ms_type = ms["milestone_type"].replace("_", " ")
            completed = ms["status"] == "completed"

            # Find matching open predictions
            matching = await conn.fetch(
                """SELECT id, probability, claim FROM deal_predictions
                   WHERE ticker = $1 AND prediction_type = 'milestone_completion'
                     AND status = 'open'
                     AND LOWER(claim) LIKE $2""",
                ticker, f"%{ms_type}%",
            )
            for pred in matching:
                actual = 1.0 if completed else 0.0
                brier = (float(pred["probability"]) - actual) ** 2
                await conn.execute(
                    """UPDATE deal_predictions
                       SET status = 'resolved', resolved_at = NOW(),
                           actual_outcome = $2, brier_score = $3,
                           resolution_source = 'milestone_status',
                           resolution_detail = $4, updated_at = NOW()
                       WHERE id = $1""",
                    pred["id"], completed, brier,
                    f"{ms['milestone_type']} {ms['status']}",
                )


async def expire_overdue_predictions(pool):
    """Mark predictions past their by_date as expired."""
    async with pool.acquire() as conn:
        result = await conn.execute(
            """UPDATE deal_predictions
               SET status = 'expired', updated_at = NOW()
               WHERE status = 'open' AND by_date < CURRENT_DATE""",
        )
    logger.info("Expired overdue predictions: %s", result)
```

### 2.5 Integration with Engine

In `run_morning_assessment()`, after `_store_assessment()` (line 603):

```python
# Store predictions from AI response
if ENABLE_PREDICTIONS:
    try:
        from .predictions import store_predictions
        raw_predictions = assessment.get("predictions", [])
        if raw_predictions:
            await store_predictions(
                self.pool, ticker, run_date,
                assessment_id, raw_predictions,
            )
    except Exception as e:
        logger.warning("Failed to store predictions for %s: %s", ticker, e)
```

In `record_outcome()` (estimate_tracker.py), after scoring:

```python
# Auto-resolve predictions
from .predictions import resolve_from_outcome
await resolve_from_outcome(pool, ticker)
```

### 2.6 Feature Flag

```python
ENABLE_PREDICTIONS = os.environ.get("RISK_PREDICTIONS", "false").lower() == "true"
```

Default OFF until Phase 1 is stable. Predictions only stored when flag is on.
Prompt additions gated behind same flag.

---

## Phase 3: Calibration Loop

**Goal**: Compute how well-calibrated the AI's probability estimates are,
and feed this back into the prompt so it can self-correct.

### 3.1 New Module: `app/risk/calibration.py`

```python
"""Calibration computation and feedback generation."""

import logging

logger = logging.getLogger(__name__)


async def compute_calibration_summary(pool) -> dict:
    """Compute calibration statistics from resolved predictions.

    Returns a dict of calibration data by bucket and by risk factor.
    Requires at least 5 resolved predictions to be meaningful.
    """
    async with pool.acquire() as conn:
        # Overall calibration by probability bucket
        buckets = await conn.fetch("""
            SELECT calibration_bucket,
                   COUNT(*) as n,
                   AVG(probability) as avg_predicted,
                   AVG(CASE WHEN actual_outcome THEN 1.0 ELSE 0.0 END) as avg_actual,
                   AVG(brier_score) as avg_brier
            FROM deal_predictions
            WHERE status = 'resolved' AND brier_score IS NOT NULL
            GROUP BY calibration_bucket
            HAVING COUNT(*) >= 3
            ORDER BY calibration_bucket DESC
        """)

        # Per risk-factor calibration (from deal_closes + milestone predictions)
        by_factor = await conn.fetch("""
            SELECT
                CASE
                    WHEN LOWER(claim) LIKE '%regulatory%' OR LOWER(claim) LIKE '%hsr%'
                         OR LOWER(claim) LIKE '%antitrust%' THEN 'regulatory'
                    WHEN LOWER(claim) LIKE '%vote%' OR LOWER(claim) LIKE '%shareholder%' THEN 'vote'
                    WHEN LOWER(claim) LIKE '%financing%' OR LOWER(claim) LIKE '%debt%' THEN 'financing'
                    WHEN LOWER(claim) LIKE '%legal%' OR LOWER(claim) LIKE '%lawsuit%' THEN 'legal'
                    ELSE 'general'
                END as factor,
                COUNT(*) as n,
                AVG(probability) as avg_predicted,
                AVG(CASE WHEN actual_outcome THEN 1.0 ELSE 0.0 END) as avg_actual,
                AVG(brier_score) as avg_brier
            FROM deal_predictions
            WHERE status = 'resolved' AND brier_score IS NOT NULL
              AND prediction_type IN ('deal_closes', 'milestone_completion')
            GROUP BY factor
            HAVING COUNT(*) >= 3
        """)

    total_resolved = sum(b["n"] for b in buckets)
    if total_resolved < 5:
        return {"available": False, "reason": f"Only {total_resolved} resolved predictions"}

    return {
        "available": True,
        "total_resolved": total_resolved,
        "by_bucket": [dict(b) for b in buckets],
        "by_factor": [dict(f) for f in by_factor],
    }


def format_calibration_for_prompt(cal: dict) -> str | None:
    """Format calibration data as a concise prompt section.

    Returns None if calibration data is not yet available.
    """
    if not cal.get("available"):
        return None

    lines = ["## YOUR CALIBRATION HISTORY"]
    lines.append(f"Based on {cal['total_resolved']} resolved predictions:")

    for bucket in cal.get("by_bucket", []):
        predicted = float(bucket["avg_predicted"]) * 100
        actual = float(bucket["avg_actual"]) * 100
        n = bucket["n"]
        diff = actual - predicted

        if abs(diff) < 3:
            assessment = "well calibrated"
        elif diff > 0:
            assessment = f"underconfident by ~{abs(diff):.0f}pp"
        else:
            assessment = f"overconfident by ~{abs(diff):.0f}pp"

        lines.append(
            f"  When you said {bucket['calibration_bucket']}% → "
            f"actual: {actual:.0f}% ({assessment}, n={n})"
        )

    # Add factor-specific insights if available
    factor_insights = []
    for f in cal.get("by_factor", []):
        predicted = float(f["avg_predicted"]) * 100
        actual = float(f["avg_actual"]) * 100
        if abs(actual - predicted) >= 5:
            direction = "overconfident" if predicted > actual else "underconfident"
            factor_insights.append(
                f"  {f['factor'].title()}: {direction} by ~{abs(actual - predicted):.0f}pp (n={f['n']})"
            )

    if factor_insights:
        lines.append("Per-factor bias:")
        lines.extend(factor_insights)

    lines.append("")
    return "\n".join(lines)
```

### 3.2 Integration with Prompt Building

In `build_deal_assessment_prompt()`, add after the signal comparison section:

```python
# Section 15: Calibration Feedback (Phase 3)
calibration_text = context.get("calibration_text")
if calibration_text:
    sections.append(calibration_text)
```

In `collect_deal_context()`, add (once per run, cached):

```python
if ENABLE_CALIBRATION:
    from .calibration import compute_calibration_summary, format_calibration_for_prompt
    # Cache calibration for the entire run (same for all deals)
    if not hasattr(self, '_calibration_cache'):
        cal = await compute_calibration_summary(self.pool)
        self._calibration_cache = format_calibration_for_prompt(cal)
    if self._calibration_cache:
        context["calibration_text"] = self._calibration_cache
```

### 3.3 Feature Flag

```python
ENABLE_CALIBRATION = os.environ.get("RISK_CALIBRATION", "false").lower() == "true"
```

Only meaningful after Phase 2 has generated enough resolved predictions.

---

## Phase 4: Human Review Queue

**Goal**: Surface the highest-information-value cases for human review.
Capture human corrections and feed them back.

### 4.1 New Migration: `038_human_review.sql`

```sql
-- 038_human_review.sql
-- Human review queue and annotation tables.

DO $$ BEGIN
    CREATE TYPE review_priority AS ENUM (
        'critical',   -- 3-way disagreement >10pp
        'high',       -- AI changed >10pp or prediction scored poorly
        'medium',     -- new milestone event
        'low'         -- routine review
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE review_trigger AS ENUM (
        'signal_divergence',     -- options vs sheet vs AI diverge
        'probability_shift',     -- AI probability moved >10pp
        'poor_prediction',       -- previous prediction scored badly
        'milestone_event',       -- new milestone completed/failed
        'grade_change',          -- AI grade changed
        'manual'                 -- human requested review
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS human_review_queue (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticker              VARCHAR(10) NOT NULL,
    assessment_date     DATE NOT NULL,
    assessment_id       UUID,

    -- Priority and trigger
    priority            review_priority NOT NULL DEFAULT 'medium',
    trigger_type        review_trigger NOT NULL,
    trigger_detail      TEXT,

    -- Signals at time of queue entry
    options_implied     NUMERIC(5,4),
    sheet_prob          NUMERIC(5,4),
    ai_prob             NUMERIC(5,4),
    max_divergence_pp   NUMERIC(5,1),

    -- Review status
    status              VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- pending, reviewed, dismissed
    reviewed_by         VARCHAR(100),
    reviewed_at         TIMESTAMPTZ,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_review_queue UNIQUE (ticker, assessment_date, trigger_type)
);

CREATE INDEX IF NOT EXISTS idx_review_pending
    ON human_review_queue (priority, created_at) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS human_annotations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id           UUID NOT NULL REFERENCES human_review_queue(id),
    ticker              VARCHAR(10) NOT NULL,

    -- Which signal was right?
    signal_winner       VARCHAR(20),  -- options, sheet, ai, none

    -- Grade corrections
    grade_corrections   JSONB,
    -- [{"factor": "regulatory", "correct_grade": "High", "reasoning": "..."}]

    -- Probability corrections
    corrected_probability  NUMERIC(5,4),
    correction_reasoning   TEXT,

    -- Freeform notes
    notes               TEXT,

    annotated_by        VARCHAR(100),
    annotated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_annotations_ticker
    ON human_annotations (ticker, annotated_at DESC);
```

### 4.2 Review Queue Population

New module: `app/risk/review_queue.py`

Populate the queue after each morning assessment run. Four triggers:

1. **Signal divergence**: max(options, sheet, AI) - min(options, sheet, AI) > 10pp → critical
2. **AI probability shift**: |today_prob - yesterday_prob| > 10pp → high
3. **Poor prediction**: any resolved prediction with brier_score > 0.25 → high
4. **New milestone event**: milestone status changed since yesterday → medium

```python
async def populate_review_queue(pool, run_date, assessments):
    """After a morning run, populate the review queue with high-value review items."""
    for assessment in assessments:
        ticker = assessment["ticker"]
        triggers = []

        # 1. Signal divergence
        sig_comp = assessment.get("_signal_comparison")
        if sig_comp:
            max_div = max((d["gap_pp"] for d in sig_comp.get("divergences", [])), default=0)
            if max_div >= 10:
                triggers.append(("signal_divergence", f"{max_div}pp max divergence", "critical"))
            elif max_div >= 5:
                triggers.append(("signal_divergence", f"{max_div}pp max divergence", "medium"))

        # 2. Probability shift
        prev_prob = assessment.get("_prev_prob")
        curr_prob = assessment.get("_curr_prob")
        if prev_prob is not None and curr_prob is not None:
            shift = abs(curr_prob - prev_prob)
            if shift >= 0.10:
                triggers.append(("probability_shift", f"{shift:.0%} shift", "high"))

        # 3. Grade change
        changes = assessment.get("_changes", [])
        if any(c.get("direction") == "worsened" for c in changes):
            triggers.append(("grade_change", "Grade worsened", "medium"))

        # Store triggers
        for trigger_type, detail, priority in triggers:
            await _insert_review_item(pool, ticker, run_date, trigger_type, detail, priority)
```

### 4.3 Corrections Feedback

Human corrections are fed into the next morning's context:

```python
# In collect_deal_context(), add:
recent_corrections = await conn.fetch(
    """SELECT ha.signal_winner, ha.grade_corrections,
              ha.corrected_probability, ha.correction_reasoning, ha.notes,
              ha.annotated_at
       FROM human_annotations ha
       JOIN human_review_queue hrq ON ha.review_id = hrq.id
       WHERE ha.ticker = $1 AND ha.annotated_at > NOW() - INTERVAL '7 days'
       ORDER BY ha.annotated_at DESC LIMIT 3""",
    ticker,
)
if recent_corrections:
    context["human_corrections"] = [dict(c) for c in recent_corrections]
```

Prompt section:

```python
corrections = context.get("human_corrections", [])
if corrections:
    sections.append("## RECENT HUMAN CORRECTIONS")
    for c in corrections:
        if c.get("correction_reasoning"):
            sections.append(f"- {c['annotated_at']}: {c['correction_reasoning']}")
        if c.get("signal_winner"):
            sections.append(f"  Signal that was right: {c['signal_winner']}")
    sections.append("")
```

### 4.4 API Endpoints

Add to existing risk routes (or new `app/api/review_routes.py`):

```python
# GET /risk/review-queue?status=pending&priority=critical,high
# GET /risk/review-queue/{id}
# POST /risk/review-queue/{id}/annotate  (body: annotation JSON)
# POST /risk/review-queue/{id}/dismiss
# GET /risk/review-queue/stats  (counts by priority and status)
```

---

## Phase 5: Signal Weighting

**Goal**: Learn which signal (options, sheet, AI) is most predictive for each risk factor.
Feed these weights back into the prompt.

### 5.1 New Migration: `039_signal_weights.sql`

```sql
-- 039_signal_weights.sql
-- Signal accuracy tracking and dynamic ensemble weights.

CREATE TABLE IF NOT EXISTS signal_accuracy (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Aggregation period
    period_start        DATE NOT NULL,
    period_end          DATE NOT NULL,
    n_deals             INTEGER NOT NULL,

    -- Overall signal accuracy (Brier scores, lower = better)
    options_brier       NUMERIC(8,6),
    sheet_brier         NUMERIC(8,6),
    ai_brier            NUMERIC(8,6),

    -- Per-factor accuracy (JSONB for flexibility)
    -- {"regulatory": {"options": 0.05, "sheet": 0.12, "ai": 0.08}, ...}
    factor_accuracy     JSONB,

    -- Derived weights (normalized to sum to 1.0)
    options_weight      NUMERIC(5,4),
    sheet_weight        NUMERIC(5,4),
    ai_weight           NUMERIC(5,4),

    -- Per-factor weights
    factor_weights      JSONB,
    -- {"regulatory": {"options": 0.5, "sheet": 0.2, "ai": 0.3}, ...}

    CONSTRAINT uq_signal_accuracy UNIQUE (period_start, period_end)
);
```

### 5.2 Weight Computation

New module: `app/risk/signal_weights.py`

```python
async def compute_signal_weights(pool) -> dict:
    """Compute optimal signal weights from historical accuracy.

    Uses inverse Brier score as a simple weight:
    weight_i = (1/brier_i) / sum(1/brier_j for all j)

    Returns None if insufficient data (<10 resolved outcomes).
    """
    async with pool.acquire() as conn:
        # Get all deals with outcomes + estimate histories
        scores = await conn.fetch("""
            SELECT ticker,
                   sheet_prob_success_brier, ai_prob_success_brier,
                   prob_success_winner
            FROM estimate_accuracy_scores
            WHERE sheet_prob_success_brier IS NOT NULL
              AND ai_prob_success_brier IS NOT NULL
        """)

    if len(scores) < 10:
        return None

    # Simple inverse-Brier weighting
    sheet_brier = sum(float(s["sheet_prob_success_brier"]) for s in scores) / len(scores)
    ai_brier = sum(float(s["ai_prob_success_brier"]) for s in scores) / len(scores)

    # Options Brier would come from comparing options-implied vs actual outcomes
    # For now, use spread-based heuristic
    options_brier = (sheet_brier + ai_brier) / 2  # Placeholder until we have enough data

    # Inverse Brier weights (avoid division by zero)
    inv = [1 / max(b, 0.001) for b in [options_brier, sheet_brier, ai_brier]]
    total = sum(inv)
    weights = [w / total for w in inv]

    return {
        "options_weight": round(weights[0], 4),
        "sheet_weight": round(weights[1], 4),
        "ai_weight": round(weights[2], 4),
        "options_brier": round(options_brier, 6),
        "sheet_brier": round(sheet_brier, 6),
        "ai_brier": round(ai_brier, 6),
        "n_deals": len(scores),
    }
```

### 5.3 Prompt Addition

When weights are available:

```python
## SIGNAL TRACK RECORD
Based on {n} completed deals:
  Options market: Brier {options_brier:.3f} (weight: {options_weight:.0%})
  Sheet analyst:  Brier {sheet_brier:.3f} (weight: {sheet_weight:.0%})
  Your AI:        Brier {ai_brier:.3f} (weight: {ai_weight:.0%})

  Weight your confidence accordingly. A signal with better historical
  accuracy deserves more weight when signals disagree.
```

---

## Cross-Cutting Concerns

### Migration Sequence

| Order | File | Phase | Depends On |
|-------|------|-------|------------|
| 1 | (no migration) | Phase 1 | Existing tables |
| 2 | `037_deal_predictions.sql` | Phase 2 | Phase 1 deployed |
| 3 | (no migration) | Phase 3 | `deal_predictions` table |
| 4 | `038_human_review.sql` | Phase 4 | Phase 1+2 deployed |
| 5 | `039_signal_weights.sql` | Phase 5 | Phase 3+4 deployed |

All migrations are:
- **Additive** (new tables only, no ALTER on existing)
- **Idempotent** (`CREATE TABLE IF NOT EXISTS`, `DO $$ BEGIN ... EXCEPTION WHEN`)
- **Reversible** (`DROP TABLE IF EXISTS` for rollback)

### Feature Flags

```python
# All in engine.py or a shared config
ENABLE_ENRICHED_CONTEXT = os.environ.get("RISK_ENRICHED_CONTEXT", "true").lower() == "true"
ENABLE_PREDICTIONS = os.environ.get("RISK_PREDICTIONS", "false").lower() == "true"
ENABLE_CALIBRATION = os.environ.get("RISK_CALIBRATION", "false").lower() == "true"
ENABLE_REVIEW_QUEUE = os.environ.get("RISK_REVIEW_QUEUE", "false").lower() == "true"
ENABLE_SIGNAL_WEIGHTS = os.environ.get("RISK_SIGNAL_WEIGHTS", "false").lower() == "true"
```

Deployment sequence:
1. Deploy Phase 1 with `RISK_ENRICHED_CONTEXT=true` (default on)
2. After 1 week, enable `RISK_PREDICTIONS=true`
3. After 20+ resolved predictions, enable `RISK_CALIBRATION=true`
4. After Phase 2 stable, enable `RISK_REVIEW_QUEUE=true`
5. After 10+ deal outcomes, enable `RISK_SIGNAL_WEIGHTS=true`

### Error Handling Pattern

Every new feature follows the existing defensive pattern:

```python
# ALWAYS: try/except with logger.warning, never crash the pipeline
try:
    # New feature code
except Exception as e:
    logger.warning("Feature X failed for %s (non-critical): %s", ticker, e)
    # Continue with assessment — feature is enrichment, not required
```

### Token Cost Budget

| Phase | Additional Tokens/Deal | Annual Cost (20 deals, daily) |
|-------|----------------------|------------------------------|
| Phase 1 | ~400 | ~$30 |
| Phase 2 | ~300 | ~$22 |
| Phase 3 | ~150 | ~$11 |
| Phase 4 | ~50 | ~$4 |
| Phase 5 | ~100 | ~$7 |
| **Total** | **~1000** | **~$74/year** |

Current cost: ~$0.40/run × 365 = ~$146/year. Total increase: ~50%.
**The enriched output is worth 10x the cost.**

### Reusable Patterns

#### Context Enrichment Pattern
Each new data source follows the same pattern in `collect_deal_context()`:
1. Query within `async with self.pool.acquire()` block
2. Wrap in `try/except` (table may not exist)
3. Store as `context["key_name"] = [dict(r) for r in rows]`
4. Corresponding prompt section in `build_deal_assessment_prompt()` checks `context.get("key_name")`
5. Hash-relevant fields added to `compute_context_hash()`
6. Gated behind feature flag

#### Prompt Section Pattern
Each new section in the user prompt follows:
```python
data = context.get("section_key")
if data:
    sections.append("## SECTION TITLE")
    # ... format data concisely ...
    sections.append("")
```

#### Prediction Lifecycle Pattern
```
AI generates → store_predictions() → open
Evidence changes → AI supersedes → superseded
Milestone completes → resolve_from_milestones() → resolved + scored
Deal outcome → resolve_from_outcome() → resolved + scored
by_date passes → expire_overdue_predictions() → expired
```

### File Change Summary

| File | Phase | Change Type |
|------|-------|-------------|
| `app/risk/engine.py` | 1,2,3 | Modified (context collection, storage) |
| `app/risk/prompts.py` | 1,2,3,4,5 | Modified (new prompt sections) |
| `app/risk/context_hash.py` | 1 | Modified (new hash fields) |
| `app/risk/signals.py` | 1 | **New** (options-implied + triangulation) |
| `app/risk/predictions.py` | 2 | **New** (prediction registry) |
| `app/risk/calibration.py` | 3 | **New** (calibration computation) |
| `app/risk/review_queue.py` | 4 | **New** (queue population) |
| `app/risk/signal_weights.py` | 5 | **New** (weight computation) |
| `app/risk/estimate_tracker.py` | 2 | Modified (trigger prediction resolution) |
| `app/api/review_routes.py` | 4 | **New** (review API endpoints) |
| `migrations/037_deal_predictions.sql` | 2 | **New** |
| `migrations/038_human_review.sql` | 4 | **New** |
| `migrations/039_signal_weights.sql` | 5 | **New** |

### Test Plan

| Test File | Phase | What It Tests |
|-----------|-------|---------------|
| `tests/risk/test_signals.py` | 1 | Options-implied probability, signal comparison |
| `tests/risk/test_context_hash_enriched.py` | 1 | Hash includes new fields, classify_changes detects them |
| `tests/risk/test_prompts_enriched.py` | 1 | Prompt renders new sections, omits when data missing |
| `tests/risk/test_predictions.py` | 2 | Store, supersede, resolve, score predictions |
| `tests/risk/test_calibration.py` | 3 | Bucket computation, prompt formatting |
| `tests/risk/test_review_queue.py` | 4 | Queue population triggers, priority assignment |

### Deployment Checklist (Per Phase)

- [ ] Migration applied to Neon production database
- [ ] Feature flag set in production `.env`
- [ ] Run manual assessment for 1-2 deals to verify
- [ ] Check logs for any new warnings
- [ ] Compare token usage before/after
- [ ] Verify existing assessment quality unchanged (no grade drift)
- [ ] Monitor for 3 days before enabling next phase

---

## Implementation Order

**Start here → Phase 1** (no migration needed, biggest immediate impact):
1. Create `app/risk/signals.py`
2. Modify `collect_deal_context()` in `engine.py`
3. Modify `build_deal_assessment_prompt()` in `prompts.py`
4. Modify `compute_context_hash()` and `build_context_summary()` in `context_hash.py`
5. Add feature flag
6. Test with one deal
7. Deploy

**Then → Phase 2** (new table + prompt additions):
1. Apply `037_deal_predictions.sql` migration
2. Create `app/risk/predictions.py`
3. Add prediction JSON schema to system prompt
4. Add open predictions context to user prompt
5. Add prediction storage after assessment
6. Add resolution triggers in estimate_tracker
7. Test end-to-end
8. Deploy with flag OFF, then ON after verification

**Then → Phase 3** (pure computation, no new tables):
1. Create `app/risk/calibration.py`
2. Add calibration text to prompt (gated on flag)
3. Cache calibration per run (same for all deals)
4. Deploy when enough predictions are resolved

**Then → Phase 4** (new tables + API):
1. Apply `038_human_review.sql` migration
2. Create `app/risk/review_queue.py`
3. Create `app/api/review_routes.py`
4. Add corrections feedback to prompt
5. Deploy

**Finally → Phase 5** (requires Phase 3+4 data):
1. Apply `039_signal_weights.sql` migration
2. Create `app/risk/signal_weights.py`
3. Add weight text to prompt
4. Deploy when statistically meaningful
