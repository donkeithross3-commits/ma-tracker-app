# Phase 2: Prediction Registry — Implementation Plan

> Status: PLAN
> Author: phase2-planner agent
> Date: 2026-02-25
> Depends on: Phase 1 (enriched context injection) for milestone data in prompt

---

## 1. SQL Schema: `deal_predictions`

Migration file: `python-service/migrations/037_deal_predictions.sql`

```sql
-- 037_deal_predictions.sql
-- Prediction registry: explicit, scoreable AI predictions per deal.
-- Idempotent (IF NOT EXISTS / ON CONFLICT safe). Reversible via DROP TABLE.

-- ---------------------------------------------------------------
-- Prediction type enum
-- ---------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE prediction_type AS ENUM (
        'deal_closes',
        'milestone_completion',
        'spread_direction',
        'next_event',
        'break_price'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE prediction_status AS ENUM (
        'open',
        'resolved_correct',
        'resolved_incorrect',
        'resolved_partial',
        'superseded',
        'expired'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------
-- deal_predictions
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deal_predictions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticker              VARCHAR(10) NOT NULL,
    assessment_id       UUID REFERENCES deal_risk_assessments(id),

    -- Prediction content
    prediction_type     prediction_type NOT NULL,
    claim               TEXT NOT NULL,           -- Falsifiable statement, e.g. "HSR clearance by 2026-04-15"
    by_date             DATE,                    -- Deadline for the prediction (NULL = deal lifetime)
    probability         NUMERIC(5,4) NOT NULL,   -- 0.0000 to 1.0000
    confidence          NUMERIC(4,3),            -- AI's confidence in its own probability estimate (0-1)
    direction           VARCHAR(10),             -- For spread_direction: 'tighter', 'wider', 'stable'

    -- Evidence linking
    evidence            JSONB NOT NULL DEFAULT '[]',
    -- Array of: {"source_type": "filing"|"halt"|"sheet_diff"|"milestone"|"price",
    --            "source_id": "<UUID or identifier>",
    --            "source_date": "2026-02-20",
    --            "detail": "14D-9 filed, outside date extended to Sep 2026"}

    -- Milestone link (for milestone_completion predictions)
    milestone_id        UUID REFERENCES canonical_deal_milestones(id),

    -- Context at prediction time
    assessment_strategy VARCHAR(20),             -- full, delta, reuse
    current_price       NUMERIC(12,4),
    deal_price          NUMERIC(12,4),
    spread_bps          NUMERIC(8,2),            -- Spread in basis points at prediction time

    -- Resolution
    status              prediction_status NOT NULL DEFAULT 'open',
    resolved_at         TIMESTAMPTZ,
    actual_outcome      BOOLEAN,                 -- TRUE = event happened, FALSE = did not
    outcome_detail      TEXT,                     -- What actually happened
    resolution_source   VARCHAR(30),             -- 'auto_milestone', 'auto_outcome', 'auto_expiry', 'manual'

    -- Scoring
    brier_score         NUMERIC(8,6),            -- (probability - actual)^2, computed on resolution
    log_score           NUMERIC(10,6),           -- -log2(probability) if correct, -log2(1-p) if wrong

    -- Supersession chain
    superseded_by       UUID REFERENCES deal_predictions(id),
    supersedes          UUID REFERENCES deal_predictions(id),

    -- Timestamps
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------

-- Open predictions per deal (hot path: fed back to AI each assessment)
CREATE INDEX IF NOT EXISTS idx_predictions_open
    ON deal_predictions (ticker, status)
    WHERE status = 'open';

-- By assessment (join back to assessment that created them)
CREATE INDEX IF NOT EXISTS idx_predictions_assessment
    ON deal_predictions (assessment_id);

-- By type (for aggregate calibration queries)
CREATE INDEX IF NOT EXISTS idx_predictions_type_status
    ON deal_predictions (prediction_type, status);

-- Expiring predictions (for auto-resolution cron)
CREATE INDEX IF NOT EXISTS idx_predictions_expiring
    ON deal_predictions (by_date)
    WHERE status = 'open' AND by_date IS NOT NULL;

-- Scoring leaderboard (resolved predictions ordered by date)
CREATE INDEX IF NOT EXISTS idx_predictions_resolved
    ON deal_predictions (resolved_at DESC)
    WHERE status IN ('resolved_correct', 'resolved_incorrect', 'resolved_partial');

-- Milestone-linked predictions
CREATE INDEX IF NOT EXISTS idx_predictions_milestone
    ON deal_predictions (milestone_id)
    WHERE milestone_id IS NOT NULL;

-- ---------------------------------------------------------------
-- Rollback
-- ---------------------------------------------------------------
-- DROP TABLE IF EXISTS deal_predictions CASCADE;
-- DROP TYPE IF EXISTS prediction_type;
-- DROP TYPE IF EXISTS prediction_status;
```

### Design Rationale

