# Phases 3-5: Calibration Loop, Human Review Queue, Signal Weighting

> Implementation plan for the predict-assess-score feedback loop.
> Builds on Phase 1 (enriched context) and Phase 2 (prediction registry).

---

## Dependency Graph

```
Phase 1 (Context Injection)
    |
Phase 2 (Prediction Registry + Scoring)
    |
    +---> Phase 3 (Calibration Loop) ----+
    |                                     |
    +---> Phase 4 (Human Review Queue) ---+---> Phase 5 (Signal Weighting)
```

- Phase 3 requires Phase 2's `prediction_registry` and `prediction_scores` tables.
- Phase 4 can begin in parallel with Phase 3 (uses existing `discrepancies`, `needs_attention`).
- Phase 5 requires data from both Phase 3 (calibration history) and Phase 4 (human corrections).
- Each phase is independently deployable and useful on its own.

---

## Phase 3: Calibration Loop

### 3.1 Purpose

Feed the AI its own historical accuracy back into the prompt so it can self-correct.
When the model said "90% probability" and outcomes only hit 75%, tell it.

### 3.2 SQL Schema

```sql
-- Migration: 039_calibration_history.sql

-- Aggregated calibration snapshots, computed weekly or on-demand
CREATE TABLE IF NOT EXISTS calibration_snapshots (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Scope
    scope               VARCHAR(30) NOT NULL DEFAULT 'global',
    -- Values: 'global', 'factor:{factor_name}', 'ticker:{TICKER}'
    -- Examples: 'global', 'factor:regulatory', 'ticker:ATVI'

    -- Bucketed calibration data (JSONB array)
    -- Each element: {
    --   "bucket": "90-100",
    --   "bucket_midpoint": 0.95,
    --   "predicted_count": 12,
    --   "actual_hit_rate": 0.83,
    --   "deviation": -0.12,    (actual - predicted midpoint)
    --   "direction": "overconfident"
    -- }
    calibration_buckets JSONB NOT NULL DEFAULT '[]',

    -- Summary statistics
    total_predictions   INTEGER NOT NULL DEFAULT 0,
    mean_brier_score    NUMERIC(8,6),
    calibration_error   NUMERIC(8,6),   -- ECE (expected calibration error)
    sharpness           NUMERIC(8,6),   -- variance of predictions (higher = more decisive)
    resolution          NUMERIC(8,6),   -- ability to separate outcomes

    -- Trend (vs previous snapshot)
    prev_snapshot_id    UUID REFERENCES calibration_snapshots(id),
    brier_delta         NUMERIC(8,6),   -- improvement since last snapshot (negative = better)
    calibration_delta   NUMERIC(8,6),

    CONSTRAINT uq_calibration_scope UNIQUE (computed_at, scope)
);

CREATE INDEX IF NOT EXISTS idx_calibration_scope
    ON calibration_snapshots (scope, computed_at DESC);
```

### 3.3 Calibration Computation Algorithm

```python
# File: app/risk/calibration.py

PROBABILITY_BUCKETS = [
    (0.0, 0.10, "0-10%"),
    (0.10, 0.20, "10-20%"),
    (0.20, 0.30, "20-30%"),
    (0.30, 0.40, "30-40%"),
    (0.40, 0.50, "40-50%"),
    (0.50, 0.60, "50-60%"),
    (0.60, 0.70, "60-70%"),
    (0.70, 0.80, "70-80%"),
    (0.80, 0.90, "80-90%"),
    (0.90, 1.01, "90-100%"),
]

async def compute_calibration(pool, scope: str = "global") -> dict:
    """Compute calibration curve from resolved predictions.

    Args:
        pool: asyncpg connection pool
        scope: 'global', 'factor:regulatory', etc.

    Returns:
        dict with calibration_buckets, total_predictions, mean_brier_score,
        calibration_error, sharpness, resolution
    """
    async with pool.acquire() as conn:
        # Query resolved predictions from prediction_scores
        # (Phase 2 table — joins prediction_registry + deal_outcomes)
        where_clause = ""
        params = []
        if scope.startswith("factor:"):
            factor = scope.split(":", 1)[1]
            where_clause = "AND pr.risk_factor = $1"
            params = [factor]

        rows = await conn.fetch(f"""
            SELECT
                pr.predicted_probability,
                ps.brier_score,
                CASE WHEN do.outcome IN ('closed_at_deal', 'closed_higher')
                     THEN 1.0 ELSE 0.0 END AS actual_outcome
            FROM prediction_registry pr
            JOIN prediction_scores ps ON ps.prediction_id = pr.id
            JOIN deal_outcomes do ON do.ticker = pr.ticker
            WHERE ps.brier_score IS NOT NULL
            {where_clause}
        """, *params)

    if not rows:
        return {
            "calibration_buckets": [],
            "total_predictions": 0,
            "mean_brier_score": None,
            "calibration_error": None,
            "sharpness": None,
            "resolution": None,
            "sufficient_data": False,
        }

    # Bucket predictions
    buckets = {}
    all_briers = []
    all_probs = []
    base_rate = sum(r["actual_outcome"] for r in rows) / len(rows)

    for low, high, label in PROBABILITY_BUCKETS:
        bucket_rows = [
            r for r in rows
            if low <= (r["predicted_probability"] or 0) < high
        ]
        if not bucket_rows:
            continue

        midpoint = (low + high) / 2
        actual_rate = sum(r["actual_outcome"] for r in bucket_rows) / len(bucket_rows)
        deviation = actual_rate - midpoint

        buckets[label] = {
            "bucket": label,
            "bucket_midpoint": round(midpoint, 2),
            "predicted_count": len(bucket_rows),
            "actual_hit_rate": round(actual_rate, 4),
            "deviation": round(deviation, 4),
            "direction": "overconfident" if deviation < -0.05
                         else "underconfident" if deviation > 0.05
                         else "well_calibrated",
        }

    for r in rows:
        all_briers.append(r["brier_score"])
        all_probs.append(r["predicted_probability"] or 0.5)

    # Expected Calibration Error (ECE)
    ece = 0.0
    for b in buckets.values():
        weight = b["predicted_count"] / len(rows)
        ece += weight * abs(b["deviation"])

    # Sharpness: variance of predicted probabilities
    mean_prob = sum(all_probs) / len(all_probs)
    sharpness = sum((p - mean_prob) ** 2 for p in all_probs) / len(all_probs)

    # Resolution: variance of bucket-level actual rates vs base rate
    resolution = 0.0
    for b in buckets.values():
        weight = b["predicted_count"] / len(rows)
        resolution += weight * (b["actual_hit_rate"] - base_rate) ** 2

    return {
        "calibration_buckets": list(buckets.values()),
        "total_predictions": len(rows),
        "mean_brier_score": round(sum(float(b) for b in all_briers) / len(all_briers), 6),
        "calibration_error": round(ece, 6),
        "sharpness": round(sharpness, 6),
        "resolution": round(resolution, 6),
        "sufficient_data": len(rows) >= 10,
    }
```

