"""Manually process recent filings from SEC EDGAR for testing"""
import asyncio
import os
from app.edgar.poller import EdgarPoller
from app.edgar.orchestrator import EdgarOrchestrator

async def process_recent():
    """Fetch and process recent filings"""
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        print("ERROR: ANTHROPIC_API_KEY not set")
        return

    print("=" * 60)
    print("Fetching Recent SEC EDGAR Filings")
    print("=" * 60)
    print()

    # Create poller to fetch RSS feed
    poller = EdgarPoller(poll_interval=60)

    try:
        # Fetch current filings from RSS
        print("Fetching filings from SEC EDGAR RSS feed...")
        filings = await poller.poll_once()

        print(f"Found {len(filings)} M&A-relevant filings in RSS feed")
        print()

        if not filings:
            print("No M&A-relevant filings in current RSS feed")
            print("The system is working - just waiting for new deals!")
            return

        # Create orchestrator
        orchestrator = EdgarOrchestrator(
            anthropic_api_key=api_key,
            poll_interval=60
        )

        await orchestrator.connect()

        # Process each filing
        for i, filing in enumerate(filings[:5], 1):  # Process first 5
            print(f"[{i}/{min(5, len(filings))}] Processing: {filing.filing_type} - {filing.company_name}")
            try:
                await orchestrator.process_filing(filing)
                print(f"    ✓ Processed")
            except Exception as e:
                print(f"    ✗ Error: {e}")
            print()

        await orchestrator.disconnect()

        print("=" * 60)
        print("Done! Check the Pending tab in your app")
        print("=" * 60)

    finally:
        await poller.close()

if __name__ == "__main__":
    asyncio.run(process_recent())
