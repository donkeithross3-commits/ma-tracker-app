# EDGAR Real-Time Monitoring with Staging Review - Architecture Plan

**Goal:** Real-time detection of M&A deals with immediate research generation and manual review workflow.

**Status:** Ready to Implement
**Priority:** CRITICAL - Competitive Advantage
**Implementation Time:** 3-4 days for MVP

---

## Core Requirements

### ✅ Must Have:
1. **Real-time detection** - Webhooks or <1 minute polling
2. **Staging area** - Unverified deals in review queue
3. **Immediate alerts** - Notify Luis instantly via multiple channels
4. **Auto-research** - Generate full analysis before approval
5. **Broad coverage** - Monitor all potential M&A filings
6. **Review workflow** - Luis approves/rejects/edits before going live

---

## Real-Time Detection Options

### Option 1: SEC EDGAR RSS + Aggressive Polling (Recommended for MVP)

**Approach:** Poll EDGAR RSS every 60 seconds during market hours

**Pros:**
- ✅ Free
- ✅ Reliable
- ✅ No third-party dependency
- ✅ <1 minute latency
- ✅ Easy to implement

**Cons:**
- ❌ Not true real-time (60s delay)
- ❌ Slightly more server load

**Implementation:**
```python
# Poll every 60 seconds during market hours (7:30 AM - 6:00 PM CT)
# Poll every 5 minutes outside market hours

import asyncio
from datetime import datetime, time

async def edgar_polling_loop():
    while True:
        now = datetime.now()

        # Market hours: 7:30 AM - 6:00 PM CT
        if is_market_hours(now):
            interval = 60  # 1 minute during market hours
        else:
            interval = 300  # 5 minutes outside market hours

        await poll_edgar_rss()
        await asyncio.sleep(interval)

def is_market_hours(dt: datetime) -> bool:
    """Check if within market hours (7:30 AM - 6:00 PM CT)."""
    market_start = time(7, 30)  # 7:30 AM
    market_end = time(18, 0)    # 6:00 PM

    # Only weekdays
    if dt.weekday() >= 5:  # Saturday = 5, Sunday = 6
        return False

    return market_start <= dt.time() <= market_end
```

### Option 2: sec-api.io Real-Time Webhooks (Upgrade Path)

**Approach:** Subscribe to webhook for instant notifications

**Provider:** https://sec-api.io
**Cost:** $99/month (Real-Time Filings Plan)

**Pros:**
- ✅ True real-time (<5 seconds)
- ✅ Pre-filtered by filing type
- ✅ Pre-parsed data
- ✅ Reliable webhooks

**Cons:**
- ❌ $99/month cost
- ❌ Third-party dependency

**When to Upgrade:**
- After validating with polling approach
- When speed becomes critical competitive advantage
- When budget allows

**Implementation:**
```python
from fastapi import FastAPI, Request

app = FastAPI()

@app.post("/webhooks/sec-api")
async def sec_api_webhook(request: Request):
    """Receive real-time filing notifications from sec-api.io."""

    payload = await request.json()

    filing = {
        "accession_number": payload["accessionNo"],
        "cik": payload["cik"],
        "company_name": payload["companyName"],
        "ticker": payload["ticker"],
        "filing_type": payload["formType"],
        "filing_date": payload["filedAt"],
        "filing_url": payload["documentFormatFiles"][0]["documentUrl"]
    }

    # Process immediately
    await process_new_filing(filing)

    return {"status": "received"}
```

### Option 3: Hybrid Approach (Best of Both Worlds)

**Phase 1 (MVP):** Aggressive polling (60s) - Free, fast enough
**Phase 2 (Production):** Add webhooks for instant alerts + polling as backup

---

## Staging Area Architecture

### Database Schema

#### New Table: `staged_deals`

Deals detected but not yet approved:

```sql
CREATE TABLE staged_deals (
    id SERIAL PRIMARY KEY,

    -- Deal information (extracted from filing)
    target_ticker VARCHAR(10),
    target_name VARCHAR(255) NOT NULL,
    acquirer_name VARCHAR(255),
    acquirer_ticker VARCHAR(10),
    deal_value DECIMAL(15, 2),
    deal_type VARCHAR(50),                    -- merger, acquisition, tender_offer, etc.
    consideration_type VARCHAR(50),           -- cash, stock, mixed

    -- Source information
    source_filing_id INTEGER REFERENCES edgar_filings(id),
    source_filing_type VARCHAR(20),           -- 8-K, SC TO, etc.
    detected_at TIMESTAMP DEFAULT NOW(),

    -- Extraction metadata
    confidence_score FLOAT,                   -- 0.0 to 1.0
    extraction_method VARCHAR(50),            -- llm, regex, manual
    raw_extracted_data JSONB,                 -- Full LLM response

    -- Review workflow
    status VARCHAR(20) DEFAULT 'pending',     -- pending, approved, rejected, needs_info
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TIMESTAMP,
    review_notes TEXT,

    -- Research status
    research_status VARCHAR(20) DEFAULT 'queued',  -- queued, generating, completed, failed
    research_completed_at TIMESTAMP,

    -- Notification status
    alert_sent BOOLEAN DEFAULT FALSE,
    alert_sent_at TIMESTAMP,

    -- If approved, link to created deal
    approved_deal_id INTEGER REFERENCES deals(id),

    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    -- Indexes
    INDEX idx_status (status, detected_at DESC),
    INDEX idx_pending (status, detected_at DESC) WHERE status = 'pending',
    INDEX idx_research_status (research_status)
);
```

#### Update `deals` Table

Add fields to track staging history:

```sql
ALTER TABLE deals ADD COLUMN created_from_staging INTEGER REFERENCES staged_deals(id);
ALTER TABLE deals ADD COLUMN auto_detected BOOLEAN DEFAULT FALSE;
ALTER TABLE deals ADD COLUMN detection_confidence FLOAT;
```

---

## Real-Time Workflow

### End-to-End Flow (60 Second Latency)

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Real-Time EDGAR Monitoring                       │
└─────────────────────────────────────────────────────────────────────┘

Time: T+0 (Filing posted to EDGAR)
│
▼
┌──────────────────────┐
│  SEC EDGAR RSS Feed  │  ← New 8-K posted
└──────────┬───────────┘
           │
Time: T+60s (Next poll cycle)
           │
           ▼
┌──────────────────────┐
│   RSS Poller         │  ← Detects new filing
│   (Every 60s)        │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Quick Filter        │  ← Is it 8-K/SC TO/DEFM14A?
│  (Filing Type)       │
└──────────┬───────────┘
           │ YES
           ▼
┌──────────────────────┐
│  Fetch Full Filing   │  ← Download HTML/XML
│  (Async)             │
└──────────┬───────────┘
           │
Time: T+70s (Filing downloaded)
           │
           ▼
┌──────────────────────┐
│  M&A Detector        │  ← Check for M&A keywords
│  (Keyword Analysis)  │     "merger agreement"
└──────────┬───────────┘     "acquisition"
           │ RELEVANT        "tender offer"
           ▼
┌──────────────────────┐
│  LLM Extraction      │  ← Extract deal details
│  (Anthropic API)     │     • Target name/ticker
└──────────┬───────────┘     • Acquirer name/ticker
           │                 • Deal value
Time: T+75s (Extraction complete)     • Deal type
           │                 • Terms
           ▼
┌──────────────────────┐
│  Create Staged Deal  │  ← Insert into staged_deals table
└──────────┬───────────┘
           │
           ├────────────────────────────────────┐
           │                                    │
           ▼                                    ▼
┌──────────────────────┐            ┌──────────────────────┐
│  Queue Research      │            │  Send Alert          │
│  (3 analyzers)       │            │  (Email + Slack)     │
└──────────┬───────────┘            └──────────────────────┘
           │
Time: T+80s (Luis gets alert)
           │
           ▼
┌──────────────────────┐
│  Background Worker   │  ← Generate research reports
│  (Research Queue)    │     • Topping Bid Analysis
└──────────┬───────────┘     • Antitrust Review
           │                 • Contract Analysis
Time: T+3min (Research done)
           │
           ▼
┌──────────────────────┐
│  UI Staging Area     │  ← Luis reviews deal
│  (Review Queue)      │     • See extracted info
└──────────┬───────────┘     • See research reports
           │                 • Approve/Reject/Edit
           │
Time: T+5min (Luis reviews)
           │
           ▼ APPROVE
