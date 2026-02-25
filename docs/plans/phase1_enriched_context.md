# Phase 1: Enriched Context — Implementation Plan

**Goal**: Inject options-implied probability and milestone timeline data into the risk
assessment prompt so the AI can triangulate three probability signals (sheet, AI-previous,
market-implied) and reference deal milestone status when grading risk factors.

**Estimated effort**: ~200 lines of Python across 4 files.
**Token cost increase**: +150-250 tokens per full assessment, +80-120 per delta.

---

## 1. Data Flow Overview

```
DB tables                        collect_deal_context()          prompt builders            AI
-----------                      ----------------------          ---------------            --
deal_options_snapshots  ──query──> context["options_snapshot"]  ──> Section 11 in prompt  ──> triangulate
canonical_deal_milestones ─query─> context["milestones"]        ──> Section 12 in prompt  ──> timeline-aware grades
```

**Key principle**: Raw DB rows are queried in `collect_deal_context()`, distilled to
compact dicts, and formatted into terse prompt sections. The AI never sees raw option
chain data — only a single implied-probability number and a few IV/volume metrics.

---

## 2. File Changes

### 2.1 `app/risk/engine.py` — `collect_deal_context()` (lines 186-296)

Add two new data-fetch blocks inside the existing `async with self.pool.acquire() as conn:` block, after block 8 (deal attributes) and before the `live_price` section.

#### New block 9: Options snapshot

```python
# 9. Latest options snapshot
try:
    options_snap = await conn.fetchrow(
        """SELECT snapshot_date, atm_iv, atm_iv_30d_avg, iv_rank_pct,
                  put_call_ratio, total_call_volume, total_put_volume,
                  unusual_volume, unusual_detail, has_options
           FROM deal_options_snapshots
           WHERE ticker = $1
           ORDER BY snapshot_date DESC LIMIT 1""",
        ticker,
    )
    if options_snap and options_snap["has_options"]:
        snap = dict(options_snap)
        # Compute spread-implied probability:
        # P(completion) ~ 1 - (spread / deal_price)
        # where spread = deal_price - current_price
        deal_px = float(row["deal_price"]) if row and row.get("deal_price") else None
        cur_px = float(row["current_price"]) if row and row.get("current_price") else None
        implied_prob = None
        if deal_px and cur_px and deal_px > 0:
            spread = deal_px - cur_px
            if spread >= 0:
                implied_prob = round((1.0 - spread / deal_px) * 100, 1)
            else:
                # Trading above deal price — implies >100% certainty or competing bid
                implied_prob = 100.0
        snap["spread_implied_prob"] = implied_prob
        context["options_snapshot"] = snap
except Exception:
    pass  # Table may not exist yet
```

**Signature**: No new function — inline block in `collect_deal_context`.

**Why spread-implied, not Black-Scholes**: The spread-based calculation
(`1 - spread/deal_price`) is model-free, requires no scipy, works even when
IV data is missing, and is the standard merger-arb probability metric.
ATM IV is passed through for color but the headline number is spread-implied.

#### New block 10: Milestone timeline

```python
# 10. Milestone timeline
try:
    milestones = await conn.fetch(
        """SELECT milestone_type, milestone_date, expected_date,
                  status, source, risk_factor_affected, notes
           FROM canonical_deal_milestones
           WHERE ticker = $1
           ORDER BY COALESCE(milestone_date, expected_date) ASC NULLS LAST""",
        ticker,
    )
    if milestones:
        context["milestones"] = [dict(m) for m in milestones]
except Exception:
    pass  # Table may not exist yet
```

---

### 2.2 `app/risk/prompts.py` — Prompt additions

#### 2.2.1 System prompt addition (`RISK_ASSESSMENT_SYSTEM_PROMPT`)

Append the following block after the existing "## Grade Comparison (CRITICAL)" section
(after line 59, before "## Additional Assessments" at line 63):

```
## Signal Triangulation

When options-implied probability and previous AI probability are provided alongside
the Google Sheet probability, compare all three signals:
- **Spread-implied**: Derived from market prices (current_price / deal_price). Most
  responsive to new information but noisy intraday.
- **Sheet**: The production team's fundamental estimate. Updated less frequently.
- **Previous AI**: Your prior assessment. Should change only on new evidence.

Flag significant divergences (>10pp between any two signals) in your probability_of_success
factors list. A wide three-way spread suggests high uncertainty or stale data somewhere.

## Milestone Timeline

When milestone data is provided, use it to:
- Anchor your timing score to actual regulatory/vote dates, not general heuristics
- Identify overdue milestones (status=pending past expected_date) as risk escalators
- Note completed milestones as de-risking events
```

