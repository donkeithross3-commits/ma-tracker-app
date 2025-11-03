# M&A Tracker - Database Schema Documentation

## Entity Relationship Diagram

```
┌─────────────┐
│    User     │
└──────┬──────┘
       │
       │ creates/updates
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│                        Deal                              │
│  (Core entity - one per unique M&A transaction)         │
└───┬─────┬─────┬──────┬──────┬─────────┬────────────┬───┘
    │     │     │      │      │         │            │
    │     │     │      │      │         │            │
    ▼     ▼     ▼      ▼      ▼         ▼            ▼
┌────┐ ┌────┐ ┌───┐ ┌────┐ ┌──────┐ ┌──────┐  ┌──────────┐
│Ver-│ │Pri-│ │CVR│ │Port│ │Snap- │ │SEC   │  │Research  │
│sion│ │ces │ │   │ │fo  │ │shots │ │Filing│  │Report    │
└────┘ └────┘ └───┘ └────┘ └──────┘ └───┬──┘  └─────┬────┘
                                         │            │
                                         │            │
                                         │            ▼
                                         │      ┌──────────┐
                                         └─────→│Report    │
                                                │Section   │
                                                └──────────┘
```

## Database Tables

### Core Entities

#### 1. **users** - User Management

Stores user accounts for multi-user access control.

| Column      | Type      | Description                    |
|-------------|-----------|--------------------------------|
| id          | UUID      | Primary key                    |
| username    | String    | Unique username                |
| email       | String    | Unique email                   |
| password    | String    | Hashed password                |
| full_name   | String?   | Display name                   |
| role        | String    | analyst/admin/viewer           |
| is_active   | Boolean   | Account status                 |
| created_at  | DateTime  | Account creation               |
| updated_at  | DateTime  | Last modification              |

**Relations:**
- Has many: Deals (created), Deals (updated), DealVersions, PortfolioPositions, DealSnapshots, ApiPriceFetches, AuditLogs

**Indexes:**
- username (unique)
- email (unique)

---

#### 2. **deals** - Core Deal Records

One record per unique M&A transaction. Immutable core data.

| Column          | Type      | Description                    |
|-----------------|-----------|--------------------------------|
| deal_id         | UUID      | Primary key                    |
| ticker          | String    | Target company ticker          |
| target_name     | String?   | Target company name            |
| acquiror_ticker | String?   | Acquiring company ticker       |
| acquiror_name   | String?   | Acquiring company name         |
| status          | String    | active/closed/terminated       |
| created_by      | UUID?     | User who created               |
| updated_by      | UUID?     | User who last updated          |
| created_at      | DateTime  | Deal creation date             |
| updated_at      | DateTime  | Last modification              |

**Relations:**
- Belongs to: User (creator), User (updater)
- Has many: DealVersions, DealPrices, Cvrs, PortfolioPositions, DealSnapshots, SecFilings
- Has one: DealResearchReport

**Indexes:**
- ticker
- status

**Design Notes:**
- Immutable core data (ticker, company names)
- All changeable data goes in DealVersion
- Allows tracking deal history

---

#### 3. **deal_versions** - Version Control

Every update to deal terms creates a new version. Complete audit trail of all changes.

| Column                | Type      | Description                        |
|-----------------------|-----------|------------------------------------|
| version_id            | UUID      | Primary key                        |
| deal_id               | UUID      | Foreign key to deals               |
| version_number        | Integer   | Sequential version (1, 2, 3...)    |
| effective_date        | DateTime  | When this version became effective |
| is_current_version    | Boolean   | Only one version is current        |

**Deal Dates:**
| Column                | Type      | Description                        |
|-----------------------|-----------|------------------------------------|
| announced_date        | Date?     | Deal announcement date             |
| expected_close_date   | Date?     | Expected transaction close         |
| outside_date          | Date?     | Deal termination deadline          |

**Deal Terms:**
| Column                | Type         | Description                     |
|-----------------------|--------------|---------------------------------|
| category              | String?      | all_cash, cash_stock, cash_cvr  |
| cash_per_share        | Decimal(10,4)| Cash component                  |
| stock_ratio           | Decimal(10,6)| Stock exchange ratio            |
| dividends_other       | Decimal(10,4)| Other value (dividends, etc)    |
| stress_test_discount  | Decimal(5,4) | Downside stress test            |