┌──────────────────────┐
│  Create Live Deal    │  ← Move to production deals table
│  (Insert into deals) │
└──────────────────────┘

Total Time to Alert: ~80 seconds from filing
Total Time to Research: ~3-5 minutes
```

---

## Alert System

### Multi-Channel Notifications

Send alerts immediately when staged deal is created:

#### 1. Email Alert

**Subject:** 🚨 New M&A Deal Detected: [Target Name] - Review Required

**Body:**
```html
<h2>New M&A Deal Detected</h2>

<div style="background: #fef3c7; padding: 15px; border-left: 4px solid #f59e0b;">
    <strong>⚠️ Pending Review</strong> - This deal was automatically detected and needs your approval.
</div>

<h3>Deal Summary</h3>
<ul>
    <li><strong>Target:</strong> [Company Name] ([TICKER])</li>
    <li><strong>Acquirer:</strong> [Acquirer Name] ([TICKER])</li>
    <li><strong>Deal Value:</strong> $[X.X] billion</li>
    <li><strong>Deal Type:</strong> [Merger/Acquisition/Tender Offer]</li>
    <li><strong>Consideration:</strong> [Cash/Stock/Mixed]</li>
</ul>

<h3>Source</h3>
<ul>
    <li><strong>Filing:</strong> [8-K Item 1.01]</li>
    <li><strong>Filed:</strong> [Date/Time]</li>
    <li><strong>Confidence:</strong> [95%]</li>
</ul>

<p><strong>Research Status:</strong> Generating analysis... (3-5 min)</p>

<a href="http://localhost:3000/staging/[deal-id]" style="...">
    Review Deal Now →
</a>

<hr>
<p><small>Filed at: [2025-11-04 10:23:15 CT] | Detected at: [2025-11-04 10:24:32 CT]</small></p>
```

#### 2. Slack Alert

```python
async def send_slack_alert(staged_deal: StagedDeal):
    """Send Slack notification for new staged deal."""

    slack_webhook_url = os.getenv("SLACK_WEBHOOK_URL")

    message = {
        "text": f"🚨 New M&A Deal Detected: {staged_deal.target_name}",
        "blocks": [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": f"🚨 New M&A Deal: {staged_deal.target_name}"
                }
            },
            {
                "type": "section",
                "fields": [
                    {"type": "mrkdwn", "text": f"*Target:*\n{staged_deal.target_name} ({staged_deal.target_ticker})"},
                    {"type": "mrkdwn", "text": f"*Acquirer:*\n{staged_deal.acquirer_name}"},
                    {"type": "mrkdwn", "text": f"*Value:*\n${staged_deal.deal_value}B"},
                    {"type": "mrkdwn", "text": f"*Type:*\n{staged_deal.deal_type}"},
                    {"type": "mrkdwn", "text": f"*Filing:*\n{staged_deal.source_filing_type}"},
                    {"type": "mrkdwn", "text": f"*Confidence:*\n{staged_deal.confidence_score * 100:.0f}%"}
                ]
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*Research Status:* {staged_deal.research_status}"
                }
            },
            {
                "type": "actions",
                "elements": [
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "Review Deal"},
                        "url": f"http://localhost:3000/staging/{staged_deal.id}",
                        "style": "primary"
                    },
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "View Filing"},
                        "url": staged_deal.source_filing_url
                    }
                ]
            }
        ]
    }

    await http_client.post(slack_webhook_url, json=message)
```

#### 3. SMS Alert (Optional - via Twilio)

For critical deals only (high confidence):

```python
async def send_sms_alert(staged_deal: StagedDeal):
    """Send SMS for high-confidence deals."""

    if staged_deal.confidence_score < 0.90:
        return  # Only send SMS for very confident detections

    from twilio.rest import Client

    client = Client(os.getenv("TWILIO_SID"), os.getenv("TWILIO_TOKEN"))

    message = client.messages.create(
        body=f"🚨 M&A Alert: {staged_deal.target_name} ({staged_deal.target_ticker}) - {staged_deal.deal_type} by {staged_deal.acquirer_name}. Value: ${staged_deal.deal_value}B. Review: [link]",
        from_=os.getenv("TWILIO_PHONE"),
        to=os.getenv("LUIS_PHONE")
    )