#### 2.2.2 `build_deal_assessment_prompt()` — Two new sections

After Section 10 (Live Market Data, line 387), add:

```python
# Section 11: Options-implied probability & market signals
options = context.get("options_snapshot")
if options:
    sections.append("## Options Market Signals")
    ip = options.get("spread_implied_prob")
    sections.append(f"Spread-Implied Completion Prob: {ip}%" if ip is not None else "Spread-Implied Completion Prob: N/A")
    if options.get("atm_iv") is not None:
        sections.append(f"ATM IV: {options['atm_iv']:.1%} (30d avg: {options.get('atm_iv_30d_avg', 'N/A')}, rank: {options.get('iv_rank_pct', 'N/A')}%)")
    pcr = options.get("put_call_ratio")
    if pcr is not None:
        sections.append(f"Put/Call Ratio: {pcr:.2f}")
    cv = options.get("total_call_volume")
    pv = options.get("total_put_volume")
    if cv is not None and pv is not None:
        sections.append(f"Volume: {cv} calls / {pv} puts")
    if options.get("unusual_volume"):
        sections.append(f"UNUSUAL VOLUME: {options.get('unusual_detail', 'flagged')}")
    sections.append("")

# Section 12: Milestone timeline
milestones = context.get("milestones")
if milestones:
    sections.append("## Deal Milestone Timeline")
    for m in milestones:
        ms_type = m.get("milestone_type", "?")
        status = m.get("status", "?")
        dt = m.get("milestone_date") or m.get("expected_date") or "TBD"
        risk = m.get("risk_factor_affected")
        line = f"- [{status.upper()}] {ms_type}: {dt}"
        if risk:
            line += f" (affects: {risk})"
        sections.append(line)
    sections.append("")
```

#### 2.2.3 `build_delta_assessment_prompt()` — Options and milestones in delta path

After the "Sheet comparison" block (line 556), add:

```python
# Options-implied probability (always include for reference)
options = context.get("options_snapshot")
if options:
    ip = options.get("spread_implied_prob")
    sections.append("## Options Market Signals")
    sections.append(f"Spread-Implied Prob: {ip}%" if ip is not None else "Spread-Implied Prob: N/A")
    if options.get("unusual_volume"):
        sections.append(f"UNUSUAL VOLUME: {options.get('unusual_detail', 'flagged')}")
    sections.append("")

# Milestone timeline (always include for reference)
milestones = context.get("milestones")
if milestones:
    sections.append("## Milestone Timeline")
    for m in milestones:
        status = m.get("status", "?")
        line = f"- [{status.upper()}] {m.get('milestone_type', '?')}: {m.get('milestone_date') or m.get('expected_date') or 'TBD'}"
        sections.append(line)
    sections.append("")
```

Note: The delta prompt includes a **compact** version — no IV detail, no volume
breakdown, no risk_factor_affected. Just the headline probability and milestone list.
This keeps delta prompts lean.

---

### 2.3 `app/risk/context_hash.py` — Hash and summary updates

#### 2.3.1 `compute_context_hash()` — Add options + milestones to hash

After the existing `deal_attributes` block (line 100), add:

```python
# Options snapshot
options = context.get("options_snapshot") or {}
# Use bucketed spread-implied prob (5% buckets to filter noise)
raw_ip = options.get("spread_implied_prob")
if raw_ip is not None:
    try:
        bucketed_ip = str(round(float(raw_ip) / 5) * 5)
    except (ValueError, TypeError):
        bucketed_ip = "None"
else:
    bucketed_ip = "None"
parts.append(f"options_implied_prob:{bucketed_ip}")
parts.append(f"unusual_volume:{_safe_str(options.get('unusual_volume'))}")

# Milestones (count + status summary)
milestones = context.get("milestones") or []
parts.append(f"milestone_count:{len(milestones)}")
completed = sum(1 for m in milestones if m.get("status") == "completed")
pending = sum(1 for m in milestones if m.get("status") == "pending")
parts.append(f"milestones_completed:{completed}")
parts.append(f"milestones_pending:{pending}")
```

**Design decision**: Options-implied probability is bucketed to 5% increments (e.g.,
92.3% -> 90%) to prevent minor spread noise from breaking reuse. Milestone status
changes (pending -> completed) trigger re-assessment, but adding notes does not.