- **UUID PK**: Consistent with all other tables in the system.
- **`prediction_type` enum**: Constrained set of prediction categories, maps 1:1 to prompt instructions.
- **`prediction_status` enum**: `superseded` handles when the AI revises a prediction. `expired` for predictions past `by_date` with no resolution trigger.
- **`evidence` JSONB array**: Flexible evidence linking without requiring a join table. Each evidence item has `source_type` + `source_id` so downstream code can resolve FK references.
- **`milestone_id` FK**: Direct link for `milestone_completion` predictions to `canonical_deal_milestones`. Enables auto-resolution when milestone status changes.
- **`supersedes`/`superseded_by`**: Bidirectional chain for prediction revisions. When the AI updates a prediction, the old one gets `status='superseded'`, `superseded_by` points to the new one.
- **`brier_score` + `log_score`**: Computed on resolution. Stored for fast aggregation — avoids recomputing across thousands of resolved predictions.
- **`spread_bps`**: Captures the spread at prediction time, critical for scoring `spread_direction` predictions.

---

## 2. Migration Design

**File**: `python-service/migrations/037_deal_predictions.sql`

**Properties**:
- **Idempotent**: All `CREATE TABLE IF NOT EXISTS`, all `CREATE INDEX IF NOT EXISTS`, enum creation wrapped in `DO $$ BEGIN ... EXCEPTION ... END $$`
- **Reversible**: Commented-out `DROP` statements at bottom. Rollback order: table first (cascades indexes), then enums.
- **No data migration**: New table, no backfill needed.
- **FK dependency**: Requires `deal_risk_assessments` (migration 031) and `canonical_deal_milestones` (migration 036) to exist.
- **Apply**: `psql $DATABASE_URL < python-service/migrations/037_deal_predictions.sql`

---

## 3. Pydantic Models

File: `python-service/app/risk/prediction_models.py`

```python
"""Pydantic models for the prediction registry."""

from datetime import date, datetime
from enum import Enum
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class PredictionType(str, Enum):
    DEAL_CLOSES = "deal_closes"
    MILESTONE_COMPLETION = "milestone_completion"
    SPREAD_DIRECTION = "spread_direction"
    NEXT_EVENT = "next_event"
    BREAK_PRICE = "break_price"


class PredictionStatus(str, Enum):
    OPEN = "open"
    RESOLVED_CORRECT = "resolved_correct"
    RESOLVED_INCORRECT = "resolved_incorrect"
    RESOLVED_PARTIAL = "resolved_partial"
    SUPERSEDED = "superseded"
    EXPIRED = "expired"


class EvidenceItem(BaseModel):
    source_type: str = Field(..., pattern=r"^(filing|halt|sheet_diff|milestone|price)$")
    source_id: Optional[str] = None
    source_date: Optional[str] = None
    detail: str


class PredictionFromAI(BaseModel):
    """Shape of a single prediction as returned by the AI in JSON response."""
    prediction_type: PredictionType
    claim: str = Field(..., min_length=10, max_length=500)
    by_date: Optional[date] = None
    probability: float = Field(..., ge=0.0, le=1.0)
    confidence: Optional[float] = Field(None, ge=0.0, le=1.0)
    direction: Optional[str] = Field(None, pattern=r"^(tighter|wider|stable)$")
    evidence: list[EvidenceItem] = Field(default_factory=list, max_length=5)

    @field_validator("by_date", mode="before")
    @classmethod
    def parse_by_date(cls, v):
        if v is None:
            return None
        if isinstance(v, str):
            return date.fromisoformat(v)
        return v


class PredictionUpdateFromAI(BaseModel):
    """Shape of a prediction update/resolution from the AI."""
    prediction_id: str  # UUID string of the open prediction being updated
    action: str = Field(..., pattern=r"^(reaffirm|revise|resolve)$")
    new_probability: Optional[float] = Field(None, ge=0.0, le=1.0)
    resolved_as: Optional[bool] = None  # True = happened, False = didn't
    reasoning: str = Field(..., min_length=5, max_length=300)


class PredictionRecord(BaseModel):
    """Full prediction record as stored in the database."""
    id: UUID
    ticker: str
    assessment_id: Optional[UUID]
    prediction_type: PredictionType
    claim: str
    by_date: Optional[date]
    probability: float
    confidence: Optional[float]
    direction: Optional[str]
    evidence: list[EvidenceItem]
    milestone_id: Optional[UUID]
    status: PredictionStatus
    resolved_at: Optional[datetime]
    actual_outcome: Optional[bool]
    outcome_detail: Optional[str]
    brier_score: Optional[float]
    log_score: Optional[float]
    created_at: datetime
```

---

## 4. JSON Schema Additions to System Prompt

These fields are added to the JSON response schema in `RISK_ASSESSMENT_SYSTEM_PROMPT` (in `prompts.py`), inside the existing JSON format block.

### New fields in the response JSON:

```json
{
    "...existing fields...",

    "predictions": [
        {
            "prediction_type": "deal_closes|milestone_completion|spread_direction|next_event|break_price",
            "claim": "HSR clearance granted by 2026-04-15",
            "by_date": "2026-04-15",
            "probability": 0.85,
            "confidence": 0.70,
            "direction": null,
            "evidence": [
                {"source_type": "filing", "source_id": "ef-123", "source_date": "2026-02-20", "detail": "HSR filing submitted per 8-K"}
            ]
        }
    ],

    "prediction_updates": [
        {
            "prediction_id": "uuid-of-open-prediction",
            "action": "reaffirm|revise|resolve",
            "new_probability": 0.90,
            "resolved_as": null,
            "reasoning": "No new information changes outlook"
        }
    ]
}
```

### JSON schema example to append after the `assessment_changes` block in the system prompt:

```json
    "predictions": [
        {
            "prediction_type": "milestone_completion",
            "claim": "Shareholder vote passes by 2026-05-01",
            "by_date": "2026-05-01",
            "probability": 0.92,
            "confidence": 0.80,
            "direction": null,
            "evidence": [
                {"source_type": "filing", "source_date": "2026-02-18", "detail": "DEFM14A filed, vote scheduled Apr 28"}
            ]
        }
    ],
    "prediction_updates": []
```

---

## 5. Prompt Text Additions

### 5a. Full Assessment Path — Add to `RISK_ASSESSMENT_SYSTEM_PROMPT`

Insert after the `assessment_changes` section (before the JSON schema block), approximately at line 107 in `prompts.py`:

```
## Predictions (REQUIRED)

Make 2-5 explicit, falsifiable predictions about this deal. Each prediction must be:
- **Specific**: A concrete claim that will be true or false by a date
- **Dated**: Include a by_date unless the prediction spans the deal's lifetime
- **Probabilistic**: Assign a probability (0.0-1.0) to the claim
- **Evidenced**: Cite 1-3 specific evidence items from the context above

Prediction types:
- **deal_closes**: Will the deal close? By when? At what terms?
- **milestone_completion**: Will a specific milestone (HSR, vote, CFIUS) complete by a date?
- **spread_direction**: Will the spread tighten, widen, or stay stable over N days?
- **next_event**: What is the next material event and when?
- **break_price**: If the deal breaks, what price does the target trade to?

For spread_direction predictions, include a "direction" field: "tighter", "wider", or "stable".

Evidence items must reference real data from the context: filing types+dates, halt codes+dates,
sheet diff fields+dates, or deal attributes. Use source_type: filing, halt, sheet_diff, milestone, or price.

If previous open predictions are provided below, you MUST also provide prediction_updates
for each one: reaffirm (keep as-is), revise (update probability), or resolve (mark outcome).
```

### 5b. Delta Assessment Path — Add to `RISK_DELTA_SYSTEM_PROMPT`

Append to the delta system prompt (after "Only change grades when evidence clearly justifies it."):

```
## Predictions

Review any open predictions listed below. For each, provide a prediction_update:
reaffirm, revise (with new_probability), or resolve (with resolved_as true/false).

If the changes since last assessment warrant it, add 1-2 new predictions. Delta assessments
should produce fewer new predictions than full assessments — only when new information
creates a scoreable claim.
```

### 5c. Token Budget Impact

Estimated additions:
- System prompt: ~250 tokens (predictions instructions)
- Previous predictions context: ~50 tokens per open prediction (typically 3-8 per deal = 150-400 tokens)
- AI output: ~100 tokens per new prediction (2-5 predictions = 200-500 tokens)
- Delta path: ~60% of above

Net cost increase: ~$0.001-0.003 per assessment at current Sonnet pricing.

---

## 6. Prediction Parsing and Validation Logic

File: `python-service/app/risk/prediction_parser.py`

```python
"""Parse and validate predictions from AI JSON response."""

import logging
from datetime import date
from uuid import UUID

from .prediction_models import (
    EvidenceItem,
    PredictionFromAI,
    PredictionType,
    PredictionUpdateFromAI,
)

logger = logging.getLogger(__name__)


def parse_predictions(ai_response: dict, ticker: str) -> list[PredictionFromAI]:
    """Extract and validate predictions from AI response JSON.

    Returns only valid predictions. Logs and skips invalid ones.
    """
    raw_predictions = ai_response.get("predictions", [])
    if not isinstance(raw_predictions, list):
        logger.warning("predictions field is not a list for %s", ticker)
        return []

    valid = []
    for i, raw in enumerate(raw_predictions):
        if not isinstance(raw, dict):
            logger.warning("Prediction %d for %s is not a dict, skipping", i, ticker)
            continue
        try:
            pred = PredictionFromAI.model_validate(raw)
            # Business validation
            if pred.prediction_type == PredictionType.SPREAD_DIRECTION and not pred.direction:
                logger.warning("spread_direction prediction %d for %s missing direction, skipping", i, ticker)
                continue
            if pred.by_date and pred.by_date <= date.today():
                logger.warning("Prediction %d for %s has by_date in the past, skipping", i, ticker)
                continue
            if not pred.evidence:
                logger.warning("Prediction %d for %s has no evidence, skipping", i, ticker)
                continue
            valid.append(pred)
        except Exception as e:
            logger.warning("Invalid prediction %d for %s: %s", i, ticker, e)
            continue

    if len(valid) > 5:
        valid = valid[:5]  # Cap at 5

    return valid


def parse_prediction_updates(
    ai_response: dict,
    open_prediction_ids: set[str],
    ticker: str,
) -> list[PredictionUpdateFromAI]:
    """Extract and validate prediction updates from AI response.

    Only accepts updates for predictions in open_prediction_ids.
    """
    raw_updates = ai_response.get("prediction_updates", [])
    if not isinstance(raw_updates, list):
        return []

    valid = []
    for i, raw in enumerate(raw_updates):
        if not isinstance(raw, dict):
            continue
        try:
            update = PredictionUpdateFromAI.model_validate(raw)
            if update.prediction_id not in open_prediction_ids:
                logger.warning(
                    "Update %d for %s references unknown prediction %s, skipping",
                    i, ticker, update.prediction_id,
                )
                continue
            if update.action == "revise" and update.new_probability is None:
                logger.warning("Revise update %d for %s missing new_probability, skipping", i, ticker)
                continue
            if update.action == "resolve" and update.resolved_as is None:
                logger.warning("Resolve update %d for %s missing resolved_as, skipping", i, ticker)
                continue
            valid.append(update)
        except Exception as e:
            logger.warning("Invalid prediction update %d for %s: %s", i, ticker, e)
            continue

    return valid
```

