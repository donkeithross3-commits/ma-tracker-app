# Rule-Based M&A Detection System

**Date**: 2025-11-13
**Replaced**: LLM-based detection (Claude Sonnet API calls)
**Reason**: LLM produced false negatives (e.g., Mersana 8-K missed despite perfect signals)

---

## Overview

The EDGAR detector now uses **deterministic rule-based logic** instead of LLM analysis to classify M&A filings. This approach is:

- ⚡ **Instant** - No API latency
- 💰 **Free** - No API costs
- 🎯 **Deterministic** - Same inputs always produce same output
- 🐛 **Debuggable** - Easy to trace why a filing was accepted/rejected
- 🔧 **Tunable** - Rules can be adjusted based on empirical results

---

## Confidence Tier System

The detector assigns filings to one of three buckets:

### HIGH Confidence (0.90-0.95)
**Clear new M&A announcements with strong signals**

**Criteria** (ALL must be true):
- ✅ 8-K filing type
- ✅ High-priority items (1.01, 8.01, or 2.01)
- ✅ 10+ M&A keywords detected
- ✅ NO historical references found
- ✅ Verified public target company

**Example**: Mersana Therapeutics 8-K
- Items 1.01 + 8.01
- 17 M&A keywords
- No "previously announced" phrases
- MRSN ticker verified

**Action**: Creates staged deal → Immediate review queue

---

### MEDIUM-HIGH Confidence (0.75-0.85)
**Strong signals but missing one element**

**Scenario 1**: High-priority 8-K + moderate keywords (5-9)
- ✅ 8-K with Items 1.01/8.01/2.01
- ⚠️ Only 5-9 keywords (not 10+)

**Scenario 2**: Many keywords + verified target, but not 8-K
- ✅ 10+ M&A keywords
- ✅ Verified public target
- ⚠️ Different filing type (S-4, SC TO, etc.)

**Action**: Creates staged deal → Review queue (slightly lower priority)

---

### MEDIUM Confidence (0.60-0.70)
**Potential deal requiring human verification**

**Scenario**: Moderate keywords but can't verify target
- ✅ 5-9 M&A keywords
- ⚠️ Target company name couldn't be extracted
- ⚠️ OR target ticker couldn't be verified

**Action**: Creates staged deal → Careful review queue (may be false positive)

---

### LOW/REJECTED (<0.50)
**Not M&A relevant or insufficient signals**

**Rejection reasons**:
- ❌ Historical references detected ("previously announced", "as previously disclosed")
- ❌ Private company target (no public ticker found)
- ❌ Retrospective filing type (8-K/A, PREM14A, DEFM14A, 425)
- ❌ Too few keywords (<5)

**Action**: NOT added to staging queue

---

## Detection Rules (in order)

### Rule 1: Historical Reference Check
**Purpose**: Filter out updates to existing deals

Checks for phrases like:
- "previously announced"
- "as previously disclosed"
- "amendment to"
- "the proposed acquisition" (definite article = already mentioned)
- "vote on the merger" (votes happen after announcement)
- "closing of the merger" (deal already done)

**Context windows**:
- Standard filings (8-K): First 2000 characters
- Retrospective filings (425, PREM14A): First 5000 characters
- Also checks 500 chars around M&A keywords

**Result**: If found → REJECT (confidence 0.05)

---

### Rule 2: Public Company Verification
**Purpose**: Only track deals where target is publicly traded

**Process**:
1. Extract target company name from filing text
2. Look up ticker using ticker_lookup service
3. Check if match found with similarity > 0.75

**Result**: If private → REJECT (confidence 0.05)

---

### Rule 3: 8-K Item Number Extraction
**Purpose**: Identify high-priority M&A announcements

**High-priority items**:
- **Item 1.01**: Entry into Material Definitive Agreement
- **Item 8.01**: Other Events
- **Item 2.01**: Completion of Acquisition or Disposition

**Pattern**: `Item X.XX` in first 5000 characters

**Result**: Used in confidence scoring (see Rule 4)

---

### Rule 4: Rule-Based Confidence Scoring
**Purpose**: Assign confidence tier based on signal strength

**Signals collected**:
```python
signals = {
    'many_keywords': keyword_count >= 10,
    'moderate_keywords': 5 <= keyword_count < 10,
    'high_priority_8k_items': has_items_1_01_or_8_01_or_2_01,
    'is_8k': filing_type == "8-K",
    'verified_public_target': ticker_found_and_verified,
    'target_unverified': company_name_not_extracted
}
```

**Scoring logic**:
```python
# HIGH (0.95)
if is_8k AND high_priority_items AND many_keywords AND verified_target:
    return 0.95

# MEDIUM-HIGH (0.80)
if is_8k AND high_priority_items AND moderate_keywords:
    return 0.80

# MEDIUM-HIGH (0.75)
if many_keywords AND verified_target:
    return 0.75

# MEDIUM (0.65)
if moderate_keywords:
    return 0.65

# REJECTED (0.30)
else:
    return 0.30 (not added to staging)
```

---

## Keyword List (MA_KEYWORDS)

**Deal terms**:
merger, acquisition, acquire, acquirer, takeover, buyout, tender offer, going private, transaction, combination

**Agreement terms**:
merger agreement, definitive agreement, letter of intent, purchase agreement, stock purchase, asset purchase

**Deal structure**:
cash and stock, all cash, all stock, exchange ratio, premium, consideration, per share

**Process terms**:
closing, regulatory approval, shareholder approval, antitrust, HSR, termination fee, break-up fee

**Tender offer specific**:
commencement, tender, offer to purchase, proration

**Spin-offs**:
spin-off, split-off, divestiture, separation

---

## Historical Reference Keywords