#### 2.3.2 `build_context_summary()` — Store new fields

After the existing `"diff_count"` field (line 133), add:

```python
# Options
options = context.get("options_snapshot") or {}
summary["spread_implied_prob"] = options.get("spread_implied_prob"),
summary["unusual_volume"] = options.get("unusual_volume"),

# Milestones
milestones = context.get("milestones") or []
summary["milestone_count"] = len(milestones)
summary["milestones_completed"] = sum(1 for m in milestones if m.get("status") == "completed")
summary["milestones_pending"] = sum(1 for m in milestones if m.get("status") == "pending")
```

#### 2.3.3 `classify_changes()` — Detect options/milestone changes

Add after the existing `expected_close_date` check (line 199), before the MINOR triggers:

```python
# Check options-implied probability shift (>10% = MODERATE)
try:
    old_ip = float(prev_summary.get("spread_implied_prob") or 0)
    new_ip = float(current.get("spread_implied_prob") or 0)
    if old_ip > 0 and new_ip > 0:
        ip_shift = abs(new_ip - old_ip)
        if ip_shift > 10:
            changes.append(f"spread_implied_prob: {old_ip:.0f}% -> {new_ip:.0f}% (shift {ip_shift:.0f}pp)")
            _upgrade(ChangeSignificance.MODERATE)
        elif ip_shift > 5:
            changes.append(f"spread_implied_prob drift: {old_ip:.0f}% -> {new_ip:.0f}%")
            _upgrade(ChangeSignificance.MINOR)
except (ValueError, TypeError):
    pass

# Check unusual volume flag (new unusual = MODERATE)
old_uv = prev_summary.get("unusual_volume")
new_uv = current.get("unusual_volume")
if new_uv and not old_uv:
    changes.append("unusual_volume: newly flagged")
    _upgrade(ChangeSignificance.MODERATE)

# Check milestone changes
old_mc = prev_summary.get("milestones_completed", 0) or 0
new_mc = current.get("milestones_completed", 0) or 0
if new_mc > old_mc:
    changes.append(f"milestones completed: {old_mc} -> {new_mc}")
    _upgrade(ChangeSignificance.MODERATE)

old_mp = prev_summary.get("milestone_count", 0) or 0
new_mp = current.get("milestone_count", 0) or 0
if new_mp > old_mp:
    changes.append(f"new milestones added: {old_mp} -> {new_mp}")
    _upgrade(ChangeSignificance.MINOR)
```

---

### 2.4 Change significance routing impact

| Event | Significance | Strategy |
|-------|-------------|----------|
| Spread-implied prob shifts >10pp | MODERATE | Delta prompt |
| Spread-implied prob shifts 5-10pp | MINOR | Delta prompt |
| Spread-implied prob shifts <5pp | Absorbed by 5% bucket | Reuse |
| Unusual volume newly flagged | MODERATE | Delta prompt |
| Milestone completed | MODERATE | Delta prompt |
| New milestone added | MINOR | Delta prompt |
| No options/milestone changes | NO_CHANGE (from these fields) | Reuse |

This is consistent with existing patterns: MAJOR triggers full reassessment,
MODERATE/MINOR trigger delta, NO_CHANGE allows reuse.

---

## 3. Graceful Degradation

| Scenario | Behavior |
|----------|----------|
| No `deal_options_snapshots` rows for ticker | `context["options_snapshot"]` not set; prompt sections 11/12 simply omitted |
| `has_options = false` in snapshot | Same as no snapshot — section omitted |
| Options snapshot exists but no IV data | Spread-implied prob still computed from prices; IV lines omitted |
| No `canonical_deal_milestones` rows | `context["milestones"]` not set; section 12 omitted |
| `canonical_deal_milestones` table doesn't exist | `try/except` catches the error; no data injected |
| `deal_options_snapshots` table doesn't exist | `try/except` catches the error; no data injected |
| `deal_price` is NULL or 0 | `implied_prob = None`; shown as "N/A" in prompt |
| Negative spread (trading above deal) | `implied_prob = 100.0`; signals competing bid or near-certainty |

**No new required data**: The engine runs identically when both tables are empty or
absent. Existing deals without options or milestones produce the exact same prompts
they do today.

---

## 4. Token Cost Estimates

### Full assessment prompt growth