### Validation Rules Summary

| Rule | Enforcement |
|------|-------------|
| `prediction_type` in enum | Pydantic enum validation |
| `claim` length 10-500 chars | Pydantic `Field(min_length=10, max_length=500)` |
| `probability` in [0.0, 1.0] | Pydantic `Field(ge=0.0, le=1.0)` |
| `by_date` not in the past | Business validation in parser |
| `evidence` non-empty | Business validation in parser |
| `direction` required for `spread_direction` | Business validation in parser |
| Max 5 predictions per assessment | Truncation in parser |
| Update references valid open prediction | Set membership check |
| `revise` requires `new_probability` | Business validation |
| `resolve` requires `resolved_as` | Business validation |

---

## 7. Prediction Scoring Algorithm

File: `python-service/app/risk/prediction_scorer.py`

### 7a. Brier Score Computation

```python
"""Score resolved predictions using Brier and log scores."""

import logging
import math
from datetime import datetime
from uuid import UUID

logger = logging.getLogger(__name__)


def compute_brier_score(probability: float, actual: bool) -> float:
    """Compute Brier score for a single prediction.

    Brier = (predicted_probability - actual_outcome)^2
    actual: True = event happened (1.0), False = didn't happen (0.0)
    Range: 0.0 (perfect) to 1.0 (worst)
    Reference: 0.25 = coin flip
    """
    actual_val = 1.0 if actual else 0.0
    return (probability - actual_val) ** 2


def compute_log_score(probability: float, actual: bool) -> float:
    """Compute logarithmic score for a single prediction.

    Rewards confident correct predictions more than Brier.
    log_score = -log2(p) if actual=True, -log2(1-p) if actual=False
    Lower is better. Range: 0 (perfect confidence) to +inf.
    """
    p = max(0.001, min(0.999, probability))  # Clamp to avoid log(0)
    if actual:
        return -math.log2(p)
    else:
        return -math.log2(1.0 - p)
```

### 7b. Auto-Resolution Triggers

