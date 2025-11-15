# Database Migration Mode

You are in **DATABASE MIGRATION MODE** for the M&A Intelligence Tracker project.

## Your Mission

Create and apply database migrations safely with zero downtime and full rollback capability.

## Migration Principles

1. **Never modify existing migrations** - Always create new ones
2. **Test on dev first** - Never apply untested migrations to production
3. **Use transactions** - Ensure atomicity
4. **Plan for rollback** - Document how to undo changes
5. **Minimal changes** - One logical change per migration

## Migration Workflow

### 1. Determine Next Migration Number

```bash
# List existing migrations
ls -la python-service/migrations/

# Find highest number
# Example output: 010_halt_monitoring.sql
# Next would be: 011_your_feature.sql
```

### 2. Create Migration File

**File naming:** `migrations/XXX_descriptive_name.sql`

**Migration Template:**
```sql
-- Migration XXX: Descriptive Name
-- Purpose: Clear description of what this migration does
-- Author: Claude Code
-- Date: YYYY-MM-DD

-- ==============================================
-- FORWARD MIGRATION
-- ==============================================

-- 1. Create new tables
CREATE TABLE IF NOT EXISTS new_table_name (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Data fields
    field_name VARCHAR(255) NOT NULL,
    json_field JSONB,
    numeric_field DECIMAL(12, 2),

    -- Metadata fields (standard pattern)
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT unique_field UNIQUE (field_name)
);

-- 2. Create indexes (critical for performance)
CREATE INDEX IF NOT EXISTS idx_new_table_field
    ON new_table(field_name);

CREATE INDEX IF NOT EXISTS idx_new_table_created_at
    ON new_table(created_at DESC);

-- 3. Add columns to existing tables (if needed)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'existing_table'
        AND column_name = 'new_column'
    ) THEN
        ALTER TABLE existing_table
        ADD COLUMN new_column VARCHAR(255);
    END IF;
END $$;

-- 4. Create foreign keys
ALTER TABLE child_table
    ADD CONSTRAINT fk_child_parent
    FOREIGN KEY (parent_id) REFERENCES parent_table(id)
    ON DELETE CASCADE;

-- 5. Create views (if needed)
CREATE OR REPLACE VIEW view_name AS
SELECT
    t1.field1,
    t2.field2,
    COUNT(*) as count
FROM table1 t1
JOIN table2 t2 ON t1.id = t2.table1_id
GROUP BY t1.field1, t2.field2;

-- 6. Add comments for documentation
COMMENT ON TABLE new_table_name IS 'Description of table purpose';
COMMENT ON COLUMN new_table_name.field_name IS 'Description of field';

-- ==============================================
-- ROLLBACK NOTES
-- ==============================================

-- To rollback this migration, run:
-- DROP TABLE IF EXISTS new_table_name CASCADE;
-- ALTER TABLE existing_table DROP COLUMN IF EXISTS new_column;
```

### 3. Test Migration Locally

**Test with Python script:**
```python
import asyncio
import asyncpg
import os

async def test_migration():
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise ValueError("DATABASE_URL not set")

    conn = await asyncpg.connect(db_url)

    try:
        # Read migration file
        with open('migrations/XXX_your_migration.sql', 'r') as f:
            sql = f.read()

        print("Applying migration...")
        await conn.execute(sql)
        print("✓ Migration applied successfully!")

        # Verify schema
        tables = await conn.fetch("""
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            ORDER BY table_name
        """)

        print(f"\nTables after migration:")
        for table in tables:
            print(f"  - {table['table_name']}")

    except Exception as e:
        print(f"✗ Migration failed: {e}")
        raise
    finally:
        await conn.close()

asyncio.run(test_migration())
```

**Run test:**
```bash
cd python-service
DATABASE_URL="postgresql://..." python3 -c "$(cat test_migration.py)"
```

### 4. Apply Migration to Production

**Method 1: Using asyncpg (Recommended)**
```bash
ANTHROPIC_API_KEY="..." DATABASE_URL="..." python3 -c "
import asyncio
import asyncpg

async def apply_migration():
    conn = await asyncpg.connect('$DATABASE_URL')

    with open('migrations/XXX_your_migration.sql', 'r') as f:
        sql = f.read()

    await conn.execute(sql)
    print('Migration XXX applied successfully!')

    await conn.close()

asyncio.run(apply_migration())
"
```

**Method 2: Using psql (Alternative)**
```bash
PGPASSWORD="your-password" psql \
  "postgresql://user@host/database?sslmode=require" \
  -f migrations/XXX_your_migration.sql
```

### 5. Verify Migration

**Check tables were created:**
```python
import asyncio
import asyncpg

async def verify_migration():
    conn = await asyncpg.connect(DATABASE_URL)

    # Check table exists
    exists = await conn.fetchval("""
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_name = 'new_table_name'
        )
    """)

    print(f"Table exists: {exists}")

    # Check columns
    columns = await conn.fetch("""
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'new_table_name'
        ORDER BY ordinal_position
    """)

    print("\nColumns:")
    for col in columns:
        print(f"  {col['column_name']}: {col['data_type']} (nullable: {col['is_nullable']})")

    # Check indexes
    indexes = await conn.fetch("""
        SELECT indexname
        FROM pg_indexes
        WHERE tablename = 'new_table_name'
    """)

    print("\nIndexes:")
    for idx in indexes:
        print(f"  - {idx['indexname']}")

    await conn.close()

asyncio.run(verify_migration())
```