### 3.4 Minimum Data Requirements

| Metric | Minimum N | Rationale |
|--------|-----------|-----------|
| Global calibration curve | 10 resolved predictions | Enough for 2-3 populated buckets |
| Per-factor calibration | 5 per factor | Smaller N acceptable because narrower scope |
| Calibration trend | 2 snapshots (2+ weeks apart) | Need at least two points for a delta |
| Statistical significance | 30+ predictions | Before showing confidence intervals |

When data is insufficient, the calibration section includes a `"note": "Early data (N=X) - treat as directional only"` disclaimer.

### 3.5 Prompt Text for Calibration Feedback

Injected as a new section in `build_deal_assessment_prompt()`, after the Previous Assessment section:

```python
def build_calibration_context(calibration: dict) -> str:
    """Build the calibration feedback section for the AI prompt."""
    if not calibration.get("sufficient_data"):
        n = calibration.get("total_predictions", 0)
        if n == 0:
            return ""  # No data at all — omit section
        return (
            "## YOUR CALIBRATION HISTORY (early data)\n"
            f"Based on {n} resolved predictions. Treat as directional only.\n"
        )

    sections = ["## YOUR CALIBRATION HISTORY"]
    sections.append(
        f"Based on {calibration['total_predictions']} resolved predictions. "
        f"Brier score: {calibration['mean_brier_score']:.4f} "
        f"(lower is better; 0=perfect, 0.25=coin flip)."
    )

    # Show only buckets with meaningful data
    miscalibrated = [
        b for b in calibration["calibration_buckets"]
        if b["predicted_count"] >= 3 and b["direction"] != "well_calibrated"
    ]

    if miscalibrated:
        sections.append("")
        sections.append("Accuracy by confidence level:")
        for b in miscalibrated:
            rate_pct = round(b["actual_hit_rate"] * 100)
            mid_pct = round(b["bucket_midpoint"] * 100)
            if b["direction"] == "overconfident":
                sections.append(
                    f"- When you said {b['bucket']}: actual hit rate was {rate_pct}% "
                    f"(you are OVERCONFIDENT by ~{mid_pct - rate_pct}pp in this range)"
                )
            else:
                sections.append(
                    f"- When you said {b['bucket']}: actual hit rate was {rate_pct}% "
                    f"(you are UNDERCONFIDENT by ~{rate_pct - mid_pct}pp in this range)"
                )

    well_calibrated = [
        b for b in calibration["calibration_buckets"]
        if b["predicted_count"] >= 3 and b["direction"] == "well_calibrated"
    ]
    if well_calibrated:
        ranges = ", ".join(b["bucket"] for b in well_calibrated)
        sections.append(f"- Well calibrated in: {ranges}")

    sections.append("")
    sections.append(
        "Adjust your confidence levels based on this history. "
        "If you have been overconfident in a range, consider lower probabilities."
    )
    sections.append("")

    return "\n".join(sections)
```

### 3.6 Per-Risk-Factor Calibration

The same algorithm runs with `scope="factor:regulatory"`, `scope="factor:vote"`, etc.
Factor-level calibration is injected only when `predicted_count >= 5` for that factor.

Added as a compact addendum to the calibration section:

```
Per-factor accuracy (where data is sufficient):
- Regulatory: Brier 0.08 (your best factor — trust your regulatory assessments)
- Vote: Brier 0.18 (your weakest — you tend to underestimate shareholder opposition)
- Financing: Brier 0.11 (well calibrated)
```

### 3.7 Calibration Improvement Tracking

Each `calibration_snapshots` row links to `prev_snapshot_id`. The `brier_delta` and
`calibration_delta` columns track whether the AI is improving over time.

Weekly cron job (added to `app/scheduler/jobs.py`):

```python
@run_job("calibration_compute", "Weekly Calibration Compute")
async def job_calibration_compute():
    """Compute calibration snapshots (Sunday 2 AM ET)."""
    from app.risk.calibration import compute_and_store_calibration
    pool = _get_pool()
    result = await compute_and_store_calibration(pool)
    return result
```

### 3.8 API Endpoint

```python
# In risk_routes.py
@router.get("/calibration")
async def get_calibration(scope: str = "global"):
    """Get latest calibration data for a scope."""
    pool = _get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT * FROM calibration_snapshots
               WHERE scope = $1 ORDER BY computed_at DESC LIMIT 1""",
            scope,
        )
        if not row:
            raise HTTPException(status_code=404, detail=f"No calibration data for scope: {scope}")
        return _row_to_dict(row)


@router.get("/calibration/trend")
async def get_calibration_trend(scope: str = "global", limit: int = 10):
    """Get calibration trend over time."""
    pool = _get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT computed_at, mean_brier_score, calibration_error,
                      total_predictions, brier_delta
               FROM calibration_snapshots
               WHERE scope = $1 ORDER BY computed_at DESC LIMIT $2""",
            scope, limit,
        )
        return [_row_to_dict(r) for r in rows]
```

### 3.9 Integration into Assessment Pipeline

In `engine.py`, `run_morning_assessment()`:

```python
# After collecting context, before calling assess_single_deal:
from .calibration import get_latest_calibration, build_calibration_context

global_cal = await get_latest_calibration(self.pool, "global")
factor_cals = {}
for factor in GRADED_FACTORS:
    factor_cals[factor] = await get_latest_calibration(
        self.pool, f"factor:{factor}"
    )

calibration_text = build_calibration_context(global_cal, factor_cals)
# Append to context dict for prompt builder
context["calibration_context"] = calibration_text
```

In `prompts.py`, `build_deal_assessment_prompt()`, add after Section 4 (Previous Assessment):

```python
# Section 4.5: Calibration feedback
cal_text = context.get("calibration_context")
if cal_text:
    sections.append(cal_text)
```

### 3.10 Minimum Viable Deployment

1. Migration `039_calibration_history.sql`
2. `app/risk/calibration.py` — compute + store functions
3. Two lines in `prompts.py` to inject calibration context
4. Five lines in `engine.py` to load calibration before assessment
5. One weekly cron job
6. Two API endpoints

Works with as few as 10 resolved predictions. Degrades gracefully to omitting the section entirely when no data exists.

---

## Phase 4: Human Review Queue

### 4.1 Purpose

Surface the highest-information-value cases for human review. Store corrections.
Feed corrections back into the next assessment cycle. Integrate with the existing
morning report pipeline so the PM sees review items in their daily email.

### 4.2 SQL Schema

```sql
-- Migration: 040_human_review.sql

-- Review queue items — one per deal-date combination requiring attention
CREATE TABLE IF NOT EXISTS human_review_items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticker              VARCHAR(10) NOT NULL,
    review_date         DATE NOT NULL DEFAULT CURRENT_DATE,

    -- Case type (why this is in the queue)
    case_type           VARCHAR(30) NOT NULL,
    -- Values: 'three_way_disagreement', 'significant_ai_change',
    --         'poor_prediction_score', 'new_milestone'

    -- Priority score (higher = review first)
    priority_score      NUMERIC(6,2) NOT NULL DEFAULT 50.0,

    -- Context snapshot (what the reviewer needs to see)
    context             JSONB NOT NULL DEFAULT '{}',
    -- Contains: {
    --   "ai_grade": ..., "sheet_grade": ..., "options_implied": ...,
    --   "ai_prob": ..., "sheet_prob": ...,
    --   "change_from": ..., "change_to": ...,
    --   "prediction_score": ..., "milestone_type": ...
    -- }

    -- Source references
    assessment_id       UUID REFERENCES deal_risk_assessments(id),
    prediction_id       UUID,  -- FK to prediction_registry when Phase 2 exists

    -- Status
    status              VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- Values: 'pending', 'in_review', 'resolved', 'dismissed'
    assigned_to         VARCHAR(100),
    resolved_at         TIMESTAMPTZ,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_review_item UNIQUE (ticker, review_date, case_type)
);

CREATE INDEX IF NOT EXISTS idx_review_status
    ON human_review_items (status, priority_score DESC)
    WHERE status IN ('pending', 'in_review');

CREATE INDEX IF NOT EXISTS idx_review_date
    ON human_review_items (review_date DESC);

CREATE INDEX IF NOT EXISTS idx_review_ticker
    ON human_review_items (ticker, review_date DESC);


-- Human annotations — corrections and judgments from the PM
CREATE TABLE IF NOT EXISTS human_annotations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    review_item_id      UUID NOT NULL REFERENCES human_review_items(id),
    ticker              VARCHAR(10) NOT NULL,
    annotation_date     DATE NOT NULL DEFAULT CURRENT_DATE,

    -- Which signal was right?
    correct_signal      VARCHAR(20),
    -- Values: 'ai', 'sheet', 'options', 'none', 'partial'

    -- Grade corrections (NULL = no correction needed)
    corrected_grades    JSONB,
    -- {
    --   "vote": {"corrected_grade": "Medium", "reasoning": "..."},
    --   "regulatory": {"corrected_grade": "High", "reasoning": "..."}
    -- }

    -- Probability correction
    corrected_probability NUMERIC(6,4),
    probability_reasoning TEXT,

    -- Free-form reasoning the AI missed
    missed_reasoning    TEXT,

    -- Categorization of the error
    error_type          VARCHAR(30),
    -- Values: 'overconfident', 'underconfident', 'wrong_factor',
    --         'stale_data', 'missing_context', 'correct_no_change'

    -- How impactful was this error?
    impact              VARCHAR(10),
    -- Values: 'high', 'medium', 'low', 'none'

    annotated_by        VARCHAR(100),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_annotations_ticker
    ON human_annotations (ticker, annotation_date DESC);

CREATE INDEX IF NOT EXISTS idx_annotations_error_type
    ON human_annotations (error_type);
```

### 4.3 Prioritization Algorithm (Information-Value Scoring)