```python
async def auto_resolve_predictions(pool) -> dict:
    """Run auto-resolution for all open predictions.

    Called daily after the morning assessment run.
    Returns summary of resolutions made.

    Resolution sources:
    1. Milestone status changes -> milestone_completion predictions
    2. Deal outcomes recorded  -> deal_closes predictions
    3. Passed by_date          -> expired predictions
    4. Price/spread data       -> spread_direction predictions
    """
    stats = {"milestone": 0, "outcome": 0, "expired": 0, "spread": 0}

    async with pool.acquire() as conn:
        # --- 1. Milestone-linked predictions ---
        # Find open predictions linked to milestones that have changed status
        milestone_resolved = await conn.fetch("""
            SELECT p.id, p.probability, p.prediction_type,
                   m.status AS milestone_status, m.milestone_type
            FROM deal_predictions p
            JOIN canonical_deal_milestones m ON m.id = p.milestone_id
            WHERE p.status = 'open'
              AND p.prediction_type = 'milestone_completion'
              AND m.status IN ('completed', 'failed', 'waived')
        """)
        for row in milestone_resolved:
            actual = row["milestone_status"] in ("completed", "waived")
            brier = compute_brier_score(float(row["probability"]), actual)
            log_s = compute_log_score(float(row["probability"]), actual)
            status = "resolved_correct" if (
                (actual and float(row["probability"]) >= 0.5) or
                (not actual and float(row["probability"]) < 0.5)
            ) else "resolved_incorrect"

            await conn.execute("""
                UPDATE deal_predictions
                SET status = $2, resolved_at = NOW(), actual_outcome = $3,
                    outcome_detail = $4, resolution_source = 'auto_milestone',
                    brier_score = $5, log_score = $6, updated_at = NOW()
                WHERE id = $1 AND status = 'open'
            """, row["id"], status, actual,
                f"Milestone {row['milestone_type']} -> {row['milestone_status']}",
                brier, log_s)
            stats["milestone"] += 1

        # --- 2. Deal outcome predictions ---
        # Find open deal_closes predictions where an outcome has been recorded
        outcome_resolved = await conn.fetch("""
            SELECT p.id, p.probability, p.ticker,
                   o.outcome, o.outcome_price, o.outcome_date
            FROM deal_predictions p
            JOIN deal_outcomes o ON o.ticker = p.ticker
            WHERE p.status = 'open'
              AND p.prediction_type = 'deal_closes'
        """)
        for row in outcome_resolved:
            deal_closed = row["outcome"] in ("closed_at_deal", "closed_higher")
            brier = compute_brier_score(float(row["probability"]), deal_closed)
            log_s = compute_log_score(float(row["probability"]), deal_closed)
            status = "resolved_correct" if (
                (deal_closed and float(row["probability"]) >= 0.5) or
                (not deal_closed and float(row["probability"]) < 0.5)
            ) else "resolved_incorrect"

            await conn.execute("""
                UPDATE deal_predictions
                SET status = $2, resolved_at = NOW(), actual_outcome = $3,
                    outcome_detail = $4, resolution_source = 'auto_outcome',
                    brier_score = $5, log_score = $6, updated_at = NOW()
                WHERE id = $1 AND status = 'open'
            """, row["id"], status, deal_closed,
                f"Deal outcome: {row['outcome']} at ${row['outcome_price']}",
                brier, log_s)
            stats["outcome"] += 1

        # --- 3. Expired predictions (past by_date with no resolution) ---
        expired = await conn.fetch("""
            SELECT id, probability, prediction_type
            FROM deal_predictions
            WHERE status = 'open'
              AND by_date IS NOT NULL
              AND by_date < CURRENT_DATE
        """)
        for row in expired:
            # Expired = event did not happen by the deadline
            brier = compute_brier_score(float(row["probability"]), False)
            log_s = compute_log_score(float(row["probability"]), False)
            status = "resolved_correct" if float(row["probability"]) < 0.5 else "resolved_incorrect"
            # For next_event predictions, we mark as expired (not scored)
            if row["prediction_type"] == "next_event":
                await conn.execute("""
                    UPDATE deal_predictions
                    SET status = 'expired', resolved_at = NOW(),
                        outcome_detail = 'Prediction expired (by_date passed)',
                        resolution_source = 'auto_expiry', updated_at = NOW()
                    WHERE id = $1 AND status = 'open'
                """, row["id"])
            else:
                await conn.execute("""
                    UPDATE deal_predictions
                    SET status = $2, resolved_at = NOW(), actual_outcome = FALSE,
                        outcome_detail = 'Event did not occur by deadline',
                        resolution_source = 'auto_expiry',
                        brier_score = $3, log_score = $4, updated_at = NOW()
                    WHERE id = $1 AND status = 'open'
                """, row["id"], status, brier, log_s)
            stats["expired"] += 1

        # --- 4. Spread direction predictions (check if by_date passed) ---
        # These are resolved by comparing spread at prediction time vs current spread
        spread_expired = await conn.fetch("""
            SELECT p.id, p.probability, p.direction, p.spread_bps, p.ticker
            FROM deal_predictions p
            WHERE p.status = 'open'
              AND p.prediction_type = 'spread_direction'
              AND p.by_date IS NOT NULL
              AND p.by_date <= CURRENT_DATE
        """)
        for row in spread_expired:
            # Get current spread
            current = await conn.fetchrow("""
                SELECT deal_price, current_price FROM sheet_rows
                WHERE ticker = $1 AND snapshot_id = (
                    SELECT id FROM sheet_snapshots
                    ORDER BY snapshot_date DESC, ingested_at DESC LIMIT 1
                )
            """, row["ticker"])
            if current and current["deal_price"] and current["current_price"]:
                dp = float(current["deal_price"])
                cp = float(current["current_price"])
                current_spread = ((dp - cp) / dp) * 10000 if dp > 0 else 0
                old_spread = float(row["spread_bps"]) if row["spread_bps"] else 0
                spread_change = current_spread - old_spread

                actual_direction = "stable"
                if spread_change < -20:   # Tightened by >20bps
                    actual_direction = "tighter"
                elif spread_change > 20:  # Widened by >20bps
                    actual_direction = "wider"

                predicted_direction = row["direction"]
                actual = (predicted_direction == actual_direction)
                brier = compute_brier_score(float(row["probability"]), actual)
                log_s = compute_log_score(float(row["probability"]), actual)
                status = "resolved_correct" if actual else "resolved_incorrect"

                await conn.execute("""
                    UPDATE deal_predictions
                    SET status = $2, resolved_at = NOW(), actual_outcome = $3,
                        outcome_detail = $4, resolution_source = 'auto_expiry',
                        brier_score = $5, log_score = $6, updated_at = NOW()
                    WHERE id = $1 AND status = 'open'
                """, row["id"], status, actual,
                    f"Spread moved {spread_change:+.0f}bps ({actual_direction}), predicted {predicted_direction}",
                    brier, log_s)
                stats["spread"] += 1

    logger.info("Auto-resolved predictions: %s", stats)
    return stats
```

