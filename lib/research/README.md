# AI Research Analysis System

Automated deal research reports powered by Claude AI.

## Overview

This system automatically analyzes SEC merger proxy filings (DEFM14A, 8-K, etc.) to generate comprehensive research reports covering:

1. **Topping Bid Analysis** - Detect potential for competing offers
2. **Antitrust Risk** - Assess regulatory approval likelihood
3. **Contract Analysis** - Identify unusual M&A agreement terms

## Features

- **Prompt Caching** - 69% cost reduction on subsequent analyses
- **A/B Testing** - Compare Haiku vs Sonnet vs Opus performance
- **Historical Analysis** - Track model performance over time
- **Modular Design** - Run individual analysis modules or full suite
- **Version Tracking** - Track AI model and prompt versions for reproducibility

## Quick Start

### 1. Set up Environment

Add to `.env`:

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

### 2. Fetch SEC Filings

```bash
POST /api/research/fetch-filings
{
  "dealId": "uuid-here",
  "ticker": "AAPL"
}
```

### 3. Generate Report

```bash
POST /api/research/generate-report
{
  "dealId": "uuid-here",
  "options": {
    "model": "claude-3-5-sonnet-20241022",
    "useCache": true,
    "modules": ["topping_bid", "antitrust", "contract"]
  }
}
```

### 4. View Report

```bash
GET /api/research/generate-report?dealId=uuid-here
```

## Architecture

```
lib/research/
├── types.ts              # TypeScript types
├── anthropic-client.ts   # Claude API client with caching
├── orchestrator.ts       # Coordinates analysis pipeline
├── ab-testing.ts         # Model comparison framework
└── analyzers/
    ├── toppingBidAnalyzer.ts   # Detects competing bid potential
    ├── antitrustAnalyzer.ts    # Regulatory risk assessment
    └── contractAnalyzer.ts     # M&A agreement analysis
```

## Cost Analysis

**40 deals/month, 3 modules each = 120 analyses**

### Recommended: Sonnet 4.5 with Caching

- **First analysis:** $0.50 (cache creation)
- **Subsequent analyses:** $0.15 (cache read)
- **Monthly cost:** ~$60

### Budget Options

| Model | First Run | Cached | Monthly |
|-------|-----------|--------|---------|
| Haiku 4.5 | $0.15 | $0.05 | $20 |
| Sonnet 4.5 | $0.50 | $0.15 | $60 |
| Opus 4 | $2.50 | $0.75 | $300 |

**Recommendation:** Sonnet 4.5 provides best balance of quality and cost.

## A/B Testing

Compare model performance:

```typescript
import { runModelComparison } from './ab-testing';

const comparison = await runModelComparison(
  context,
  'topping_bid',
  ['claude-3-5-haiku-20241022', 'claude-3-5-sonnet-20241022']
);

console.log(`Winner: ${comparison.winner}`);
console.log(`Reason: ${comparison.recommendation}`);
```

Run comprehensive test:

```typescript
import { runComprehensiveTest } from './ab-testing';

const results = await runComprehensiveTest(context);

console.log('Total Cost by Model:', results.summary.totalCost);
console.log('Recommended Model:', results.summary.recommendedModel);
```

## Historical Analysis

Track patterns across deals:

```typescript
// Get report for specific deal
const report = await getResearchReport(dealId);

// Query all reports with high topping bid scores
const reports = await prisma.dealResearchReport.findMany({
  where: {
    toppingBidScore: { gte: 70 }
  },
  include: { sections: true }
});

// Analyze which patterns predicted successful topping bids
```

## Analysis Modules

### Topping Bid Analyzer

Detects signals that a competing offer might emerge:

- Rejected higher bids in DEFM14A
- Go-shop provisions
- Termination fee structure
- Evidence of strategic interest