```python
# File: app/risk/review_queue.py

async def generate_review_items(pool, run_id: uuid.UUID) -> list[dict]:
    """Generate review queue items after a morning assessment run.

    Called at the end of run_morning_assessment() or by the report compile job.
    Returns list of created review items.
    """
    items = []

    async with pool.acquire() as conn:
        assessments = await conn.fetch(
            "SELECT * FROM deal_risk_assessments WHERE run_id = $1",
            run_id,
        )

        for assessment in assessments:
            a = dict(assessment)
            ticker = a["ticker"]

            # Case 1: Three-way disagreement
            # AI, sheet, and options-implied diverge by >10pp on probability
            # or >1 grade level on any factor
            priority = await _score_three_way_disagreement(conn, a)
            if priority > 0:
                items.append(await _create_review_item(
                    conn, ticker, "three_way_disagreement", priority, a,
                ))

            # Case 2: Significant AI change (>10pp probability or grade level change)
            priority = _score_significant_change(a)
            if priority > 0:
                items.append(await _create_review_item(
                    conn, ticker, "significant_ai_change", priority, a,
                ))

            # Case 3: Poor prediction score (from previous predictions)
            priority = await _score_poor_prediction(conn, ticker)
            if priority > 0:
                items.append(await _create_review_item(
                    conn, ticker, "poor_prediction_score", priority, a,
                ))

            # Case 4: New milestone event
            priority = await _score_new_milestone(conn, ticker)
            if priority > 0:
                items.append(await _create_review_item(
                    conn, ticker, "new_milestone", priority, a,
                ))

    return [i for i in items if i is not None]


async def _score_three_way_disagreement(conn, assessment: dict) -> float:
    """Score based on divergence between AI, sheet, and options-implied signals.

    Returns priority score (0 = no review needed, 100 = urgent).
    """
    score = 0.0

    # Probability divergence: AI vs sheet
    ai_prob = assessment.get("our_prob_success")
    sheet_prob = assessment.get("sheet_prob_success")
    if ai_prob is not None and sheet_prob is not None:
        gap = abs(float(ai_prob) - float(sheet_prob))
        if gap > 0.10:  # >10pp
            score += 30 + (gap - 0.10) * 200  # Scale up for larger gaps

    # Grade mismatches
    grade_map = {
        ("vote_grade", "sheet_vote_risk"),
        ("financing_grade", "sheet_finance_risk"),
        ("legal_grade", "sheet_legal_risk"),
    }
    for ai_key, sheet_key in grade_map:
        ai_grade = assessment.get(ai_key)
        sheet_grade = assessment.get(sheet_key)
        if ai_grade and sheet_grade:
            from app.risk.engine import extract_grade, GRADE_ORDER
            sheet_normalized = extract_grade(sheet_grade)
            ai_order = GRADE_ORDER.get(ai_grade, 0)
            sheet_order = GRADE_ORDER.get(sheet_normalized, 0)
            if abs(ai_order - sheet_order) >= 2:  # Two grade levels apart
                score += 25

    # Options-implied divergence (when Phase 1 data is available)
    # Check canonical_risk_grades or options data for a third signal
    options_prob = await conn.fetchval("""
        SELECT options_implied_prob FROM deal_estimate_snapshots
        WHERE ticker = $1 AND snapshot_date = CURRENT_DATE
    """, assessment["ticker"])
    if options_prob is not None and ai_prob is not None:
        options_gap = abs(float(options_prob) - float(ai_prob))
        if options_gap > 0.10:
            score += 20

    return score


def _score_significant_change(assessment: dict) -> float:
    """Score based on magnitude of AI assessment change from yesterday."""
    ai_response = assessment.get("ai_response")
    if isinstance(ai_response, str):
        try:
            ai_response = __import__("json").loads(ai_response)
        except (TypeError, ValueError):
            return 0.0

    if not isinstance(ai_response, dict):
        return 0.0

    changes = ai_response.get("assessment_changes", [])
    if not changes:
        return 0.0

    score = 0.0
    for change in changes:
        if change.get("direction") == "worsened":
            score += 20
        else:
            score += 10
        # Bonus for grade-level changes (vs minor score tweaks)
        if change.get("factor") in ("vote", "financing", "legal", "regulatory", "mac"):
            score += 15

    return min(score, 80)  # Cap at 80


async def _score_poor_prediction(conn, ticker: str) -> float:
    """Score based on recent prediction accuracy for this deal."""
    # Check if any recent prediction scored poorly (Brier > 0.20)
    row = await conn.fetchrow("""
        SELECT brier_score FROM prediction_scores ps
        JOIN prediction_registry pr ON ps.prediction_id = pr.id
        WHERE pr.ticker = $1
        ORDER BY ps.scored_at DESC LIMIT 1
    """, ticker)

    if not row or row["brier_score"] is None:
        return 0.0

    brier = float(row["brier_score"])
    if brier > 0.20:
        return 40 + (brier - 0.20) * 200  # Brier 0.30 -> priority 60
    return 0.0


async def _score_new_milestone(conn, ticker: str) -> float:
    """Score based on recent milestone completions/failures."""
    milestones = await conn.fetch("""
        SELECT milestone_type, status, updated_at
        FROM canonical_deal_milestones
        WHERE ticker = $1
          AND updated_at > NOW() - INTERVAL '24 hours'
          AND status IN ('completed', 'failed')
    """, ticker)

    if not milestones:
        return 0.0

    score = 0.0
    high_impact = {"shareholder_vote", "hsr_clearance", "hsr_second_request",
                   "eu_phase2", "cfius_clearance", "closing", "termination"}
    for m in milestones:
        if m["milestone_type"] in high_impact:
            score += 35
        else:
            score += 15

    return min(score, 70)
```

### 4.4 API Endpoints