### 7c. Aggregate Calibration Query

For Phase 3 (calibration loop), but the schema supports it now:

```sql
-- Calibration curve: predicted probability buckets vs actual frequency
SELECT
    width_bucket(probability, 0, 1, 10) AS bucket,
    COUNT(*) AS n,
    AVG(probability) AS avg_predicted,
    AVG(CASE WHEN actual_outcome THEN 1.0 ELSE 0.0 END) AS avg_actual,
    AVG(brier_score) AS avg_brier
FROM deal_predictions
WHERE status IN ('resolved_correct', 'resolved_incorrect')
GROUP BY bucket
ORDER BY bucket;
```

---

## 8. Previous Prediction Context Builder

File: additions to `python-service/app/risk/prompts.py`

### 8a. Function to fetch and format open predictions

```python
async def build_prediction_context(pool, ticker: str) -> str:
    """Build a compact text section listing open predictions for the AI.

    Returns empty string if no open predictions exist.
    """
    async with pool.acquire() as conn:
        predictions = await conn.fetch("""
            SELECT id, prediction_type, claim, by_date, probability,
                   confidence, direction, evidence, created_at
            FROM deal_predictions
            WHERE ticker = $1 AND status = 'open'
            ORDER BY created_at DESC
            LIMIT 10
        """, ticker)

    if not predictions:
        return ""

    lines = ["## YOUR OPEN PREDICTIONS (update each one)"]
    for p in predictions:
        by_str = f" by {p['by_date']}" if p['by_date'] else ""
        lines.append(
            f"- [{p['id']}] {p['prediction_type']}: "
            f"\"{p['claim']}\"{by_str} — p={float(p['probability']):.2f}"
        )
    lines.append("")
    lines.append("For each prediction above, provide a prediction_update with action: reaffirm, revise, or resolve.")
    lines.append("")
    return "\n".join(lines)
```

### 8b. Integration into `build_deal_assessment_prompt`

Add as a new section after Section 10 (Live Market Data), before the `return`:

```python
    # Section 11: Open predictions (for update)
    prediction_context = context.get("prediction_context", "")
    if prediction_context:
        sections.append(prediction_context)
```

### 8c. Integration into `build_delta_assessment_prompt`

Add after the sheet comparison section, before the `return`:

```python
    # Open predictions for update
    prediction_context = context.get("prediction_context", "")
    if prediction_context:
        sections.append(prediction_context)
```

### 8d. Integration into `collect_deal_context`

Add after the live_price section in `RiskAssessmentEngine.collect_deal_context`:

```python
        # Build prediction context (open predictions for this deal)
        try:
            from .prompts import build_prediction_context
            pred_ctx = await build_prediction_context(self.pool, ticker)
            if pred_ctx:
                context["prediction_context"] = pred_ctx
        except Exception:
            pass  # Table may not exist yet
```

---

## 9. Evidence Linking Strategy

### Evidence Source Types

| source_type | source_id format | Resolution |
|-------------|-----------------|------------|
| `filing` | `portfolio_edgar_filings.id` (UUID) or `"{filing_type}_{filed_at}"` | Join to `portfolio_edgar_filings` |
| `halt` | `halt_events.id` (UUID) or `"{halt_code}_{halted_at}"` | Join to `halt_events` |
| `sheet_diff` | `"{field_name}_{diff_date}"` | Query `sheet_diffs` |
| `milestone` | `canonical_deal_milestones.id` (UUID) | Direct FK available on `deal_predictions.milestone_id` |
| `price` | `"{ticker}_{date}"` | Query `sheet_rows` or `deal_estimate_snapshots` |

### AI Guidance for Evidence

The AI is instructed to use `source_type` and `source_date` from the context sections. Since the prompt already provides filing dates, halt dates, and diff dates, the AI should cite those directly. The `source_id` field is optional — if the AI can't reference a specific UUID (it doesn't have them), it provides the natural key (filing type + date) and the parser resolves it.

### Evidence Resolution Function

```python
async def resolve_evidence_ids(pool, ticker: str, evidence: list[dict]) -> list[dict]:
    """Attempt to resolve natural-key evidence items to actual UUIDs.

    Best-effort: if resolution fails, keeps the natural key.
    """
    async with pool.acquire() as conn:
        for item in evidence:
            if item.get("source_id") and len(item["source_id"]) == 36:
                continue  # Already a UUID
            st = item.get("source_type")
            sd = item.get("source_date")
            if st == "filing" and sd:
                row = await conn.fetchrow("""
                    SELECT id FROM portfolio_edgar_filings
                    WHERE ticker = $1 AND detected_at::date = $2::date
                    ORDER BY detected_at DESC LIMIT 1
                """, ticker, sd)
                if row:
                    item["source_id"] = str(row["id"])
            elif st == "halt" and sd:
                row = await conn.fetchrow("""
                    SELECT id FROM halt_events
                    WHERE ticker = $1 AND halted_at::date = $2::date
                    ORDER BY halted_at DESC LIMIT 1
                """, ticker, sd)
                if row:
                    item["source_id"] = str(row["id"])
            elif st == "milestone":
                row = await conn.fetchrow("""
                    SELECT id FROM canonical_deal_milestones
                    WHERE ticker = $1
                    ORDER BY created_at DESC LIMIT 1
                """, ticker)
                if row:
                    item["source_id"] = str(row["id"])
    return evidence
```

