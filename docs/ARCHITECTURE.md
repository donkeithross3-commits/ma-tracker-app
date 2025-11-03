# M&A Tracker - System Architecture

## Overview

The M&A Tracker is a sophisticated merger arbitrage deal tracking platform with automated options analysis and AI-powered research capabilities.

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                             │
├─────────────────────────────────────────────────────────────────┤
│  Next.js 15 Frontend (React 18, TypeScript)                     │
│  - Deal Dashboard                                                │
│  - Portfolio Management                                          │
│  - Research Reports                                              │
│  - Options Scanner UI                                            │
└────────────┬────────────────────────────────────────────────────┘
             │
             │ HTTPS
             │
┌────────────▼────────────────────────────────────────────────────┐
│                      APPLICATION LAYER                           │
├─────────────────────────────────────────────────────────────────┤
│  Next.js App Router API Routes                                  │
│  ├─ /api/deals              - Deal CRUD operations              │
│  ├─ /api/options/scan       - Options analysis proxy            │
│  ├─ /api/research/*         - SEC filing & AI analysis          │
│  └─ /api/portfolio          - Position management               │
└────┬────────────────────────────┬───────────────────────────────┘
     │                            │
     │                            │ HTTP
     │                            │
     │                    ┌───────▼────────────────────────────┐
     │                    │   PYTHON MICROSERVICE              │
     │                    ├────────────────────────────────────┤
     │                    │  FastAPI Service (Port 8000)       │
     │                    │  ├─ IB Gateway Integration         │
     │                    │  ├─ Options Chain Analysis         │
     │                    │  ├─ Merger Arb Calculator          │
     │                    │  └─ Greeks & Risk Metrics          │
     │                    │                                     │
     │                    │  Interactive Brokers API (ibapi)   │
     │                    │  ├─ Real-time quotes               │
     │                    │  ├─ Options data                   │
     │                    │  └─ Market data                    │
     │                    └───────┬────────────────────────────┘
     │                            │
     │                            │ TCP (Port 7497/7496)
     │                            │
     │                    ┌───────▼────────────────────────────┐
     │                    │  IB Gateway / TWS                  │
     │                    │  (Runs on User's PC)               │
     │                    └────────────────────────────────────┘
     │
     │ Prisma ORM
     │
┌────▼────────────────────────────────────────────────────────────┐
│                         DATA LAYER                               │
├─────────────────────────────────────────────────────────────────┤
│  PostgreSQL Database (Neon.tech)                                │
│  ├─ Deal Management                                             │
│  ├─ Version Control                                             │
│  ├─ Portfolio Positions                                         │
│  ├─ SEC Filings Cache                                           │
│  └─ AI Research Reports                                         │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    EXTERNAL SERVICES                             │
├─────────────────────────────────────────────────────────────────┤
│  SEC EDGAR API (data.sec.gov)                                   │
│  └─ Merger proxy filings, 8-Ks, regulatory documents           │
│                                                                  │
│  Anthropic Claude API (Future)                                  │
│  └─ AI-powered document analysis and research                   │
└─────────────────────────────────────────────────────────────────┘
```

## Architecture Layers

### 1. Client Layer (Next.js Frontend)

**Technology:** Next.js 15, React 18, TypeScript, Tailwind CSS, shadcn/ui

**Responsibilities:**
- User interface for deal management
- Real-time options scanner interface
- Research report visualization
- Portfolio analytics dashboard

**Key Features:**
- Server-side rendering for performance
- Client-side state management
- Responsive design for desktop/mobile

### 2. Application Layer (Next.js API Routes)

**Technology:** Next.js App Router, TypeScript

**API Structure:**
```
/api/
├── deals/              # Deal CRUD operations
├── options/
│   └── scan/          # Options analysis (proxies to Python service)
├── research/
│   ├── fetch-filings/ # SEC filing retrieval
│   ├── analyze/       # AI analysis trigger
│   └── reports/       # Report generation & retrieval
└── portfolio/         # Position management
```

**Responsibilities:**
- Business logic orchestration
- Authentication & authorization
- Data validation
- Rate limiting
- External API integration

### 3. Microservice Layer (Python FastAPI)

**Technology:** FastAPI, Python 3.9+, ibapi (Interactive Brokers)

**Location:** Runs on user's local machine (Luis's PC for now)

**Responsibilities:**
- Connect to IB Gateway/TWS
- Fetch real-time options chains
- Calculate merger arbitrage metrics
- Analyze options strategies
- Compute Greeks and risk metrics

**Endpoints:**
```
GET  /health                    - Service health check
GET  /                         - Service info
POST /scan                     - Analyze options for a deal
GET  /test-scan/{ticker}       - Test endpoint with defaults
```

**Connection to IB:**
- Port 7497 (paper trading)
- Port 7496 (live trading)
- Localhost TCP connection

### 4. Data Layer (PostgreSQL + Prisma)

**Technology:** PostgreSQL 14+, Prisma ORM

**Hosting:** Neon.tech (serverless PostgreSQL)

**See DATABASE_SCHEMA.md for detailed schema documentation**

### 5. External Services

**SEC EDGAR API:**
- Public data.sec.gov API
- Rate limit: 10 requests/second
- Fetches DEFM14A, 8-K, DEFA14A, PREM14A filings
- No authentication required (requires User-Agent header)

**Anthropic Claude API (Planned):**
- Document analysis
- Contract review
- Risk assessment
- Report generation

## Data Flow Diagrams

### Deal Creation Flow

```
User Creates Deal
    │
    ├─> Save to Database (Deal + DealVersion)
    │
    ├─> Trigger SEC Filing Fetch
    │   └─> Lookup CIK by ticker
    │   └─> Fetch recent filings
    │   └─> Store in SecFiling table
    │
    └─> (Future) Trigger AI Research Report Generation
        └─> Analyze filings
        └─> Generate report sections
        └─> Store in DealResearchReport + ReportSection
```

### Options Scan Flow

```
User Requests Options Scan
    │
    ├─> Next.js API Route (/api/options/scan)
    │   └─> Validate deal parameters
    │
    ├─> Python FastAPI Service (http://localhost:8000/scan)
    │   ├─> Connect to IB Gateway
    │   ├─> Fetch underlying price
    │   ├─> Fetch options chain
    │   ├─> Calculate merger arb strategies
    │   └─> Return opportunities
    │
    └─> Display results in UI
```

### Research Report Flow (Planned)

```
Deal Added / Filing Updated
    │
    ├─> Fetch SEC Filings
    │   └─> Store raw HTML/text
    │
    ├─> Create DealResearchReport (status: generating)
    │
    ├─> Run AI Analysis Modules (Parallel)
    │   ├─> Antitrust Analysis
    │   │   └─> Create ReportSection
    │   │
    │   ├─> Contract Analysis
    │   │   └─> Create ReportSection
    │   │
    │   ├─> Topping Bid Detection
    │   │   └─> Create ReportSection
    │   │
    │   └─> Deal Structure Analysis
    │       └─> Create ReportSection
    │
    ├─> Aggregate Risk Scores
    │
    ├─> Generate Executive Summary
    │
    └─> Update Report (status: completed)
```

## Deployment Architecture

### Current Setup

**Frontend + API:**
- Deployed on Vercel
- Serverless functions for API routes
- Automatic deployments from main branch
- Production URL: https://ma-tracker-app.vercel.app/

**Database:**
- Neon.tech serverless PostgreSQL
- Connection pooling enabled
- Automatic backups

**Python Service:**
- Runs on Luis's Windows PC
- Exposes via ngrok tunnel (free tier)
- ngrok URL changes on restart (limitation)

### Production Deployment Considerations

**For Production Scale:**

1. **Python Service:**
   - Deploy to AWS EC2 / DigitalOcean VPS
   - Persistent ngrok URL (paid tier) or direct IP
   - PM2 for process management
   - Docker container for portability

2. **Database:**
   - Neon.tech (current) or
   - AWS RDS PostgreSQL or
   - Supabase (includes auth)

3. **Authentication:**
   - NextAuth.js (ready to integrate)
   - OAuth providers (Google, GitHub)
   - Role-based access control

4. **Monitoring:**
   - Vercel Analytics
   - Sentry for error tracking
   - Prisma Studio for database inspection

## Security Considerations

### Current Implementation

1. **API Security:**
   - CORS enabled (allow all origins for development)
   - Input validation with Pydantic/Zod
   - No authentication (single-user system)

2. **Data Security:**
   - Database credentials in .env
   - Connection string not exposed to client
   - Prisma client runs server-side only

3. **IB Gateway:**
   - Localhost connection only
   - Trusted IP: 127.0.0.1
   - No remote access

### Production Security Recommendations

1. **Add Authentication:**
   - NextAuth.js with JWT
   - User roles: admin, analyst, viewer
   - Session management

2. **API Protection:**
   - Rate limiting per user
   - API key for Python service
   - CORS restrict to specific domains

3. **Secrets Management:**
   - Environment variables for all secrets
   - Rotate database credentials
   - Secure ngrok auth token

4. **Data Privacy:**
   - Encrypt sensitive deal data
   - Audit logging (already implemented)
   - GDPR compliance if needed

## Performance Optimization

### Current Optimizations

1. **Database:**
   - Indexes on frequently queried fields
   - Prisma connection pooling
   - Efficient foreign key relationships

2. **API:**
   - Next.js edge functions
   - Server-side rendering
   - Caching strategies

3. **Python Service:**
   - Reuses IB connection
   - Concurrent option chain fetches
   - In-memory caching

### Future Optimizations

1. **Caching:**
   - Redis for API responses
   - CDN for static assets
   - Browser caching headers

2. **Database:**
   - Read replicas for heavy queries
   - Materialized views for analytics
   - Query optimization

3. **Background Jobs:**
   - Queue system for filing fetches
   - Scheduled report generation
   - Batch processing

## Scalability

### Current Limitations

1. **Python Service:**
   - Single instance on one PC
   - No horizontal scaling
   - IB Gateway connection limit

2. **Database:**
   - Neon.tech limits (generous for current use)

3. **API:**
   - Vercel serverless limits
   - SEC EDGAR rate limits (10/sec)

### Scaling Strategy

1. **Multi-User Support:**
   - Add authentication system
   - User-specific data isolation
   - Multi-tenant database design

2. **Python Service:**
   - Deploy multiple instances
   - Load balancer
   - IB Gateway per instance

3. **Data Growth:**
   - Archive old deals
   - Compress SEC filing text
   - Pagination on all list endpoints

## Technology Choices Rationale

**Next.js 15:**
- Modern React framework
- Built-in API routes
- Excellent TypeScript support
- Vercel deployment integration

**Prisma:**
- Type-safe database client
- Great developer experience
- Migration management
- Visual database browser

**PostgreSQL:**
- Robust relational database
- Complex query support
- JSON column support
- Excellent tooling

**FastAPI (Python):**
- Fast async framework
- Automatic OpenAPI docs
- Great for IB API integration
- Python ecosystem for finance

**Tailwind CSS + shadcn/ui:**
- Rapid UI development
- Consistent design system
- Accessible components
- Easy customization
