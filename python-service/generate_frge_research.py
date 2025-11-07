"""Generate research for FRGE deal"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.edgar.deal_research_generator import create_research_generator
from app.edgar.database import EdgarDatabase

async def generate_frge_research():
    """Generate research for FRGE"""

    db = EdgarDatabase()
    await db.connect()

    conn = await db.pool.acquire()
    try:
        # Get FRGE deal info
        frge = await conn.fetchrow('''
            SELECT di.deal_id, di.target_name, di.acquirer_name, di.deal_value,
                   ds.source_url
            FROM deal_intelligence di
            JOIN deal_sources ds ON di.deal_id = ds.deal_id
            WHERE di.target_name ILIKE '%forge%'
            AND ds.source_name = 'EDGAR'
            LIMIT 1
        ''')

        if not frge:
            print("FRGE deal not found")
            return

        print(f"Found FRGE deal: {frge['deal_id']}")
        print(f"Filing URL: {frge['source_url']}")
        print()

        # Create research generator
        generator = create_research_generator()

        deal_info = {
            "target_name": frge['target_name'],
            "acquirer_name": frge['acquirer_name'],
            "deal_value": frge['deal_value'],
            "filing_type": "8-K"
        }

        print("Generating research (this may take 30-60 seconds)...")
        print()

        # Generate research
        result = await generator.generate_research(deal_info, frge['source_url'])

        if result['success']:
            print("✅ Research generation successful!")
            print()

            # Store in database
            import json
            extracted_data = result['extracted_data']

            await conn.execute('''
                INSERT INTO deal_research
                (deal_id, report_markdown, extracted_deal_terms,
                 target_ticker, go_shop_end_date, vote_risk, finance_risk, legal_risk,
                 status, completed_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
                ON CONFLICT (deal_id) DO UPDATE
                SET report_markdown = EXCLUDED.report_markdown,
                    extracted_deal_terms = EXCLUDED.extracted_deal_terms,
                    target_ticker = EXCLUDED.target_ticker,
                    go_shop_end_date = EXCLUDED.go_shop_end_date,
                    vote_risk = EXCLUDED.vote_risk,
                    finance_risk = EXCLUDED.finance_risk,
                    legal_risk = EXCLUDED.legal_risk,
                    status = EXCLUDED.status,
                    completed_at = EXCLUDED.completed_at
            ''',
                frge['deal_id'],
                result['markdown_report'],
                json.dumps(extracted_data),
                extracted_data.get('deal_terms', {}).get('target_ticker'),
                extracted_data.get('go_shop_provision', {}).get('go_shop_end_date'),
                extracted_data.get('risk_assessment', {}).get('vote_risk'),
                extracted_data.get('risk_assessment', {}).get('finance_risk'),
                extracted_data.get('risk_assessment', {}).get('legal_risk'),
                'completed'
            )

            print("Research stored in database!")
            print()
            print("=" * 80)
            print("REPORT PREVIEW:")
            print("=" * 80)
            print(result['markdown_report'][:1000])
            print("...")
        else:
            print(f"❌ Research generation failed: {result.get('error')}")

    finally:
        await db.pool.release(conn)
        await db.disconnect()

if __name__ == "__main__":
    asyncio.run(generate_frge_research())
