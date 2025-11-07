"""Test M&A detection with a real filing"""
import asyncio
import os
from app.edgar.models import EdgarFiling
from app.edgar.detector import MADetector
from app.edgar.extractor import DealExtractor
from datetime import datetime

async def test_ma_system():
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        print("ERROR: ANTHROPIC_API_KEY not set")
        return

    # Use a real M&A filing from today (Tempest Therapeutics merger)
    test_filing = EdgarFiling(
        accession_number="0001193125-25-265937",
        cik="1544227",
        company_name="Tempest Therapeutics, Inc.",
        ticker="TPST",
        filing_type="8-K",
        filing_date=datetime.now(),
        filing_url="https://www.sec.gov/Archives/edgar/data/1544227/000119312525265937/0001193125-25-265937-index.htm"
    )

    print("=" * 60)
    print("Testing M&A Detection System")
    print("=" * 60)
    print(f"Filing: {test_filing.filing_type} - {test_filing.company_name}")
    print(f"URL: {test_filing.filing_url}")
    print()

    # Test detection
    detector = MADetector(api_key)

    try:
        print("Step 1: Detecting M&A relevance...")
        detection_result = await detector.detect_ma_relevance(test_filing)
        print(f"✓ M&A Relevant: {detection_result.is_ma_relevant}")
        print(f"✓ Confidence: {detection_result.confidence_score:.2%}")
        print(f"✓ Keywords: {', '.join(detection_result.detected_keywords[:5])}")
        print(f"✓ Reasoning: {detection_result.reasoning}")
        print()

        if detection_result.is_ma_relevant:
            # Test extraction
            print("Step 2: Extracting deal information...")
            filing_text = await detector.fetch_filing_text(test_filing.filing_url)

            extractor = DealExtractor(api_key)
            deal_info = await extractor.extract_deal_info(test_filing, filing_text)

            if deal_info:
                print(f"✓ Target: {deal_info.target_name}")
                print(f"✓ Acquirer: {deal_info.acquirer_name}")
                print(f"✓ Deal Value: ${deal_info.deal_value}B" if deal_info.deal_value else "✓ Deal Value: Not disclosed")
                print(f"✓ Deal Type: {deal_info.deal_type}")
                print(f"✓ Confidence: {deal_info.confidence_score:.2%}")
                print()
                print("✅ System is working correctly!")
            else:
                print("✗ Failed to extract deal info")
        else:
            print("Filing not detected as M&A relevant")

    finally:
        await detector.close()

if __name__ == "__main__":
    asyncio.run(test_ma_system())