**Risk Assessments:**
| Column                | Type      | Description                        |
|-----------------------|-----------|------------------------------------|
| vote_risk             | String?   | low/medium/high                    |
| finance_risk          | String?   | low/medium/high                    |
| legal_risk            | String?   | low/medium/high                    |

**Metrics:**
| Column                | Type         | Description                     |
|-----------------------|--------------|---------------------------------|
| current_yield         | Decimal(10,6)| Expected IRR                    |

**Investment Tracking:**
| Column                | Type      | Description                        |
|-----------------------|-----------|------------------------------------|
| is_investable         | Boolean   | Investment decision flag           |
| investable_notes      | Text?     | Reason for investment decision     |
| deal_notes            | Text?     | General notes                      |
| go_shop_end_date      | Date?     | Go-shop period end                 |

**Relations:**
- Belongs to: Deal, User (creator)

**Indexes:**
- (deal_id, version_number) - unique
- (deal_id, is_current_version)
- effective_date

**Design Notes:**
- Implements temporal versioning
- Never delete versions - complete audit trail
- Query current version with `is_current_version = true`

---

#### 4. **deal_prices** - Time-Series Price Data

Historical price data from Interactive Brokers API.

| Column          | Type         | Description                     |
|-----------------|--------------|---------------------------------|
| price_id        | UUID         | Primary key                     |
| deal_id         | UUID         | Foreign key to deals            |
| price_date      | Date         | Price observation date          |
| target_price    | Decimal(10,4)| Target company price            |
| acquiror_price  | Decimal(10,4)| Acquiror price (if stock deal)  |
| source          | String       | interactive_brokers             |
| created_at      | DateTime     | When price was fetched          |

**Relations:**
- Belongs to: Deal

**Indexes:**
- (deal_id, price_date) - unique
- (deal_id, price_date DESC)
- price_date DESC

**Design Notes:**
- One price per day per deal
- Enables spread calculation over time
- Powers historical analysis charts

---

#### 5. **cvrs** - Contingent Value Rights

Multiple CVRs can be associated with a single deal.

| Column            | Type         | Description                     |
|-------------------|--------------|---------------------------------|
| cvr_id            | UUID         | Primary key                     |
| deal_id           | UUID         | Foreign key to deals            |
| cvr_name          | String?      | CVR description                 |
| payment_amount    | Decimal(10,4)| Potential payment per share     |
| probability       | Decimal(3,2) | 0.00 to 1.00 (default 0.50)     |
| payment_deadline  | Date?        | CVR payment deadline            |
| payment_status    | String       | pending/paid/expired            |
| notes             | Text?        | CVR details                     |
| created_at        | DateTime     | Creation timestamp              |
| updated_at        | DateTime     | Last modification               |

**Relations:**
- Belongs to: Deal

**Indexes:**
- deal_id
- payment_status

**Design Notes:**
- Supports complex deal structures
- NPV calculation: payment_amount * probability
- Multiple CVRs per deal supported

---

#### 6. **portfolio_positions** - Actual Positions Taken

Tracks actual investments made in deals.

| Column        | Type         | Description                     |
|---------------|--------------|---------------------------------|
| position_id   | UUID         | Primary key                     |
| deal_id       | UUID         | Foreign key to deals            |
| shares        | Decimal(15,4)| Number of shares                |
| entry_date    | Date         | Position entry date             |
| entry_price   | Decimal(10,4)| Entry price per share           |
| exit_date     | Date?        | Position exit date              |
| exit_price    | Decimal(10,4)| Exit price per share            |
| status        | String       | open/closed                     |
| notes         | Text?        | Position notes                  |
| created_by    | UUID?        | User who created position       |
| created_at    | DateTime     | Creation timestamp              |
| updated_at    | DateTime     | Last modification               |

**Relations:**
- Belongs to: Deal, User (creator)
- Has many: DealSnapshots

**Indexes:**
- deal_id
- status

**Design Notes:**
- Tracks actual P&L
- Multiple positions per deal allowed (averaging, pyramiding)
- Supports both long and short positions (negative shares)

---

#### 7. **deal_snapshots** - Memorialized Calculations

Captures point-in-time metrics at key decision moments.

| Column              | Type         | Description                     |
|---------------------|--------------|---------------------------------|
| snapshot_id         | UUID         | Primary key                     |
| deal_id             | UUID         | Foreign key to deals            |
| snapshot_type       | String       | entry_decision/exit_decision    |
| snapshot_date       | DateTime     | When snapshot was taken         |

