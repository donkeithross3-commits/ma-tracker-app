# Email Ingestion Setup Guide

This guide explains how to set up real-time email ingestion for M&A deal research reports and announcements.

## Overview

The email ingestion system receives emails via webhook and automatically:
- Extracts ticker symbols and company names
- Matches emails to existing deals in the intelligence platform
- Creates new staged deals from trusted sources
- Adds research content as sources for existing deals

## Supported Email Services

### Option 1: SendGrid Inbound Parse (Recommended)

**Pros:**
- Free for up to 100 emails/day
- Reliable and battle-tested
- Easy webhook setup

**Setup Steps:**

1. **Create a SendGrid account** at https://sendgrid.com
   - Free tier is sufficient for testing

2. **Configure Inbound Parse:**
   - Go to Settings > Inbound Parse
   - Click "Add Host & URL"
   - Enter your subdomain (e.g., `deals.yourdomain.com`)
   - Enter webhook URL: `https://your-app.com/webhooks/email/inbound`
   - Enable "POST the raw, full MIME message"
   - Save

3. **Set up DNS:**
   - Add MX record to your domain:
     ```
     Host: deals.yourdomain.com
     Type: MX
     Priority: 10
     Value: mx.sendgrid.net
     ```

4. **Forward emails to your address:**
   - Email sent to `anything@deals.yourdomain.com` will hit your webhook
   - Create an email like `maresearch@deals.yourdomain.com`

### Option 2: Mailgun Routes

**Pros:**
- Free for up to 10,000 emails/month
- More generous free tier

**Setup Steps:**

1. **Create Mailgun account** at https://www.mailgun.com

2. **Add your domain:**
   - Go to Sending > Domains
   - Add your domain and verify DNS records

3. **Create a route:**
   - Go to Sending > Routes
   - Create route:
     ```
     Priority: 1
     Filter: match_recipient(".*@deals.yourdomain.com")
     Actions: forward("https://your-app.com/webhooks/email/inbound")
     ```

4. **Update DNS:**
   - Add MX records as shown in Mailgun dashboard

### Option 3: Amazon SES + SNS

**Pros:**
- Extremely cheap ($0.10 per 1,000 emails)
- Integrates well with AWS infrastructure

**Setup Steps:**

1. **Verify domain in SES:**
   - Add domain in AWS SES console
   - Add verification DNS records

2. **Create SNS topic:**
   - Create topic named `ma-email-ingestion`

3. **Create SES receipt rule:**
   - Go to Email Receiving > Rule Sets
   - Create rule to publish to SNS topic
   - SNS subscription URL: `https://your-app.com/webhooks/email/inbound`

## Email Format Requirements

For best results, emails should include:

### Subject Line Patterns

The system looks for these patterns to extract ticker symbols:
- `ACME ($ACME) - Deal Update`
- `[ACME] Merger Update`
- `ACME (Ticker: ACME) News`
- `ACME - Acquisition Announced`

### Body Content

The system extracts:
- **Deal values:** "deal value: $5.5 billion" or "$5.5B deal"
- **Dates:** "announced: 2024-01-15" or "expected close: 2024-06-30"
- **Deal types:** merger, acquisition, tender offer

### Trusted Senders

Emails from these domains are auto-processed:
- yetanothervalueblog.com
- pitchbook.com
- bloomberg.com
- reuters.com
- wsj.com
- ft.com

To add more trusted domains, edit `app/services/email_ingestion.py`:

```python
self.trusted_domains = [
    "yetanothervalueblog.com",
    "yourtrustedresearch.com",  # Add your trusted domains here
    # ...
]
```

## Testing the Webhook

### 1. Check endpoint is accessible

```bash
curl http://localhost:8000/webhooks/email/test
```

Expected response:
```json
{
  "status": "ok",
  "message": "Email webhook endpoint is active",
  "endpoints": [...]
}
```

### 2. Test with sample POST

```bash
curl -X POST http://localhost:8000/webhooks/email/inbound \
  -F "from=research@yetanothervalueblog.com" \
  -F "subject=FRGE ($FRGE) - Merger Announced" \
  -F "text=Forge Global announces $5.5B acquisition by Private Shares. Deal expected to close in Q2 2024."
```

Expected response:
```json
{
  "status": "success",
  "message": "Email processed successfully",
  "result": {
    "action_taken": "added_source_to_existing_deal",
    "matching_deal_id": "...",
    "ticker": "FRGE"
  }
}
```

## Production Deployment

### Expose webhook publicly

If deploying on Vercel/Railway/Heroku, your webhook will automatically be public at:
```
https://your-app.vercel.app/webhooks/email/inbound
```

### For local testing with ngrok:

```bash
# Install ngrok
brew install ngrok

# Start your server
cd /Users/donaldross/ma-tracker-app/python-service
python3 start_server.py

# In another terminal, expose port 8000
ngrok http 8000
```

Use the ngrok URL (e.g., `https://abc123.ngrok.io/webhooks/email/inbound`) in your email service webhook config.

### Security considerations:

1. **Add webhook signature validation** (for SendGrid):
   ```python
   # In webhooks.py, add verification
   from sendgrid.helpers.inbound import Parse

   def verify_sendgrid_signature(request: Request):
       # Verify X-Twilio-Email-Event-Webhook-Signature header
       pass
   ```

2. **Rate limiting:** Add rate limits to prevent abuse
   ```python
   from slowapi import Limiter

   @router.post("/email/inbound")
   @limiter.limit("100/hour")
   async def receive_inbound_email(...):
       pass
   ```

3. **Whitelist sender IPs:** Only accept webhooks from known IPs
   - SendGrid IPs: https://docs.sendgrid.com/for-developers/parsing-email/setting-up-the-inbound-parse-webhook#firewall

## Monitoring

Check email ingestion logs:
```bash
# View logs
tail -f /var/log/ma-tracker/email-ingestion.log

# Or if using Python logging
grep "Processing email" /var/log/app.log
```

## Troubleshooting

### Emails not arriving at webhook

1. Check DNS records are correct:
   ```bash
   dig MX deals.yourdomain.com
   ```

2. Check webhook URL is publicly accessible:
   ```bash
   curl https://your-app.com/webhooks/email/test
   ```

3. Check email service logs (SendGrid/Mailgun dashboard)

### Emails processed but not creating deals

1. Check if email matches existing deal (logs will show "added_source_to_existing_deal")
2. Check if sender is in trusted domains list
3. Check if ticker/company name was extracted correctly (view logs)

### How to manually replay an email

Save the email as `.eml` file, then:
```python
with open('email.eml', 'r') as f:
    email_content = f.read()

# Parse and send to webhook
# ... convert to form data and POST to webhook
```

## Next Steps

1. Set up your chosen email service (SendGrid recommended for simplicity)
2. Configure DNS records
3. Test with a sample email
4. Add your research email addresses to forward emails
5. Monitor incoming emails in the Intelligence platform

For questions or issues, check the main README or open an issue.
