# M&A Tracker - Technology Stack

## Overview

The M&A Tracker uses a modern, scalable stack optimized for financial data processing, real-time options analysis, and AI-powered research.

---

## Frontend Stack

### Core Framework
- **Next.js 15** - React framework with App Router
  - Server-side rendering (SSR) for performance
  - API routes for serverless functions
  - Built-in optimization (images, fonts, scripts)
  - File-based routing

- **React 18** - UI library
  - Server Components for reduced bundle size
  - Concurrent rendering
  - Automatic batching
  - Suspense for data fetching

### Language
- **TypeScript 5+** - Type-safe development
  - Compile-time error detection
  - IntelliSense and autocomplete
  - Refactoring support
  - Better documentation

### Styling
- **Tailwind CSS 3** - Utility-first CSS framework
  - Rapid development
  - Consistent design system
  - Minimal CSS bundle size
  - JIT (Just-In-Time) compilation

- **shadcn/ui** - Component library
  - Accessible components (ARIA compliant)
  - Customizable with Tailwind
  - Copy-paste components (not npm package)
  - Built on Radix UI primitives

### Icons
- **Lucide React** - Icon library
  - Consistent icon style
  - Tree-shakeable
  - TypeScript support

---

## Backend Stack

### API Layer
- **Next.js App Router API Routes**
  - Serverless functions
  - Edge runtime support
  - TypeScript native
  - Co-located with frontend

### Python Microservice
- **FastAPI** - Modern Python web framework
  - Async/await support
  - Automatic OpenAPI documentation
  - Pydantic data validation
  - High performance (built on Starlette + Uvicorn)

- **Uvicorn** - ASGI server
  - Lightning-fast ASGI server
  - WebSocket support
  - Production-ready

- **ibapi** - Interactive Brokers API
  - Real-time market data
  - Options chain retrieval
  - Order placement (future)
  - Account management (future)

### Data Processing
- **NumPy** - Numerical computing
  - Options pricing calculations
  - Statistical analysis
  - Array operations

- **Pandas** - Data manipulation
  - Time series analysis
  - Data transformation
  - CSV/Excel export

- **SciPy** - Scientific computing
  - Options Greeks calculation
  - Probability distributions
  - Optimization algorithms

---

## Database Stack

### Database
- **PostgreSQL 14+** - Relational database
  - ACID compliance
  - Complex queries and joins
  - JSON/JSONB support
  - Full-text search
  - Robust indexing

### ORM
- **Prisma** - Next-generation ORM
  - Type-safe database client
  - Auto-generated TypeScript types
  - Migration management
  - Visual database browser (Prisma Studio)
  - Connection pooling
  - Query optimization

### Hosting
- **Neon.tech** - Serverless PostgreSQL
  - Auto-scaling
  - Branching (database versioning)
  - Connection pooling
  - Point-in-time recovery
  - Generous free tier

---

## External Services

### Market Data
- **Interactive Brokers API** (ibapi)
  - Real-time quotes
  - Options chains with Greeks
  - Historical data
  - Market depth

### Regulatory Data
- **SEC EDGAR API** (data.sec.gov)
  - Official SEC data source
  - Free public access
  - Company filings (DEFM14A, 8-K, etc.)
  - 10 requests/second limit

### Tunneling & Access (Development)
- **Cloudflare Tunnel** - Secure tunnels for Next.js UI
  - Named Tunnel: Stable URL at `krj-dev.dr3-dashboard.com`
  - Quick Tunnel: Temporary URLs for demos
  - Free tier with unlimited usage
  - Integrated with Cloudflare Access for authentication
  
- **Cloudflare Access** - Authentication layer
  - Email-based authentication (One-Time PIN)
  - Access control before requests reach the app
  - Identity headers for app-level user management
  - Free tier (up to 50 users)
  
- **ngrok** - Secure tunnels for Python service
  - Exposes Python webhook service (port 8000)
  - Used for email webhooks
  - Separate from Next.js UI access

### AI (Planned)
- **Anthropic Claude API** - LLM for document analysis
  - Claude 3.5 Sonnet (current model)
  - 200K context window
  - Function calling
  - Vision capabilities (future)

---

## Development Tools

### External Access
- **Cloudflare Tunnel** - Expose Next.js UI (port 3000) externally
  - **Named Tunnel (Default):** Stable URL at `krj-dev.dr3-dashboard.com`
  - **Quick Tunnel (Fallback):** Temporary public URLs for demos
  - Protected by Cloudflare Access (email-based authentication)
  - Scripts: `./scripts/start-tunnel.sh` (named) or `./scripts/start-tunnel.sh --quick`
  