| Section | Typical tokens | Notes |
|---------|---------------|-------|
| Options Market Signals (Section 11) | 60-80 | 5-6 lines, terse format |
| Milestone Timeline (Section 12) | 70-150 | ~15 tokens per milestone, typical deal has 5-10 |
| System prompt additions | 120 | Cached via ephemeral cache_control after first call |
| **Total per full assessment** | **+150-250** | ~5-8% increase on typical ~3000 token prompt |

### Delta assessment prompt growth

| Section | Typical tokens | Notes |
|---------|---------------|-------|
| Options (compact) | 25-35 | Just headline prob + unusual flag |
| Milestones (compact) | 50-100 | Type + status + date only |
| **Total per delta** | **+80-120** | ~5-7% increase on typical ~1500 token delta prompt |

### Cost impact

At current Claude pricing (~$3/Mtok input, $15/Mtok output):
- Full assessment: +$0.0005-$0.0008 per deal (input tokens only; output unchanged)
- Delta assessment: +$0.0003-$0.0004 per deal
- System prompt addition: amortized across batch via prompt caching (~$0 marginal)
- **For a 25-deal portfolio**: +$0.01-$0.02 per morning run

---

## 5. Context Hash Stability Analysis

The 5% bucketing on spread-implied probability is critical. Without it, a 0.5% daily
price drift would shift the implied probability enough to break the hash, defeating
the reuse strategy. With 5% buckets:

- A $50 deal trading at $49.00 (implied=98%) and $48.75 (implied=97.5%) both hash to 100%.
- Only when the spread widens to $47.50 (implied=95%) does the bucket change.
- This matches the existing $0.50 price bucketing pattern in `_bucket_price()`.

Milestones are hashed by count + completed/pending counts, not by individual milestone
content. Adding notes to an existing milestone does not change the hash.

---

## 6. Test Strategy

### 6.1 Unit tests (`tests/test_phase1_enriched_context.py`)

```python
# Test: compute_context_hash includes options and milestones
def test_context_hash_options_changes():
    """Hash changes when spread-implied prob crosses a 5% bucket boundary."""
    ctx1 = _base_context()
    ctx1["options_snapshot"] = {"spread_implied_prob": 92.0}
    ctx2 = _base_context()
    ctx2["options_snapshot"] = {"spread_implied_prob": 93.0}
    ctx3 = _base_context()
    ctx3["options_snapshot"] = {"spread_implied_prob": 84.0}

    h1 = compute_context_hash(ctx1)
    h2 = compute_context_hash(ctx2)
    h3 = compute_context_hash(ctx3)
    assert h1 == h2  # same 5% bucket (90)
    assert h1 != h3  # different bucket (85)

def test_context_hash_milestone_changes():
    """Hash changes when a milestone completes."""
    ctx1 = _base_context()
    ctx1["milestones"] = [
        {"milestone_type": "hsr_filing", "status": "completed"},
        {"milestone_type": "shareholder_vote", "status": "pending"},
    ]
    ctx2 = _base_context()
    ctx2["milestones"] = [
        {"milestone_type": "hsr_filing", "status": "completed"},
        {"milestone_type": "shareholder_vote", "status": "completed"},
    ]
    assert compute_context_hash(ctx1) != compute_context_hash(ctx2)

# Test: classify_changes detects options shift
def test_classify_options_shift_moderate():
    """A >10pp shift in spread-implied prob triggers MODERATE."""
    ctx = _base_context()
    ctx["options_snapshot"] = {"spread_implied_prob": 80.0}
    prev = build_context_summary(_base_context_with_options(92.0))
    sig, changes = classify_changes(ctx, prev)
    assert sig == ChangeSignificance.MODERATE
    assert any("spread_implied_prob" in c for c in changes)

# Test: build_deal_assessment_prompt includes options section
def test_prompt_includes_options():
    ctx = _base_context()
    ctx["options_snapshot"] = {
        "spread_implied_prob": 94.5,
        "atm_iv": 0.35,
        "atm_iv_30d_avg": 0.30,
        "put_call_ratio": 1.2,
        "total_call_volume": 5000,
        "total_put_volume": 6000,
    }
    prompt = build_deal_assessment_prompt(ctx)
    assert "Spread-Implied Completion Prob: 94.5%" in prompt
    assert "ATM IV: 35.0%" in prompt
    assert "Put/Call Ratio: 1.20" in prompt

# Test: build_deal_assessment_prompt includes milestones
def test_prompt_includes_milestones():
    ctx = _base_context()
    ctx["milestones"] = [
        {"milestone_type": "hsr_filing", "status": "completed",
         "milestone_date": "2026-01-15", "expected_date": None,
         "risk_factor_affected": "regulatory"},
    ]
    prompt = build_deal_assessment_prompt(ctx)
    assert "[COMPLETED] hsr_filing: 2026-01-15 (affects: regulatory)" in prompt

# Test: graceful degradation — no options data
def test_prompt_no_options():
    ctx = _base_context()  # no options_snapshot key
    prompt = build_deal_assessment_prompt(ctx)
    assert "Options Market Signals" not in prompt

# Test: graceful degradation — no milestones
def test_prompt_no_milestones():
    ctx = _base_context()  # no milestones key
    prompt = build_deal_assessment_prompt(ctx)
    assert "Milestone Timeline" not in prompt

# Test: delta prompt compact format
def test_delta_prompt_compact_options():
    ctx = _base_context()
    ctx["options_snapshot"] = {
        "spread_implied_prob": 94.5,
        "atm_iv": 0.35,
        "unusual_volume": False,
    }
    prompt = build_delta_assessment_prompt(ctx, _prev_assessment(), [], "minor")
    assert "Spread-Implied Prob: 94.5%" in prompt
    assert "ATM IV" not in prompt  # compact — no IV in delta

# Test: negative spread (competing bid scenario)
def test_implied_prob_above_deal():
    """When current > deal price, implied prob = 100%."""
    # This is tested via the inline logic in collect_deal_context
    # but we can unit-test the formula:
    deal_px, cur_px = 50.0, 52.0
    spread = deal_px - cur_px  # negative
    implied_prob = 100.0 if spread < 0 else round((1 - spread / deal_px) * 100, 1)
    assert implied_prob == 100.0
```

