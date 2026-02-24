# M&A Portfolio Production Support -- Engineering Backlog

> Prioritized ticket list for the M&A Portfolio Production Support System.
> Ingests Google Sheet portfolio, replicates in DR3 dashboard, adds intelligence
> (validation, EDGAR/news enrichment, AI suggestions), monitors spreads intraday.

---

## Phase 1 -- Sheet Ingest + Storage + UI

### TICKET-001: Create SheetSnapshot + SheetRow DB migration (024)
**Phase:** 1 | **Priority:** P0 | **Depends on:** none
**Description:** Add Prisma migration 024 creating the `SheetSnapshot` and `SheetRow` tables in Neon PostgreSQL. `SheetSnapshot` stores one row per ingest run (id, sheet_id, tab_gid, fetched_at, row_count, status, raw_csv_url). `SheetRow` stores every row from every tab keyed to a snapshot (id, snapshot_id, tab_gid, row_index, target, acquiror, announced_date, expected_close, end_date, countdown_days, deal_price, current_price, gross_yield, price_change, current_yield, category, investable, deal_notes, vote_risk, finance_risk, legal_risk, cvr, raw_json). Include appropriate indexes on (snapshot_id, tab_gid) and (target, acquiror).
**Definition of Done:**
- [ ] Migration 024 applies cleanly on a fresh Neon database
- [ ] `npx prisma migrate dev` succeeds with no drift warnings
- [ ] Both tables visible in Prisma Studio
- [ ] Rollback migration drops both tables without residue
**Test Notes:** Run migration against a throwaway Neon branch; verify schema with `\d sheet_snapshot` and `\d sheet_row`.
**Risks/Edge Cases:** Column types for risk fields (vote, finance, legal) -- decide enum vs free text. CVR may be nullable or contain complex expressions.

---

### TICKET-002: Migrate deals_ingest.py to PostgreSQL + add to FastAPI
**Phase:** 1 | **Priority:** P0 | **Depends on:** TICKET-001
**Description:** Port the existing `deals_ingest.py` (currently CSV-based Google Sheets fetch) into a FastAPI service endpoint. The migrated version should: (1) fetch all six tabs from Sheet ID `148_gz88_8cXhyZnCZyJxFufqlbqTzTnVSy37O19Fh2c` via the public CSV export URL using each tab's GID, (2) parse rows into the SheetRow schema, (3) write a SheetSnapshot + child SheetRows in a single DB transaction. Preserve the existing column mapping logic. Add structured logging for row counts, parse errors, and timing.
**Definition of Done:**
- [ ] `POST /api/ma-portfolio/ingest` triggers a full ingest of all 6 tabs
- [ ] SheetSnapshot created with correct row_count and status
- [ ] All SheetRows persisted with correct column mapping
- [ ] Parse errors logged but do not abort the entire ingest
- [ ] Existing deals_ingest.py tests pass or are ported
**Test Notes:** Call the endpoint manually; compare row counts against the live Google Sheet. Verify with a known-good snapshot that all fields map correctly.
**Risks/Edge Cases:** Google may rate-limit CSV exports. Sheets with merged cells or header-row drift will break parsing. Need to handle the case where a tab is empty or has been restructured.

---

### TICKET-003: Build morning cron job (7 AM ET ingest)
**Phase:** 1 | **Priority:** P0 | **Depends on:** TICKET-002
**Description:** Create a scheduled job that calls the ingest endpoint every weekday at 7:00 AM Eastern. Implement as a system cron entry on the Droplet (or a FastAPI BackgroundScheduler if preferred). The job should: call `/api/ma-portfolio/ingest`, verify the response status, and log success/failure. On failure, retry once after 5 minutes before alerting.
**Definition of Done:**
- [ ] Cron fires at 7 AM ET on weekdays
- [ ] Successful ingest logged with snapshot ID
- [ ] Failed ingest retried once, then error logged
- [ ] No duplicate snapshots created on retry if first attempt partially succeeded
**Test Notes:** Temporarily set cron to run in 2 minutes; verify snapshot creation. Test failure path by temporarily blocking Sheet access.
**Risks/Edge Cases:** Timezone handling -- ensure ET not UTC. DST transitions shift the UTC offset. If the Droplet reboots, cron must survive.

---

### TICKET-004: Add computed columns (gross spread, annualized yield, days to close)
**Phase:** 1 | **Priority:** P1 | **Depends on:** TICKET-001
**Description:** Add server-side computed fields to the SheetRow response: `gross_spread` (deal_price - current_price), `annualized_yield` ((gross_spread / current_price) * (365 / days_to_close) * 100), `days_to_close` (end_date - today). These should be computed at query time (not stored) and returned in the API response. Handle edge cases: days_to_close <= 0 returns null yield, missing prices return null spread.
**Definition of Done:**
- [ ] API response includes gross_spread, annualized_yield, days_to_close
- [ ] Division by zero and missing data handled gracefully (null, not error)
- [ ] Values match manual spreadsheet calculations for at least 5 sample deals
**Test Notes:** Pick 5 deals with known values from the Google Sheet and compare computed output.
**Risks/Edge Cases:** Annualized yield is misleading for deals closing within days. Negative spreads (broken deals) should still compute correctly rather than being suppressed.

---

