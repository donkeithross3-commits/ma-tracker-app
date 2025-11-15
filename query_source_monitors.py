#!/usr/bin/env python3
"""Query source_monitors table to check configuration."""

import asyncio
import asyncpg
import os
import json
from dotenv import load_dotenv

# Load environment variables
load_dotenv('python-service/.env')

async def query_monitors():
    """Query and display source_monitors configuration."""
    database_url = os.getenv('DATABASE_URL')

    if not database_url:
        print("ERROR: DATABASE_URL not found in environment")
        return

    print(f"Connecting to database...")
    conn = await asyncpg.connect(database_url)

    try:
        # Query all enabled monitors
        query = """
            SELECT
                source_name,
                is_enabled,
                config,
                poll_interval_seconds,
                created_at,
                updated_at
            FROM source_monitors
            WHERE is_enabled = true
            ORDER BY source_name
        """

        rows = await conn.fetch(query)

        print(f"\n{'='*80}")
        print(f"ENABLED SOURCE MONITORS ({len(rows)} found)")
        print(f"{'='*80}\n")

        for row in rows:
            print(f"Source Name: {row['source_name']}")
            print(f"Enabled: {row['is_enabled']}")
            print(f"Poll Interval: {row['poll_interval_seconds']} seconds")
            print(f"Created: {row['created_at']}")
            print(f"Updated: {row['updated_at']}")
            print(f"\nConfig (JSON):")

            # Pretty print the JSON config
            config = row['config']
            if isinstance(config, str):
                config = json.loads(config)
            print(json.dumps(config, indent=2))
            print(f"\n{'-'*80}\n")

        # Also query ALL monitors to see disabled ones
        print(f"\n{'='*80}")
        print(f"ALL SOURCE MONITORS (including disabled)")
        print(f"{'='*80}\n")

        all_query = """
            SELECT
                source_name,
                is_enabled,
                poll_interval_seconds
            FROM source_monitors
            ORDER BY source_name
        """

        all_rows = await conn.fetch(all_query)

        for row in all_rows:
            status = "ENABLED" if row['is_enabled'] else "DISABLED"
            print(f"{row['source_name']:30s} - {status:10s} - Poll: {row['poll_interval_seconds']:5d}s")

    finally:
        await conn.close()
        print("\nConnection closed.")

if __name__ == "__main__":
    asyncio.run(query_monitors())
