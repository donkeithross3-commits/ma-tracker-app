# EDGAR Detector Tuning Notes

**Date**: 2025-11-13
**System**: Rule-based M&A detection (replaced LLM)

## Overview

The detector now uses deterministic rules instead of LLM analysis. This document tracks known edge cases and tuning opportunities for future improvements.

---

## Known Edge Cases

### 1. Mersana Therapeutics (MRSN) - False Negative

**Filing**: 8-K filed 2025-11-13 (Accession: 0001104659-25-110764)
**Deal**: Mersana being acquired by Day One Biopharmaceuticals
**Expected**: HIGH confidence (0.95)
**Actual**: REJECTED (0.05) - Historical reference false positive

**Root Cause**:
- The detector is correctly fetching the filing and identifying 17-19 M&A keywords
- However, it's detecting historical reference phrases in the boilerplate risk disclosures
- Phrases like "the proposed transaction" appear in forward-looking statements like "the proposed transaction may not close" which are standard in NEW deal announcements

**Signals Present**:
- ✅ 8-K filing type
- ✅ Items 1.01 + 8.01 (high-priority)
- ✅ 17+ M&A keywords
- ✅ Verified public target (MRSN ticker)
- ❌ Historical reference false positive triggers rejection

**Fix Options**:
1. **Manual review**: Accept that edge cases will hit MEDIUM queue
2. **Whitelist**: Skip historical ref check for filings with Items 1.01+8.01+10+ keywords
3. **Context analysis**: Check if historical refs are in "Risk Factors" sections
4. **File format**: Prefer .htm files over .txt (better parsing)

**Recommendation**: Manual review for now. Track rejection reasons and tune based on patterns.

---

## Historical Reference Keywords - Tuning Log

### Removed (Caused False Positives)

**2025-11-13**:
- ❌ `"the proposed transaction"` - Appears in risk disclosures for NEW deals
- ❌ `"the proposed merger"` - Same issue
- ❌ `"the pending transaction"` - Same issue
- ❌ `"closing conditions"` - Too generic, appears in both new and updates

**Reason**: These phrases appear in standard boilerplate for new M&A announcements in forward-looking risk statements. They're not reliable indicators of previously announced deals.

**Replacement**: Use more specific variants:
- ✅ `"the proposed acquisition of"` - More specific
- ✅ `"the proposed merger with"` - Includes target reference
- ✅ `"the pending merger with"` - Includes target reference

### Strong Indicators (Keep)

These reliably indicate updates to existing deals:
- ✅ `"previously announced"`
- ✅ `"as previously disclosed"`
- ✅ `"as previously reported"`
- ✅ `"amendment to"`
- ✅ `"amendment no."`
- ✅ `"the merger agreement dated"` (with specific date)
- ✅ `"special meeting of stockholders"` (votes happen after announcement)
- ✅ `"definitive proxy"` / `"proxy statement"`
- ✅ `"completion of the merger"` (deal already done)

---

## Target Company Extraction - Tuning Log

### Current Logic

1. Try pattern matching in filing text:
   - `"acquisition of [Company]"`
   - `"[Company] will be acquired"`
   - `"tender offer for [Company]"`

2. Skip generic terms:
   - "Merger Sub" (always the subsidiary, not target)
   - "Acquisition Sub"
   - "the Company" (ambiguous)

3. Fallback to filing company name
   - Most 8-Ks are filed BY the target company

### Known Issues

**Mersana case**: Successfully uses filing company as target (✅)

**Private company filtering**: Working correctly - rejects deals where extracted target has no public ticker

---

## Confidence Tier Calibration

### Expected Approval Rates

Track these over time to calibrate thresholds:

| Tier | Confidence | Expected Approval | Actual (TBD) |
|------|-----------|-------------------|--------------|
| HIGH | 0.90-0.95 | >90% | - |
| MEDIUM-HIGH | 0.75-0.85 | 70-85% | - |
| MEDIUM | 0.60-0.70 | 50-65% | - |

### Threshold Adjustments

**If too many false positives in HIGH tier**:
- Raise keyword threshold from 10+ to 12+
- Require specific keywords (e.g., "definitive agreement")
- Add more filing type restrictions