### TICKET-005: Create /ma-portfolio Next.js page (table view)
**Phase:** 1 | **Priority:** P0 | **Depends on:** TICKET-002, TICKET-004
**Description:** Build a new page at `/ma-portfolio` in the Next.js 16 app. Display the most recent SheetSnapshot's rows in a sortable, filterable table. Columns: Target, Acquiror, Announced, Expected Close, End Date, Countdown, Deal Price, Current Price, Gross Spread, Gross Yield, Price Change, Current Yield, Annualized Yield, Category, Investable, Deal Notes, Vote Risk, Finance Risk, Legal Risk, CVR. Default sort by Target ascending. Use the existing DR3 table component styling.
**Definition of Done:**
- [ ] Page loads at `/ma-portfolio` and displays latest snapshot data
- [ ] All columns rendered with appropriate formatting (currency, percentage, date)
- [ ] Table is sortable by clicking column headers
- [ ] Empty state shown when no snapshots exist
- [ ] Page matches DR3 visual style
**Test Notes:** Load page with live data; verify column values match Google Sheet. Test with zero rows. Test sort on each column type.
**Risks/Edge Cases:** Large deal count (100+) may need pagination or virtualized scrolling. Long deal notes may break table layout.

---

### TICKET-006: Tab navigation (Dashboard, EA, COMM, TRUE, IROQ, PLYM)
**Phase:** 1 | **Priority:** P1 | **Depends on:** TICKET-005
**Description:** Add a tab bar to the `/ma-portfolio` page with six tabs corresponding to the Google Sheet tabs: Dashboard (GID 0), EA (815650768), COMM (232205931), TRUE (1570397858), IROQ (1065275530), PLYM (662428847). Selecting a tab filters the table to show only rows from that tab's GID. Default to Dashboard tab. Persist selected tab in URL query parameter (`?tab=ea`).
**Definition of Done:**
- [ ] Six tabs displayed, correct tab highlighted on click
- [ ] Table filters to selected tab's rows
- [ ] URL updates with tab parameter; direct linking works
- [ ] Tab row counts shown as badges
**Test Notes:** Click each tab and verify correct rows appear. Copy URL with tab param, open in new browser tab, verify same tab selected.
**Risks/Edge Cases:** Some tabs may have zero rows. Dashboard tab may aggregate rather than filter -- confirm expected behavior with stakeholder.

---

### TICKET-007: Column chooser integration
**Phase:** 1 | **Priority:** P2 | **Depends on:** TICKET-005
**Description:** Integrate the existing DR3 column chooser component with the MA portfolio table. Allow users to show/hide columns and persist their selection in localStorage. Default visible columns: Target, Acquiror, Deal Price, Current Price, Gross Spread, Annualized Yield, Category, Investable. All other columns hidden by default but available via the chooser.
**Definition of Done:**
- [ ] Column chooser toggle button visible on the page
- [ ] Columns can be shown/hidden individually
- [ ] Selection persists across page reloads via localStorage
- [ ] Reset button restores default column set
**Test Notes:** Hide several columns, reload page, verify they remain hidden. Reset and verify defaults restored.
**Risks/Edge Cases:** localStorage key collision with other DR3 pages. If the column set changes (new columns added), stale localStorage may hide new columns.

---

### TICKET-008: Manual refresh endpoint
**Phase:** 1 | **Priority:** P1 | **Depends on:** TICKET-002
**Description:** Add a "Refresh Now" button to the `/ma-portfolio` page that triggers an on-demand ingest via `POST /api/ma-portfolio/ingest`. Show a loading spinner during ingest, then reload the table with the new snapshot. Debounce to prevent multiple concurrent ingests. Return 429 if an ingest is already in progress.
**Definition of Done:**
- [ ] Refresh button visible on the page
- [ ] Clicking triggers ingest and updates table on completion
- [ ] Loading state shown during ingest
- [ ] 429 returned if ingest already running; UI shows appropriate message
- [ ] Button disabled during ingest
**Test Notes:** Click refresh, verify new snapshot created. Double-click rapidly, verify only one ingest runs.
**Risks/Edge Cases:** Long-running ingest (slow Sheet fetch) may time out the HTTP request. Consider making it async with polling.

---

### TICKET-009: Sheet ingest health check endpoint
**Phase:** 1 | **Priority:** P1 | **Depends on:** TICKET-002
**Description:** Create `GET /api/ma-portfolio/health` that returns the status of the ingest system: last successful snapshot timestamp, last snapshot row count, time since last ingest, and whether the cron is on schedule (stale if > 25 hours since last weekday ingest). Return HTTP 200 for healthy, 503 for stale/unhealthy.
**Definition of Done:**
- [ ] Endpoint returns JSON with last_snapshot_at, row_count, hours_since_ingest, is_healthy
- [ ] Returns 503 when no snapshot exists or last ingest is stale
- [ ] Can be used as an uptime monitor target
**Test Notes:** Call endpoint after a fresh ingest (expect 200). Delete all snapshots and call again (expect 503).
**Risks/Edge Cases:** Weekends and holidays -- 25-hour threshold will fire on Saturday morning. Consider weekday-only staleness check.

---

## Phase 2 -- Validation + Reconciliation

### TICKET-010: Create SheetDiff + ValidationIssue DB migration (025)
**Phase:** 2 | **Priority:** P0 | **Depends on:** TICKET-001
**Description:** Add Prisma migration 025 creating `SheetDiff` and `ValidationIssue` tables. `SheetDiff` stores row-level changes between consecutive snapshots (id, prev_snapshot_id, curr_snapshot_id, tab_gid, target, acquiror, diff_type [added|removed|changed], changed_fields JSON, prev_values JSON, curr_values JSON, detected_at). `ValidationIssue` stores rule violations (id, snapshot_id, sheet_row_id, rule_name, severity [error|warning|info], message, field_name, field_value, resolved_at, resolved_by). Index on (snapshot_id) and (rule_name, severity).
**Definition of Done:**
- [ ] Migration 025 applies cleanly on top of 024
- [ ] Both tables visible in Prisma Studio
- [ ] Foreign keys to SheetSnapshot and SheetRow enforced
- [ ] Rollback drops tables cleanly
**Test Notes:** Run full migration chain 024+025 on fresh DB. Insert test rows and verify FK constraints.
**Risks/Edge Cases:** Large diff payloads if many fields change simultaneously. JSON columns need to handle null vs missing keys.

