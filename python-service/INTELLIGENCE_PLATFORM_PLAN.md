# Multi-Source M&A Intelligence Platform - Implementation Plan

## Overview
Transform the M&A tracker from single-source (EDGAR) to a comprehensive multi-source intelligence platform that aggregates deal information from 9 different sources, categorizes tickers into tiers, and provides early warning signals.

---

## Source Analysis & Implementation Strategy

### **Tier 1: Official Sources** (Highest Credibility - Definitive Information)

#### 1. **SEC EDGAR** ✅ Already Implemented
- **URL**: SEC EDGAR RSS Feeds
- **Data Type**: 8-K filings, SC TO (tender offers), DEFM14A (merger proxies)
- **Credibility**: ★★★★★ (Definitive)
- **Update Frequency**: Real-time
- **Value**: Definitive deal announcements, legal agreements
- **Implementation**: Keep existing monitor, integrate with new intelligence engine
- **Auto-Promotion Rule**: ANY mention → **Active** tier immediately

#### 2. **FTC Early Termination Notices** 🆕 High Priority
- **URL**: https://www.ftc.gov/legal-library/browse/early-termination-notices
- **Data Type**: HSR Act early termination grants
- **Credibility**: ★★★★★ (Official regulatory clearance)
- **Update Frequency**: Daily (business days)
- **Value**: Deal progress indicator - means regulatory approval granted
- **Technical Approach**:
  - HTML scraping (no RSS available)
  - Parse table format: Date | Acquiring Person | Acquired Person
  - Extract tickers using company name matching
- **Auto-Promotion Rule**: Confirms existing **Active** deals, updates status to "pending_approval" → "cleared"

#### 3. **NASDAQ Trader Headlines** 🆕 High Priority
- **URL**: http://www.nasdaqtrader.com/Trader.aspx?id=archiveheadlines&cat_id=105
- **Data Type**: Trading halts, corporate actions, symbol changes
- **Credibility**: ★★★★★ (Official exchange data)
- **Update Frequency**: Real-time
- **Value**: Trading halts often precede deal announcements (T1 halt)
- **Technical Approach**:
  - HTML table scraping
  - Parse fields: Date, Time, Issue Symbol, Issue Name, Reason Code
  - Filter for T1 (pending news), M (merger/acquisition) codes
- **Auto-Promotion Rule**: T1 halt for known ticker → investigate, add to **Rumored** with high confidence

#### 4. **NYSE Corporate Actions** 🆕 High Priority
- **URL**: https://www.nyse.com/corporate-actions
- **Data Type**: Mergers, acquisitions, spin-offs, symbol changes
- **Credibility**: ★★★★★ (Official exchange data)
- **Update Frequency**: Daily
- **Value**: Official exchange notification of corporate actions
- **Technical Approach**:
  - HTML/AJAX scraping or API if available
  - Parse action type, ticker, company name, effective date
  - Filter for M&A-related actions
- **Auto-Promotion Rule**: M&A action → **Active** tier immediately

---

### **Tier 2: News Sources** (High Credibility - Informed Reporting)

#### 5. **Reuters M&A Section** 🆕 High Priority
- **URL**: https://www.reuters.com/legal/mergers-acquisitions/
- **Data Type**: Verified news articles on M&A deals
- **Credibility**: ★★★★☆ (Established news source)
- **Update Frequency**: Hourly
- **Value**: Early deal announcements, deal updates, market commentary
- **Technical Approach**:
  - Check for RSS feed, fallback to HTML scraping
  - Parse: headline, publish date, article content
  - NLP extraction: tickers, company names, deal values from article text
  - Use Claude to extract structured deal info
- **Auto-Promotion Rule**:
  - First mention → **Rumored** tier
  - Second mention from different source → **Active** tier

#### 6. **Seeking Alpha M&A News** 🆕 Medium Priority
- **URL**: https://seekingalpha.com/market-news/m-a
- **Data Type**: Aggregated M&A news and analysis
- **Credibility**: ★★★☆☆ (News aggregator, mixed quality)
- **Update Frequency**: Hourly
- **Value**: Broad coverage, early signals, analyst commentary
- **Technical Approach**:
  - RSS feed or HTML scraping
  - Parse headlines and article summaries
  - Ticker extraction from article tags/links
  - LLM-based content analysis for deal details
