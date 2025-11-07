#!/usr/bin/env python3
"""
Setup Gmail Watch for Push Notifications

This script:
1. Authenticates with Gmail API
2. Sets up a watch on your inbox
3. Configures Gmail to send push notifications to Cloud Pub/Sub

Run this script once to enable instant email notifications.
Watch lasts 7 days - re-run to renew.
"""

import os
import sys
from datetime import datetime, timedelta
from app.services.gmail_push import get_gmail_push_service

# Configuration
PROJECT_ID = os.getenv("GOOGLE_CLOUD_PROJECT", "modern-unison-454322-d7")
TOPIC_NAME_TEMPLATE = "projects/{}/topics/gmail-push"


def setup_watch():
    """Set up Gmail watch for push notifications"""

    print("=" * 60)
    print("Gmail Push Notifications Setup")
    print("=" * 60)
    print()

    # Get project ID
    if not PROJECT_ID:
        print("⚠️  GOOGLE_CLOUD_PROJECT environment variable not set")
        print()
        project_id = input("Enter your Google Cloud Project ID: ").strip()
        if not project_id:
            print("❌ Project ID is required")
            sys.exit(1)
    else:
        project_id = PROJECT_ID
        print(f"Using Google Cloud Project: {project_id}")
        print()

    topic_name = TOPIC_NAME_TEMPLATE.format(project_id)

    print(f"Topic: {topic_name}")
    print()

    # Initialize service
    print("Initializing Gmail Push service...")
    try:
        service = get_gmail_push_service()
        print("✅ Service initialized")
        print()
    except Exception as e:
        print(f"❌ Failed to initialize service: {e}")
        print()
        print("Make sure you have:")
        print("1. credentials.json in the python-service directory")
        print("2. Gmail API enabled in Google Cloud Console")
        print("3. Pub/Sub API enabled in Google Cloud Console")
        sys.exit(1)

    # Authenticate with Gmail
    print("Authenticating with Gmail API...")
    print("(A browser window will open for OAuth - grant permissions)")
    print()

    try:
        gmail = service._get_gmail_service()
        profile = gmail.users().getProfile(userId='me').execute()
        email = profile['emailAddress']
        print(f"✅ Authenticated as: {email}")
        print(f"   Total messages: {profile.get('messagesTotal', 'unknown')}")
        print()
    except Exception as e:
        print(f"❌ Authentication failed: {e}")
        print()
        print("Troubleshooting:")
        print("1. Make sure credentials.json exists")
        print("2. Delete token.json if it exists (to force re-auth)")
        print("3. Grant all requested permissions in the browser")
        sys.exit(1)

    # Set up watch
    print("Setting up Gmail watch...")
    print()

    try:
        result = service.setup_watch(topic_name)

        # Calculate expiration time
        expiration_ms = int(result['expiration'])
        expiration_dt = datetime.fromtimestamp(expiration_ms / 1000)
        days_until_expiration = (expiration_dt - datetime.now()).days

        print("=" * 60)
        print("✅ SUCCESS! Gmail watch is now active")
        print("=" * 60)
        print()
        print(f"History ID: {result['historyId']}")
        print(f"Expiration: {expiration_dt.strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"Valid for:  {days_until_expiration} days")
        print()
        print("=" * 60)
        print("What happens now:")
        print("=" * 60)
        print()
        print("1. When emails arrive in your inbox:")
        print("   → Gmail sends notification to Pub/Sub")
        print("   → Pub/Sub pushes to your webhook")
        print("   → Email processed INSTANTLY (< 1 second)")
        print()
        print("2. Only emails from trusted senders are processed:")
        for domain in service.trusted_domains:
            print(f"   ✓ {domain}")
        print()
        print("3. Watch will expire in {} days".format(days_until_expiration))
        print("   → Re-run this script to renew:")
        print("   → /Users/donaldross/opt/anaconda3/bin/python3 setup_gmail_watch.py")
        print()
        print("=" * 60)
        print("Next Steps:")
        print("=" * 60)
        print()
        print("1. Make sure your server is running:")
        print("   → cd /Users/donaldross/ma-tracker-app/python-service")
        print("   → ./start_with_ngrok.sh")
        print()
        print("2. Make sure Pub/Sub push subscription is configured:")
        print("   → Topic: {}".format(topic_name))
        print("   → Push endpoint: https://YOUR_NGROK_URL.ngrok.io/webhooks/email/gmail-push")
        print()
        print("3. Send a test email from a trusted sender to test!")
        print()

    except Exception as e:
        print("=" * 60)
        print("❌ FAILED to set up Gmail watch")
        print("=" * 60)
        print()
        print(f"Error: {e}")
        print()
        print("Common issues:")
        print()
        print("1. Pub/Sub topic doesn't exist:")
        print("   → Create it in Google Cloud Console:")
        print("   → https://console.cloud.google.com/cloudpubsub/topic/list")
        print("   → Or use gcloud:")
        print("   → gcloud pubsub topics create gmail-push")
        print()
        print("2. Gmail user doesn't have permission to publish to topic:")
        print("   → Go to Pub/Sub topic permissions")
        print("   → Add gmail-api-push@system.gserviceaccount.com")
        print("   → Grant 'Pub/Sub Publisher' role")
        print()
        print("3. Watch already active:")
        print("   → This is fine! The watch has been renewed.")
        print()
        sys.exit(1)


if __name__ == "__main__":
    setup_watch()