**Price Snapshot:**
| Column              | Type         | Description                     |
|---------------------|--------------|---------------------------------|
| target_price        | Decimal(10,4)| Target price at snapshot        |
| acquiror_price      | Decimal(10,4)| Acquiror price at snapshot      |
| deal_price          | Decimal(10,4)| Calculated deal value           |

**Metrics Snapshot:**
| Column              | Type         | Description                     |
|---------------------|--------------|---------------------------------|
| gross_spread        | Decimal(10,6)| Gross spread %                  |
| net_spread          | Decimal(10,6)| Net spread after costs          |
| days_to_close       | Integer      | Days remaining                  |
| annualized_return   | Decimal(10,6)| Annualized return %             |
| projected_irr       | Decimal(10,6)| Projected IRR                   |
| cvr_total_npv       | Decimal(10,4)| Total CVR NPV                   |

**Context:**
| Column              | Type         | Description                     |
|---------------------|--------------|---------------------------------|
| notes               | Text?        | Why snapshot was taken          |
| created_by          | UUID?        | User who created snapshot       |
| position_id         | UUID?        | Related position (if any)       |

**Relations:**
- Belongs to: Deal, User (creator), PortfolioPosition (optional)

**Indexes:**
- deal_id
- snapshot_type
- snapshot_date DESC

**Design Notes:**
- Immutable records - never updated
- Powers performance attribution
- Documents decision rationale

---

### AI Research System

#### 8. **sec_filings** - SEC Filing Cache

Stores SEC EDGAR filings for each deal.

| Column             | Type      | Description                        |
|--------------------|-----------|-----------------------------------|
| filing_id          | UUID      | Primary key                       |
| deal_id            | UUID      | Foreign key to deals              |
| filing_type        | String    | DEFM14A, 8-K, DEFA14A, etc        |
| filing_date        | Date      | Official filing date              |
| accession_number   | String    | SEC accession number (unique)     |
| edgar_url          | Text      | URL to filing on SEC EDGAR        |
| document_url       | Text?     | Direct URL to primary document    |
| html_text          | Text?     | Cached HTML content               |
| text_extracted     | Text?     | Extracted plain text              |
| fetched_at         | DateTime? | When content was fetched          |
| fetch_status       | String    | pending/fetched/error             |
| fetch_error        | Text?     | Error message if fetch failed     |
| created_at         | DateTime  | Record creation                   |
| updated_at         | DateTime  | Last modification                 |

**Relations:**
- Belongs to: Deal

**Indexes:**
- (deal_id, accession_number) - unique
- (deal_id, filing_type)
- filing_date DESC

**Design Notes:**
- Caches filing content to avoid repeated SEC fetches
- Respects SEC rate limits (10 req/sec)
- Supports incremental fetching (fetch status tracking)

---

#### 9. **deal_research_reports** - AI-Generated Research

Main research report per deal with aggregated metrics.

| Column                | Type      | Description                        |
|-----------------------|-----------|-----------------------------------|
| report_id             | UUID      | Primary key                       |
| deal_id               | UUID      | Foreign key to deals (unique)     |
| report_version        | Integer   | Version number (for regeneration) |
| generated_at          | DateTime  | When report was generated         |
| status                | String    | pending/generating/completed/error|

**Risk Scores (0-100):**
| Column                | Type      | Description                        |
|-----------------------|-----------|-----------------------------------|
| antitrust_risk_score  | Integer?  | Antitrust/regulatory risk          |
| contract_risk_score   | Integer?  | Contract language risk             |
| topping_bid_score     | Integer?  | Likelihood of topping bid          |
| overall_risk_score    | Integer?  | Aggregate risk score               |

**Executive Summary:**
| Column                | Type      | Description                        |
|-----------------------|-----------|-----------------------------------|
| executive_summary     | Text?     | High-level summary                 |
| key_findings          | JSON?     | Array of key findings              |
| red_flags             | JSON?     | Array of red flags                 |
| opportunities         | JSON?     | Array of opportunities             |

**Metadata:**
| Column                | Type      | Description                        |
|-----------------------|-----------|-----------------------------------|
| last_updated          | DateTime  | Last modification                  |
| error_message         | Text?     | Error if generation failed         |
| processing_time_ms    | Integer?  | Generation time in milliseconds    |