### 6. Update Code to Use New Schema

**Update models, queries, and API endpoints** to use the new schema.

**Example pattern:**
```python
# Before migration
result = await conn.fetchrow("SELECT * FROM old_table WHERE id = $1", id)

# After migration
result = await conn.fetchrow("SELECT * FROM new_table WHERE id = $1", id)
```

### 7. Restart Services

```bash
# Backend
cd python-service
pkill -f "start_server.py" && sleep 3 && python3 start_server.py &

# Verify services are using new schema
curl http://localhost:8000/health
```

## Common Migration Patterns

### Adding a Column

```sql
-- Safe: Add nullable column
ALTER TABLE table_name
ADD COLUMN IF NOT EXISTS new_column VARCHAR(255);

-- Add with default
ALTER TABLE table_name
ADD COLUMN IF NOT EXISTS new_column VARCHAR(255) DEFAULT 'default_value';

-- Later make NOT NULL after backfilling data
ALTER TABLE table_name
ALTER COLUMN new_column SET NOT NULL;
```

### Adding an Index

```sql
-- Non-blocking (PostgreSQL 11+)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_table_field
ON table_name(field_name);

-- Regular index (faster but locks table)
CREATE INDEX IF NOT EXISTS idx_table_field
ON table_name(field_name);
```

### Adding Foreign Key

```sql
-- Add foreign key
ALTER TABLE child_table
ADD CONSTRAINT fk_child_parent
FOREIGN KEY (parent_id) REFERENCES parent_table(id)
ON DELETE CASCADE;  -- or SET NULL, RESTRICT, etc.
```

### Renaming Column

```sql
-- Rename column
ALTER TABLE table_name
RENAME COLUMN old_name TO new_name;

-- Note: Update all queries in code!
```

### Changing Column Type

```sql
-- Safe: Expanding type (e.g., VARCHAR(100) -> VARCHAR(255))
ALTER TABLE table_name
ALTER COLUMN field_name TYPE VARCHAR(255);

-- Risky: Narrowing type (data loss possible)
-- First check data fits:
SELECT MAX(LENGTH(field_name)) FROM table_name;

-- Then alter:
ALTER TABLE table_name
ALTER COLUMN field_name TYPE VARCHAR(50);
```

### Creating Enum Type

```sql
-- Create enum
CREATE TYPE deal_status AS ENUM (
    'pending',
    'active',
    'completed',
    'terminated'
);

-- Use in table
ALTER TABLE deals
ADD COLUMN status deal_status DEFAULT 'pending';
```

### Adding JSONB Field

```sql
-- Add JSONB column
ALTER TABLE table_name
ADD COLUMN metadata JSONB DEFAULT '{}'::jsonb;

-- Create GIN index for JSONB (enables fast queries)
CREATE INDEX IF NOT EXISTS idx_table_metadata
ON table_name USING GIN (metadata);
```

## Migration Checklist

Before applying migration:

- [ ] Migration file created with clear name
- [ ] SQL syntax is valid
- [ ] Tested on dev database
- [ ] Verified schema changes are correct
- [ ] Indexes created for performance
- [ ] Rollback plan documented
- [ ] Code updated to use new schema
- [ ] No breaking changes to existing code
- [ ] Foreign keys set correctly (CASCADE vs RESTRICT)
- [ ] Comments added for documentation

After applying migration:

- [ ] Migration applied successfully
- [ ] Tables/columns exist as expected
- [ ] Indexes created
- [ ] Foreign keys working
- [ ] Services restarted
- [ ] API endpoints work
- [ ] No errors in logs
- [ ] Frontend still functions

## Emergency: Rollback Migration

If migration causes issues:

```sql
-- Rollback by reversing changes
-- Example: Drop table created in migration
DROP TABLE IF EXISTS new_table_name CASCADE;

-- Example: Drop column added in migration
ALTER TABLE existing_table
DROP COLUMN IF EXISTS new_column;

-- Example: Drop index added in migration
DROP INDEX IF EXISTS idx_table_field;
```

**After rollback:**
1. Restart services
2. Verify old schema works
3. Fix migration SQL
4. Test again before re-applying

## M&A Tracker Migration History

Current migrations (001-010):
- 001: Initial schema
- 002: Source monitors
- 003: Deal intelligence
- 004: Ticker master
- 005: Deal history
- 006: Fix duplicate sources
- 007: Production tracking
- 008: Deal research
- 009: Alert notifications
- 010: Halt monitoring

Next migration: **011**

## Best Practices

1. **One migration per feature** - Don't bundle unrelated changes
2. **Test thoroughly** - Migration failures in production are costly
3. **Use transactions** - Ensure all-or-nothing application
4. **Document well** - Future you will thank present you
5. **Keep migrations small** - Easier to debug and rollback
6. **Index appropriately** - Query performance depends on it
7. **Plan for data** - Consider existing data when changing schema
8. **Version control** - Commit migration with related code changes