---

## 10. Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    MORNING ASSESSMENT RUN                        │
│                                                                 │
│  1. collect_deal_context(ticker)                                │
│     ├── sheet_row, filings, halts, diffs, etc.                 │
│     └── build_prediction_context(pool, ticker)  ◄── NEW        │
│         └── Fetches open predictions from deal_predictions      │
│                                                                 │
│  2. Build prompt                                                │
│     ├── RISK_ASSESSMENT_SYSTEM_PROMPT (with prediction section) │
│     ├── build_deal_assessment_prompt(context)                   │
│     │   └── Section 11: Open predictions context                │
│     └── OR build_delta_assessment_prompt(...)                   │
│         └── Includes prediction_context if present              │
│                                                                 │
│  3. assess_single_deal(context) → Claude API call               │
│     └── Returns JSON with predictions[] + prediction_updates[]  │
│                                                                 │
│  4. Parse response                                              │
│     ├── parse_predictions(ai_response, ticker)                  │
│     │   └── Validates via PredictionFromAI Pydantic model       │
│     └── parse_prediction_updates(ai_response, open_ids, ticker) │
│         └── Validates via PredictionUpdateFromAI model           │
│                                                                 │
│  5. Store predictions                                           │
│     ├── INSERT new predictions into deal_predictions            │
│     │   ├── Link assessment_id                                  │
│     │   ├── Resolve evidence IDs (best-effort)                  │
│     │   ├── Link milestone_id for milestone_completion types    │
│     │   └── Capture spread_bps, current_price, deal_price       │
│     └── Apply prediction_updates                                │
│         ├── reaffirm → no-op (logged)                          │
│         ├── revise → new prediction, old → superseded           │
│         └── resolve → update status, compute brier+log scores   │
│                                                                 │
│  6. Store assessment (existing _store_assessment)               │
│     └── ai_response JSONB now includes predictions              │
│                                                                 │
│  7. Auto-resolve (post-run)                                     │
│     ├── Milestone status changes → resolve milestone_completion │
│     ├── Deal outcomes → resolve deal_closes                     │
│     ├── Expired by_date → resolve or expire                     │
│     └── Spread direction → compare spread_bps                   │
│                                                                 │
│  8. Next morning: predictions fed back as context (step 1)      │
└─────────────────────────────────────────────────────────────────┘
```

### Sequence in `run_morning_assessment`

After the existing `_store_assessment` call (engine.py ~line 602):

```python
# Store predictions from this assessment
try:
    from .prediction_parser import parse_predictions, parse_prediction_updates
    from .prediction_store import store_predictions, apply_prediction_updates

    new_preds = parse_predictions(assessment, ticker)
    open_ids = set(str(p["id"]) for p in context.get("_open_predictions", []))
    updates = parse_prediction_updates(assessment, open_ids, ticker)

    await store_predictions(
        self.pool, ticker, assessment_id, new_preds, context,
    )
    await apply_prediction_updates(self.pool, updates)
except Exception as e:
    logger.error("Prediction storage failed for %s: %s", ticker, e, exc_info=True)
```

After the full run loop, before the run summary:

```python
# Auto-resolve predictions based on new data
try:
    from .prediction_scorer import auto_resolve_predictions
    resolve_stats = await auto_resolve_predictions(self.pool)
    logger.info("Prediction auto-resolution: %s", resolve_stats)
except Exception as e:
    logger.error("Prediction auto-resolution failed: %s", e, exc_info=True)
```

---

## 11. Test Strategy

### Unit Tests

File: `python-service/tests/test_prediction_parser.py`

```python
# Test cases for parse_predictions:
# 1. Valid prediction with all fields → accepted
# 2. Missing claim → rejected
# 3. Probability > 1.0 → rejected
# 4. by_date in the past → rejected
# 5. Empty evidence → rejected
# 6. spread_direction without direction → rejected
# 7. More than 5 predictions → truncated to 5
# 8. Non-list predictions field → returns empty list
# 9. Mixed valid/invalid → only valid returned

# Test cases for parse_prediction_updates:
# 1. Valid reaffirm → accepted
# 2. Valid revise with new_probability → accepted
# 3. Revise without new_probability → rejected
# 4. Resolve without resolved_as → rejected
# 5. Update for unknown prediction_id → rejected
# 6. Non-list field → returns empty list
```

File: `python-service/tests/test_prediction_scorer.py`

```python
# Test cases for compute_brier_score:
# 1. Perfect prediction (p=1.0, actual=True) → 0.0
# 2. Perfect wrong (p=1.0, actual=False) → 1.0
# 3. Coin flip (p=0.5, actual=True) → 0.25
# 4. Coin flip (p=0.5, actual=False) → 0.25
# 5. Moderate confidence correct (p=0.8, actual=True) → 0.04
# 6. Moderate confidence wrong (p=0.8, actual=False) → 0.64