---

### TICKET-011: Build row-level diff engine
**Phase:** 2 | **Priority:** P0 | **Depends on:** TICKET-010, TICKET-002
**Description:** Implement a diff engine that compares two consecutive SheetSnapshots and produces SheetDiff records. Match rows by (target, acquiror, tab_gid) composite key. Detect: new rows (added), removed rows (removed), changed fields (changed with field-level detail). Run automatically after each ingest completes. Store results in SheetDiff table.
**Definition of Done:**
- [ ] Diff runs after every ingest and produces SheetDiff records
- [ ] Added, removed, and changed rows correctly identified
- [ ] Changed fields include previous and current values
- [ ] First-ever snapshot produces no diffs (no previous to compare)
- [ ] Performance acceptable for 500+ rows (< 5 seconds)
**Test Notes:** Ingest twice with a known change (edit one cell in Sheet). Verify exactly one SheetDiff with correct changed_fields. Add a new row, verify "added" diff. Remove a row, verify "removed" diff.
**Risks/Edge Cases:** Target/acquiror name changes break the matching key. Floating-point price comparison needs tolerance (e.g., 0.001). Row reordering should not generate false diffs.

---

### TICKET-012: Build daily reconciliation job
**Phase:** 2 | **Priority:** P1 | **Depends on:** TICKET-011
**Description:** Create a scheduled job that runs after the morning ingest (7:15 AM ET) to perform reconciliation: (1) run the diff engine, (2) run the validation rule engine (TICKET-014), (3) generate a daily reconciliation summary (total rows, changes, new issues). Store summary as a log entry. If critical issues found, flag for review.
**Definition of Done:**
- [ ] Reconciliation job runs after each morning ingest
- [ ] Diff + validation results stored in DB
- [ ] Summary log entry created with counts
- [ ] Job is idempotent (re-running does not duplicate results)
**Test Notes:** Trigger manually after an ingest. Verify diff and validation records created. Run again, verify no duplicates.
**Risks/Edge Cases:** If ingest fails, reconciliation should not run on stale data. Need to handle the case where the previous snapshot is missing.

---

### TICKET-013: Build validation rule engine (missing fields, suspicious values)
**Phase:** 2 | **Priority:** P1 | **Depends on:** TICKET-010
**Description:** Create a rule engine that validates SheetRow data and produces ValidationIssue records. Initial rules: (1) missing required fields (target, acquiror, deal_price), (2) suspicious prices (current_price <= 0, current_price > deal_price * 2), (3) expired deals (end_date in the past but still listed), (4) missing category or investable flag, (5) countdown mismatch (countdown != end_date - today). Rules should be configurable and extensible.
**Definition of Done:**
- [ ] At least 5 validation rules implemented
- [ ] Each rule produces ValidationIssue with severity, message, and field reference
- [ ] Rules can be enabled/disabled via config
- [ ] Engine processes all rows in a snapshot in < 3 seconds
**Test Notes:** Insert a row with missing target -- verify error-level issue created. Insert a row with price > 2x deal price -- verify warning created. Insert an expired deal -- verify warning.
**Risks/Edge Cases:** Some "suspicious" values may be intentional (e.g., special situations with negative spread). Need stakeholder input on severity thresholds.

---

### TICKET-014: Create changelog UI component
**Phase:** 2 | **Priority:** P1 | **Depends on:** TICKET-011, TICKET-005
**Description:** Build a changelog panel/drawer on the `/ma-portfolio` page that shows recent SheetDiff records. Display as a chronological feed: "ACME Corp: deal_price changed from $45.00 to $46.50 (Feb 24)". Color-code by diff type (green=added, red=removed, yellow=changed). Allow filtering by date range and deal name. Show the most recent 50 changes by default.
**Definition of Done:**
- [ ] Changelog panel accessible from the portfolio page (button or side drawer)
- [ ] Diffs displayed chronologically with human-readable descriptions
- [ ] Color coding by diff type
- [ ] Filter by date range and deal name functional
- [ ] Empty state when no diffs exist
**Test Notes:** Create several diffs by ingesting after Sheet edits. Open changelog, verify all changes visible with correct details.
**Risks/Edge Cases:** High-change days (e.g., many price updates) may produce hundreds of diffs. Need pagination or virtual scroll.

---

### TICKET-015: Create validation issues queue page
**Phase:** 2 | **Priority:** P1 | **Depends on:** TICKET-013, TICKET-005
**Description:** Build a `/ma-portfolio/issues` page that displays all open ValidationIssues in a sortable, filterable table. Columns: Severity, Rule, Target, Field, Value, Message, Detected At. Allow resolving issues (mark resolved_by + resolved_at). Filter by severity and rule name. Show counts by severity in header badges.
**Definition of Done:**
- [ ] Page loads at `/ma-portfolio/issues` with open issues
- [ ] Issues sortable and filterable by severity and rule
- [ ] Resolve button marks issue as resolved with timestamp and user
- [ ] Severity badges show counts (e.g., "3 errors, 12 warnings")
- [ ] Resolved issues hidden by default, toggleable
**Test Notes:** Generate validation issues, visit page, verify display. Resolve an issue, reload, verify it disappears from default view. Toggle resolved filter, verify it reappears.
**Risks/Edge Cases:** Bulk resolution needed if many issues share the same root cause. Consider "resolve all for rule" action.

