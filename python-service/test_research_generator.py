"""Test the research generator on FRGE deal"""
import asyncio
import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.edgar.deal_research_generator import create_research_generator

async def test_frge_research():
    """Test research generation on FRGE deal"""

    # Create generator
    generator = create_research_generator()

    # FRGE deal info
    deal_info = {
        "target_name": "Forge Global Holdings, Inc.",
        "acquirer_name": "The Charles Schwab Corporation",
        "deal_value": None,
        "filing_type": "8-K"
    }

    filing_url = "https://www.sec.gov/Archives/edgar/data/1827821/000182782125000020/0001827821-25-000020-index.htm"

    print("=" * 80)
    print("Testing Research Generator on FRGE Deal")
    print("=" * 80)
    print(f"Target: {deal_info['target_name']}")
    print(f"Acquirer: {deal_info['acquirer_name']}")
    print(f"Filing URL: {filing_url}")
    print("=" * 80)
    print("\nGenerating research (this may take 30-60 seconds)...\n")

    # Generate research
    result = await generator.generate_research(deal_info, filing_url)

    if result['success']:
        print("✅ Research generation successful!\n")

        # Print extracted data
        print("=" * 80)
        print("EXTRACTED DATA (JSON)")
        print("=" * 80)
        import json
        print(json.dumps(result['extracted_data'], indent=2))

        print("\n" + "=" * 80)
        print("MARKDOWN REPORT")
        print("=" * 80)
        print(result['markdown_report'])

    else:
        print(f"❌ Research generation failed: {result.get('error')}")
        print(f"\nPartial markdown:\n{result['markdown_report']}")

if __name__ == "__main__":
    asyncio.run(test_frge_research())