```

#### 4. Push Notification (Browser)

For when Luis has the dashboard open:

```typescript
// client-side
async function requestNotificationPermission() {
    if ("Notification" in window) {
        await Notification.requestPermission();
    }
}

// When new staged deal detected (via WebSocket or polling)
function showBrowserNotification(deal: StagedDeal) {
    if (Notification.permission === "granted") {
        new Notification("New M&A Deal Detected", {
            body: `${deal.targetName} - Review required`,
            icon: "/logo.png",
            tag: `staged-deal-${deal.id}`,
            requireInteraction: true
        });
    }
}
```

---

## Review UI

### Staging Queue Page

**Route:** `/staging` or `/staging/queue`

```typescript
// app/staging/page.tsx
"use client"

import { useState, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

interface StagedDeal {
    id: number
    targetName: string
    targetTicker: string
    acquirerName: string
    dealValue: number
    dealType: string
    confidenceScore: number
    detectedAt: string
    researchStatus: "queued" | "generating" | "completed" | "failed"
    status: "pending" | "approved" | "rejected"
}

export default function StagingQueuePage() {
    const [stagedDeals, setStagedDeals] = useState<StagedDeal[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        fetchStagedDeals()

        // Poll for updates every 10 seconds
        const interval = setInterval(fetchStagedDeals, 10000)
        return () => clearInterval(interval)
    }, [])

    async function fetchStagedDeals() {
        const res = await fetch("/api/staging/deals?status=pending")
        const data = await res.json()
        setStagedDeals(data.deals)
        setLoading(false)
    }

    return (
        <div className="container mx-auto py-8">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold">Deal Review Queue</h1>
                <Badge variant="secondary">
                    {stagedDeals.length} Pending Review
                </Badge>
            </div>

            {stagedDeals.length === 0 ? (
                <Card className="p-8 text-center text-muted-foreground">
                    <p>No deals pending review</p>
                    <p className="text-sm mt-2">New deals will appear here automatically</p>
                </Card>
            ) : (
                <div className="space-y-4">
                    {stagedDeals.map(deal => (
                        <StagedDealCard key={deal.id} deal={deal} />
                    ))}
                </div>
            )}
        </div>
    )
}

function StagedDealCard({ deal }: { deal: StagedDeal }) {
    return (
        <Card className="p-6">
            <div className="flex justify-between items-start">
                <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-xl font-semibold">
                            {deal.targetName}
                            {deal.targetTicker && (
                                <span className="text-muted-foreground ml-2">
                                    ({deal.targetTicker})
                                </span>
                            )}
                        </h3>
                        <Badge variant={
                            deal.confidenceScore >= 0.9 ? "default" :
                            deal.confidenceScore >= 0.7 ? "secondary" :
                            "outline"
                        }>
                            {(deal.confidenceScore * 100).toFixed(0)}% confidence
                        </Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                            <p className="text-sm text-muted-foreground">Acquirer</p>
                            <p className="font-medium">{deal.acquirerName}</p>
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">Deal Value</p>
                            <p className="font-medium">
                                ${deal.dealValue?.toFixed(2)}B
                            </p>
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">Deal Type</p>
                            <p className="font-medium capitalize">{deal.dealType}</p>
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">Detected</p>
                            <p className="font-medium">
                                {new Date(deal.detectedAt).toLocaleString()}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <ResearchStatusBadge status={deal.researchStatus} />
                    </div>
                </div>

                <div className="flex flex-col gap-2 ml-4">
                    <Button asChild>
                        <a href={`/staging/${deal.id}`}>
                            Review →
                        </a>
                    </Button>
                </div>
            </div>
        </Card>
    )
}

function ResearchStatusBadge({ status }: { status: string }) {
    const config = {
        queued: { label: "Research Queued", variant: "outline" },
        generating: { label: "Generating Research...", variant: "secondary" },
        completed: { label: "Research Complete", variant: "default" },
        failed: { label: "Research Failed", variant: "destructive" }
    }

    const { label, variant } = config[status] || config.queued

    return <Badge variant={variant as any}>{label}</Badge>
}
```

### Deal Review Page

**Route:** `/staging/[id]`

```typescript
// app/staging/[id]/page.tsx
"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ResearchReportSection } from "@/components/research-report"

