# M&A Deal Tracker

A Next.js application for tracking merger arbitrage deals with version control and persistent history.

## Current Status

✅ Next.js 15 with TypeScript
✅ Prisma ORM with PostgreSQL schema
✅ Tailwind CSS + shadcn/ui components
✅ Dev server running on http://localhost:3000

## Getting Started

### Prerequisites

- Node.js 20+ (installed via nvm)
- PostgreSQL database

### Initial Setup

1. **Database Setup** (Required before first use)

   ```bash
   # Create PostgreSQL database
   createdb ma_tracker

   # Update .env with your database connection string
   # DATABASE_URL="postgresql://user:password@localhost:5432/ma_tracker?schema=public"

   # Push the Prisma schema to create tables
   npm run db:push
   ```

2. **Start Development Server**

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000) in your browser.

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run db:generate` - Generate Prisma Client
- `npm run db:push` - Push schema changes to database
- `npm run db:studio` - Open Prisma Studio (database GUI)

## Python Options Scanner (Windows Setup)

The options scanner connects to Interactive Brokers to analyze merger arbitrage option strategies.

**For Windows users:** See [LUIS_WINDOWS_SETUP.md](./LUIS_WINDOWS_SETUP.md) for complete setup instructions.

**Quick reference:** See [QUICK_TROUBLESHOOTING.md](./QUICK_TROUBLESHOOTING.md) for common issues.

**Mac/Linux users:** The setup script works automatically:
```bash
bash setup-for-luis.sh
~/start-scanner.sh
```

## Project Structure

```
ma-tracker-app/
├── app/                    # Next.js App Router pages
│   ├── layout.tsx         # Root layout
│   ├── page.tsx           # Home page
│   └── globals.css        # Global styles
├── components/
│   └── ui/                # shadcn/ui components
├── lib/
│   ├── db.ts              # Prisma client instance
│   └── utils.ts           # Utility functions
├── prisma/
│   └── schema.prisma      # Database schema
└── package.json
```

## Features (In Development)

### Phase 1 - Core Deal Management
- [ ] Deal detail view (individual deal "tabs")
- [ ] Create/edit deal terms
- [ ] CVR management
- [ ] Manual price entry
- [ ] Basic calculations (spread, IRR)

### Phase 2 - Dashboard Views
- [ ] M&A Dashboard (all active deals)
- [ ] Portfolio view (current positions)
- [ ] Position management

### Phase 3 - Advanced Features
- [ ] Version history view
- [ ] Snapshot creation at key moments
- [ ] Interactive Brokers API integration
- [ ] Keyboard shortcuts
- [ ] Multi-user authentication

## Database Schema

The database schema is defined in `prisma/schema.prisma` and includes:

- **Users** - User management
- **Deals** - Core deal records
- **DealVersions** - Complete version history
- **DealPrices** - Time-series price data
- **Cvrs** - Contingent value rights
- **PortfolioPositions** - Actual positions
- **DealSnapshots** - Memorialized calculations
- **ApiPriceFetches** - API integration logs

For detailed schema documentation, see `/Users/donaldross/ma_tracker_schema_documentation.md`.

## Next Steps

1. **Set up PostgreSQL database** and run `npm run db:push`
2. **View the app** at http://localhost:3000
3. **Build deal detail view** - The primary interface for managing individual deals
4. **Import existing data** from Google Sheets
5. **Integrate Interactive Brokers API** for price updates

## Documentation

Comprehensive documentation is available in the `/docs` directory:

- **[Architecture](./docs/ARCHITECTURE.md)** - System architecture, diagrams, and design patterns
- **[Database Schema](./docs/DATABASE_SCHEMA.md)** - Complete database documentation with ERD and query patterns
- **[API Documentation](./docs/API_DOCUMENTATION.md)** - REST API endpoints, request/response formats
- **[Tech Stack](./docs/TECH_STACK.md)** - Detailed technology choices and rationale

### Windows Setup Documentation

- **[Windows Setup Guide](./LUIS_WINDOWS_SETUP.md)** - Complete setup for Python options scanner on Windows
- **[Quick Troubleshooting](./QUICK_TROUBLESHOOTING.md)** - Common issues and fixes

## Tech Stack

- **Frontend**: Next.js 15, React 18, TypeScript
- **Styling**: Tailwind CSS, shadcn/ui components
- **Database**: PostgreSQL (Neon.tech) via Prisma ORM
- **Python Service**: FastAPI + Interactive Brokers API
- **AI Research**: Claude API (planned)
- **External Data**: SEC EDGAR API

For detailed technology documentation, see [TECH_STACK.md](./docs/TECH_STACK.md).

## Key Features

### Current
- Deal tracking with version control
- CVR (Contingent Value Rights) management
- Portfolio position management
- Options scanner integration (IB Gateway)
- SEC filing auto-fetch
- Real-time price updates
- Complete audit trail

### In Development
- AI-powered deal research reports
- Antitrust risk analysis
- M&A contract analysis
- Hidden topping bid detection
- Automated filing monitoring

## Notes

- The app is currently in production at https://ma-tracker-app.vercel.app/
- Database schema includes 12 tables with complete referential integrity
- Python options scanner runs on local machine with IB Gateway connection
- UI components follow shadcn/ui patterns for accessibility