---

### TICKET-016: Deal history timeline component
**Phase:** 2 | **Priority:** P2 | **Depends on:** TICKET-011, TICKET-005
**Description:** Build a per-deal timeline component showing the history of changes for a specific (target, acquiror) pair. Display as a vertical timeline: each entry shows the date, which fields changed, and old/new values. Accessible by clicking a deal row in the portfolio table (opens as a slide-out panel or dedicated sub-page). Include the initial appearance (first snapshot containing this deal).
**Definition of Done:**
- [ ] Clicking a deal row opens the history timeline
- [ ] Timeline shows all changes chronologically
- [ ] First appearance shown as "Deal added" entry
- [ ] Price changes show direction indicator (up/down arrow)
- [ ] Timeline loads in < 2 seconds for deals with 100+ changes
**Test Notes:** Pick a deal that has had multiple price changes. Open timeline, verify all changes present with correct dates and values.
**Risks/Edge Cases:** Deals that appear, disappear, and reappear need careful handling. Very old deals may have thousands of changes.

---

## Phase 3 -- EDGAR/News Enrichment

### TICKET-017: Create EnrichedFact + SourceDocument DB migration (026)
**Phase:** 3 | **Priority:** P0 | **Depends on:** TICKET-001
**Description:** Add Prisma migration 026 creating `EnrichedFact` and `SourceDocument` tables. `SourceDocument` stores fetched documents (id, deal_target, deal_acquiror, source_type [edgar_filing|news_article|press_release], source_url, title, published_at, fetched_at, raw_content_path, content_hash). `EnrichedFact` stores extracted facts (id, source_document_id, deal_target, deal_acquiror, fact_type [closing_date|termination_fee|regulatory_status|shareholder_vote|price_adjustment], fact_value, confidence, extracted_by [claude|regex|manual], extracted_at, verified, verified_by). Index on (deal_target, deal_acquiror, fact_type).
**Definition of Done:**
- [ ] Migration 026 applies cleanly on top of 024+025
- [ ] Both tables visible in Prisma Studio with correct schema
- [ ] Foreign key from EnrichedFact to SourceDocument enforced
- [ ] Content deduplication possible via content_hash
**Test Notes:** Run full migration chain. Insert test SourceDocument + EnrichedFact, verify FK constraints and indexes.
**Risks/Edge Cases:** Raw content storage -- full filing text can be large. Consider storing on disk/S3 with path reference rather than in DB.

---

### TICKET-018: Adapt existing monitors for enrichment mode
**Phase:** 3 | **Priority:** P0 | **Depends on:** TICKET-017
**Description:** Modify the existing EDGAR poller/detector and news monitors (from py_proj) to operate in "enrichment mode": instead of discovering new M&A deals, they look up known deals from the SheetRow table and fetch relevant filings/articles for those specific targets and acquirors. Create a deal-to-CIK mapping for EDGAR lookups. News monitors should search for "[Target] [Acquiror] merger" and similar queries. Store results as SourceDocument records.
**Definition of Done:**
- [ ] EDGAR poller fetches filings for known deals by CIK lookup
- [ ] News monitor fetches articles for known deals by name search
- [ ] Results stored as SourceDocument records with deduplication (content_hash)
- [ ] Existing discovery mode still works (not broken by changes)
- [ ] At least 3 filing types supported (SC 14D-9, DEFM14A, 8-K)
**Test Notes:** Run enrichment for a known deal with recent EDGAR filings. Verify SourceDocuments created with correct metadata. Run again, verify no duplicates.
**Risks/Edge Cases:** CIK lookup may fail for recently announced deals. Company name variations (abbreviations, "Inc" vs "Corp") complicate news search. Rate limiting on EDGAR (10 req/sec).

---

### TICKET-019: Build enrichment worker
**Phase:** 3 | **Priority:** P0 | **Depends on:** TICKET-018
**Description:** Create a background worker that orchestrates the enrichment pipeline for all active deals. For each deal in the latest SheetSnapshot: (1) check when it was last enriched, (2) if stale (> 24 hours or never), run EDGAR + news fetch, (3) store new SourceDocuments, (4) trigger fact extraction (TICKET-020). Worker should process deals in parallel (max 3 concurrent) with backoff on rate limits. Expose status via a simple API endpoint.
**Definition of Done:**
- [ ] Worker processes all active deals and fetches new sources
- [ ] Skips recently-enriched deals (< 24 hours)
- [ ] Respects rate limits with backoff
- [ ] Status endpoint shows: deals_total, deals_enriched, deals_pending, last_run
- [ ] Worker can be triggered manually or on schedule
**Test Notes:** Run worker with 5 active deals. Verify SourceDocuments created for each. Run again immediately, verify all skipped (recently enriched).
**Risks/Edge Cases:** Worker crashing mid-run should not leave deals in a broken state. Need idempotent processing. Large number of active deals (50+) may take a long time.

---

### TICKET-020: Claude AI fact extraction pipeline
**Phase:** 3 | **Priority:** P1 | **Depends on:** TICKET-017, TICKET-019
**Description:** Build a fact extraction pipeline that uses the Claude API (via the existing intelligence orchestrator) to extract structured facts from SourceDocuments. For each unprocessed SourceDocument, send the content to Claude with a prompt requesting extraction of: expected closing date, termination fee, regulatory approvals needed/received, shareholder vote date/result, price adjustments, material conditions. Parse Claude's structured response into EnrichedFact records with confidence scores.
**Definition of Done:**
- [ ] Pipeline processes unprocessed SourceDocuments
- [ ] Facts extracted with correct fact_type and confidence
- [ ] Extracted_by field set to "claude"
- [ ] Token usage logged for cost tracking
- [ ] Handles Claude API errors gracefully (retry once, then skip)
- [ ] At least 5 fact types extracted correctly from test documents
**Test Notes:** Feed a known DEFM14A filing through the pipeline. Verify extracted closing date and termination fee match the filing. Check confidence scores are reasonable.
**Risks/Edge Cases:** Claude may hallucinate facts not in the document -- confidence scoring helps but is not foolproof. Very long filings may exceed context window; need chunking strategy. Cost per document depends on filing length.

