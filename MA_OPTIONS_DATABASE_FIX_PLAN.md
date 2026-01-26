# MA Options Scanner - Database Connectivity Fix

**Date:** December 26, 2025  
**Issue:** PrismaClientInitializationError - Can't reach database server at `localhost:5432`  
**Status:** 🔧 In Progress

---

## 🔍 Root Cause

The MA Options Scanner backend is failing because:

1. **DATABASE_URL not passed to container:** The `docker-compose.yml` at `/home/don/apps/docker-compose.yml` does not include `DATABASE_URL` in the environment variables
2. **No Postgres database exists:** There is no Postgres container or local instance running on the droplet
3. **env_file not loaded:** The `.env.local` file exists but is not being loaded by Docker Compose

**Current Configuration:**
```yaml
# /home/don/apps/docker-compose.yml
services:
  web:
    image: ma-tracker-app-dev
    environment:
      NEXTAUTH_URL: "http://134.199.204.12:3000"
      # ❌ DATABASE_URL is MISSING
```

**What's in .env.local (not being used):**
```bash
DATABASE_URL="postgresql://donaldross@localhost:5432/ma_tracker"
# This points to localhost Postgres which doesn't exist on droplet
```

---

## 🎯 Solution Options

### Option A: SQLite (Recommended for Immediate Fix) ✅

**Pros:**
- No external database needed
- File-based, works immediately
- Zero configuration
- Easy to migrate later
- Perfect for development/testing

**Cons:**
- Not ideal for high-concurrency production
- File-based (but that's fine for this use case)

**Implementation:**
1. Update `docker-compose.yml` to pass `DATABASE_URL` with SQLite connection string
2. Update Prisma schema to support SQLite (already supports postgresql)
3. Run migrations in container
4. Restart container

### Option B: Add Postgres Container

**Pros:**
- Full Postgres database
- Production-ready
- Better for complex queries

**Cons:**
- Requires more resources
- Need to manage backups
- More complex setup

### Option C: External Managed Postgres

**Pros:**
- Most robust
- Managed backups
- Scalable

**Cons:**
- Costs money ($15-30/month)
- Requires DigitalOcean setup
- Network latency

---

## ✅ Recommended Approach: SQLite (Option A)

### Step 1: Update docker-compose.yml

Add `DATABASE_URL` environment variable pointing to SQLite:

```yaml
services:
  web:
    image: ma-tracker-app-dev
    container_name: ma-tracker-app-web
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      NEXTAUTH_URL: "http://134.199.204.12:3000"
      DATABASE_URL: "file:/app/data/ma_tracker.db"  # SQLite file in mounted volume
    working_dir: /app
    volumes:
      - ./data/krj:/app/data/krj
      - ./data/ma_options:/app/data  # For SQLite database file
```

### Step 2: Update Prisma Schema (if needed)

Check if schema supports SQLite:
```prisma
datasource db {
  provider = "postgresql"  # Change to "sqlite" or use env var
  url      = env("DATABASE_URL")
}
```

**Better approach:** Use environment variable for provider:
```prisma
datasource db {
  provider = env("DATABASE_PROVIDER")  # "postgresql" or "sqlite"
  url      = env("DATABASE_URL")
}
```

### Step 3: Run Migrations

```bash
# SSH into droplet
ssh don@134.199.204.12

# Enter container
docker exec -it ma-tracker-app-web sh

# Run Prisma migrations
npx prisma migrate deploy
# OR if starting fresh:
npx prisma db push
```

### Step 4: Restart Container

```bash
cd /home/don/apps
docker compose restart web
```

### Step 5: Verify

Visit: http://134.199.204.12:3000/ma-options

Should see the page load (even if empty, no more database error)

---

## 🚀 Alternative: Quick Fix with Postgres Container

If you prefer Postgres, add this to `docker-compose.yml`:

```yaml
services:
  web:
    # ... existing config ...
    environment:
      NEXTAUTH_URL: "http://134.199.204.12:3000"
      DATABASE_URL: "postgresql://ma_user:ma_password@postgres:5432/ma_tracker"
    depends_on:
      - postgres

  postgres:
    image: postgres:16-alpine
    container_name: ma-tracker-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: ma_user
      POSTGRES_PASSWORD: ma_password
      POSTGRES_DB: ma_tracker
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"  # Optional: expose for external access

volumes:
  postgres_data:
```

Then:
```bash
cd /home/don/apps
docker compose up -d postgres
docker compose restart web
docker exec -it ma-tracker-app-web npx prisma migrate deploy
```

---

## 📝 Implementation Checklist

- [ ] Decide: SQLite or Postgres?
- [ ] Update `/home/don/apps/docker-compose.yml` with DATABASE_URL
- [ ] Create data volume mount (if using SQLite)
- [ ] Restart container
- [ ] Run Prisma migrations
- [ ] Test /ma-options page loads
- [ ] Verify prisma.deal.findMany() works
- [ ] Update documentation

---

## 🔄 Migration Path (Future)

If you start with SQLite and want to migrate to Postgres later:

1. Export data from SQLite
2. Set up Postgres (container or managed)
3. Update DATABASE_URL
4. Run migrations
5. Import data
6. Test
7. Switch over

---

## 📚 Related Files

- `/home/don/apps/docker-compose.yml` - Main Docker Compose config
- `/home/don/apps/ma-tracker-app/.env.local` - Environment variables (not currently loaded)
- `/Users/donaldross/dev/ma-tracker-app/prisma/schema.prisma` - Prisma schema
- `/Users/donaldross/dev/ma-tracker-app/app/ma-options/page.tsx` - MA Options page

---

**Next Steps:** Choose Option A (SQLite) or Option B (Postgres) and implement