**If too many false negatives** (not catching real deals):
- Lower keyword threshold from 10+ to 8+
- Accept more filing types as high-priority
- Relax target verification (assume public if can't extract)

---

## Test Results Summary

**Date**: 2025-11-13
**Sample**: 25 recent filings (2025-11-10 to 2025-11-13)

### Classification Changes

**REJECTED → ACCEPTED** (improvements):
1. **SHOE CARNIVAL (SCVL)**
   - 8-K with 5 keywords
   - Old: LLM rejected with 0.95 confidence (wrong)
   - New: Accepted with 0.65 MEDIUM confidence (correct)
   - Outcome: Will be manually reviewed ✅

2. **Global Medical REIT (GMRE)**
   - 8-K with Item 8.01 + 8 keywords
   - Old: LLM rejected with 1.00 confidence (wrong)
   - New: Accepted with 0.80 MEDIUM-HIGH confidence (correct)
   - Outcome: Strong signal, likely legitimate ✅

### Correctly Rejected

These had historical references and were correctly filtered:
- NB Bancorp (NBBK) - 9-10 keywords but "previously announced"
- LGL GROUP (LGL) - 3 keywords + historical ref
- Star Equity (STRR) - 6 keywords + historical ref
- Xenetic Biosciences (XBIO) - 3 keywords + historical ref
- Seagate (STX) - 3 keywords + historical ref

---

## Monitoring Plan

### Metrics to Track

1. **Staged deals per confidence tier**
   - How many HIGH vs MEDIUM-HIGH vs MEDIUM?
   - Should be pyramid: few HIGH, more MEDIUM

2. **Approval rate per tier**
   - Do 90%+ of HIGH confidence deals get approved?
   - Calibrate thresholds based on actual rates

3. **Rejection reasons**
   - Which rejection reasons are most common?
   - Historical refs? Private targets? Low keywords?

4. **False negatives**
   - Manually check deals you find elsewhere (news, Twitter, etc.)
   - Were they in edgar_filings but rejected?
   - What was the rejection reason?

### Tuning Process

**Weekly review**:
1. Look at all rejected deals (status='analyzed', is_ma_relevant=false)
2. Sample 10-20 rejections
3. Check rejection reasoning field
4. Identify patterns in false positives/negatives
5. Adjust keywords, thresholds, or rules
6. Document changes in this file

**Example queries**:
```sql
-- Most common rejection reasons
SELECT reasoning, COUNT(*)
FROM edgar_filings
WHERE is_ma_relevant = false
  AND detected_keywords IS NOT NULL
  AND filing_date >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY reasoning
ORDER BY COUNT(*) DESC;

-- False negatives (high keywords but rejected)
SELECT company_name, filing_type, array_length(detected_keywords, 1) as kw_count, reasoning
FROM edgar_filings
WHERE is_ma_relevant = false
  AND array_length(detected_keywords, 1) >= 8
  AND filing_date >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY kw_count DESC;
```

---

## Future Enhancements

### Phase 1: Confidence Calibration (Next 2-4 weeks)
- Track approval rates per tier
- Adjust thresholds based on real data
- Fine-tune historical reference keywords

### Phase 2: Deal Value Extraction
- Extract dollar amounts from filings
- Cap confidence at 0.89 for deals < $50M
- Give higher confidence to large deals

### Phase 3: Acquirer Identification
- Extract acquirer company name
- Verify acquirer ticker if public
- Higher confidence when both parties verified

### Phase 4: Machine Learning (Optional)
- Train classifier on labeled dataset
- Use rule-based as baseline/features
- Ensemble: ML probability + rule-based confidence

---

## Quick Reference: Tuning Thresholds

**Current settings** (in detector.py):

```python
# Keyword thresholds
'many_keywords': keyword_count >= 10
'moderate_keywords': 5 <= keyword_count < 10

# High-priority 8-K items
high_priority_items = {'1.01', '8.01', '2.01'}

# Confidence scores
HIGH: 0.95  # 8-K + items + 10+ kw + verified
MEDIUM-HIGH: 0.80  # 8-K + items + 5-9 kw
MEDIUM-HIGH: 0.75  # 10+ kw + verified (any filing type)
MEDIUM: 0.65  # 5-9 kw (may not verify target)
REJECTED: 0.30  # < 5 kw

# Historical reference context
context_window = 2000  # chars to check at start
context_window = 5000  # for retrospective filing types
context_radius = 500   # chars around M&A keywords
```

**To adjust**:
1. Edit `app/edgar/detector.py`
2. Search for threshold values above
3. Update and test on historical filings
4. Document changes here

---

## Rollback Instructions

If rule-based detector performs worse than expected:

1. **Revert to LLM version**:
```bash
git log --oneline -- python-service/app/edgar/detector.py
git checkout <commit-before-rules> -- python-service/app/edgar/detector.py
```

2. **Re-enable Anthropic API**:
```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

3. **Restart EDGAR monitor**

LLM version is preserved in git history (commit before 2025-11-13).

---

## Contact / Questions

For tuning questions or edge cases:
- Review this document
- Check RULE_BASED_DETECTION.md for system overview
- Run test_rule_based_detector.py on sample filings
- Update this document with findings