---

### TICKET-021: Evidence storage + citation system
**Phase:** 3 | **Priority:** P1 | **Depends on:** TICKET-020
**Description:** Enhance fact extraction to include evidence citations. Each EnrichedFact should reference the specific passage(s) in the SourceDocument that support it. Add an `evidence_text` field to EnrichedFact (the relevant excerpt, max 1000 chars) and a `source_location` field (page number, section, or character offset). When displaying facts in the UI, show the citation with a link to the full source document.
**Definition of Done:**
- [ ] EnrichedFact includes evidence_text and source_location
- [ ] Evidence is a direct quote or close paraphrase from the source
- [ ] UI displays evidence alongside each fact
- [ ] Clicking evidence opens/scrolls to the source passage
**Test Notes:** Extract a fact with evidence. Verify the evidence text appears in the original document at the cited location.
**Risks/Edge Cases:** Character offsets may drift if document is reformatted. Section references more robust than offsets. Evidence text may contain sensitive content that needs sanitization.

---

### TICKET-022: Per-deal enrichment page (filings, news, timeline)
**Phase:** 3 | **Priority:** P1 | **Depends on:** TICKET-020, TICKET-021
**Description:** Build a `/ma-portfolio/deals/[target-acquiror]` page showing all enrichment data for a specific deal. Sections: (1) Deal Summary (current Sheet data + computed fields), (2) Extracted Facts table with evidence citations, (3) Source Documents list (filings + news) with links, (4) Enrichment Timeline (chronological view of when sources were fetched and facts extracted). Accessible by clicking a deal in the portfolio table.
**Definition of Done:**
- [ ] Page loads with deal summary from latest SheetRow
- [ ] Extracted facts displayed with confidence badges and evidence
- [ ] Source documents listed with type, title, date, and external link
- [ ] Timeline shows enrichment activity chronologically
- [ ] Page handles deals with no enrichment data (shows "not yet enriched" state)
**Test Notes:** Navigate to a deal with enrichment data. Verify all sections populated. Navigate to a deal without enrichment, verify empty state.
**Risks/Edge Cases:** URL slug generation for deal names with special characters. Very active deals may have dozens of source documents.

---

### TICKET-023: Enrichment scheduling (daily + on-demand)
**Phase:** 3 | **Priority:** P2 | **Depends on:** TICKET-019
**Description:** Schedule the enrichment worker to run daily at 8 AM ET (after the 7 AM ingest completes and reconciliation finishes). Also add an "Enrich Now" button on the per-deal page that triggers enrichment for a single deal on demand. On-demand enrichment bypasses the 24-hour cooldown. Add enrichment status indicators to the portfolio table (last enriched timestamp, stale indicator).
**Definition of Done:**
- [ ] Daily enrichment runs at 8 AM ET on weekdays
- [ ] On-demand single-deal enrichment works from the deal page
- [ ] Portfolio table shows last_enriched_at per deal
- [ ] Stale indicator (> 48 hours) visible in table
- [ ] On-demand enrichment does not interfere with scheduled batch run
**Test Notes:** Trigger on-demand enrichment for one deal, verify it completes independently. Wait for scheduled run, verify all deals processed.
**Risks/Edge Cases:** On-demand enrichment during a batch run could cause duplicate fetches. Need locking or deduplication per deal.

---

## Phase 4 -- Suggestion Engine

### TICKET-024: Create Suggestion + TradeIdea DB migration (027)
**Phase:** 4 | **Priority:** P0 | **Depends on:** TICKET-017
**Description:** Add Prisma migration 027 creating `Suggestion` and `TradeIdea` tables. `Suggestion` stores fact-vs-sheet discrepancies (id, deal_target, deal_acquiror, suggestion_type [date_mismatch|price_adjustment|risk_change|new_info], sheet_field, sheet_value, enriched_value, confidence, evidence_summary, status [pending|accepted|rejected|deferred], reviewed_by, reviewed_at, created_at). `TradeIdea` stores AI-generated trade suggestions (id, deal_target, deal_acquiror, idea_type [spread_opportunity|risk_warning|catalyst_alert], title, thesis, supporting_facts JSON, confidence, status [pending|accepted|rejected], reviewed_by, reviewed_at, created_at). Index on (status, created_at).
**Definition of Done:**
- [ ] Migration 027 applies cleanly on top of 024-026
- [ ] Both tables have correct schema and indexes
- [ ] Status enum values enforced
- [ ] Rollback drops tables cleanly
**Test Notes:** Run full migration chain. Insert test Suggestion and TradeIdea, verify constraints.
**Risks/Edge Cases:** Suggestion and TradeIdea may need to reference specific EnrichedFacts. Consider adding a join table or JSON array of fact IDs.

---

