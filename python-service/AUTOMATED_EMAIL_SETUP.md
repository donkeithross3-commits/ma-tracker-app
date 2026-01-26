# Automated Email Forwarding Setup

> **Note:** This guide is for the Python service backend (port 8000) email webhook functionality.  
> For exposing the Next.js UI (port 3000), see [../docs/CLOUDFLARE_TUNNEL_SETUP.md](../docs/CLOUDFLARE_TUNNEL_SETUP.md).

This guide sets up **fully automated** email forwarding from Gmail to your M&A Tracker webhook. Emails from trusted senders will be automatically processed and added to your deal intelligence platform.

## Quick Start (5 minutes)

### Step 1: Start the Server with ngrok

```bash
cd /Users/donaldross/ma-tracker-app/python-service
./start_with_ngrok.sh
```

This script will:
- Start your Python server on port 8000
- Launch ngrok to expose it publicly
- Display your webhook URL

**Copy the webhook URL** - you'll need it in Step 2.

Example output:
```
Public URL: https://abc123.ngrok.io
Webhook URL: https://abc123.ngrok.io/webhooks/email/inbound
```

### Step 2: Set Up Gmail Auto-Forwarding

1. **Open Google Apps Script**
   - Go to https://script.google.com
   - Click **New Project**

2. **Paste the Code**
   - Open `gmail_forwarder.gs` in this directory
   - Copy the entire contents
   - Paste into the Apps Script editor

3. **Update the Webhook URL**
   ```javascript
   // Line 17 in gmail_forwarder.gs
   const WEBHOOK_URL = 'https://abc123.ngrok.io/webhooks/email/inbound';
   ```
   Replace `YOUR-NGROK-URL` with your actual ngrok URL from Step 1

4. **Save the Project**
   - Click the disk icon or Ctrl+S
   - Name it "M&A Email Forwarder"

5. **Test the Connection**
   - In the toolbar, select function: `testWebhook`
   - Click **Run**
   - Grant permissions when prompted (Apps Script needs to access Gmail)
   - Check **Logs** (View > Logs) for "Test successful!"

6. **Set Up Automatic Running**
   - Click the clock icon (Triggers)
   - Click **Add Trigger**
   - Settings:
     - Function: `processInbox`
     - Event source: **Time-driven**
     - Type: **Minutes timer**
     - Interval: **Every 5 minutes**
   - Click **Save**

## Done!

Your system is now fully automated. Every 5 minutes, the Apps Script will:

1. Check for new emails from trusted senders:
   - yetanothervalueblog.com
   - pitchbook.com
   - bloomberg.com
   - reuters.com
   - wsj.com
   - ft.com

2. Forward them to your webhook

3. Extract ticker symbols and deal information

4. Match to existing deals or log for review

5. Label processed emails as "MA-Tracker/Processed"

## Testing

### Test with a Real Email

1. Forward any M&A research email to yourself
2. Make sure the sender is from a trusted domain
3. Wait up to 5 minutes (or run `processInbox` manually)
4. Check your webhook logs:
   ```bash
   # In ngrok dashboard
   http://localhost:4040
   ```

5. Verify in database:
   ```sql
   SELECT * FROM deal_sources
   WHERE source_name LIKE '%Email%'
   ORDER BY detected_at DESC
   LIMIT 5;
   ```

### Manual Test

In Apps Script, run `testProcessSingleEmail` to immediately process your most recent email.

## Monitoring

### ngrok Dashboard
- Open http://localhost:4040
- See all webhook requests in real-time
- Inspect request/response data

### Gmail Labels
Processed emails are automatically labeled:
- `MA-Tracker/Processed` - Successfully forwarded
- `MA-Tracker/Error` - Failed to forward (check webhook logs)

### Application Logs
View Python server logs:
```bash
# The start_with_ngrok.sh script shows logs in the terminal
# Look for lines like:
INFO: Processing email from research@yetanothervalueblog.com: FRGE ($FRGE) - Deal Update
```

## Trusted Senders

Add more trusted domains in `gmail_forwarder.gs`:

```javascript
const TRUSTED_DOMAINS = [
  'yetanothervalueblog.com',
  'yourdomain.com',  // Add your domains here
  // ...
];
```

And in `app/services/email_ingestion.py`:

```python
self.trusted_domains = [
    "yetanothervalueblog.com",
    "yourdomain.com",  # Add your domains here
]
```

## Troubleshooting

### Emails not being forwarded

1. **Check Apps Script Executions**
   - In Apps Script, click **Executions** (left sidebar)
   - Look for errors in recent runs

2. **Verify Webhook URL**
   - Make sure ngrok is still running
   - ngrok URLs change each time you restart (unless you have a paid plan)
   - Update the webhook URL in `gmail_forwarder.gs` if it changed

3. **Check Sender Domain**
   - Only emails from trusted domains are forwarded
   - Check if sender is in `TRUSTED_DOMAINS` list

4. **Grant Permissions**
   - Apps Script needs permission to access Gmail
   - Re-run `testWebhook` to grant permissions again if needed

### ngrok session expired

Free ngrok sessions expire after 8 hours. Restart with:
```bash
./start_with_ngrok.sh
```

Then update the webhook URL in Apps Script.

### Want a permanent URL?

**Option 1: ngrok paid plan** ($8/month)
- Get a static URL that doesn't change
- No 8-hour session limit

**Option 2: Deploy to cloud**
- Deploy Python service to Railway/Render/Heroku
- Get a permanent webhook URL
- Update `WEBHOOK_URL` once in Apps Script

## Architecture

```
Gmail Inbox
  ↓
  (Every 5 min)
  ↓
Apps Script checks for emails from trusted senders
  ↓
POST to webhook
  ↓
ngrok tunnel → localhost:8000
  ↓
Email Ingestion Service
  ↓
Extracts: ticker, deal terms, company name
  ↓
Matches to existing deal
  ↓
Adds as source to deal_intelligence table
```

## Security Notes

1. **Webhook is publicly accessible** via ngrok
   - Only accept emails from whitelisted domains
   - Consider adding webhook signature verification

2. **Apps Script has Gmail access**
   - Only processes emails (read-only for forwarding)
   - Review permissions in Google Account settings

3. **ngrok free tier**
   - URL changes on restart
   - 8-hour session limit
   - Traffic visible in dashboard (localhost:4040)

## Next Steps

- Monitor first few automated forwards
- Adjust trigger frequency if needed (5-15 minutes recommended)
- Add more trusted sender domains as you discover them
- Set up production deployment for permanent URL
