"""Clear processed filings from database to allow re-processing"""
import asyncio
import asyncpg
import os

async def clear_filings():
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        print("ERROR: DATABASE_URL not set")
        return
    
    conn = await asyncpg.connect(db_url)
    
    try:
        # Count current filings (table name is PascalCase)
        count = await conn.fetchval('SELECT COUNT(*) FROM "EdgarFiling"')
        print(f"Current filings in database: {count}")
        
        if count > 0:
            # Delete all processed filings
            await conn.execute('DELETE FROM "EdgarFiling"')
            print(f"✓ Cleared {count} processed filings from database")
            print()
            print("All filings will be re-processed on next poll cycle with corrected document resolution")
        else:
            print("No filings to clear")
            
    finally:
        await conn.close()

if __name__ == "__main__":
    asyncio.run(clear_filings())