### 6.2 Integration test

```python
# Test: full collect_deal_context with options + milestones in DB
async def test_collect_deal_context_with_enriched_data(pool):
    """Insert test data into deal_options_snapshots and canonical_deal_milestones,
    then verify collect_deal_context returns them in the expected format."""
    engine = RiskAssessmentEngine(pool, "test-key")
    # ... insert test rows ...
    ctx = await engine.collect_deal_context("TEST")
    assert "options_snapshot" in ctx
    assert ctx["options_snapshot"]["spread_implied_prob"] is not None
    assert "milestones" in ctx
    assert len(ctx["milestones"]) > 0
```

### 6.3 Manual validation

After deploying, run a single-deal assessment and verify:
1. The prompt printed in debug logs contains both new sections
2. The AI response references spread-implied probability in its `probability_of_success.factors`
3. The AI response references milestone status in timing/regulatory details
4. Deals without options or milestones produce unchanged prompts (diff the logs)

---

## 7. Implementation Order

| Step | Description | Risk |
|------|-------------|------|
| 1 | Add context queries in `engine.py` (blocks 9 and 10) | Low — additive, try/except guarded |
| 2 | Add `compute_context_hash` additions in `context_hash.py` | Low — extends existing list |
| 3 | Add `build_context_summary` additions in `context_hash.py` | Low — extends existing dict |
| 4 | Add `classify_changes` additions in `context_hash.py` | Medium — new thresholds need tuning |
| 5 | Add prompt sections in `prompts.py` (both full and delta) | Low — additive to prompt builders |
| 6 | Add system prompt text in `prompts.py` | Low — extends system prompt string |
| 7 | Write unit tests | Low |
| 8 | Run morning assessment on 1 deal, inspect prompt + response | Validation |
| 9 | Run full morning assessment, check costs | Validation |

**No migration needed** — all tables already exist (`deal_options_snapshots` from 033,
`canonical_deal_milestones` from 036). No new columns on any existing table.

**No new dependencies** — spread-implied probability is a simple arithmetic formula,
no scipy/numpy required.

---

## 8. What Phase 2 Builds On

Phase 1 establishes the pattern that Phase 2 (prediction registry) extends:

- **Three-signal triangulation**: Phase 1 surfaces spread-implied, sheet, and AI
  probabilities side-by-side. Phase 2 records these as timestamped predictions and
  scores them against outcomes.
- **Milestone awareness**: Phase 1 teaches the AI about the milestone timeline.
  Phase 2 can use milestone completion as prediction checkpoints.
- **Context hash stability**: Phase 1 proves the bucketing approach works for
  market-derived signals. Phase 2 adds prediction-derived signals to the hash.
- **Prompt section pattern**: Phase 1 adds sections 11-12 following the established
  pattern. Phase 2 adds section 13 (prediction history) using the same approach.
