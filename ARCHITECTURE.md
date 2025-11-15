# Intelligence Platform Architecture

## Single Source of Truth

The Intelligence Platform follows a clear single-source-of-truth architecture:

### Primary Tables (Authoritative Data)

1. **`deal_intelligence`** - SINGLE SOURCE OF TRUTH for deal data
   - Contains the verified, corrected deal information
   - Fields: `target_name`, `target_ticker`, `acquirer_name`, `acquirer_ticker`, `deal_value`, `deal_status`, etc.
   - This table is the authoritative source for all deal queries and displays
   - Manual corrections are made here and logged in `deal_history`

2. **`staged_deals`** - Pending approval queue
   - Temporary holding area for detected deals awaiting human review
   - Once approved, data is promoted to `deal_intelligence`
   - After promotion, staged deal is marked as `status='approved'` with reference to `approved_deal_id`

### Supporting Tables (Attribution & History)

3. **`deal_sources`** - Source attribution (NOT authoritative for deal data)
   - Links each deal to the sources that detected it (EDGAR filings, news articles, etc.)
   - Contains `extracted_data` field with **historical record** of original AI extraction
   - **IMPORTANT**: `extracted_data` is preserved as-is for audit purposes and may differ from corrected `deal_intelligence` data
   - Frontend displays this with clear labeling: "Original AI Extraction from Source - see deal summary above for verified information"

4. **`deal_history`** - Audit trail
   - Tracks all changes made to deals over time
   - Records manual corrections, status changes, data updates
   - Provides accountability and rollback capability

5. **`edgar_filings`** - Raw SEC filing data
   - Original EDGAR filing documents
   - Reference data, not deal data

6. **`deal_research`** - AI-generated research reports
   - Comprehensive analysis of deals
   - Derived data, refreshed as needed

## Data Flow

```
External Source (SEC, Reuters, etc.)
    ↓
AI Extraction → staged_deals (with sources[].extracted_data)
    ↓
Human Review/Approval
    ↓
deal_intelligence (single source of truth)
    ↓
Manual Correction (if needed)
    ↓
deal_intelligence updated + deal_history logged

Note: deal_sources.extracted_data NOT updated (preserved as historical record)
```

## Handling Data Corrections

When correcting a deal (e.g., swapping target/acquirer):

1. **DO**: Update `deal_intelligence` table
2. **DO**: Log change in `deal_history` table
3. **DO NOT**: Update `deal_sources.extracted_data` (preserve historical extraction)
4. **DO**: Ensure frontend clearly labels extracted_data as historical/original extraction

## Frontend Display Hierarchy

```
Deal Detail Page:
├── Deal Summary (lines 175-225) ✅ Uses deal_intelligence (authoritative)
│   ├── Target Name: deal.target_name
│   ├── Acquirer Name: deal.acquirer_name
│   └── All deal metadata from deal_intelligence table
│
└── Sources Section (lines 234-327)
    └── For each source:
        ├── Headline, content snippet ✅ Informational
        └── Extracted Data ⚠️ Historical only
            └── Shows original AI extraction (may differ from corrected values above)
```

## Why This Architecture?

1. **Single source of truth**: All queries pull from `deal_intelligence`
2. **Audit trail**: `deal_sources.extracted_data` preserves what AI originally saw
3. **Transparency**: Users can see original extraction vs corrected values
4. **No redundancy**: Deal data stored once in `deal_intelligence`
5. **Attribution**: Sources track "which filing/article detected this deal"
6. **History**: Changes logged in `deal_history` for accountability

## Key Principle

**Never use `deal_sources.extracted_data` for deal display or logic.**
- It's a historical artifact showing "what did the AI extract from this specific source"
- Always use `deal_intelligence` table fields for authoritative deal information
- Frontend clearly labels extracted data as historical to prevent confusion
