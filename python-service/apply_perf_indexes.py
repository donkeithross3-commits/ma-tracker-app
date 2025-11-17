#!/usr/bin/env python3
"""
Apply performance indexes migration to database
Run: python3 apply_perf_indexes.py
"""

import asyncio
import asyncpg
import os
from pathlib import Path

async def apply_migration():
    # Load DATABASE_URL from environment
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        print("ERROR: DATABASE_URL environment variable not set")
        return

    # Read migration SQL
    migration_file = Path(__file__).parent / "migrations" / "022_performance_indexes.sql"
    with open(migration_file) as f:
        sql = f.read()

    print(f"Applying performance indexes migration...")
    print(f"Migration file: {migration_file}")

    # Connect to database
    conn = await asyncpg.connect(database_url)

    try:
        # Execute migration
        await conn.execute(sql)
        print("✅ Performance indexes created successfully!")

        # Verify indexes were created
        indexes = await conn.fetch("""
            SELECT indexname, tablename
            FROM pg_indexes
            WHERE indexname LIKE 'idx_%'
            ORDER BY tablename, indexname;
        """)

        print(f"\n✅ {len(indexes)} indexes found in database:")
        for idx in indexes:
            print(f"   - {idx['tablename']}.{idx['indexname']}")

    except Exception as e:
        print(f"❌ Error applying migration: {e}")
    finally:
        await conn.close()

if __name__ == "__main__":
    asyncio.run(apply_migration())