- **Auto-Promotion Rule**:
  - Mention alone → Watchlist
  - Mention + one other news source → **Rumored**

---

### **Tier 3: Social/Alternative Sources** (Lower Credibility - Early Signals)

#### 7. **Twitter @OpenOutcrier** 🆕 Medium Priority
- **URL**: https://twitter.com/OpenOutcrier
- **Data Type**: Real-time M&A rumors and market chatter
- **Credibility**: ★★☆☆☆ (Social media, unverified)
- **Update Frequency**: Real-time
- **Value**: **Earliest possible signals** - sometimes hours/days before official news
- **Technical Approach**:
  - Twitter API v2 or web scraping
  - Parse tweets for ticker mentions ($TICKER format)
  - Keyword detection: "rumor", "sources say", "working on deal", "in talks"
  - Sentiment analysis
- **Auto-Promotion Rule**:
  - Tweet mention → Watchlist
  - Tweet + ANY other source → **Rumored**
  - Confidence boost if @OpenOutcrier has strong track record

---

### **Tier 4: Indicator Sources** (Indirect Signals)

#### 8. **QuantumOnline Preferred Securities** 🆕 Low Priority (Phase 2)
- **URL**: https://www.quantumonline.com/
- **Data Type**: Preferred stock/bond calls, redemptions related to M&A
- **Credibility**: ★★★★☆ (Specialized data source)
- **Update Frequency**: Daily
- **Value**: Preferred securities often called/redeemed in M&A transactions
- **Technical Approach**:
  - HTML scraping of call/redemption notices
  - Correlate preferred stock actions with potential M&A activity
  - Use as supporting evidence for existing deals
- **Auto-Promotion Rule**: Supporting evidence only, doesn't trigger promotions alone

#### 9. **AlphaRank** 🆕 Low Priority (Phase 2) - Need Research
- **URL**: https://alpharank.com/
- **Data Type**: TBD - need to investigate site capabilities
- **Credibility**: TBD
- **Update Frequency**: TBD
- **Value**: TBD
- **Technical Approach**: Research site, determine if useful
- **Auto-Promotion Rule**: TBD

#### 10. **FRED HY Spread (BAMLH0A0HYM2)** 🆕 Low Priority (Phase 2)
- **URL**: https://fred.stlouisfed.org/series/BAMLH0A0HYM2
- **Data Type**: High Yield Option-Adjusted Spread
- **Credibility**: ★★★☆☆ (Economic indicator)
- **Update Frequency**: Daily
- **Value**: Market sentiment indicator - widening spreads may impact deal activity
- **Technical Approach**:
  - FRED API integration
  - Track spread changes over time
  - Correlate with deal closure rates
- **Auto-Promotion Rule**: Context indicator only, doesn't trigger promotions

---

## Implementation Phases

### **Phase 1: Foundation** (Priority: Immediate - ~3-4 hours)

1. **Database Migration** ✅ Complete
   - Apply 003_deal_intelligence.sql migration
   - Tables: `deal_intelligence`, `deal_sources`, `ticker_watchlist`, `source_monitors`, `deal_history`

2. **Core Framework** (1-2 hours)
   - `BaseSourceMonitor` abstract class
   - `IntelligenceAggregator` - entity resolution & confidence scoring
   - `TierManager` - automatic promotion logic
   - Data models for deal intelligence

3. **High-Priority Monitors** (1-2 hours)
   - `FTCEarlyTerminationMonitor`
   - `NASDAQHeadlinesMonitor`
   - `ReutersRSSMonitor`

4. **Integration** (30 mins)
   - Update existing EDGAR monitor to feed intelligence engine
   - API endpoints for deal intelligence
   - Basic UI dashboard

### **Phase 2: Expansion** (Priority: Next Session - ~2-3 hours)

5. **Additional Monitors**
   - `NYSECorporateActionsMonitor`
   - `SeekingAlphaMonitor`
   - `TwitterOpenOutcrierMonitor`