```python
# In risk_routes.py

# ---------------------------------------------------------------------------
# GET /risk/review-queue
# ---------------------------------------------------------------------------
@router.get("/review-queue")
async def get_review_queue(
    status: Optional[str] = Query("pending", description="Filter by status"),
    limit: int = Query(50, le=200),
):
    """Get prioritized review queue."""
    pool = _get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT ri.*, a.deal_summary, a.our_prob_success,
                   a.vote_grade, a.financing_grade, a.legal_grade,
                   a.regulatory_grade, a.mac_grade
            FROM human_review_items ri
            LEFT JOIN deal_risk_assessments a ON a.id = ri.assessment_id
            WHERE ri.status = $1
            ORDER BY ri.priority_score DESC, ri.created_at ASC
            LIMIT $2
        """, status, limit)
        return [_row_to_dict(r) for r in rows]


# ---------------------------------------------------------------------------
# POST /risk/review-queue/{item_id}/annotate
# ---------------------------------------------------------------------------
class AnnotationRequest(BaseModel):
    correct_signal: Optional[str] = None
    corrected_grades: Optional[dict] = None
    corrected_probability: Optional[float] = None
    probability_reasoning: Optional[str] = None
    missed_reasoning: Optional[str] = None
    error_type: Optional[str] = None
    impact: Optional[str] = None

@router.post("/review-queue/{item_id}/annotate")
async def annotate_review_item(item_id: str, body: AnnotationRequest):
    """Submit human annotation for a review item."""
    pool = _get_pool()
    item_uuid = uuid.UUID(item_id)

    async with pool.acquire() as conn:
        # Verify item exists
        item = await conn.fetchrow(
            "SELECT * FROM human_review_items WHERE id = $1", item_uuid
        )
        if not item:
            raise HTTPException(status_code=404, detail="Review item not found")

        # Insert annotation
        await conn.execute("""
            INSERT INTO human_annotations
            (review_item_id, ticker, correct_signal, corrected_grades,
             corrected_probability, probability_reasoning, missed_reasoning,
             error_type, impact)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        """,
            item_uuid, item["ticker"],
            body.correct_signal,
            json.dumps(body.corrected_grades) if body.corrected_grades else None,
            body.corrected_probability,
            body.probability_reasoning,
            body.missed_reasoning,
            body.error_type, body.impact,
        )

        # Mark item resolved
        await conn.execute("""
            UPDATE human_review_items
            SET status = 'resolved', resolved_at = NOW(), updated_at = NOW()
            WHERE id = $1
        """, item_uuid)

    return {"status": "annotated", "item_id": item_id}


# ---------------------------------------------------------------------------
# POST /risk/review-queue/bulk-dismiss
# ---------------------------------------------------------------------------
class BulkDismissRequest(BaseModel):
    item_ids: list[str]

@router.post("/review-queue/bulk-dismiss")
async def bulk_dismiss(body: BulkDismissRequest):
    """Dismiss multiple review items at once."""
    pool = _get_pool()
    uuids = [uuid.UUID(i) for i in body.item_ids]
    async with pool.acquire() as conn:
        count = await conn.fetchval("""
            UPDATE human_review_items
            SET status = 'dismissed', resolved_at = NOW(), updated_at = NOW()
            WHERE id = ANY($1) AND status IN ('pending', 'in_review')
            RETURNING count(*)
        """, uuids)
    return {"dismissed": count}


# ---------------------------------------------------------------------------
# GET /risk/review-queue/stats
# ---------------------------------------------------------------------------
@router.get("/review-queue/stats")
async def review_queue_stats():
    """Queue statistics: pending count, resolution rate, common error types."""
    pool = _get_pool()
    async with pool.acquire() as conn:
        pending = await conn.fetchval(
            "SELECT count(*) FROM human_review_items WHERE status = 'pending'"
        )
        resolved_7d = await conn.fetchval("""
            SELECT count(*) FROM human_review_items
            WHERE status = 'resolved' AND resolved_at > NOW() - INTERVAL '7 days'
        """)
        error_types = await conn.fetch("""
            SELECT error_type, count(*) as cnt
            FROM human_annotations
            WHERE error_type IS NOT NULL
            GROUP BY error_type ORDER BY cnt DESC
        """)
        return {
            "pending": pending,
            "resolved_last_7d": resolved_7d,
            "error_type_distribution": [dict(r) for r in error_types],
        }
```

### 4.5 Corrections Feedback into Next Assessment Cycle

Human corrections are injected into the prompt as a new section, similar to calibration.

```python
# In prompts.py, build_deal_assessment_prompt():

def build_human_corrections_context(corrections: list[dict]) -> str:
    """Build prompt section showing recent human corrections for this deal."""
    if not corrections:
        return ""

    sections = ["## HUMAN CORRECTIONS (from portfolio manager review)"]
    for c in corrections[-3:]:  # Last 3 corrections only
        date_str = c.get("annotation_date", "?")
        sections.append(f"- [{date_str}] Correct signal: {c.get('correct_signal', '?')}")
        if c.get("corrected_grades"):
            for factor, data in c["corrected_grades"].items():
                sections.append(
                    f"  {factor} corrected to {data.get('corrected_grade')}: "
                    f"{data.get('reasoning', '')}"
                )
        if c.get("missed_reasoning"):
            sections.append(f"  Reasoning you missed: {c['missed_reasoning']}")
        if c.get("error_type"):
            sections.append(f"  Error pattern: {c['error_type']}")
    sections.append("")
    sections.append(
        "Incorporate these corrections. Avoid repeating the same error patterns."
    )
    sections.append("")
    return "\n".join(sections)
```

Loading corrections in `engine.py`:

```python
# In collect_deal_context(), add after existing queries:

# 9. Recent human corrections
try:
    corrections = await conn.fetch("""
        SELECT ha.* FROM human_annotations ha
        JOIN human_review_items hri ON hri.id = ha.review_item_id
        WHERE hri.ticker = $1
          AND ha.annotation_date > CURRENT_DATE - INTERVAL '30 days'
        ORDER BY ha.annotation_date DESC LIMIT 3
    """, ticker)
    if corrections:
        context["human_corrections"] = [dict(c) for c in corrections]
except Exception:
    pass  # Table may not exist yet
```

### 4.6 Integration with Morning Report

Review items are included in the morning report as a new section between
"Discrepancies" and "Deal-by-Deal Summary":

```python
# In report_formatter.py, format_morning_report():

# After discrepancies section:
if review_items:
    parts.append(_section_header(
        f"REVIEW QUEUE ({len(review_items)} items)"
    ))
    parts.append('<div style="padding:8px 20px 12px;">')
    for item in review_items[:10]:  # Top 10 by priority
        case_label = {
            "three_way_disagreement": "3-Way Divergence",
            "significant_ai_change": "AI Grade Change",
            "poor_prediction_score": "Poor Prediction",
            "new_milestone": "New Milestone",
        }.get(item.get("case_type"), item.get("case_type", "?"))
        parts.append(
            f'<p style="margin:4px 0;font-size:13px;">'
            f'<strong>{item.get("ticker","?")}</strong> — {case_label} '
            f'(priority: {item.get("priority_score", 0):.0f})</p>'
        )
    parts.append("</div>")
```

Review queue generation is called from `job_morning_report_compile()`:

```python
# In jobs.py, job_morning_report_compile():
from app.risk.review_queue import generate_review_items

# After getting assessments:
review_items = await generate_review_items(pool, run["id"])
```

