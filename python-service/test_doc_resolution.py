"""
Quick test script to verify document resolution logic
"""
import asyncio
import os
from app.edgar.detector import MADetector

async def test_tempest_filing():
    """Test the Tempest Therapeutics filing that was failing"""

    # Get API key from environment
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        print("ERROR: ANTHROPIC_API_KEY not set")
        return

    detector = MADetector(api_key)

    # Test filing that was failing
    index_url = "https://www.sec.gov/Archives/edgar/data/1544227/000119312525265937/0001193125-25-265937-index.htm"

    print(f"Testing document resolution for:")
    print(f"  {index_url}")
    print()

    try:
        # Test primary document resolution
        primary_doc_url = await detector.fetch_primary_document_url(index_url)
        print(f"✓ Resolved primary document:")
        print(f"  {primary_doc_url}")
        print()

        # Verify URL is correct (no double slashes except in https://)
        if "///" in primary_doc_url or primary_doc_url.count("//") > 1:
            print("✗ ERROR: URL contains double slashes!")
            print(f"  Found in: {primary_doc_url}")
        else:
            print("✓ URL looks correct (no double slashes)")

        # Try fetching the document
        print()
        print("Attempting to fetch document...")
        text = await detector.fetch_filing_text(index_url, max_chars=1000)

        if text:
            print(f"✓ Successfully fetched {len(text)} characters")
            print(f"  Preview: {text[:200]}...")
        else:
            print("✗ Failed to fetch document text")

    except Exception as e:
        print(f"✗ ERROR: {e}")
    finally:
        await detector.close()

if __name__ == "__main__":
    asyncio.run(test_tempest_filing())