# Test cases for compute_log_score:
# 1. Perfect prediction → 0.0 (approx)
# 2. Coin flip → 1.0
# 3. Confident wrong → large positive value

# Test cases for auto_resolve_predictions (integration, needs DB fixture):
# 1. Milestone completed → prediction resolved_correct
# 2. Milestone failed → prediction resolved_incorrect
# 3. Deal outcome closed → deal_closes prediction resolved
# 4. Expired by_date → prediction resolved as not happened
# 5. Spread tightened → spread_direction prediction scored
# 6. No matching trigger → prediction stays open
```

### Integration Tests

File: `python-service/tests/test_prediction_flow.py`

```python
# End-to-end flow tests (mock Claude API):
# 1. Full assessment produces predictions → stored in DB → fed back next run
# 2. Delta assessment updates existing predictions → supersession chain correct
# 3. Prediction with milestone_id → auto-resolved when milestone completes
# 4. Evidence resolution → natural keys resolved to UUIDs
# 5. Prediction context builder → correct formatting in prompt
```

### Manual Validation Checklist

- [ ] Migration applies cleanly to production DB
- [ ] First morning run with predictions produces valid JSON
- [ ] Predictions appear in `deal_predictions` table with correct FKs
- [ ] Next morning run feeds back open predictions in context
- [ ] AI produces prediction_updates for fed-back predictions
- [ ] Supersession chain (revise) creates new prediction, marks old as superseded
- [ ] Auto-resolution fires when milestone status changes
- [ ] Auto-resolution fires when deal outcome is recorded
- [ ] Expired predictions are resolved at by_date + 1
- [ ] Brier scores are computed correctly on resolution
- [ ] Calibration query returns sensible buckets after 1 week of data

---

## Appendix A: Files to Create / Modify

### New Files
| File | Purpose |
|------|---------|
| `migrations/037_deal_predictions.sql` | Schema migration |
| `app/risk/prediction_models.py` | Pydantic models |
| `app/risk/prediction_parser.py` | Parse + validate AI predictions |
| `app/risk/prediction_scorer.py` | Scoring + auto-resolution |
| `app/risk/prediction_store.py` | DB insert/update for predictions |
| `tests/test_prediction_parser.py` | Parser unit tests |
| `tests/test_prediction_scorer.py` | Scorer unit tests |

### Modified Files
| File | Change |
|------|--------|
| `app/risk/prompts.py` | Add prediction instructions to system prompt, add `build_prediction_context()`, add Section 11 to both prompt builders |
| `app/risk/engine.py` | Add prediction context to `collect_deal_context()`, add prediction storage after `_store_assessment()`, add auto-resolution after run loop |
| `app/api/risk_routes.py` | Add endpoint for manual prediction resolution, prediction listing |

### Unchanged Files (verified compatible)
| File | Why unchanged |
|------|---------------|
| `app/risk/context_hash.py` | Predictions don't affect context hash (they're outputs, not inputs) |
| `app/risk/estimate_tracker.py` | Estimate snapshots are a separate concern; predictions complement, don't replace |
| `app/risk/model_config.py` | No new model needed; predictions use same assessment models |

---

## Appendix B: Prediction Type Specifications

### `deal_closes`
- **Claim format**: "Deal closes by {date}" or "Deal closes at ${price}"
- **by_date**: Expected close date or outside date
- **Resolution**: Auto via `deal_outcomes` table
- **actual_outcome**: TRUE if outcome in (closed_at_deal, closed_higher), FALSE otherwise

### `milestone_completion`
- **Claim format**: "{milestone_type} completes by {date}"
- **by_date**: Expected milestone date
- **milestone_id**: FK to `canonical_deal_milestones`
- **Resolution**: Auto via milestone status change to completed/failed/waived
- **actual_outcome**: TRUE if completed/waived, FALSE if failed

### `spread_direction`
- **Claim format**: "Spread {tightens|widens|stays stable} over next {N} days"
- **by_date**: date.today() + N days
- **direction**: Required. "tighter", "wider", or "stable"
- **Resolution**: Auto at by_date. Compare `spread_bps` at creation vs current.
- **Thresholds**: >20bps change = directional, else stable
- **actual_outcome**: TRUE if actual direction matches predicted direction

### `next_event`
- **Claim format**: "Next material event is {description} by {date}"
- **by_date**: When the event should occur
- **Resolution**: Manual or auto-expiry. Not scored (informational).
- **Note**: Expired `next_event` predictions get status='expired', no Brier score.

### `break_price`
- **Claim format**: "If deal breaks, target trades to ${price}"
- **by_date**: NULL (deal lifetime)
- **Resolution**: Auto when deal outcome = broke/withdrawn.
- **Scoring**: Uses outcome_price vs predicted break price. Brier score on whether the predicted price was within 10% of actual. Log score based on (predicted - actual) / actual.