### 4.7 The Four Case Types

| Case Type | Trigger | Priority Weight | Information Value |
|-----------|---------|-----------------|-------------------|
| `three_way_disagreement` | AI, sheet, options diverge >10pp | 30-80 | Highest — one signal is wrong, which? |
| `significant_ai_change` | Grade level change or >10pp probability shift | 20-80 | High — did the AI overreact or catch something real? |
| `poor_prediction_score` | Recent Brier > 0.20 for this deal | 40-80 | High — past predictions were wrong, need recalibration |
| `new_milestone` | Milestone completed/failed in last 24h | 15-70 | Medium — verify AI incorporated the milestone correctly |

### 4.8 Minimum Viable Deployment

1. Migration `040_human_review.sql`
2. `app/risk/review_queue.py` — generation + scoring
3. 4 API endpoints in `risk_routes.py`
4. Hook into `job_morning_report_compile` (one function call)
5. Optional: corrections feedback section in prompt

The review queue works immediately — it leverages existing `discrepancies`,
`needs_attention`, and `assessment_changes` data. No Phase 2 dependency required
for the basic three-way disagreement and significant AI change cases. The
`poor_prediction_score` case requires Phase 2's `prediction_scores` table.

---

## Phase 5: Signal Weighting

### 5.1 Purpose

Track which signal source (AI, sheet analyst, options market) is most accurate
for each risk factor, and use historical accuracy to weight their contributions
into a blended probability estimate.

### 5.2 SQL Schema

```sql
-- Migration: 041_signal_weighting.sql

-- Per-signal accuracy tracking by risk factor
CREATE TABLE IF NOT EXISTS signal_accuracy (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Scope
    risk_factor         VARCHAR(30) NOT NULL,
    -- Values: 'overall', 'vote', 'financing', 'legal', 'regulatory',
    --         'mac', 'probability', 'break_price'
    signal_source       VARCHAR(20) NOT NULL,
    -- Values: 'ai', 'sheet', 'options'

    -- Accuracy metrics
    sample_size         INTEGER NOT NULL DEFAULT 0,
    mean_brier_score    NUMERIC(8,6),
    hit_rate            NUMERIC(6,4),  -- % of correct directional calls
    calibration_error   NUMERIC(8,6),
    avg_confidence      NUMERIC(6,4),  -- average confidence when available

    -- Derived weight (0.0 to 1.0, sums to 1.0 across signals for a factor)
    computed_weight     NUMERIC(6,4),

    -- Metadata
    evaluation_window   INTEGER DEFAULT 90,  -- days of data used
    is_statistically_significant BOOLEAN DEFAULT FALSE,

    CONSTRAINT uq_signal_accuracy UNIQUE (computed_at, risk_factor, signal_source)
);

CREATE INDEX IF NOT EXISTS idx_signal_accuracy_factor
    ON signal_accuracy (risk_factor, computed_at DESC);


-- Blended probability estimates (computed daily)
CREATE TABLE IF NOT EXISTS blended_estimates (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticker              VARCHAR(10) NOT NULL,
    estimate_date       DATE NOT NULL DEFAULT CURRENT_DATE,

    -- Individual signal probabilities
    ai_probability      NUMERIC(6,4),
    sheet_probability   NUMERIC(6,4),
    options_probability NUMERIC(6,4),

    -- Weights used
    ai_weight           NUMERIC(6,4),
    sheet_weight        NUMERIC(6,4),
    options_weight      NUMERIC(6,4),

    -- Blended result
    blended_probability NUMERIC(6,4),
    blended_confidence  NUMERIC(6,4),

    -- Disagreement metrics
    signal_dispersion   NUMERIC(6,4),  -- std dev across signals
    max_signal_gap      NUMERIC(6,4),  -- max pairwise difference

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_blended_estimate UNIQUE (ticker, estimate_date)
);

CREATE INDEX IF NOT EXISTS idx_blended_ticker
    ON blended_estimates (ticker, estimate_date DESC);
```

### 5.3 Signal Accuracy Tracking

```python
# File: app/risk/signal_weighting.py

async def compute_signal_accuracy(pool, risk_factor: str = "overall") -> dict:
    """Compute accuracy for each signal source on a given risk factor.

    Returns dict keyed by signal_source with accuracy metrics.
    """
    async with pool.acquire() as conn:
        # Fetch resolved predictions with their signal sources
        # For 'overall' scope, compare probability_of_success estimates
        if risk_factor == "overall" or risk_factor == "probability":
            rows = await conn.fetch("""
                SELECT
                    des.ai_prob_success,
                    des.sheet_prob_success,
                    des.options_implied_prob,  -- from Phase 1 enrichment
                    CASE WHEN do.outcome IN ('closed_at_deal', 'closed_higher')
                         THEN 1.0 ELSE 0.0 END AS actual_outcome
                FROM deal_estimate_snapshots des
                JOIN deal_outcomes do ON do.ticker = des.ticker
                WHERE des.ai_prob_success IS NOT NULL
                ORDER BY des.snapshot_date
            """)
        else:
            # For specific factors, compare grade predictions
            # (convert grades to numeric: Low=0.2, Medium=0.5, High=0.8)
            rows = await conn.fetch("""
                SELECT
                    des.ai_{factor}_grade AS ai_grade,
                    des.sheet_{factor}_risk AS sheet_grade,
                    do.primary_risk_factor,
                    do.outcome
                FROM deal_estimate_snapshots des
                JOIN deal_outcomes do ON do.ticker = des.ticker
                WHERE des.ticker IS NOT NULL
            """.format(factor=risk_factor))

        results = {}
        for source in ("ai", "sheet", "options"):
            predictions = []
            outcomes = []

            for r in rows:
                if risk_factor in ("overall", "probability"):
                    prob_key = f"{source}_prob_success"
                    prob = r.get(prob_key) if source != "options" else r.get("options_implied_prob")
                    if prob is not None:
                        predictions.append(float(prob))
                        outcomes.append(float(r["actual_outcome"]))

            if len(predictions) < 3:
                results[source] = {
                    "sample_size": len(predictions),
                    "mean_brier_score": None,
                    "is_statistically_significant": False,
                }
                continue

            # Brier score
            brier_scores = [(p - o) ** 2 for p, o in zip(predictions, outcomes)]
            mean_brier = sum(brier_scores) / len(brier_scores)

            # Hit rate (directional: >0.5 predicted, outcome=1)
            correct = sum(
                1 for p, o in zip(predictions, outcomes)
                if (p > 0.5 and o == 1.0) or (p <= 0.5 and o == 0.0)
            )
            hit_rate = correct / len(predictions)

            results[source] = {
                "sample_size": len(predictions),
                "mean_brier_score": round(mean_brier, 6),
                "hit_rate": round(hit_rate, 4),
                "avg_confidence": round(sum(predictions) / len(predictions), 4),
                "is_statistically_significant": len(predictions) >= 15,
            }

        return results
```