export default function StagedDealReviewPage() {
    const params = useParams()
    const router = useRouter()
    const [deal, setDeal] = useState<any>(null)
    const [editing, setEditing] = useState(false)
    const [reviewNotes, setReviewNotes] = useState("")

    useEffect(() => {
        fetchDeal()
    }, [params.id])

    async function fetchDeal() {
        const res = await fetch(`/api/staging/deals/${params.id}`)
        const data = await res.json()
        setDeal(data.deal)
    }

    async function handleApprove() {
        await fetch(`/api/staging/deals/${params.id}/approve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ notes: reviewNotes })
        })

        router.push("/staging")
    }

    async function handleReject() {
        await fetch(`/api/staging/deals/${params.id}/reject`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ notes: reviewNotes })
        })

        router.push("/staging")
    }

    async function handleSaveEdits() {
        await fetch(`/api/staging/deals/${params.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(deal)
        })

        setEditing(false)
    }

    if (!deal) return <div>Loading...</div>

    return (
        <div className="container mx-auto py-8">
            {/* Header */}
            <div className="flex justify-between items-start mb-6">
                <div>
                    <h1 className="text-3xl font-bold mb-2">
                        Review: {deal.targetName}
                    </h1>
                    <p className="text-muted-foreground">
                        Detected {new Date(deal.detectedAt).toLocaleString()}
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={() => router.push("/staging")}>
                        ← Back to Queue
                    </Button>
                </div>
            </div>

            {/* Deal Information */}
            <Card className="p-6 mb-6">
                <div className="flex justify-between items-start mb-4">
                    <h2 className="text-xl font-semibold">Deal Information</h2>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditing(!editing)}
                    >
                        {editing ? "Cancel" : "Edit"}
                    </Button>
                </div>

                {editing ? (
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label>Target Name</Label>
                                <Input
                                    value={deal.targetName}
                                    onChange={e => setDeal({ ...deal, targetName: e.target.value })}
                                />
                            </div>
                            <div>
                                <Label>Target Ticker</Label>
                                <Input
                                    value={deal.targetTicker || ""}
                                    onChange={e => setDeal({ ...deal, targetTicker: e.target.value })}
                                />
                            </div>
                            <div>
                                <Label>Acquirer Name</Label>
                                <Input
                                    value={deal.acquirerName || ""}
                                    onChange={e => setDeal({ ...deal, acquirerName: e.target.value })}
                                />
                            </div>
                            <div>
                                <Label>Deal Value (Billions)</Label>
                                <Input
                                    type="number"
                                    step="0.01"
                                    value={deal.dealValue || ""}
                                    onChange={e => setDeal({ ...deal, dealValue: parseFloat(e.target.value) })}
                                />
                            </div>
                        </div>
                        <Button onClick={handleSaveEdits}>Save Changes</Button>
                    </div>
                ) : (
                    <dl className="grid grid-cols-2 gap-4">
                        <div>
                            <dt className="text-sm text-muted-foreground">Target</dt>
                            <dd className="font-medium">
                                {deal.targetName} ({deal.targetTicker})
                            </dd>
                        </div>
                        <div>
                            <dt className="text-sm text-muted-foreground">Acquirer</dt>
                            <dd className="font-medium">{deal.acquirerName}</dd>
                        </div>
                        <div>
                            <dt className="text-sm text-muted-foreground">Deal Value</dt>
                            <dd className="font-medium">${deal.dealValue}B</dd>
                        </div>
                        <div>
                            <dt className="text-sm text-muted-foreground">Deal Type</dt>
                            <dd className="font-medium capitalize">{deal.dealType}</dd>
                        </div>
                        <div>
                            <dt className="text-sm text-muted-foreground">Consideration</dt>
                            <dd className="font-medium capitalize">{deal.considerationType}</dd>
                        </div>
                        <div>
                            <dt className="text-sm text-muted-foreground">Confidence</dt>
                            <dd className="font-medium">
                                {(deal.confidenceScore * 100).toFixed(0)}%
                            </dd>
                        </div>
                    </dl>
                )}
            </Card>

            {/* Source Filing */}
            <Card className="p-6 mb-6">
                <h2 className="text-xl font-semibold mb-4">Source Filing</h2>
                <dl className="grid grid-cols-2 gap-4">
                    <div>
                        <dt className="text-sm text-muted-foreground">Filing Type</dt>
                        <dd className="font-medium">{deal.sourceFilingType}</dd>
                    </div>
                    <div>
                        <dt className="text-sm text-muted-foreground">Filed At</dt>
                        <dd className="font-medium">
                            {new Date(deal.sourceFilingDate).toLocaleString()}
                        </dd>
                    </div>
                    <div className="col-span-2">
                        <Button variant="outline" asChild>
                            <a href={deal.sourceFilingUrl} target="_blank">
                                View Original Filing →
                            </a>
                        </Button>
                    </div>
                </dl>
            </Card>

            {/* Research Reports */}
            {deal.researchStatus === "completed" && (
                <div className="mb-6">
                    <h2 className="text-xl font-semibold mb-4">Research Analysis</h2>
                    <ResearchReportSection dealId={deal.id} isStaged />
                </div>
            )}

            {/* Review Notes */}
            <Card className="p-6 mb-6">
                <h2 className="text-xl font-semibold mb-4">Review Notes</h2>
                <Textarea
                    placeholder="Add any notes about this deal..."
                    value={reviewNotes}
                    onChange={e => setReviewNotes(e.target.value)}
                    rows={4}
                />
            </Card>

            {/* Actions */}
            <div className="flex gap-4">
                <Button
                    size="lg"
                    onClick={handleApprove}
                    className="flex-1"
                >
                    ✓ Approve & Add to Tracker
                </Button>
                <Button
                    size="lg"
                    variant="destructive"
                    onClick={handleReject}
                >
                    ✗ Reject
                </Button>
            </div>
        </div>
    )
}
```

---

## API Endpoints

### Staging API

**File:** `app/api/staging/deals/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get("status") || "pending"

    const deals = await prisma.stagedDeal.findMany({
        where: { status },
        orderBy: { detectedAt: "desc" },
        include: {
            sourceFiling: true
        }
    })

    return NextResponse.json({ deals })
}
```

**File:** `app/api/staging/deals/[id]/approve/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function POST(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    const { notes } = await request.json()
    const stagedDealId = parseInt(params.id)

    // Start transaction
    const result = await prisma.$transaction(async (tx) => {
        // 1. Get staged deal
        const stagedDeal = await tx.stagedDeal.findUnique({
            where: { id: stagedDealId }
        })

        if (!stagedDeal) {
            throw new Error("Staged deal not found")
        }

        // 2. Create live deal
        const liveDeal = await tx.deal.create({
            data: {
                targetTicker: stagedDeal.targetTicker,
                targetName: stagedDeal.targetName,
                acquirerName: stagedDeal.acquirerName,
                acquirerTicker: stagedDeal.acquirerTicker,
                dealValue: stagedDeal.dealValue,
                dealType: stagedDeal.dealType,
                considerationType: stagedDeal.considerationType,

                // Metadata
                autoDetected: true,
                detectionConfidence: stagedDeal.confidenceScore,
                createdFromStaging: stagedDealId,
                status: "active"
            }
        })

        // 3. Update staged deal
        await tx.stagedDeal.update({
            where: { id: stagedDealId },
            data: {
                status: "approved",
                reviewedAt: new Date(),
                reviewNotes: notes,
                approvedDealId: liveDeal.id
            }
        })

        // 4. Link research reports
        await tx.researchReport.updateMany({
            where: { stagedDealId },
            data: { dealId: liveDeal.id }
        })

        return liveDeal
    })

    return NextResponse.json({ deal: result })
}
```

---

## Implementation Checklist

### Phase 1: Real-Time Detection (Day 1)

- [ ] Update database schema
  - [ ] Create `staged_deals` table
  - [ ] Create `research_queue` table
  - [ ] Update Prisma schema
  - [ ] Run migrations

- [ ] Implement aggressive polling
  - [ ] 60-second polling during market hours
  - [ ] 5-minute polling outside market hours
  - [ ] Market hours detection

- [ ] Implement M&A detection
  - [ ] Filing type filtering
  - [ ] Keyword analysis
  - [ ] Confidence scoring

### Phase 2: Extraction & Staging (Day 2)

- [ ] LLM-based deal extraction
  - [ ] Parse target/acquirer info
  - [ ] Extract deal value
  - [ ] Parse deal terms

- [ ] Create staged deals
  - [ ] Store in `staged_deals` table
  - [ ] Link to source filing
  - [ ] Calculate confidence score

- [ ] Deduplication logic
  - [ ] Check for existing staged deals
  - [ ] Check for existing live deals
  - [ ] Merge duplicate detections

### Phase 3: Alerts (Day 2)

- [ ] Email alerts
  - [ ] Design email template
  - [ ] Send via SendGrid/AWS SES
  - [ ] Include deal summary

- [ ] Slack integration
  - [ ] Set up webhook
  - [ ] Format Slack message
  - [ ] Add action buttons

- [ ] Browser notifications (optional)
  - [ ] Request permission
  - [ ] Send notifications via WebSocket

### Phase 4: Review UI (Day 3)

- [ ] Staging queue page
  - [ ] List pending deals
  - [ ] Real-time updates
  - [ ] Filter/sort options

- [ ] Deal review page
  - [ ] Show deal details
  - [ ] Edit capability
  - [ ] View source filing
  - [ ] View research reports
  - [ ] Approve/reject actions

- [ ] API endpoints
  - [ ] GET /api/staging/deals
  - [ ] GET /api/staging/deals/[id]
  - [ ] POST /api/staging/deals/[id]/approve
  - [ ] POST /api/staging/deals/[id]/reject
  - [ ] PATCH /api/staging/deals/[id]

### Phase 5: Auto-Research (Day 4)

- [ ] Queue research jobs
  - [ ] Create job on deal detection
  - [ ] High priority for staged deals

- [ ] Background worker
  - [ ] Process research queue
  - [ ] Generate all 3 reports
  - [ ] Update staged deal status

- [ ] Link research to staged deals
  - [ ] Store with staged deal reference
  - [ ] Transfer to live deal on approval

---

## Configuration

### Environment Variables

```bash
# EDGAR Monitoring
EDGAR_POLLING_INTERVAL_MARKET=60      # Seconds during market hours
EDGAR_POLLING_INTERVAL_OFFPEAK=300    # Seconds outside market hours