**Relations:**
- Belongs to: Deal (one-to-one)
- Has many: ReportSections

**Indexes:**
- deal_id - unique
- status
- generated_at DESC

**Design Notes:**
- One report per deal (regenerate to update)
- Aggregates scores from all sections
- Stores structured data in JSON columns

---

#### 10. **report_sections** - Modular Analysis Sections

Individual analysis modules (antitrust, contract, topping bids, etc.)

| Column              | Type      | Description                        |
|---------------------|-----------|-----------------------------------|
| section_id          | UUID      | Primary key                       |
| report_id           | UUID      | Foreign key to deal_research_reports|
| section_type        | String    | antitrust/contract/topping_bid    |
| section_title       | String    | Display title                     |

**Analysis Content:**
| Column              | Type      | Description                        |
|---------------------|-----------|-----------------------------------|
| analysis_markdown   | Text      | Full analysis in markdown          |
| risk_score          | Integer?  | Section-specific risk (0-100)      |
| confidence          | String?   | high/medium/low                    |

**Structured Data:**
| Column              | Type      | Description                        |
|---------------------|-----------|-----------------------------------|
| extracted_data      | JSON?     | Section-specific structured data   |
| key_points          | JSON?     | Array of key points                |

**Source Tracking:**
| Column              | Type      | Description                        |
|---------------------|-----------|-----------------------------------|
| source_filing_ids   | String[]  | Array of SecFiling IDs used        |
| ai_model            | String?   | claude-3-5-sonnet, etc             |
| prompt_version      | String?   | Track prompt versions              |

**Metadata:**
| Column              | Type      | Description                        |
|---------------------|-----------|-----------------------------------|
| generated_at        | DateTime  | When section was generated         |
| status              | String    | pending/completed/error            |
| error_message       | Text?     | Error if generation failed         |
| processing_time_ms  | Integer?  | Generation time in milliseconds    |

**Relations:**
- Belongs to: DealResearchReport

**Indexes:**
- (report_id, section_type)
- section_type

**Design Notes:**
- Modular design allows independent regeneration
- Each section tracks its AI model and prompt version
- Source tracking enables reproducibility

**Section Types:**
- `antitrust` - Regulatory approval analysis
- `contract` - M&A agreement analysis
- `topping_bid` - Competing bid detection (YAVB pattern)
- `deal_structure` - CVRs, collars, unusual terms
- `timeline` - Deal timeline and milestones
- `financing` - Financing condition analysis

---

### Supporting Tables

#### 11. **api_price_fetches** - API Integration Tracking

Tracks price fetch operations from Interactive Brokers.

| Column              | Type      | Description                        |
|---------------------|-----------|-----------------------------------|
| fetch_id            | UUID      | Primary key                       |
| fetch_date          | Date      | Date of fetch                     |
| ticker              | String    | Ticker fetched                    |
| fetch_status        | String?   | success/failure/partial           |
| records_fetched     | Integer   | Number of prices fetched          |
| error_message       | Text?     | Error details if failed           |
| fetch_started_at    | DateTime  | When fetch began                  |
| fetch_completed_at  | DateTime? | When fetch completed              |
| created_by          | UUID?     | User who triggered fetch          |

**Relations:**
- Belongs to: User (creator)

**Indexes:**
- fetch_date DESC
- ticker

**Design Notes:**
- Monitoring and debugging tool
- Tracks API reliability
- Helps identify problematic tickers

---

#### 12. **audit_logs** - Complete Audit Trail

Tracks all data changes for compliance and debugging.

| Column           | Type      | Description                        |
|------------------|-----------|-----------------------------------|
| log_id           | UUID      | Primary key                       |
| entity_type      | String    | cvr/deal/position/etc             |
| entity_id        | String    | ID of affected entity             |
| action           | String    | create/update/delete              |
| changed_fields   | Text?     | JSON of fields that changed       |
| old_values       | Text?     | JSON of previous values           |
| new_values       | Text?     | JSON of new values                |
| created_at       | DateTime  | When change occurred              |
| created_by       | UUID?     | User who made change              |

**Relations:**
- Belongs to: User (creator)

**Indexes:**
- (entity_type, entity_id)
- created_at DESC
- created_by

**Design Notes:**
- Immutable - never updated or deleted
- Powers "who changed what when" queries
- Compliance requirement for regulated environments

---

## Common Query Patterns

### Get Current Deal Terms