### TICKET-025: Build fact-vs-sheet comparison engine
**Phase:** 4 | **Priority:** P0 | **Depends on:** TICKET-024, TICKET-020
**Description:** Implement a comparison engine that checks EnrichedFacts against the current SheetRow data for each deal. Detect discrepancies: (1) closing date in filing differs from Sheet's End Date, (2) deal price adjusted in filing but not in Sheet, (3) new risk factors identified in filings not reflected in Sheet risk columns, (4) regulatory milestones reached (approval/rejection) not noted in Sheet. Generate Suggestion records for each discrepancy found.
**Definition of Done:**
- [ ] Engine compares facts to sheet data for all active deals
- [ ] At least 4 comparison rules implemented
- [ ] Suggestions created with correct type, values, and confidence
- [ ] Duplicate suggestions not created for already-known discrepancies
- [ ] Engine runs in < 30 seconds for 50 deals with 200 facts total
**Test Notes:** Manually create an EnrichedFact with a closing date different from the Sheet. Run engine, verify Suggestion created with correct sheet_value and enriched_value.
**Risks/Edge Cases:** Fuzzy matching needed for dates (Sheet may say "Q2 2026" while filing says "June 15, 2026"). Confidence scoring should account for fact extraction confidence.

---

### TICKET-026: Suggestion generation with confidence scoring
**Phase:** 4 | **Priority:** P1 | **Depends on:** TICKET-025
**Description:** Enhance the comparison engine with a confidence scoring model. Factors: (1) source document recency (newer = higher), (2) fact extraction confidence from Claude, (3) number of corroborating sources, (4) magnitude of discrepancy. Final confidence is a weighted composite (0.0-1.0). Only generate Suggestions above a configurable threshold (default 0.5). Include evidence_summary with the top supporting facts.
**Definition of Done:**
- [ ] Confidence score computed for each potential suggestion
- [ ] Suggestions below threshold suppressed
- [ ] Evidence summary includes top 3 supporting facts
- [ ] Threshold configurable via environment variable
- [ ] Score breakdown visible in suggestion detail
**Test Notes:** Create facts with varying confidence and recency. Verify composite scores are reasonable. Test threshold by setting it high (0.9) and verifying only strong suggestions pass.
**Risks/Edge Cases:** Over-aggressive threshold hides valid suggestions. Under-aggressive threshold floods the review queue. Need to tune based on real-world data.

---

### TICKET-027: Human review queue UI
**Phase:** 4 | **Priority:** P1 | **Depends on:** TICKET-026
**Description:** Build a `/ma-portfolio/suggestions` page displaying all pending Suggestions in a review queue. Each card shows: deal name, suggestion type, sheet value vs enriched value, confidence score, evidence summary with citations. Sort by confidence descending (most actionable first). Include filters by type, confidence range, and deal.
**Definition of Done:**
- [ ] Page displays pending suggestions as reviewable cards
- [ ] Each card shows all relevant fields including evidence
- [ ] Sortable by confidence, date, type
- [ ] Filterable by type, confidence range, deal name
- [ ] Count badges for pending suggestions in navigation
**Test Notes:** Create 10 suggestions with varying confidence. Verify sort order. Apply filters, verify correct subset shown.
**Risks/Edge Cases:** Large backlog of suggestions may be overwhelming. Consider grouping by deal or priority tiers.

---

### TICKET-028: Accept/reject workflow with audit trail
**Phase:** 4 | **Priority:** P1 | **Depends on:** TICKET-027
**Description:** Add accept/reject/defer actions to each suggestion in the review queue. On accept: mark status as "accepted", record reviewer and timestamp, optionally apply the change (update Sheet or flag for manual Sheet update). On reject: mark as "rejected" with optional reason. On defer: mark as "deferred" for later review. All actions create an audit log entry. Show review history on the deal enrichment page.
**Definition of Done:**
- [ ] Accept, reject, and defer buttons on each suggestion card
- [ ] Status updated with reviewer identity and timestamp
- [ ] Optional rejection reason captured
- [ ] Audit trail queryable per deal
- [ ] Accepted suggestions surfaced on deal enrichment page as "confirmed changes"
**Test Notes:** Accept a suggestion, verify status change and audit entry. Reject with reason, verify reason stored. Defer, verify status.
**Risks/Edge Cases:** Concurrent reviewers accepting/rejecting the same suggestion. Need optimistic locking or last-write-wins with notification.

---

### TICKET-029: Trade idea generator
**Phase:** 4 | **Priority:** P2 | **Depends on:** TICKET-025, TICKET-020
**Description:** Build a trade idea generator that uses Claude to synthesize EnrichedFacts and SheetRow data into actionable trade ideas. For each deal, send current spread, enrichment facts, recent changes, and risk factors to Claude with a prompt requesting: (1) spread opportunity analysis, (2) risk warnings, (3) catalyst alerts (upcoming events that could move the spread). Store as TradeIdea records. Run after each enrichment cycle.
**Definition of Done:**
- [ ] Trade ideas generated for deals with sufficient enrichment data
- [ ] At least 3 idea types supported (spread_opportunity, risk_warning, catalyst_alert)
- [ ] Ideas include thesis text and supporting fact references
- [ ] Token usage and cost logged
- [ ] Ideas are de-duplicated (similar idea within 7 days not regenerated)
**Test Notes:** Run generator for a deal with rich enrichment data. Verify trade idea has coherent thesis and references real facts. Run again within 7 days, verify no duplicate.
**Risks/Edge Cases:** AI-generated trade ideas must include disclaimers. Ideas may become stale quickly in fast-moving situations. Cost scaling with number of deals.

---