### 5.4 Dynamic Ensemble Weighting Algorithm

Uses inverse-Brier weighting with Bayesian shrinkage toward equal weights when
sample sizes are small.

```python
def compute_ensemble_weights(
    accuracy: dict[str, dict],
    min_sample: int = 5,
    shrinkage_n: int = 20,
) -> dict[str, float]:
    """Compute ensemble weights from signal accuracy data.

    Uses inverse-Brier weighting with Bayesian shrinkage:
    - With N=0 predictions: equal weights (1/3 each)
    - With N=shrinkage_n predictions: fully data-driven weights
    - In between: linear interpolation

    Args:
        accuracy: dict from compute_signal_accuracy()
        min_sample: minimum predictions before a signal gets any weight
        shrinkage_n: predictions needed for full data-driven weighting
    """
    equal_weight = 1.0 / 3  # Prior: equal weights

    eligible = {}
    for source, data in accuracy.items():
        n = data.get("sample_size", 0)
        brier = data.get("mean_brier_score")
        if n >= min_sample and brier is not None and brier < 0.50:
            eligible[source] = data

    if not eligible:
        return {"ai": equal_weight, "sheet": equal_weight, "options": equal_weight}

    # Inverse-Brier weights (lower Brier = higher weight)
    # Add small epsilon to avoid division by zero
    epsilon = 0.001
    inv_briers = {
        source: 1.0 / (data["mean_brier_score"] + epsilon)
        for source, data in eligible.items()
    }
    total_inv = sum(inv_briers.values())
    data_weights = {
        source: inv_b / total_inv
        for source, inv_b in inv_briers.items()
    }

    # Bayesian shrinkage: blend data_weights with equal_weight
    # Weight of data evidence = min(min_n / shrinkage_n, 1.0)
    min_n = min(d["sample_size"] for d in eligible.values())
    data_confidence = min(min_n / shrinkage_n, 1.0)

    final = {}
    all_sources = {"ai", "sheet", "options"}
    for source in all_sources:
        data_w = data_weights.get(source, 0.0)
        final[source] = data_confidence * data_w + (1 - data_confidence) * equal_weight

    # Normalize to sum to 1.0
    total = sum(final.values())
    return {s: round(w / total, 4) for s, w in final.items()}
```

### 5.5 Handling Small Sample Sizes

| Sample Size | Behavior |
|-------------|----------|
| 0-4 predictions | Signal excluded from weighting; equal weights for remaining |
| 5-19 predictions | Bayesian shrinkage blends data with equal-weight prior |
| 20+ predictions | Fully data-driven weights |
| Factor-specific N < 5 | Falls back to overall accuracy for that signal |

The blended estimate always includes a `"confidence_note"` field explaining
the weighting basis:

```python
def confidence_note(weights: dict, accuracy: dict) -> str:
    min_n = min(
        (accuracy.get(s, {}).get("sample_size", 0) for s in weights),
        default=0,
    )
    if min_n < 5:
        return "Insufficient data for signal weighting — using equal weights"
    if min_n < 20:
        return f"Limited data (N={min_n}) — weights partially shrunk toward equal"
    return f"Data-driven weights based on {min_n}+ resolved predictions"
```

### 5.6 Prompt Text for Signal Weights

Added to the prompt when sufficient data exists:

```python
def build_signal_weights_context(weights: dict, accuracy: dict) -> str:
    """Build prompt section showing signal accuracy and weights."""
    min_n = min(
        (accuracy.get(s, {}).get("sample_size", 0) for s in weights),
        default=0,
    )
    if min_n < 5:
        return ""  # Not enough data to show

    sections = ["## SIGNAL ACCURACY & WEIGHTS"]
    sections.append(
        "Historical accuracy of each signal source "
        "(lower Brier score = more accurate):"
    )

    for source in ("ai", "sheet", "options"):
        data = accuracy.get(source, {})
        brier = data.get("mean_brier_score")
        n = data.get("sample_size", 0)
        weight = weights.get(source, 0)
        if brier is not None:
            sections.append(
                f"- {source.upper()}: Brier {brier:.4f} "
                f"(N={n}, weight={weight:.1%})"
            )
        else:
            sections.append(f"- {source.upper()}: insufficient data (N={n})")

    # Per-factor accuracy hints (if available)
    sections.append("")
    sections.append("Use these weights to calibrate your confidence:")
    if weights.get("options", 0) > 0.40:
        sections.append(
            "- Options market has been the most accurate signal — "
            "give extra weight to spread behavior."
        )
    if weights.get("sheet", 0) > 0.40:
        sections.append(
            "- Sheet analyst has been the most accurate — "
            "defer to production grades unless you have strong new evidence."
        )
    sections.append("")

    return "\n".join(sections)
```

### 5.7 Blended Probability Computation