```typescript
const deal = await prisma.deal.findUnique({
  where: { id: dealId },
  include: {
    versions: {
      where: { isCurrentVersion: true },
      take: 1,
    },
  },
});
```

### Get Deal with All Related Data

```typescript
const deal = await prisma.deal.findUnique({
  where: { id: dealId },
  include: {
    versions: {
      where: { isCurrentVersion: true },
    },
    prices: {
      orderBy: { priceDate: 'desc' },
      take: 30, // Last 30 days
    },
    cvrs: true,
    portfolioPositions: {
      where: { status: 'open' },
    },
    researchReport: {
      include: {
        sections: true,
      },
    },
    secFilings: {
      orderBy: { filingDate: 'desc' },
    },
  },
});
```

### Calculate Current Spread

```typescript
const latestPrice = await prisma.dealPrice.findFirst({
  where: { dealId },
  orderBy: { priceDate: 'desc' },
});

const currentVersion = await prisma.dealVersion.findFirst({
  where: { dealId, isCurrentVersion: true },
});

// Spread = (deal_value - current_price) / current_price
const dealValue = currentVersion.cashPerShare + (currentVersion.dividendsOther || 0);
const spread = ((dealValue - latestPrice.targetPrice) / latestPrice.targetPrice) * 100;
```

### Get All Active Deals with Current Metrics

```typescript
const activeDeals = await prisma.deal.findMany({
  where: { status: 'active' },
  include: {
    versions: {
      where: { isCurrentVersion: true },
    },
    prices: {
      orderBy: { priceDate: 'desc' },
      take: 1,
    },
    researchReport: {
      select: {
        overallRiskScore: true,
        toppingBidScore: true,
      },
    },
  },
  orderBy: {
    updatedAt: 'desc',
  },
});
```

### Get Deal Audit History

```typescript
const history = await prisma.auditLog.findMany({
  where: {
    entityType: 'deal',
    entityId: dealId,
  },
  include: {
    createdBy: {
      select: {
        username: true,
        fullName: true,
      },
    },
  },
  orderBy: {
    createdAt: 'desc',
  },
});
```

## Data Integrity Rules

### Enforced by Database

1. **Foreign Keys**: Cascade deletes where appropriate
2. **Unique Constraints**: Prevent duplicate data
3. **Not Null**: Required fields enforced
4. **Check Constraints**: (Future) Value range validation

### Enforced by Application

1. **Version Control**: Only one `is_current_version = true` per deal
2. **Price Uniqueness**: One price per ticker per date
3. **Status Transitions**: Valid state machine for deal status
4. **Audit Logging**: All updates trigger audit log entries

## Performance Considerations

### Indexed Columns

All foreign keys and frequently queried columns have indexes:
- User: username, email
- Deal: ticker, status
- DealVersion: (deal_id, is_current_version), (deal_id, version_number)
- DealPrice: (deal_id, price_date), price_date DESC
- CVR: deal_id, payment_status
- PortfolioPosition: deal_id, status
- DealSnapshot: deal_id, snapshot_type, snapshot_date DESC
- SecFiling: (deal_id, accession_number), (deal_id, filing_type), filing_date DESC
- DealResearchReport: deal_id (unique), status, generated_at DESC
- ReportSection: (report_id, section_type), section_type
- ApiPriceFetch: fetch_date DESC, ticker
- AuditLog: (entity_type, entity_id), created_at DESC, created_by

### Query Optimization

- Use `select` to limit returned fields
- Use `take` and `skip` for pagination
- Avoid N+1 queries with `include`
- Use `count` instead of loading all records
- Consider materialized views for complex analytics

## Migration Strategy

### Current: Prisma Migrations

- Development: `npx prisma db push`
- Production: `npx prisma migrate deploy`
- Schema file: `prisma/schema.prisma`

### Backup Strategy

- Neon.tech automatic backups
- Point-in-time recovery available
- Export via `pg_dump` for local backups

## Future Enhancements

### Potential Additions

1. **Notifications Table**
   - Deal status changes
   - Price alerts
   - Report completion

2. **Watchlists**
   - User-specific deal lists
   - Custom filtering

3. **Comments/Notes**
   - Collaborative deal notes
   - Thread-based discussions

4. **Document Storage**
   - Attachments to deals
   - S3/Blob storage links

5. **Backtesting**
   - Historical performance analysis
   - Strategy comparison