### TICKET-030: Trade ideas page
**Phase:** 4 | **Priority:** P2 | **Depends on:** TICKET-029, TICKET-028
**Description:** Build a `/ma-portfolio/trade-ideas` page displaying TradeIdea records. Each idea shown as a card with: deal name, idea type (color-coded), title, thesis, confidence, supporting facts, and accept/reject controls. Filter by type, confidence, and status. Accepted ideas move to a "watchlist" section. Include a link from the portfolio table to the deal's trade ideas.
**Definition of Done:**
- [ ] Page displays trade ideas as cards with all fields
- [ ] Color-coded by type (green=opportunity, red=warning, yellow=catalyst)
- [ ] Accept/reject workflow with audit trail
- [ ] Watchlist section for accepted ideas
- [ ] Link from portfolio table row to deal's trade ideas
**Test Notes:** Generate trade ideas for 3 deals. Visit page, verify cards display correctly. Accept one, verify it moves to watchlist.
**Risks/Edge Cases:** Mixing AI-generated content with human-reviewed content needs clear visual distinction. Stale ideas should auto-expire or be flagged.

---

## Phase 5 -- Intraday Monitoring + Alerts

### TICKET-031: Create SpreadObservation + AlertSetting DB migration (028)
**Phase:** 5 | **Priority:** P0 | **Depends on:** TICKET-001
**Description:** Add Prisma migration 028 creating `SpreadObservation` and `AlertSetting` tables. `SpreadObservation` stores intraday price/spread snapshots (id, deal_target, deal_acquiror, observed_at, current_price, deal_price, gross_spread, annualized_yield, source [polygon|manual], volume, options_activity_flag). `AlertSetting` stores per-deal or global alert thresholds (id, deal_target, deal_acquiror [null for global], alert_type [spread_widening|spread_tightening|volume_spike|options_activity|price_drop], threshold_value, threshold_unit [percent|absolute|stddev], enabled, cooldown_minutes, created_by, created_at). `AlertEvent` table for fired alerts (id, alert_setting_id, spread_observation_id, fired_at, message, acknowledged, acknowledged_at).
**Definition of Done:**
- [ ] Migration 028 applies cleanly on top of 024-027
- [ ] All three tables created with correct schema
- [ ] AlertSetting supports both per-deal and global (null target) settings
- [ ] Indexes on (deal_target, observed_at) for time-series queries
**Test Notes:** Run full migration chain. Insert sample SpreadObservation, AlertSetting, and AlertEvent. Verify FK constraints.
**Risks/Edge Cases:** SpreadObservation table will grow rapidly (6 tabs x N deals x 78 observations/day). Need retention policy or partitioning strategy.

---