**Based on:** [YAVB Blog - Hidden Topping Bids](https://www.yetanothervalueblog.com/)

### Antitrust Analyzer

Assesses regulatory approval risk:

- Market concentration (HHI)
- Horizontal/vertical overlap
- Required approvals (FTC, DOJ, EU)
- Historical precedents
- Proposed remedies

### Contract Analyzer

Identifies unusual M&A agreement terms:

- Termination rights
- Material Adverse Effect (MAE) clauses
- Financing conditions
- Reverse break fees
- Specific performance

## Customization

### Add New Analysis Module

1. Create analyzer in `analyzers/`:

```typescript
// lib/research/analyzers/customAnalyzer.ts

export async function analyzeCustom(
  context: AnalysisContext,
  model: AIModel
): Promise<AnalysisResult> {
  const client = getAnthropicClient();
  const promptConfig = buildPromptConfig(context);

  const response = await client.generateAnalysis(
    promptConfig,
    filingContent,
    model,
    true // use cache
  );

  return {
    sectionType: 'custom',
    sectionTitle: 'Custom Analysis',
    analysisMarkdown: response.content,
    // ... other fields
  };
}
```

2. Register in orchestrator:

```typescript
// lib/research/orchestrator.ts

case 'custom':
  return analyzeCustom(context, model);
```

3. Use it:

```bash
POST /api/research/generate-report
{
  "dealId": "uuid",
  "options": {
    "modules": ["custom", "topping_bid"]
  }
}
```

## Prompt Versioning

Track prompt changes for A/B testing:

```typescript
const PROMPT_VERSION = "2.0.0"; // Increment when changing prompts

// Version is stored in ReportSection.promptVersion
// Query reports by version to compare performance
```

## Database Schema

```sql
-- Main report
DealResearchReport {
  id
  dealId
  status (pending/generating/completed)
  overallRiskScore
  antitrustRiskScore
  contractRiskScore
  toppingBidScore
  executiveSummary
  keyFindings
}

-- Individual analysis sections
ReportSection {
  id
  reportId
  sectionType
  analysisMarkdown
  riskScore
  confidence
  keyPoints
  extractedData
  aiModel              -- Track which model used
  promptVersion        -- Track prompt version
  processingTimeMs     -- Performance tracking
}
```

## API Reference

### Generate Report

```
POST /api/research/generate-report
```

**Request:**
```json
{
  "dealId": "uuid",
  "options": {
    "model": "claude-3-5-sonnet-20241022",
    "useCache": true,
    "modules": ["topping_bid", "antitrust", "contract"],
    "compareModels": false
  }
}
```

**Response:**
```json
{
  "success": true,
  "reportId": "uuid",
  "status": "completed",
  "sectionsGenerated": 3,
  "totalCost": 0.50,
  "totalTimeMs": 45000,
  "sections": [...]
}
```

### Get Report

```
GET /api/research/generate-report?dealId=uuid
```

**Response:**
```json
{
  "success": true,
  "report": {
    "id": "uuid",
    "dealId": "uuid",
    "status": "completed",
    "overallRiskScore": 65,
    "executiveSummary": "...",
    "sections": [...]
  }
}
```

## Performance

**Target Response Times:**

| Operation | Target | Typical |
|-----------|--------|---------|
| Single module | < 30s | ~15s |
| Full report (3 modules) | < 60s | ~45s |
| A/B test (2 models) | < 60s | ~50s |
| Comprehensive test | < 3min | ~2min |

**Optimization:**

- Modules run in parallel (Promise.all)
- Prompt caching reduces latency by ~50% after first run
- Consider batch API for overnight processing (50% discount)

## Cost Monitoring

Track costs in production:

```typescript
import { getAnthropicClient } from './anthropic-client';

const client = getAnthropicClient();
const cost = client.calculateCost(usage, model);

// Store in database or logging service
await logApiCost({
  dealId,
  module: 'topping_bid',
  model,
  cost,
  timestamp: new Date()
});
```

## Troubleshooting

### "Deal not ready for analysis"

- Run `POST /api/research/fetch-filings` first
- Ensure filings have `fetchStatus: "fetched"`

### "Failed to generate analysis"

- Check `ANTHROPIC_API_KEY` is set
- Verify API key has sufficient credits
- Check filing content is not empty

### High costs

- Enable prompt caching (`useCache: true`)
- Use Haiku for simple deals
- Consider batch API for overnight processing

## Future Enhancements

### Planned

- [ ] Batch API integration (50% discount)
- [ ] WebSocket for real-time progress
- [ ] Scheduled report generation
- [ ] Email notifications
- [ ] Custom prompt templates
- [ ] Multi-model consensus voting

### Under Consideration

- [ ] GPT-4 integration for comparison
- [ ] Local LLM option (Llama, Mistral)
- [ ] Visual filing analysis (charts, tables)
- [ ] Cross-deal pattern detection
- [ ] Automated trading signals

## Support

For issues or questions:

1. Check [API Documentation](../../docs/API_DOCUMENTATION.md)
2. Review [Architecture](../../docs/ARCHITECTURE.md)
3. Open GitHub issue

## License

Proprietary - M&A Tracker App