6. **Enhanced Aggregation**
   - Fuzzy matching for company names
   - Deal timeline reconstruction
   - Source credibility scoring system

7. **Advanced UI**
   - Multi-source timeline view
   - Tier management interface
   - Source attribution display

### **Phase 3: Polish** (Priority: Future - ~2 hours)

8. **Indicator Sources**
   - `QuantumOnlineMonitor`
   - `AlphaRankMonitor` (if valuable)
   - `FREDHYSpreadMonitor`

9. **Intelligence Features**
   - Historical pattern analysis
   - Deal prediction scoring
   - Alert system for tier promotions

---

## Ticker Tier System

### **Tier Definitions**

1. **Active Deals** 🟢
   - Confirmed M&A activity
   - Source: Official filings (EDGAR, FTC, Exchange)
   - Action: Full monitoring, detailed research

2. **Rumored Deals** 🟡
   - Multiple credible mentions OR high-credibility single source
   - Source: News outlets, multiple social mentions
   - Action: Enhanced monitoring, watch for confirmation

3. **Watchlist / General** ⚪
   - All other tickers
   - Single low-credibility mention OR no mentions
   - Action: Passive monitoring

### **Auto-Promotion Rules**

```python
# Watchlist → Rumored
- 2+ news sources mention deal
- 1 high-credibility news source (Reuters) mentions deal
- Twitter mention + any other source

# Rumored → Active
- EDGAR filing
- FTC early termination notice
- Exchange corporate action announcement
- 3+ news sources converge on same deal

# Demotion Rules
- Rumored → Watchlist: No new mentions in 30 days
- Active → Watchlist: Deal terminated/completed
```

---

## Technical Architecture

```
┌──────────────────────── SOURCES LAYER ────────────────────────┐
│                                                                 │
│  EDGAR  FTC  NASDAQ  NYSE  Reuters  SA  Twitter  QO  FRED     │
│    │     │      │      │      │      │      │      │     │     │
└────┴─────┴──────┴──────┴──────┴──────┴──────┴──────┴─────┴────┘
         │
         ▼
┌──────────────────── SOURCE MONITORS ──────────────────────────┐
│  BaseSourceMonitor (abstract)                                  │
│  ├─ fetch_updates()                                            │
│  ├─ parse_content()                                            │
│  └─ extract_deal_mention()                                     │
└────────────────────────────┬───────────────────────────────────┘
                             │
                             ▼
┌─────────────── INTELLIGENCE AGGREGATOR ───────────────────────┐
│  • Entity Resolution (same deal, different sources)            │
│  • Ticker Extraction & Normalization                           │
│  • Confidence Scoring (based on source credibility + count)    │
│  • Timeline Reconstruction                                     │
└────────────────────────────┬───────────────────────────────────┘
                             │
                             ▼
┌───────────────────── TIER MANAGER ────────────────────────────┐
│  • Apply promotion rules                                       │
│  • Update ticker watchlist                                     │
│  • Trigger alerts on tier changes                              │
│  • Maintain deal history                                       │
└────────────────────────────┬───────────────────────────────────┘
                             │
                             ▼
┌─────────────────── DATABASE LAYER ────────────────────────────┐
│  deal_intelligence  |  deal_sources  |  ticker_watchlist       │
└────────────────────────────┬───────────────────────────────────┘
                             │
                             ▼
┌──────────────────── API & UI LAYER ───────────────────────────┐
│  • Unified deal dashboard                                      │
│  • Source attribution timeline                                 │
│  • Tier management interface                                   │
│  • Real-time monitoring status                                 │
└────────────────────────────────────────────────────────────────┘
```

---

## Next Steps

1. ✅ Database schema created
2. ⏳ Apply migration to database
3. ⏳ Build core framework (BaseSourceMonitor, IntelligenceAggregator, TierManager)
4. ⏳ Implement top 3 high-priority monitors (FTC, NASDAQ, Reuters)
5. ⏳ Create unified intelligence dashboard

**Ready to proceed with implementation?**