**Direct references**:
previously announced, as previously disclosed, as previously reported, previously entered into, as announced on

**Amendments**:
amendment to, amendment no., first amendment, supplement to

**Original agreements**:
original merger agreement, the merger agreement dated, entered into on

**Proposed deals** (definite article):
the proposed acquisition, the proposed merger, the pending transaction

**Shareholder votes**:
special meeting of stockholders, vote on the merger, proxy statement, definitive proxy

**Regulatory updates**:
HSR clearance, antitrust clearance, regulatory approval received

**Completion language**:
completion of the merger, closing of the acquisition, consummation of the merger

---

## Advantages Over LLM

| Aspect | LLM-Based | Rule-Based |
|--------|-----------|------------|
| **Speed** | 2-5 seconds per filing | <100ms per filing |
| **Cost** | $0.01-0.05 per filing | $0 |
| **Consistency** | Varies per run | 100% deterministic |
| **False Negatives** | Can miss obvious deals | Catches all keyword matches |
| **Debuggability** | Black box | Clear reasoning |
| **Tuning** | Prompt engineering | Adjust thresholds |

---

## Case Study: Mersana Therapeutics

**Filing**: 8-K filed 2025-11-13 11:17 AM
**Target**: Mersana Therapeutics (MRSN)
**Acquirer**: Day One Biopharmaceuticals

### LLM Result (WRONG)
- is_ma_relevant: **False** ❌
- confidence_score: **0.05** ❌
- reasoning: Unknown (black box)

### Rule-Based Result (CORRECT)
- is_ma_relevant: **True** ✅
- confidence_score: **0.95** ✅
- reasoning: "HIGH CONFIDENCE: 8-K Items ['1.01', '8.01'] + 17 M&A keywords + verified public target (Mersana Therapeutics, Inc.) - clear new M&A announcement"

**Signals detected**:
- ✅ 8-K filing
- ✅ Items 1.01 + 8.01 (high-priority)
- ✅ 17 keywords: merger, acquisition, acquire, takeover, tender offer, transaction, combination, merger agreement, definitive agreement, stock purchase, premium, consideration, per share, closing, regulatory approval, antitrust, commencement
- ✅ No historical references
- ✅ MRSN ticker verified

---

## Tuning the System

### If Too Many False Positives

**Option 1**: Raise keyword threshold
```python
'many_keywords': keyword_count >= 12  # was 10
'moderate_keywords': 7 <= keyword_count < 12  # was 5-10
```

**Option 2**: Require more signals for HIGH confidence
```python
# Add requirement for specific keywords
required_keywords = ['merger agreement', 'definitive agreement', 'acquisition']
if not any(k in detected_keywords for k in required_keywords):
    confidence = max(confidence - 0.10, 0.60)  # downgrade
```

**Option 3**: Add more historical reference keywords
```python
HISTORICAL_REFERENCE_KEYWORDS += [
    "as disclosed on",
    "as described in",
    # etc.
]
```

### If Too Many False Negatives

**Option 1**: Lower keyword threshold
```python
'many_keywords': keyword_count >= 8  # was 10
'moderate_keywords': 4 <= keyword_count < 8  # was 5-10
```

**Option 2**: Accept more filing types as high-priority
```python
# Currently only 8-K with items 1.01/8.01/2.01 gets HIGH confidence
# Could add S-4, SC TO, etc.
if filing_type in ['8-K', 'S-4', 'SC TO']:
    # ...
```

**Option 3**: Reduce minimum for MEDIUM tier
```python
if keyword_count >= 3:  # was 5
    return MEDIUM confidence
```

---

## Monitoring and Iteration

### Metrics to Track

1. **Detection Rate**: % of real deals caught (measure against manual review)
2. **False Positive Rate**: % of staged deals rejected after review
3. **Confidence Calibration**: Do 95% confidence deals have 95% approval rate?

### Expected Performance

Based on the Mersana case study:

- **HIGH confidence**: >90% should be approved
- **MEDIUM-HIGH confidence**: 70-85% should be approved
- **MEDIUM confidence**: 50-65% should be approved (these need careful review)

### Iteration Process

1. Monitor approval/rejection rates per confidence tier
2. Identify patterns in false positives (common keywords? filing types?)
3. Identify patterns in false negatives (missing keywords? edge cases?)
4. Adjust thresholds and rules accordingly
5. Re-test on historical data
6. Deploy and measure

---

## Code Location

**File**: `/Users/donaldross/ma-tracker-app/python-service/app/edgar/detector.py`

**Function**: `MADetector.detect_ma_relevance()` (lines 614-867)

**Dependencies**:
- `keyword_scan()` - Detects M&A keywords
- `detect_historical_reference()` - Checks for retrospective language
- `detect_historical_reference_near_keywords()` - Context-aware historical check
- `check_target_is_public()` - Verifies public ticker
- `extract_8k_item_numbers()` - Parses 8-K item numbers
- `is_high_priority_8k()` - Checks for items 1.01/8.01/2.01

---

## Future Enhancements

### Phase 2: Machine Learning Scoring
- Train classifier on labeled dataset of filings
- Use rule-based system as baseline
- Ensemble: ML + rules

### Phase 3: Deal Value Extraction
- Extract dollar amounts from filings
- Cap confidence at 0.89 for deals < $50M (current LLM rule)

### Phase 4: Acquirer Extraction
- Extract acquirer company name
- Verify acquirer ticker
- Higher confidence if both parties verified

---

## Rollback Plan

If rule-based system performs poorly, LLM code is preserved in git history:

```bash
git log --all --grep="LLM-based detection" -- python-service/app/edgar/detector.py
git checkout <commit-hash> -- python-service/app/edgar/detector.py
```

The LLM version is at commit before 2025-11-13 refactor.