- **ngrok** - Expose Python service (port 8000) for email webhooks
  - Used for backend webhook functionality
  - Separate from Next.js UI access
  - Python service only (not for KRJ UI)

### Version Control
- **Git** - Source control
- **GitHub** - Code hosting
  - Issue tracking
  - Pull requests
  - Actions (CI/CD)

### Package Managers
- **npm** - Node.js packages
- **pip** - Python packages
- **nvm** - Node version management

### Code Quality
- **ESLint** - JavaScript/TypeScript linting
  - Next.js config
  - TypeScript rules
  - Auto-fix support

- **Prettier** (to be added) - Code formatting
  - Consistent code style
  - Auto-format on save

- **TypeScript Compiler** - Type checking
  - Strict mode enabled
  - No implicit any

### Development Server
- **Next.js Dev Server** - Hot module replacement
- **Uvicorn** - Python ASGI development server

---

## Deployment Stack

### Frontend & API
- **Vercel** - Next.js hosting platform
  - Zero-config deployment
  - Automatic HTTPS
  - Edge network (CDN)
  - Serverless functions
  - Environment variables
  - Preview deployments
  - Analytics

### Python Service
- **Local (Current)** - Luis's Windows PC
  - IB Gateway connection required
  - ngrok tunnel for external access

- **Production (Future)** - Cloud deployment
  - AWS EC2 / DigitalOcean Droplet
  - Docker container
  - PM2 process manager
  - Persistent ngrok or direct IP

### Database
- **Neon.tech** - Production database
  - Automatic backups
  - Connection pooling
  - SSL connections

---

## Monitoring & Analytics (Future)

### Application Monitoring
- **Vercel Analytics** - Frontend performance
- **Sentry** - Error tracking
  - Real-time error notifications
  - Stack traces
  - User context
  - Performance monitoring

### Database Monitoring
- **Neon Dashboard** - Database metrics
- **Prisma Studio** - Visual database browser

### Logging
- **Vercel Logs** - Function logs
- **Python logging** - Application logs
  - File logging (/tmp/scanner.log)
  - Console logging

---

## Security Stack

### Authentication (Future)
- **NextAuth.js** - Authentication library
  - OAuth providers (Google, GitHub)
  - JWT tokens
  - Session management
  - Built-in security

### Environment Variables
- **.env files** - Local secrets
- **Vercel Environment Variables** - Production secrets
  - Database URLs
  - API keys
  - Auth secrets

### API Security
- **CORS** - Cross-origin resource sharing
- **Rate Limiting** (to be added)
- **Input Validation** - Zod/Pydantic

---

## Testing Stack (To Be Implemented)

### Frontend Testing
- **Jest** - Unit testing
- **React Testing Library** - Component testing
- **Playwright** - E2E testing

### Backend Testing
- **pytest** - Python testing
- **httpx** - API testing

### Load Testing
- **k6** - Performance testing
- **Artillery** - Load testing

---

## Build Tools

### Frontend
- **Next.js Compiler** - Rust-based compiler
  - Faster builds
  - Minification
  - Tree shaking

- **Turbopack** (future) - Next-gen bundler
  - Faster than Webpack
  - Incremental builds

### Python
- **pip** - Package installer
- **venv** - Virtual environments

---

## CI/CD Pipeline (Future)

### GitHub Actions
```yaml
On Push to Main:
  ├─ Run TypeScript check
  ├─ Run ESLint
  ├─ Run tests
  ├─ Build application
  └─ Deploy to Vercel (automatic)

On Pull Request:
  ├─ Run all checks
  ├─ Deploy preview
  └─ Comment with preview URL
```

### Python Service
```yaml
On Python Changes:
  ├─ Run pytest
  ├─ Run mypy (type checking)
  ├─ Build Docker image
  └─ Deploy to server
```

---

## Infrastructure as Code (Future)

### Terraform
- Database provisioning
- Cloud resources
- DNS configuration

### Docker
- Python service containerization
- Consistent environments
- Easy deployment

---

## Performance Optimization

### Frontend
- **Server-Side Rendering (SSR)** - Fast initial load
- **Static Generation** - Pre-rendered pages
- **Image Optimization** - Next.js Image component
- **Code Splitting** - Dynamic imports
- **Lazy Loading** - On-demand component loading