```python
async def compute_blended_estimate(
    pool,
    ticker: str,
    ai_prob: float,
    sheet_prob: float | None,
    options_prob: float | None,
) -> dict:
    """Compute weighted blended probability for a deal.

    Returns dict with blended_probability, weights, confidence, dispersion.
    """
    # Get current weights
    accuracy = await compute_signal_accuracy(pool, "probability")
    weights = compute_ensemble_weights(accuracy)

    # Build available signals
    signals = {"ai": ai_prob}
    if sheet_prob is not None:
        signals["sheet"] = sheet_prob
    if options_prob is not None:
        signals["options"] = options_prob

    # Re-normalize weights for available signals
    available_weight = sum(weights[s] for s in signals)
    norm_weights = {
        s: weights[s] / available_weight if available_weight > 0 else 1.0 / len(signals)
        for s in signals
    }

    # Weighted average
    blended = sum(norm_weights[s] * p for s, p in signals.items())

    # Dispersion: standard deviation across signals
    mean_p = sum(signals.values()) / len(signals)
    dispersion = (sum((p - mean_p) ** 2 for p in signals.values()) / len(signals)) ** 0.5

    # Max gap
    probs = list(signals.values())
    max_gap = max(probs) - min(probs) if len(probs) > 1 else 0

    return {
        "blended_probability": round(blended, 4),
        "blended_confidence": round(1.0 - dispersion, 4),
        "ai_probability": ai_prob,
        "sheet_probability": sheet_prob,
        "options_probability": options_prob,
        "ai_weight": round(norm_weights.get("ai", 0), 4),
        "sheet_weight": round(norm_weights.get("sheet", 0), 4),
        "options_weight": round(norm_weights.get("options", 0), 4),
        "signal_dispersion": round(dispersion, 4),
        "max_signal_gap": round(max_gap, 4),
        "note": confidence_note(weights, accuracy),
    }
```

### 5.8 When This Becomes Statistically Meaningful

| Milestone | N Required | Expected Timeline |
|-----------|------------|-------------------|
| First weights computed | 5 resolved predictions | ~2-3 months |
| Meaningful per-source comparison | 15 per source | ~4-6 months |
| Per-factor weights | 10 per factor per source | ~6-12 months |
| Statistical confidence (p<0.05) | 30+ per source | ~8-12 months |

Until statistical significance is reached, the system uses Bayesian shrinkage
toward equal weights, which means:
- At N=5: weights are ~90% equal, ~10% data-driven
- At N=10: weights are ~50% equal, ~50% data-driven
- At N=20+: weights are fully data-driven

This means the system is "useful" immediately (it still computes blended estimates)
but becomes increasingly data-driven as evidence accumulates.

### 5.9 API Endpoints

```python
# In risk_routes.py

@router.get("/signal-weights")
async def get_signal_weights(risk_factor: str = "overall"):
    """Get current signal accuracy and weights."""
    pool = _get_pool()
    from app.risk.signal_weighting import compute_signal_accuracy, compute_ensemble_weights
    accuracy = await compute_signal_accuracy(pool, risk_factor)
    weights = compute_ensemble_weights(accuracy)
    return {
        "risk_factor": risk_factor,
        "accuracy": accuracy,
        "weights": weights,
    }

@router.get("/blended-estimates/{ticker}")
async def get_blended_estimate(ticker: str):
    """Get latest blended probability estimate for a deal."""
    pool = _get_pool()
    ticker = ticker.upper()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT * FROM blended_estimates
               WHERE ticker = $1 ORDER BY estimate_date DESC LIMIT 1""",
            ticker,
        )
        if not row:
            raise HTTPException(status_code=404, detail="No blended estimate found")
        return _row_to_dict(row)
```

### 5.10 Minimum Viable Deployment

1. Migration `041_signal_weighting.sql`
2. `app/risk/signal_weighting.py` — accuracy computation + weighting
3. 2 API endpoints
4. Weekly cron job to compute and store signal accuracy
5. Prompt injection in `prompts.py` (optional, only when data exists)

The system starts with equal weights and progressively learns. It provides value
from day one as a "blended estimate" view, even before weights are meaningful.

---

## Cross-Phase Data Flow

```
Morning Assessment Run
    |
    +---> [Phase 2] Store predictions in prediction_registry
    |
    +---> [Phase 3] Load calibration_snapshots -> inject into prompt
    |
    +---> [Phase 4] Generate human_review_items from assessment results
    |         |
    |         +---> Load human_annotations -> inject corrections into prompt
    |
    +---> [Phase 5] Load signal_accuracy -> compute blended_estimates
    |         |
    |         +---> Inject signal weights into prompt
    |
    +---> Store assessment in deal_risk_assessments
    |
    +---> [Phase 4] Include review queue in morning report
```

## Migration Safety

All three migrations are additive (new tables only, no ALTER on existing tables).
Safe to apply in any order. Recommended order: 039, 040, 041.

Each phase checks for its required tables via try/except on queries, so:
- Phase 3 runs fine without Phase 2 data (calibration section is just empty)
- Phase 4 runs fine without Phase 2 (poor_prediction_score case is skipped)
- Phase 5 runs fine without Phase 1 options data (options signal gets zero weight)

## File Summary

| Phase | New Files | Modified Files |
|-------|-----------|----------------|
| 3 | `migrations/039_calibration_history.sql`, `app/risk/calibration.py` | `app/risk/prompts.py`, `app/risk/engine.py`, `app/api/risk_routes.py`, `app/scheduler/jobs.py` |
| 4 | `migrations/040_human_review.sql`, `app/risk/review_queue.py` | `app/risk/prompts.py`, `app/risk/engine.py`, `app/api/risk_routes.py`, `app/risk/report_formatter.py`, `app/scheduler/jobs.py` |
| 5 | `migrations/041_signal_weighting.sql`, `app/risk/signal_weighting.py` | `app/risk/prompts.py`, `app/risk/engine.py`, `app/api/risk_routes.py`, `app/scheduler/jobs.py` |

## Data Requirements Summary

| Phase | Minimum Data | Full Effectiveness |
|-------|-------------|-------------------|
| Phase 3 (Calibration) | 10 resolved predictions | 30+ for per-factor curves |
| Phase 4 (Review Queue) | 0 (works immediately) | Better prioritization with Phase 2+3 data |
| Phase 5 (Weighting) | 5 per signal source | 20+ per source for full data-driven weights |
