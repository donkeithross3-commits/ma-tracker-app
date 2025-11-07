# EDGAR Automation & Research Pipeline - Comprehensive Plan

**Goal:** Automatically monitor SEC EDGAR for new M&A deal announcements and trigger research analysis in real-time.

**Status:** Planning Phase
**Priority:** High
**Estimated Complexity:** Medium-High
**Implementation Time:** 2-3 days

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [EDGAR Data Sources](#edgar-data-sources)
4. [Filing Type Detection](#filing-type-detection)
5. [Database Schema](#database-schema)
6. [Processing Pipeline](#processing-pipeline)
7. [Service Design](#service-design)
8. [Implementation Phases](#implementation-phases)
9. [Error Handling](#error-handling)
10. [Monitoring & Alerts](#monitoring--alerts)
11. [Cost Analysis](#cost-analysis)

---

## Overview

### What We're Building

An automated system that:
1. **Monitors** SEC EDGAR RSS feeds every 5-10 minutes
2. **Detects** M&A related filings (8-K, SC 13D, DEFM14A, etc.)
3. **Parses** filing data to extract deal information
4. **Creates** new deal entries in database automatically
5. **Triggers** comprehensive research analysis
6. **Notifies** users of new deals via dashboard/email

### Key Benefits

- ✅ **Real-time detection** - Know about deals within minutes of SEC filing
- ✅ **Automated research** - Full analysis generated automatically
- ✅ **Comprehensive coverage** - Never miss a deal announcement
- ✅ **Competitive advantage** - Get deal info before competitors manually search
- ✅ **Time savings** - No manual monitoring of EDGAR

---

## Architecture

### High-Level Components

```
┌─────────────────────────────────────────────────────────────┐
│                     EDGAR Monitoring System                  │
└─────────────────────────────────────────────────────────────┘

┌──────────────────┐         ┌──────────────────┐
│   SEC EDGAR      │         │   RSS Feed       │
│   API/RSS        ├────────►│   Poller         │
│   (every 5 min)  │         │   (Python)       │
└──────────────────┘         └────────┬─────────┘
                                      │
                                      ▼
                             ┌──────────────────┐
                             │  Filing Parser   │
                             │  (Extract M&A)   │
                             └────────┬─────────┘
                                      │
                                      ▼
                             ┌──────────────────┐
                             │  Deal Detector   │
                             │  (Deduplicate)   │
                             └────────┬─────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    │                 │                 │
                    ▼                 ▼                 ▼
          ┌─────────────────┐ ┌──────────────┐ ┌──────────────┐
          │   Database       │ │   Research   │ │  Notification│
          │   (Store Deal)   │ │   Queue      │ │  Service     │
          └─────────────────┘ └──────┬───────┘ └──────────────┘
                                      │
                                      ▼
                             ┌──────────────────┐
                             │  Research Worker │
                             │  (Generate AI    │
                             │   Analysis)      │
                             └──────────────────┘
```

### Service Architecture

**Option A: Single Python Service (Recommended for MVP)**
```
python-service/
├── app/
│   ├── edgar/
│   │   ├── __init__.py
│   │   ├── poller.py          # RSS feed polling
│   │   ├── parser.py          # Parse filing XML/HTML
│   │   ├── detector.py        # Detect M&A deals
│   │   └── enricher.py        # Add metadata
│   ├── workers/
│   │   ├── __init__.py
│   │   ├── edgar_worker.py    # Background polling
│   │   └── research_worker.py # Research generation
│   └── scheduler.py           # Job scheduling
```

**Option B: Separate Microservice**
```
edgar-monitor-service/
├── poller.py
├── parser.py
├── worker.py
└── config.py
```

**Recommendation:** Start with Option A (single service) for simplicity, can extract later if needed.

---

## EDGAR Data Sources

### 1. SEC EDGAR RSS Feeds (Primary - Recommended)

**Latest Filings RSS:**
- URL: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&CIK=&type=&company=&dateb=&owner=include&start=0&count=100&output=atom`
- Updates: Every 10 minutes during market hours
- Format: Atom XML
- Rate Limit: 10 requests/second (generous)

**Pros:**
- ✅ Real-time updates
- ✅ Easy to parse (XML)
- ✅ No API key required
- ✅ Reliable

**Cons:**
- ❌ Need to filter for relevant filing types
- ❌ May include amendments/corrections

### 2. SEC EDGAR Full-Text Search API

**Endpoint:**
- URL: `https://efts.sec.gov/LATEST/search-index`
- Method: POST with JSON query
- Rate Limit: 10 requests/second

**Example Query:**
```json
{
  "dateRange": "custom",
  "startdt": "2025-01-01",
  "enddt": "2025-12-31",
  "forms": ["8-K", "SC 13D", "DEFM14A"],
  "q": "merger OR acquisition OR tender offer"
}
```

**Pros:**
- ✅ Can search full text of filings
- ✅ Better filtering
- ✅ Returns more metadata

**Cons:**
- ❌ Slight delay (5-15 minutes after filing)
- ❌ More complex parsing

### 3. Third-Party APIs (Optional Enhancement)

**sec-api.io:**
- Real-time webhooks
- Pre-parsed data
- Cost: $50-200/month

**Recommendation:** Start with SEC RSS feeds (free, reliable), add third-party later if needed.

---

## Filing Type Detection

### M&A Relevant Filing Types

#### **Primary Indicators (High Confidence)**

1. **8-K Item 1.01** - Entry into Material Definitive Agreement
   - Merger agreements
   - Acquisition agreements
   - Purchase agreements

2. **8-K Item 2.01** - Completion of Acquisition or Disposition
   - Deal closed announcements

3. **SC TO** - Tender Offer Statement
   - Tender offers for public companies
   - Usually includes offer price

4. **SC 13D** - Beneficial Ownership Report
   - Large stake acquisitions (>5%)
   - May indicate upcoming acquisition

5. **DEFM14A** - Definitive Proxy Statement (Merger)
   - Detailed merger proxy
   - Vote information
   - Deal terms

6. **S-4** - Registration Statement (Mergers)
   - Stock-for-stock mergers
   - Detailed financials

#### **Secondary Indicators (Medium Confidence)**

7. **8-K Item 8.01** - Other Events
   - Sometimes used for deal announcements
   - Requires text analysis

8. **SC 13D/A** - Amendments
   - Changes in ownership
   - May indicate deal progress

9. **425** - Prospectus (Mergers)
   - Communications about business combinations

### Detection Logic

```python
def is_ma_relevant_filing(filing_type: str, filing_text: str) -> tuple[bool, float]:
    """
    Determine if a filing is M&A relevant.

    Returns:
        (is_relevant, confidence_score)
    """

    # High confidence filing types
    HIGH_CONFIDENCE_TYPES = {
        "8-K": ["1.01", "2.01"],  # Items
        "SC TO": 1.0,
        "SC 13D": 0.8,
        "DEFM14A": 1.0,
        "S-4": 0.9,
        "425": 0.85
    }

    # Keyword analysis
    MA_KEYWORDS = [
        "merger agreement",
        "acquisition agreement",
        "tender offer",
        "definitive agreement",
        "purchase agreement",
        "plan of merger",
        "transaction agreement"
    ]

    # Check filing type first
    if filing_type in HIGH_CONFIDENCE_TYPES:
        base_confidence = HIGH_CONFIDENCE_TYPES[filing_type]

        # For 8-K, check item numbers
        if filing_type == "8-K":
            if any(item in filing_text for item in ["1.01", "2.01"]):
                return True, 0.95
            else:
                return False, 0.0

        return True, base_confidence

    # Text analysis for other types
    keyword_matches = sum(1 for kw in MA_KEYWORDS if kw.lower() in filing_text.lower())

    if keyword_matches >= 2:
        confidence = min(0.7 + (keyword_matches * 0.1), 0.95)
        return True, confidence

    return False, 0.0
```

---

## Database Schema

### New Tables

#### 1. `edgar_filings` Table

Track all EDGAR filings we've processed:

```sql
CREATE TABLE edgar_filings (
    id SERIAL PRIMARY KEY,
    accession_number VARCHAR(20) UNIQUE NOT NULL,  -- e.g., "0001193125-25-012345"
    cik VARCHAR(10) NOT NULL,                      -- Company CIK
    company_name VARCHAR(255),
    ticker VARCHAR(10),
    filing_type VARCHAR(20),                       -- e.g., "8-K", "SC TO"
    filing_date TIMESTAMP NOT NULL,
    filing_url TEXT,
    html_url TEXT,
    xml_url TEXT,

    -- Detection metadata
    is_ma_relevant BOOLEAN DEFAULT FALSE,
    confidence_score FLOAT,                        -- 0.0 to 1.0
    detected_keywords TEXT[],

    -- Processing status
    status VARCHAR(20) DEFAULT 'pending',          -- pending, processed, ignored, error
    processed_at TIMESTAMP,
    error_message TEXT,

    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    -- Indexes
    INDEX idx_filing_date (filing_date DESC),
    INDEX idx_status (status),
    INDEX idx_ma_relevant (is_ma_relevant, confidence_score)
);
```

#### 2. `deal_filings` Join Table

Link deals to EDGAR filings (many-to-many):

```sql
CREATE TABLE deal_filings (
    id SERIAL PRIMARY KEY,
    deal_id INTEGER REFERENCES deals(id) ON DELETE CASCADE,
    filing_id INTEGER REFERENCES edgar_filings(id) ON DELETE CASCADE,

    -- Relationship metadata
    relationship_type VARCHAR(50),  -- "initial_announcement", "completion", "amendment", "proxy"
    relevance_score FLOAT,          -- How relevant this filing is to the deal
    notes TEXT,

    created_at TIMESTAMP DEFAULT NOW(),

    -- Ensure no duplicates
    UNIQUE(deal_id, filing_id),
    INDEX idx_deal_filings (deal_id),
    INDEX idx_filing_deals (filing_id)
);
```

#### 3. `research_queue` Table

Queue for research generation jobs:

```sql
CREATE TABLE research_queue (
    id SERIAL PRIMARY KEY,
    deal_id INTEGER REFERENCES deals(id) ON DELETE CASCADE,

    -- Queue metadata
    priority INTEGER DEFAULT 5,                    -- 1 (low) to 10 (high)
    status VARCHAR(20) DEFAULT 'pending',          -- pending, processing, completed, failed

    -- Processing info
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    error_message TEXT,

    -- Research configuration
    analyzer_types TEXT[],                         -- ["topping_bid", "antitrust", "contract"]
    options JSON,                                  -- Additional options

    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    INDEX idx_status_priority (status, priority DESC, created_at),
    INDEX idx_deal_queue (deal_id)
);
```

#### 4. `edgar_polling_log` Table

Track polling activity for debugging:

```sql
CREATE TABLE edgar_polling_log (
    id SERIAL PRIMARY KEY,
    poll_timestamp TIMESTAMP DEFAULT NOW(),
    filings_fetched INTEGER,
    new_filings INTEGER,
    ma_relevant_filings INTEGER,
    errors INTEGER,
    duration_ms INTEGER,
    last_accession_number VARCHAR(20),

    INDEX idx_poll_timestamp (poll_timestamp DESC)
);
```

### Schema Updates to Existing Tables

#### Update `deals` Table

Add fields to track EDGAR automation:

```sql
ALTER TABLE deals ADD COLUMN auto_created BOOLEAN DEFAULT FALSE;
ALTER TABLE deals ADD COLUMN source VARCHAR(50) DEFAULT 'manual';  -- manual, edgar_8k, edgar_sc_to, etc.
ALTER TABLE deals ADD COLUMN confidence_score FLOAT;
ALTER TABLE deals ADD COLUMN first_filing_date TIMESTAMP;
ALTER TABLE deals ADD COLUMN needs_review BOOLEAN DEFAULT FALSE;
```

---

## Processing Pipeline

### Step-by-Step Flow

#### **Step 1: Poll EDGAR RSS Feed**

**Frequency:** Every 5 minutes

**Process:**
```python
async def poll_edgar_rss():
    """Poll SEC EDGAR RSS feed for new filings."""

    # 1. Fetch RSS feed
    rss_url = "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&output=atom"
    response = await http_client.get(rss_url, headers={"User-Agent": "YourCompany info@yourcompany.com"})

    # 2. Parse XML
    feed = feedparser.parse(response.text)

    # 3. Extract filings
    new_filings = []
    for entry in feed.entries:
        accession_number = extract_accession_number(entry.link)

        # Check if already processed
        if await db.filing_exists(accession_number):
            continue

        filing = {
            "accession_number": accession_number,
            "cik": entry.get("edgar_cik"),
            "company_name": entry.get("edgar_companyname"),
            "filing_type": entry.get("edgar_formtype"),
            "filing_date": entry.published,
            "filing_url": entry.link,
        }

        new_filings.append(filing)

    # 4. Store in database
    for filing in new_filings:
        await db.create_filing(filing)

    # 5. Log polling activity
    await db.log_poll(
        filings_fetched=len(feed.entries),
        new_filings=len(new_filings)
    )

    return new_filings
```

#### **Step 2: Detect M&A Relevance**

**Process:**
```python
async def detect_ma_relevance(filing: EdgarFiling):
    """Determine if filing is M&A relevant."""

    # 1. Quick check based on filing type
    if filing.filing_type in ["SC TO", "DEFM14A", "S-4"]:
        filing.is_ma_relevant = True
        filing.confidence_score = 1.0
        await db.update_filing(filing)
        return True

    # 2. For 8-K, fetch full document and check items
    if filing.filing_type == "8-K":
        filing_text = await fetch_filing_text(filing.html_url)

        # Check for M&A relevant items
        if "ITEM 1.01" in filing_text or "ITEM 2.01" in filing_text:
            # Analyze text for M&A keywords
            keywords = extract_ma_keywords(filing_text)

            if len(keywords) >= 2:
                filing.is_ma_relevant = True
                filing.confidence_score = 0.95
                filing.detected_keywords = keywords
                await db.update_filing(filing)
                return True

    # 3. For SC 13D, check if it's an acquisition
    if filing.filing_type in ["SC 13D", "SC 13D/A"]:
        filing_text = await fetch_filing_text(filing.html_url)

        # Look for purpose indicating acquisition
        if any(kw in filing_text.lower() for kw in ["acquisition", "merger", "tender offer"]):
            filing.is_ma_relevant = True
            filing.confidence_score = 0.85
            await db.update_filing(filing)
            return True

    # 4. Not M&A relevant
    filing.is_ma_relevant = False
    filing.confidence_score = 0.0
    await db.update_filing(filing)
    return False
```

#### **Step 3: Parse Deal Information**

**Process:**
```python
async def parse_deal_from_filing(filing: EdgarFiling) -> Optional[Deal]:
    """Extract deal information from filing."""

    # 1. Fetch full filing text
    filing_text = await fetch_filing_text(filing.html_url)

    # 2. Use LLM to extract structured data
    prompt = f"""
    Extract M&A deal information from this SEC filing.

    Filing Type: {filing.filing_type}
    Company: {filing.company_name} ({filing.ticker})

    Filing Excerpt:
    {filing_text[:5000]}

    Extract the following information:
    - Target Company Name
    - Target Ticker Symbol
    - Acquirer Company Name
    - Acquirer Ticker Symbol
    - Deal Value (if mentioned)
    - Deal Type (merger, acquisition, tender offer, etc.)
    - Cash vs. Stock (all cash, all stock, mixed)
    - Expected Closing Date (if mentioned)
    - Key Terms

    Return as JSON.
    """

    # 3. Call Anthropic API
    response = await anthropic_client.extract_deal_info(prompt)

    # 4. Parse response
    deal_info = json.loads(response)

    # 5. Create deal object
    deal = Deal(
        target_ticker=deal_info.get("target_ticker"),
        target_name=deal_info.get("target_name"),
        acquirer_name=deal_info.get("acquirer_name"),
        acquirer_ticker=deal_info.get("acquirer_ticker"),
        deal_value=parse_deal_value(deal_info.get("deal_value")),
        deal_type=deal_info.get("deal_type"),
        consideration_type=deal_info.get("consideration_type"),
        expected_close_date=parse_date(deal_info.get("expected_close_date")),

        # Metadata
        auto_created=True,
        source=f"edgar_{filing.filing_type.lower()}",
        confidence_score=filing.confidence_score,
        first_filing_date=filing.filing_date,
        status="pending_review"  # Requires manual verification
    )

    return deal
```

#### **Step 4: Deduplicate Deals**

**Process:**
```python
async def find_existing_deal(new_deal: Deal) -> Optional[Deal]:
    """Check if deal already exists in database."""

    # 1. Check by target ticker (exact match)
    if new_deal.target_ticker:
        existing = await db.find_deal_by_ticker(new_deal.target_ticker)
        if existing:
            return existing

    # 2. Check by company names (fuzzy match)
    if new_deal.target_name:
        candidates = await db.find_deals_by_name_similarity(new_deal.target_name)

        for candidate in candidates:
            # Calculate similarity score
            similarity = calculate_similarity(
                new_deal.target_name,
                candidate.target_name
            )

            if similarity > 0.85:
                return candidate

    # 3. No match found
    return None

async def handle_deal(new_deal: Deal, filing: EdgarFiling):
    """Create or update deal in database."""

    existing = await find_existing_deal(new_deal)

    if existing:
        # Link filing to existing deal
        await db.link_filing_to_deal(
            deal_id=existing.id,
            filing_id=filing.id,
            relationship_type="additional_filing"
        )

        # Update deal with new information if confidence is higher
        if new_deal.confidence_score > existing.confidence_score:
            await db.update_deal(existing.id, new_deal)
    else:
        # Create new deal
        deal_id = await db.create_deal(new_deal)

        # Link filing to deal
        await db.link_filing_to_deal(
            deal_id=deal_id,
            filing_id=filing.id,
            relationship_type="initial_announcement"
        )

        return deal_id
```

#### **Step 5: Queue Research Generation**

**Process:**
```python
async def queue_research_for_deal(deal_id: int):
    """Add deal to research queue."""

    # Check if already queued
    existing_job = await db.find_research_job(deal_id)
    if existing_job:
        return existing_job.id

    # Create research job
    job = ResearchJob(
        deal_id=deal_id,
        priority=8,  # High priority for auto-detected deals
        status="pending",
        analyzer_types=["topping_bid", "antitrust", "contract"],
        options={"auto_generated": True}
    )

    job_id = await db.create_research_job(job)

    return job_id
```

#### **Step 6: Process Research Queue**

**Process:**
```python
async def process_research_queue():
    """Process pending research jobs."""

    # 1. Get next job from queue
    job = await db.get_next_research_job()

    if not job:
        return

    # 2. Mark as processing
    job.status = "processing"
    job.started_at = datetime.now()
    await db.update_research_job(job)

    try:
        # 3. Generate research
        deal = await db.get_deal(job.deal_id)

        for analyzer_type in job.analyzer_types:
            await generate_research_report(
                deal_id=deal.id,
                analyzer_type=analyzer_type
            )

        # 4. Mark as completed
        job.status = "completed"
        job.completed_at = datetime.now()
        await db.update_research_job(job)

    except Exception as e:
        # 5. Handle errors
        job.attempts += 1
        job.error_message = str(e)

        if job.attempts >= job.max_attempts:
            job.status = "failed"
        else:
            job.status = "pending"  # Retry

        await db.update_research_job(job)
```

---

## Service Design

### Background Worker Service

**File:** `python-service/app/workers/edgar_worker.py`

```python
import asyncio
from datetime import datetime, timedelta
from app.edgar import poller, detector, parser
from app.database import get_db
from app.research import queue_manager

class EdgarWorker:
    def __init__(self):
        self.polling_interval = 300  # 5 minutes
        self.is_running = False

    async def start(self):
        """Start the EDGAR monitoring worker."""
        self.is_running = True
        print(f"[EdgarWorker] Starting... polling every {self.polling_interval}s")

        while self.is_running:
            try:
                await self.poll_cycle()
            except Exception as e:
                print(f"[EdgarWorker] Error: {e}")
                # Continue despite errors

            # Wait for next cycle
            await asyncio.sleep(self.polling_interval)

    async def poll_cycle(self):
        """Execute one polling cycle."""
        start_time = datetime.now()

        # 1. Poll EDGAR RSS
        new_filings = await poller.poll_edgar_rss()
        print(f"[EdgarWorker] Found {len(new_filings)} new filings")

        # 2. Detect M&A relevance
        ma_relevant_count = 0
        for filing in new_filings:
            is_relevant = await detector.detect_ma_relevance(filing)
            if is_relevant:
                ma_relevant_count += 1

        print(f"[EdgarWorker] {ma_relevant_count} M&A relevant filings")

        # 3. Parse and create deals
        for filing in new_filings:
            if filing.is_ma_relevant:
                deal = await parser.parse_deal_from_filing(filing)
                if deal:
                    deal_id = await self.handle_deal(deal, filing)

                    # Queue research
                    await queue_manager.queue_research(deal_id)

        duration = (datetime.now() - start_time).total_seconds()
        print(f"[EdgarWorker] Poll cycle completed in {duration:.2f}s")

    async def stop(self):
        """Stop the worker."""
        self.is_running = False
        print("[EdgarWorker] Stopping...")

# Global worker instance
edgar_worker = EdgarWorker()
```

### Research Queue Worker

**File:** `python-service/app/workers/research_worker.py`

```python
import asyncio
from app.research import generator, queue_manager

class ResearchWorker:
    def __init__(self):
        self.processing_interval = 10  # Check queue every 10 seconds
        self.is_running = False
        self.max_concurrent_jobs = 2  # Process 2 research jobs at a time

    async def start(self):
        """Start the research queue worker."""
        self.is_running = True
        print("[ResearchWorker] Starting...")

        while self.is_running:
            try:
                await self.process_queue()
            except Exception as e:
                print(f"[ResearchWorker] Error: {e}")

            await asyncio.sleep(self.processing_interval)

    async def process_queue(self):
        """Process pending research jobs."""

        # Get pending jobs
        jobs = await queue_manager.get_pending_jobs(limit=self.max_concurrent_jobs)

        if not jobs:
            return

        print(f"[ResearchWorker] Processing {len(jobs)} jobs")

        # Process jobs concurrently
        tasks = [self.process_job(job) for job in jobs]
        await asyncio.gather(*tasks, return_exceptions=True)

    async def process_job(self, job):
        """Process a single research job."""
        try:
            print(f"[ResearchWorker] Processing job {job.id} for deal {job.deal_id}")

            # Mark as processing
            await queue_manager.mark_processing(job.id)

            # Generate research
            await generator.generate_all_research(job.deal_id, job.analyzer_types)

            # Mark as completed
            await queue_manager.mark_completed(job.id)

            print(f"[ResearchWorker] Job {job.id} completed")

        except Exception as e:
            print(f"[ResearchWorker] Job {job.id} failed: {e}")
            await queue_manager.mark_failed(job.id, str(e))

    async def stop(self):
        """Stop the worker."""
        self.is_running = False
        print("[ResearchWorker] Stopping...")

# Global worker instance
research_worker = ResearchWorker()
```

### Integration with FastAPI

**File:** `python-service/app/main.py`

```python
from fastapi import FastAPI
from contextlib import asynccontextmanager
from app.workers.edgar_worker import edgar_worker
from app.workers.research_worker import research_worker

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    print("Starting background workers...")

    # Start workers in background tasks
    asyncio.create_task(edgar_worker.start())
    asyncio.create_task(research_worker.start())

    yield

    # Shutdown
    print("Stopping background workers...")
    await edgar_worker.stop()
    await research_worker.stop()

app = FastAPI(lifespan=lifespan)

# ... rest of API endpoints ...
```

---

## Implementation Phases

### Phase 1: Basic EDGAR Polling (Week 1)

**Goal:** Poll EDGAR and store filings in database

**Tasks:**
- [ ] Create database tables (`edgar_filings`, `edgar_polling_log`)
- [ ] Implement RSS feed polling
- [ ] Parse and store filings
- [ ] Add admin UI to view filings

**Deliverables:**
- Background worker polling EDGAR every 5 minutes
- Database storing all new filings
- Admin page showing recent filings

**Testing:**
- Verify polling works during market hours
- Check deduplication (no duplicate filings)
- Monitor for errors

### Phase 2: M&A Detection (Week 2)

**Goal:** Detect M&A relevant filings

**Tasks:**
- [ ] Implement filing type detection
- [ ] Add keyword analysis
- [ ] Fetch and parse filing text
- [ ] Calculate confidence scores

**Deliverables:**
- M&A detection algorithm
- Confidence scoring
- UI showing M&A relevant filings only

**Testing:**
- Test with historical filings
- Validate false positive rate
- Tune confidence thresholds

### Phase 3: Deal Extraction (Week 3)

**Goal:** Parse deal information from filings

**Tasks:**
- [ ] Implement LLM-based extraction
- [ ] Parse deal terms
- [ ] Handle different filing formats
- [ ] Create deal records

**Deliverables:**
- Automated deal creation
- Deal-filing linkage
- UI showing auto-created deals

**Testing:**
- Test with various filing types
- Verify extraction accuracy
- Check deduplication

### Phase 4: Research Automation (Week 4)

**Goal:** Automatically generate research for new deals

**Tasks:**
- [ ] Create research queue
- [ ] Implement queue worker
- [ ] Add rate limiting
- [ ] Handle failures gracefully

**Deliverables:**
- Automated research generation
- Queue management UI
- Error handling and retries

**Testing:**
- Test with multiple concurrent deals
- Verify API rate limits respected
- Check error recovery

### Phase 5: Notifications & Polish (Week 5)

**Goal:** Notify users of new deals

**Tasks:**
- [ ] Add email notifications
- [ ] Create dashboard widgets
- [ ] Add manual review workflow
- [ ] Performance optimization

**Deliverables:**
- Email alerts for new deals
- Dashboard showing new deals
- Review interface for auto-created deals

---

## Error Handling

### Common Errors & Solutions

#### 1. **RSS Feed Unavailable**

**Error:** SEC website down or rate limited

**Solution:**
```python
async def poll_edgar_rss_with_retry():
    max_retries = 3
    retry_delay = 60  # seconds

    for attempt in range(max_retries):
        try:
            return await poll_edgar_rss()
        except Exception as e:
            if attempt < max_retries - 1:
                print(f"RSS poll failed, retry {attempt + 1}/{max_retries}")
                await asyncio.sleep(retry_delay)
            else:
                # Log error and continue
                await log_error("RSS poll failed after retries", e)
                return []
```

#### 2. **Filing Parse Failure**

**Error:** Unable to parse filing HTML/XML

**Solution:**
- Mark filing as "parse_error"
- Log for manual review
- Continue processing other filings

#### 3. **LLM Extraction Failure**

**Error:** Anthropic API error or invalid response

**Solution:**
```python
async def extract_deal_with_fallback(filing):
    try:
        # Try primary extraction
        return await extract_with_llm(filing)
    except Exception as e:
        # Fall back to regex-based extraction
        return await extract_with_regex(filing)
```

#### 4. **Rate Limiting**

**Error:** Too many API calls

**Solution:**
```python
from asyncio import Semaphore

# Global rate limiter
api_semaphore = Semaphore(10)  # Max 10 concurrent API calls

async def call_api_with_rate_limit(url):
    async with api_semaphore:
        return await http_client.get(url)
```

---

## Monitoring & Alerts

### Metrics to Track

1. **Polling Metrics:**
   - Filings fetched per hour
   - New filings detected
   - M&A relevant filings
   - Polling failures

2. **Processing Metrics:**
   - Deals created per day
   - Parse success rate
   - Extraction confidence scores
   - Deduplication rate

3. **Research Metrics:**
   - Queue length
   - Processing time per job
   - Completion rate
   - Error rate

### Dashboard Widgets

**Admin Dashboard:**
```
┌─────────────────────────────────────────┐
│   EDGAR Automation Status               │
├─────────────────────────────────────────┤
│  Last Poll: 2 minutes ago ✓             │
│  Filings Today: 1,247                   │
│  M&A Relevant: 23                       │
│  Deals Created: 5                       │
│  Research Queue: 3 pending              │
│                                         │
│  [View Recent Filings]  [View Queue]   │
└─────────────────────────────────────────┘
```

### Email Alerts

**Send alerts for:**
- New M&A deal detected (high confidence)
- Processing errors (after retries)
- Queue backlog (>10 jobs)

---

## Cost Analysis

### Anthropic API Costs

**Extraction per Filing:**
- Input: ~5,000 tokens (filing excerpt)
- Output: ~500 tokens (structured data)
- Cost per filing: ~$0.08 (Claude 3.5 Sonnet)

**Research per Deal:**
- 3 analyzers × ~10,000 tokens input = 30,000 tokens
- 3 analyzers × ~2,000 tokens output = 6,000 tokens
- Cost per deal: ~$1.50

**Monthly Estimates:**
- M&A relevant filings: ~500/month
- Extraction cost: 500 × $0.08 = $40
- New deals: ~100/month
- Research cost: 100 × $1.50 = $150
- **Total: ~$190/month**

### Infrastructure Costs

- Database storage: <$5/month
- Compute (background workers): $0 (same server)
- **Total infrastructure: ~$5/month**

### **Total Monthly Cost: ~$200**

---

## Next Steps

1. **Review this plan** with team
2. **Prioritize features** (which phases to implement first?)
3. **Set up development environment**
4. **Start Phase 1** (basic polling)
5. **Iterate based on results**

---

## Questions to Resolve

1. **Polling frequency?** 5 minutes vs. 10 minutes vs. real-time webhooks?
2. **Manual review required?** Should all auto-created deals require approval?
3. **Notification preferences?** Email, Slack, SMS, or dashboard only?
4. **Which filing types to monitor?** Start with 8-K only, or all types?
5. **Research priority?** Generate immediately or queue for off-peak hours?

---

**Status:** Ready for review and implementation! 🚀