### API
- **Edge Functions** - Low latency
- **Caching** - Redis (future)
- **CDN** - Static asset delivery

### Database
- **Indexes** - Optimized queries
- **Connection Pooling** - Efficient connections
- **Query Optimization** - Prisma query insights

### Python Service
- **Async/Await** - Non-blocking I/O
- **Connection Reuse** - IB Gateway connection
- **Caching** - In-memory caching

---

## Development Workflow

### Local Development
```bash
# Terminal 1: Database
npx prisma studio

# Terminal 2: Frontend + API
npm run dev

# Terminal 3: Python Service
cd python-service
python -m uvicorn app.main:app --reload

# Terminal 4: IB Gateway
# Start IB Gateway manually
```

### Production Deployment
```bash
# Frontend (automatic via Vercel)
git push origin main

# Database migrations
npx prisma migrate deploy

# Python service (manual)
ssh user@server
cd ma-tracker-app/python-service
git pull
pm2 restart scanner
```

---

## Package Versions

### Frontend
```json
{
  "next": "15.x",
  "react": "^18.3.1",
  "typescript": "^5",
  "tailwindcss": "^3.4.1",
  "@prisma/client": "^6.18.0",
  "prisma": "^6.18.0"
}
```

### Python
```txt
fastapi>=0.104.1
uvicorn[standard]>=0.24.0
pydantic>=2.5.0
pandas>=2.0.3
numpy>=1.24.4
scipy>=1.10.1
ibapi>=9.81.1.post1
```

---

## Scalability Considerations

### Current Limitations
- **Python Service**: Single instance
- **IB Gateway**: One connection per service
- **Database**: Neon free tier limits

### Scaling Strategy

**Horizontal Scaling:**
- Multiple Python service instances
- Load balancer (Nginx)
- Multiple IB Gateway connections

**Vertical Scaling:**
- Larger database instance
- More powerful server for Python service

**Caching:**
- Redis for API responses
- CDN for static assets
- Browser caching headers

---

## Technology Decision Rationale

### Why Next.js?
- Best-in-class React framework
- Built-in API routes (no separate backend needed)
- Excellent TypeScript support
- Vercel integration
- Large ecosystem

### Why PostgreSQL?
- Robust relational model
- Complex query support
- JSON/JSONB for flexibility
- Mature ecosystem
- Excellent tools (Prisma)

### Why Prisma?
- Best developer experience
- Type safety from database to frontend
- Visual database browser
- Automatic migrations
- Great documentation

### Why FastAPI (Python)?
- Best framework for IB API integration
- Fast async performance
- Automatic API docs
- Pydantic validation
- Modern Python features

### Why TypeScript?
- Catch errors at compile time
- Better IDE support
- Self-documenting code
- Easier refactoring
- Industry standard

---

## Future Technology Additions

### Planned
- **Redis** - Caching layer
- **WebSockets** - Real-time updates
- **Bull** - Job queue
- **NextAuth.js** - Authentication
- **Docker** - Containerization
- **Terraform** - Infrastructure as code

### Under Consideration
- **GraphQL** - Alternative to REST API
- **tRPC** - End-to-end type safety
- **Temporal** - Workflow orchestration
- **Apache Kafka** - Event streaming

---

## Dependencies Graph

```
Frontend (Next.js + React + TypeScript)
    ↓
API Routes (Next.js Serverless)
    ↓
    ├─→ Database (PostgreSQL via Prisma)
    ↓
    └─→ Python Service (FastAPI)
            ↓
            ├─→ IB Gateway (ibapi)
            └─→ SEC EDGAR API
```

---

## Learning Resources

### Documentation
- [Next.js Docs](https://nextjs.org/docs)
- [React Docs](https://react.dev)
- [Prisma Docs](https://www.prisma.io/docs)
- [FastAPI Docs](https://fastapi.tiangolo.com)
- [Tailwind CSS Docs](https://tailwindcss.com/docs)

### Tutorials
- [Next.js Learn](https://nextjs.org/learn)
- [Prisma Getting Started](https://www.prisma.io/docs/getting-started)
- [FastAPI Tutorial](https://fastapi.tiangolo.com/tutorial/)

### Community
- [Next.js Discord](https://nextjs.org/discord)
- [Prisma Discord](https://pris.ly/discord)
- [FastAPI Discord](https://discord.com/invite/VQjSZaeJmf)
