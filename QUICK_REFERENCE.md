# Quick Reference - M&A Options Tracker

## Development Commands

```bash
# Start everything (Python + Next.js)
npm run dev

# Kill all dev processes
npm run dev-kill

# Next.js only (no strategy detection)
npm run dev:next-only

# Full stack (Python + Cloudflare + Next.js)
npm run dev-full
```

---

## Service Health Checks

```bash
# Python strategy analyzer
curl http://localhost:8000/health
# Expected: {"status":"healthy","ib_connected":true}

# Next.js
curl http://localhost:3000/api/ib-connection/status
# Expected: {"connected":true}

# Check what's running
lsof -i:3000  # Next.js
lsof -i:8000  # Python service
lsof -i:7497  # IB TWS
```

---

## Port Map

| Port | Service | Purpose |
|------|---------|---------|
| 3000 | Next.js | Frontend + API |
| 8000 | Python | Strategy analyzer |
| 7497 | IB TWS | Market data |
| 5432 | PostgreSQL | Database |

---

## Key URLs

- **Dashboard**: http://localhost:3000/ma-options
- **KRJ Signals**: http://localhost:3000/krj
- **Python API Docs**: http://localhost:8000/docs
- **Database Studio**: `npm run db:studio`

---

## Troubleshooting

### No Strategy Candidates

**Symptom**: Option chain loads but 0 candidates  
**Fix**: 
```bash
curl http://localhost:8000/health
# If it fails, restart:
npm run dev-kill && npm run dev
```

### IB TWS Not Connected

**Symptom**: Red "Disconnected" indicator  
**Fix**:
1. Start IB TWS/Gateway
2. Enable API in TWS settings
3. Ensure port 7497 is configured
4. Refresh browser

### Port Already in Use

**Symptom**: Port 8000/3000 in use  
**Fix**:
```bash
npm run dev-kill
# Or manually:
lsof -i:8000 | grep LISTEN | awk '{print $2}' | xargs kill -9
```

---

## Recent Changes (Jan 7, 2026)

- ✅ **Refresh Prices**: Now 10-20x faster (5-15s vs 60-120s)
- ✅ **Strategy Detection**: Fixed (Python service now auto-starts)
- ✅ **Dev Startup**: `npm run dev` starts Python + Next.js automatically

See [`.cursor/SESSION_SUMMARY_2026-01-07.md`](.cursor/SESSION_SUMMARY_2026-01-07.md) for details.

---

## Documentation

- **[START_HERE_TESTING.md](docs/START_HERE_TESTING.md)** - Testing guide
- **[DEV_STARTUP.md](docs/DEV_STARTUP.md)** - Startup options
- **[PRODUCTION_DEPLOYMENT.md](docs/PRODUCTION_DEPLOYMENT.md)** - Deploy to droplet

---

## Database Commands

```bash
npm run db:push      # Update schema
npm run db:seed      # Seed data
npm run db:studio    # Open Prisma Studio
npm run db:generate  # Regenerate Prisma client
```

---

## Testing Workflow

1. **Start services**: `npm run dev`
2. **Check IB connection**: Look for green indicator
3. **Load option chain**: Curate tab → Select deal → Load Option Chain
4. **Verify candidates**: Should see multiple spreads
5. **Test refresh**: Monitor tab → Refresh Prices (5-15s)

---

## Contact

For questions or issues, see session logs in `.cursor/` directory.

