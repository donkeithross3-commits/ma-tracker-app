#!/usr/bin/env python3
"""
Test Email Webhook Locally
Simulates SendGrid sending an email to your webhook endpoint
"""

import requests
import json
from datetime import datetime

# Your local webhook endpoint
WEBHOOK_URL = "http://localhost:8000/webhooks/email/inbound"

def test_frge_email():
    """Test with a FRGE deal announcement email"""

    print("Testing email webhook with FRGE deal announcement...")
    print(f"Webhook URL: {WEBHOOK_URL}")
    print()

    # Simulate a research email about FRGE
    email_data = {
        "from": "research@yetanothervalueblog.com",
        "to": "deals@yourdomain.com",
        "subject": "FRGE ($FRGE) - Forge Global Acquisition Update",
        "text": """
Forge Global Holdings, Inc. (FRGE) - Acquisition by Private Shares

Deal announced: 2024-11-01
Expected close: Q2 2025
Deal value: $5.5 billion

Forge Global Holdings has entered into a definitive agreement to be acquired
by Private Shares in an all-cash transaction valued at approximately $5.5 billion.

Key Terms:
- Cash consideration: $2.50 per share
- Expected close: Q2 2025
- Shareholder vote: January 2025

This represents a significant premium to FRGE's current trading price.

Risks:
- Regulatory approval required
- Shareholder approval required (simple majority)
- Financing condition: Yes

For more details, see the 8-K filing on EDGAR.
        """,
        "html": None,
        "envelope": json.dumps({
            "to": ["deals@yourdomain.com"],
            "from": "research@yetanothervalueblog.com"
        })
    }

    try:
        response = requests.post(WEBHOOK_URL, data=email_data, timeout=10)

        print(f"Status Code: {response.status_code}")
        print()

        if response.status_code == 200:
            result = response.json()
            print("✅ Email processed successfully!")
            print()
            print("Result:")
            print(json.dumps(result, indent=2))

            if result.get("result", {}).get("action_taken") == "added_source_to_existing_deal":
                print()
                print(f"✅ Added as source to existing FRGE deal: {result['result']['matching_deal_id']}")
            elif result.get("result", {}).get("action_taken") == "created_staged_deal":
                print()
                print(f"✅ Created new staged deal: {result['result']['staged_deal_id']}")
        else:
            print(f"❌ Error: {response.text}")

    except requests.exceptions.ConnectionError:
        print("❌ Connection Error: Is your server running on port 8000?")
        print()
        print("Start your server with:")
        print("  cd /Users/donaldross/ma-tracker-app/python-service")
        print("  python3 start_server.py")
    except Exception as e:
        print(f"❌ Error: {e}")


def test_generic_email():
    """Test with a generic M&A announcement"""

    print("\nTesting generic M&A announcement email...")
    print()

    email_data = {
        "from": "news@bloomberg.com",
        "to": "deals@yourdomain.com",
        "subject": "ACME Corp ($ACME) - Announces Definitive Merger Agreement",
        "text": """
ACME Corp announces it has entered into a definitive agreement to be acquired
by BigCo Holdings for $150 per share in cash, valuing the transaction at
approximately $12 billion.

Deal expected to close in Q3 2025.
        """,
        "html": None,
        "envelope": json.dumps({
            "to": ["deals@yourdomain.com"],
            "from": "news@bloomberg.com"
        })
    }

    try:
        response = requests.post(WEBHOOK_URL, data=email_data, timeout=10)

        print(f"Status Code: {response.status_code}")

        if response.status_code == 200:
            result = response.json()
            print("✅ Email processed successfully!")
            print()
            print("Result:")
            print(json.dumps(result, indent=2))
        else:
            print(f"❌ Error: {response.text}")

    except Exception as e:
        print(f"❌ Error: {e}")


def test_untrusted_sender():
    """Test with an untrusted sender (should be logged for review)"""

    print("\nTesting email from untrusted sender...")
    print()

    email_data = {
        "from": "random@example.com",
        "to": "deals@yourdomain.com",
        "subject": "XYZ ($XYZ) - Merger News",
        "text": "XYZ Corp announces merger with ABC Holdings for $50 per share.",
        "html": None,
        "envelope": json.dumps({
            "to": ["deals@yourdomain.com"],
            "from": "random@example.com"
        })
    }

    try:
        response = requests.post(WEBHOOK_URL, data=email_data, timeout=10)

        print(f"Status Code: {response.status_code}")

        if response.status_code == 200:
            result = response.json()
            print("✅ Email processed successfully!")
            print()
            print("Result:")
            print(json.dumps(result, indent=2))

            if result.get("result", {}).get("action_taken") == "logged_for_review":
                print()
                print("⚠️  Email from untrusted sender - logged for manual review")
        else:
            print(f"❌ Error: {response.text}")

    except Exception as e:
        print(f"❌ Error: {e}")


if __name__ == "__main__":
    print("=" * 60)
    print("Email Webhook Testing Tool")
    print("=" * 60)
    print()

    # Test 1: FRGE deal
    test_frge_email()

    # Test 2: Generic announcement
    test_generic_email()

    # Test 3: Untrusted sender
    test_untrusted_sender()

    print()
    print("=" * 60)
    print("Testing Complete!")
    print("=" * 60)