### TICKET-032: Build spread monitor worker (5-min polling)
**Phase:** 5 | **Priority:** P0 | **Depends on:** TICKET-031, TICKET-002
**Description:** Create a background worker that polls current prices for all active deals every 5 minutes during market hours (9:30 AM - 4:00 PM ET, weekdays). Use the existing Polygon data integration to fetch real-time prices. For each deal, compute current spread and annualized yield, then store as SpreadObservation. Worker should handle Polygon rate limits and missing tickers gracefully.
**Definition of Done:**
- [ ] Worker polls every 5 minutes during market hours
- [ ] SpreadObservation created for each active deal per poll
- [ ] Polygon API integration reused from existing codebase
- [ ] Graceful handling of missing tickers (log warning, skip deal)
- [ ] Worker status endpoint shows last_poll, deals_polled, errors
- [ ] Worker idle outside market hours and on weekends
**Test Notes:** Start worker during market hours. Verify SpreadObservations created every 5 minutes. Check a known ticker's price matches Polygon data. Test with an invalid ticker, verify warning logged.
**Risks/Edge Cases:** Polygon rate limits with many tickers. Ticker symbol mapping (target company ticker may differ from Sheet's company name). Pre/post market pricing may not be available.

---

### TICKET-033: Options activity monitor
**Phase:** 5 | **Priority:** P1 | **Depends on:** TICKET-031, TICKET-032
**Description:** Integrate the existing options scanner to monitor unusual options activity for deals in the portfolio. For each deal's target ticker, check for: (1) volume spikes above 2x 20-day average, (2) large block trades, (3) significant open interest changes, (4) unusual put/call ratio shifts. Flag SpreadObservations with `options_activity_flag = true` when anomalies detected. Store detailed options data for review.
**Definition of Done:**
- [ ] Options activity checked alongside each spread observation poll
- [ ] At least 4 anomaly detection rules implemented
- [ ] SpreadObservation flagged when anomalies detected
- [ ] Detailed options data accessible per observation
- [ ] Handles deals without listed options gracefully
**Test Notes:** Run monitor for a deal known to have active options. Verify options data captured. Manually set a low volume threshold to trigger an anomaly flag.
**Risks/Edge Cases:** Not all M&A targets have listed options. Options data may be delayed. False positives on expiration-week volume spikes.

---

### TICKET-034: Alert engine with thresholds + dedup
**Phase:** 5 | **Priority:** P0 | **Depends on:** TICKET-031, TICKET-032
**Description:** Build an alert engine that evaluates each new SpreadObservation against AlertSettings. For each matching setting: (1) check if threshold breached, (2) check cooldown (don't re-fire within cooldown_minutes of last fire for same setting), (3) create AlertEvent if threshold breached and not in cooldown. Support alert types: spread widening > X%, spread tightening > X%, absolute price drop > $Y, volume spike > Z%, options activity detected. Deduplicate by (alert_setting_id, deal) within the cooldown window.
**Definition of Done:**
- [ ] Alert engine evaluates all settings on each new observation
- [ ] Alerts fire when thresholds breached
- [ ] Cooldown prevents duplicate alerts within configured window
- [ ] AlertEvent created with descriptive message
- [ ] At least 5 alert types functional
- [ ] Engine processes 100 observations x 20 settings in < 5 seconds
**Test Notes:** Create an AlertSetting for spread widening > 5%. Insert a SpreadObservation with 6% widening. Verify alert fires. Insert another within cooldown, verify no duplicate. Wait past cooldown, insert again, verify new alert fires.
**Risks/Edge Cases:** Threshold evaluation needs a baseline (previous observation or daily open). Cascading alerts if spread moves sharply then oscillates around threshold. Consider hysteresis.

---

### TICKET-035: Intraday monitor dashboard page
**Phase:** 5 | **Priority:** P1 | **Depends on:** TICKET-032, TICKET-034
**Description:** Build a `/ma-portfolio/monitor` page showing real-time intraday data. Display: (1) deal table with latest spread, yield, price change since open, volume, and alert indicators, (2) mini sparkline charts showing intraday spread movement per deal, (3) active alerts banner at top. Auto-refresh every 60 seconds (or websocket if feasible). Highlight deals with active alerts in the table.
**Definition of Done:**
- [ ] Page shows latest intraday data for all active deals
- [ ] Sparkline charts show intraday spread movement
- [ ] Active alerts displayed prominently
- [ ] Auto-refresh updates data without full page reload
- [ ] Deals with alerts highlighted with color/icon
- [ ] Market closed state shown outside trading hours
**Test Notes:** Load page during market hours, verify data updates. Trigger an alert, verify it appears in the banner and the deal row is highlighted. Load outside market hours, verify closed state.
**Risks/Edge Cases:** High refresh rate with many deals may strain the API. Sparkline rendering performance with 50+ deals. Stale data indicator if Polygon feed is delayed.

---

### TICKET-036: Alert history + settings page
**Phase:** 5 | **Priority:** P1 | **Depends on:** TICKET-034
**Description:** Build a `/ma-portfolio/alerts` page with two sections: (1) Alert History -- chronological list of all AlertEvents with deal name, type, message, fired_at, and acknowledge button. Filterable by deal, type, date range. (2) Alert Settings -- CRUD interface for AlertSettings. Create new settings (global or per-deal), edit thresholds, toggle enabled/disabled, set cooldown. Default settings pre-populated for new installs.
**Definition of Done:**
- [ ] Alert history displays all fired alerts chronologically
- [ ] Acknowledge button marks alert as seen with timestamp
- [ ] Settings CRUD: create, read, update, delete alert settings
- [ ] Default alert settings created on first setup
- [ ] Filter and search functional for both sections
**Test Notes:** Create alert settings, trigger alerts, visit page. Verify history shows alerts. Acknowledge one, verify timestamp set. Edit a setting's threshold, verify change persisted.
**Risks/Edge Cases:** Deleting an AlertSetting with existing AlertEvents -- cascade or orphan? Recommend soft-delete (disable) rather than hard delete.

---

### TICKET-037: Alert notification channels (email + dashboard)
**Phase:** 5 | **Priority:** P2 | **Depends on:** TICKET-034
**Description:** Add notification delivery to the alert engine. When an AlertEvent fires, deliver notifications via configured channels: (1) Dashboard -- already covered by TICKET-035 banner, (2) Email -- send a formatted email with deal name, alert type, current spread, threshold, and a link to the monitor page. Use a simple SMTP integration or existing email service. Make channels configurable per AlertSetting (some alerts email-worthy, others dashboard-only).
**Definition of Done:**
- [ ] Email notifications sent for email-enabled alerts
- [ ] Email includes deal details, alert info, and dashboard link
- [ ] Channel preference configurable per AlertSetting
- [ ] Email delivery failures logged, do not block alert processing
- [ ] Rate limiting on emails (max 10 per hour per setting)
**Test Notes:** Configure an alert with email enabled. Trigger alert, verify email received with correct content. Trigger 15 alerts rapidly, verify rate limiting kicks in after 10.
**Risks/Edge Cases:** Email deliverability (SPF/DKIM setup). Sensitive financial data in emails -- consider encryption or links-only approach. Alert storms could flood inbox even with rate limiting.

---

## Summary

| Phase | Tickets | Priority Breakdown |
|-------|---------|-------------------|
| 1 -- Sheet Ingest + Storage + UI | TICKET-001 through TICKET-009 | 3x P0, 3x P1, 2x P2, 1x P1 |
| 2 -- Validation + Reconciliation | TICKET-010 through TICKET-016 | 2x P0, 4x P1, 1x P2 |
| 3 -- EDGAR/News Enrichment | TICKET-017 through TICKET-023 | 3x P0, 3x P1, 1x P2 |
| 4 -- Suggestion Engine | TICKET-024 through TICKET-030 | 2x P0, 3x P1, 2x P2 |
| 5 -- Intraday Monitoring + Alerts | TICKET-031 through TICKET-037 | 3x P0, 3x P1, 1x P2 |
| **Total** | **37 tickets** | **13x P0, 16x P1, 8x P2** |

### Critical Path

```
TICKET-001 (DB schema)
  --> TICKET-002 (ingest)
    --> TICKET-003 (cron)
    --> TICKET-005 (UI) --> TICKET-006 (tabs)
  --> TICKET-010 (diff schema) --> TICKET-011 (diff engine) --> TICKET-014 (changelog)
  --> TICKET-017 (enrichment schema) --> TICKET-018 (monitors) --> TICKET-019 (worker) --> TICKET-020 (extraction)
    --> TICKET-025 (comparison) --> TICKET-026 (scoring) --> TICKET-027 (review queue)
  --> TICKET-031 (monitoring schema) --> TICKET-032 (spread monitor) --> TICKET-034 (alert engine)
```

All P0 tickets should be completed before advancing to the next phase's P1 tickets.
