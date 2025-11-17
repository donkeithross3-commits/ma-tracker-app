#!/usr/bin/env python3
"""
Test script to verify Cidara/CDTX EDGAR upgrade logic.

This tests the scenario where:
1. EDGAR has a Cidara filing marked as "unlikely"
2. Seeking Alpha has definitive language confirming the deal
3. System should upgrade EDGAR filing to "pending" instead of creating intelligence deal

Usage:
    /Users/donaldross/opt/anaconda3/bin/python3 test_cidara_upgrade.py
"""
import asyncio
import asyncpg
import os

async def test_cidara_upgrade():
    conn = await asyncpg.connect(os.getenv('DATABASE_URL'))

    print("=" * 80)
    print("CIDARA/CDTX EDGAR UPGRADE TEST")
    print("=" * 80)

    # Check current EDGAR filing status
    print("\n[1] Checking EDGAR filing status for CDTX...")
    edgar_filing = await conn.fetchrow(
        """SELECT staged_deal_id, target_name, target_ticker, acquirer_name, status, detected_at
           FROM staged_deals
           WHERE target_ticker = 'CDTX'
           LIMIT 1"""
    )

    if edgar_filing:
        print(f"   ✓ Found EDGAR filing:")
        print(f"     ID: {edgar_filing['staged_deal_id']}")
        print(f"     Target: {edgar_filing['target_name']} ({edgar_filing['target_ticker']})")
        print(f"     Acquirer: {edgar_filing['acquirer_name']}")
        print(f"     Status: {edgar_filing['status']}")
        print(f"     Detected: {edgar_filing['detected_at']}")

        if edgar_filing['status'] == 'unlikely':
            print("\n   ⚠️  Status is 'unlikely' - this is the scenario our fix handles!")
            print("   When Seeking Alpha article is processed, it should:")
            print("   1. Detect EDGAR filing with status='unlikely'")
            print("   2. Upgrade it to 'pending'")
            print("   3. NOT create intelligence deal")
        elif edgar_filing['status'] == 'pending':
            print("\n   ✓ Status is already 'pending' - may have been upgraded!")
        else:
            print(f"\n   Status is '{edgar_filing['status']}'")
    else:
        print("   ✗ No EDGAR filing found for CDTX")

    # Check for intelligence deal
    print("\n[2] Checking for intelligence deal for CDTX...")
    intel_deal = await conn.fetchrow(
        """SELECT deal_id, target_name, target_ticker, acquirer_name, deal_status, first_detected_at
           FROM deal_intelligence
           WHERE target_ticker = 'CDTX'
           LIMIT 1"""
    )

    if intel_deal:
        print(f"   Found intelligence deal:")
        print(f"     ID: {intel_deal['deal_id']}")
        print(f"     Target: {intel_deal['target_name']} ({intel_deal['target_ticker']})")
        print(f"     Status: {intel_deal['deal_status']}")
        print("\n   ⚠️  Per user requirement, we should NOT create intelligence deal")
        print("   when upgrading EDGAR filing. This may be from before the fix.")
    else:
        print("   ✓ No intelligence deal found - correct behavior per user requirement")

    # Check deal_history for upgrade events
    if edgar_filing:
        print(f"\n[3] Checking for upgrade events in deal_history...")
        history = await conn.fetch(
            """SELECT change_type, new_value, triggered_by, changed_at
               FROM deal_history
               WHERE deal_id = $1
               AND change_type = 'status_upgraded'
               ORDER BY changed_at DESC
               LIMIT 5""",
            edgar_filing['staged_deal_id']
        )

        if history:
            print(f"   Found {len(history)} upgrade event(s):")
            for event in history:
                print(f"     - {event['changed_at']}: {event['change_type']}")
                print(f"       Triggered by: {event['triggered_by']}")
                print(f"       Details: {event['new_value']}")
        else:
            print("   No upgrade events found yet")

    await conn.close()
    print("\n" + "=" * 80)

if __name__ == "__main__":
    asyncio.run(test_cidara_upgrade())