# Alerts
SENDGRID_API_KEY=sg-xxx
ALERT_EMAIL_FROM=alerts@yourdomain.com
ALERT_EMAIL_TO=luis@yourdomain.com

SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx/yyy/zzz

# SMS (optional)
TWILIO_SID=ACxxx
TWILIO_TOKEN=xxx
TWILIO_PHONE=+1234567890
LUIS_PHONE=+1234567890

# Research
AUTO_RESEARCH_ENABLED=true
RESEARCH_PRIORITY_STAGED=8            # High priority for staged deals
```

---

## Cost Estimate (Updated)

### With 60-Second Polling:

**EDGAR RSS Polls:**
- Market hours: 9.5 hours × 60 polls/hour = 570 polls/day
- Off-peak: 14.5 hours × 12 polls/hour = 174 polls/day
- Total: ~750 polls/day (free)

**LLM Extraction:**
- ~10 M&A filings/day × $0.08 = $0.80/day
- Monthly: ~$24

**Research Generation:**
- ~5 new deals/day × $1.50 = $7.50/day
- Monthly: ~$225

**Notification Services:**
- SendGrid (email): Free tier (100/day)
- Slack: Free
- Twilio (SMS): $0.0075/message × 5/day = $0.04/day ($1.20/month)

**Total Monthly Cost: ~$250**

---

## Questions for Luis

1. **Polling frequency?**
   - Start with 60s during market hours?
   - Upgrade to webhooks later?

2. **Alert channels?**
   - Email + Slack? (recommended)
   - Add SMS for high-confidence deals?

3. **Auto-approve threshold?**
   - Should deals >95% confidence auto-approve?
   - Or always require manual review?

4. **Filing types to monitor?**
   - 8-K only to start?
   - Or all types (8-K, SC TO, DEFM14A, SC 13D)?

5. **Research timing?**
   - Generate immediately (before review)?
   - Or only after approval?

---

## Next Steps

1. **Approve this architecture**
2. **Set up alert channels** (Slack webhook, SendGrid)
3. **Start Phase 1 implementation** (database + polling)
4. **Test with historical filings**
5. **Deploy and monitor**

**Ready to start building!** 🚀

This architecture gives Luis instant alerts with full research, while maintaining control through the review workflow. The 60-second polling during market hours provides near-real-time detection without the cost of webhooks.
