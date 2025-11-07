# Gmail Push Notifications - INSTANT Email Processing

This setup gives you **real-time email notifications** (< 1 second latency) using Google Cloud Pub/Sub. No polling, no delays.

## Architecture

```
Email arrives in Gmail
  ↓ (< 1 second)
Google sends push notification to Pub/Sub
  ↓
Pub/Sub pushes to your webhook
  ↓
Email processed instantly
```

## Quick Setup (15 minutes)

### Step 1: Google Cloud Setup (5 minutes)

1. **Go to Google Cloud Console**
   - Visit https://console.cloud.google.com
   - Create new project or select existing one
   - Note your **Project ID** (you'll need this)

2. **Enable APIs**
   - Search for "Gmail API" → Enable
   - Search for "Cloud Pub/Sub API" → Enable

3. **Create Pub/Sub Topic**
   ```bash
   # In Cloud Console, go to Pub/Sub → Topics → Create Topic
   # Or use gcloud CLI:
   gcloud pubsub topics create gmail-push
   ```

   Your topic name will be: `projects/YOUR_PROJECT_ID/topics/gmail-push`

### Step 2: OAuth Credentials (3 minutes)

1. **Go to APIs & Services → Credentials**

2. **Create OAuth 2.0 Client ID**
   - Click "Create Credentials" → "OAuth client ID"
   - Application type: **Desktop app**
   - Name: "M&A Tracker Gmail"
   - Download the JSON file

3. **Save credentials**
   ```bash
   # Save the downloaded file as:
   /Users/donaldross/ma-tracker-app/python-service/credentials.json
   ```

### Step 3: Grant Gmail Permissions (2 minutes)

You need to allow your Cloud Project to send Gmail notifications:

1. **Go to Gmail Settings**
   - Visit: https://mail.google.com/mail/u/0/#settings/fwdandpop
   - Or Gmail → Settings → Forwarding and POP/IMAP

2. **Grant Domain-Wide Delegation** (for personal Gmail)
   - In Google Cloud Console
   - Go to IAM & Admin → Service Accounts
   - Create service account: "gmail-push-notifications"
   - Grant role: "Pub/Sub Publisher"

**For personal Gmail** (simpler):
- Just run the setup script - it will open a browser for OAuth
- Grant permissions when prompted

### Step 4: Start Your Server with ngrok (1 minute)

```bash
cd /Users/donaldross/ma-tracker-app/python-service
./start_with_ngrok.sh
```

Note your webhook URL, e.g.: `https://abc123.ngrok.io`

### Step 5: Create Push Subscription (2 minutes)

```bash
# In Cloud Console: Pub/Sub → Subscriptions → Create Subscription
# Or use gcloud:

gcloud pubsub subscriptions create gmail-push-sub \
  --topic=gmail-push \
  --push-endpoint=https://YOUR_NGROK_URL.ngrok.io/webhooks/email/gmail-push
```

Replace `YOUR_NGROK_URL` with your actual ngrok URL from Step 4.

### Step 6: Start Gmail Watch (1 minute)

```bash
cd /Users/donaldross/ma-tracker-app/python-service
/Users/donaldross/opt/anaconda3/bin/python3 setup_gmail_watch.py
```

This script will:
1. Authenticate with Gmail (browser will open)
2. Start watching your inbox
3. Print confirmation with expiration time

**Watch lasts 7 days** - you'll need to renew it weekly (or set up a cron job).

## Done!

You now have **instant email notifications**. Test it:

1. Send a test email to your Gmail from a trusted domain
2. Watch your server logs - you should see it processed within 1 second

## Monitoring

### Check if Watch is Active

```bash
/Users/donaldross/opt/anaconda3/bin/python3 -c "
from app.services.gmail_push import get_gmail_push_service
service = get_gmail_push_service()
gmail = service._get_gmail_service()
profile = gmail.users().getProfile(userId='me').execute()
print(f'Email: {profile[\"emailAddress\"]}')
print(f'Messages Total: {profile[\"messagesTotal\"]}')
"
```

### Renew Watch (Every 7 Days)

```bash
/Users/donaldross/opt/anaconda3/bin/python3 setup_gmail_watch.py
```

Or set up a cron job:
```bash
# Add to crontab (runs every 6 days)
0 0 */6 * * cd /Users/donaldross/ma-tracker-app/python-service && /Users/donaldross/opt/anaconda3/bin/python3 setup_gmail_watch.py
```

### View Pub/Sub Metrics

https://console.cloud.google.com/cloudpubsub/subscription/detail/gmail-push-sub

Shows:
- Messages received
- Messages delivered
- Delivery latency (should be < 1 second)

## Troubleshooting

### "Permission denied" on Gmail API

1. Make sure you granted OAuth permissions (Step 3)
2. Delete `token.json` and re-run setup script
3. Make sure Gmail API is enabled in Cloud Console

### Notifications not arriving at webhook

1. **Check Pub/Sub subscription status**
   - Go to Cloud Console → Pub/Sub → Subscriptions
   - Look for errors on `gmail-push-sub`

2. **Verify webhook is accessible**
   ```bash
   curl https://YOUR_NGROK_URL.ngrok.io/webhooks/email/test
   ```
   Should return `{"status": "ok"}`

3. **Check ngrok is running**
   - ngrok free tier expires after 8 hours
   - Restart `./start_with_ngrok.sh` if needed
   - Update Pub/Sub push-endpoint with new URL

4. **Test Pub/Sub directly**
   ```bash
   gcloud pubsub topics publish gmail-push --message '{"emailAddress":"test@gmail.com","historyId":"12345"}'
   ```
   Check your webhook logs for the message.

### Watch expired (after 7 days)

```bash
# Just re-run setup
/Users/donaldross/opt/anaconda3/bin/python3 setup_gmail_watch.py
```

### "Insufficient Permission" error

The Gmail user needs to grant permission to the Cloud Project:

1. Delete token.json
2. Re-run setup script
3. Make sure to click "Allow" when prompted

## Comparison: Push vs. Polling

| Method | Latency | Resource Usage | Reliability |
|--------|---------|----------------|-------------|
| **Gmail Push** | < 1 second | Minimal (event-driven) | Very high |
| Apps Script 5-min | 0-5 minutes | Low | Medium |
| Apps Script 1-min | 0-1 minute | Medium | Medium |
| IMAP IDLE | 1-30 seconds | High (persistent connection) | Medium |

**Gmail Push is the clear winner** for time-sensitive M&A deal announcements.

## Production Deployment

For production (permanent URL instead of ngrok):

1. **Deploy Python service** to Railway/Render/Heroku
   - Get permanent webhook URL

2. **Update Pub/Sub subscription**
   ```bash
   gcloud pubsub subscriptions update gmail-push-sub \
     --push-endpoint=https://your-app.onrender.com/webhooks/email/gmail-push
   ```

3. **Set up watch renewal** (cron job on server)
   ```bash
   # Every 6 days
   0 0 */6 * * /path/to/python setup_gmail_watch.py
   ```

## Costs

- **Gmail API**: Free (no quotas for personal use)
- **Pub/Sub**: Free tier includes 10 GB/month
  - ~10,000 emails/month = well under free tier
- **Cloud Functions** (if using): $0.40 per million invocations

**Total cost for personal use: $0/month**

## Security

1. **credentials.json** contains OAuth client secrets
   - Add to .gitignore
   - Don't commit to version control

2. **token.json** contains access/refresh tokens
   - Add to .gitignore
   - Grants read-only Gmail access

3. **Pub/Sub authentication**
   - Webhook is public but only receives Gmail notifications
   - Consider adding Pub/Sub signature verification

## Next Steps

1. Run setup (steps 1-6 above)
2. Test with a real email
3. Monitor for 24 hours
4. Set up watch renewal cron job
5. Deploy to production for permanent URL
