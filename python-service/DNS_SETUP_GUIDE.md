# DNS Setup Guide for Email Ingestion

This guide helps you set up DNS records for email authentication (DMARC, SPF, DKIM) and email forwarding via SendGrid.

## Prerequisites

- A domain you control (e.g., `yourdomain.com`)
- Access to your domain's DNS management (GoDaddy, Namecheap, Cloudflare, etc.)
- SendGrid account (free tier is fine)

## Step 1: Choose Your Subdomain

You'll create a subdomain specifically for receiving M&A research emails. Common choices:
- `deals.yourdomain.com`
- `research.yourdomain.com`
- `ma.yourdomain.com`

For this guide, we'll use `deals.yourdomain.com` as the example.

## Step 2: SendGrid Domain Authentication

### A. Authenticate Your Domain in SendGrid

1. Log into SendGrid: https://app.sendgrid.com
2. Go to **Settings** > **Sender Authentication**
3. Click **Authenticate Your Domain**
4. Choose your DNS host
5. Enter your domain: `yourdomain.com`
6. Use default subdomain: `em` (creates `em.yourdomain.com`)
7. Click **Next**

SendGrid will generate DNS records for you to add.

### B. Add CNAME Records for DKIM

SendGrid will show you 3 CNAME records to add. They'll look like this:

```
Type: CNAME
Host: s1._domainkey.yourdomain.com
Value: s1.domainkey.u12345.wl.sendgrid.net

Type: CNAME
Host: s2._domainkey.yourdomain.com
Value: s2.domainkey.u12345.wl.sendgrid.net

Type: CNAME
Host: em.yourdomain.com
Value: u12345.wl.sendgrid.net
```

**Add these to your DNS provider.**

## Step 3: Set Up SPF Record

SPF (Sender Policy Framework) tells receiving servers which mail servers are allowed to send email for your domain.

### Add TXT Record for SPF:

```
Type: TXT
Host: @ (or yourdomain.com)
Value: v=spf1 include:sendgrid.net ~all
```

**Important:** If you already have an SPF record, don't create a second one. Instead, add `include:sendgrid.net` to your existing record:

```
Existing: v=spf1 include:_spf.google.com ~all
Updated:  v=spf1 include:_spf.google.com include:sendgrid.net ~all
```

## Step 4: Set Up DMARC Record

DMARC (Domain-based Message Authentication, Reporting & Conformance) tells receiving servers what to do with emails that fail SPF/DKIM checks.

### Add TXT Record for DMARC:

```
Type: TXT
Host: _dmarc.yourdomain.com
Value: v=DMARC1; p=none; rua=mailto:dmarc-reports@yourdomain.com; pct=100; adkim=r; aspf=r
```

**Explanation:**
- `v=DMARC1` - Version
- `p=none` - Policy: monitor only (doesn't reject failed emails)
- `rua=mailto:your-email@yourdomain.com` - Where to send aggregate reports
- `pct=100` - Apply policy to 100% of emails
- `adkim=r` - Relaxed DKIM alignment
- `aspf=r` - Relaxed SPF alignment

**Recommended for production (after testing):**
```
v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@yourdomain.com; pct=100; adkim=s; aspf=s
```

## Step 5: Set Up Inbound Parse (MX Records)

Now set up the subdomain to receive emails via SendGrid.

### A. Add MX Record

```
Type: MX
Host: deals.yourdomain.com
Priority: 10
Value: mx.sendgrid.net
```

### B. Configure SendGrid Inbound Parse

1. In SendGrid, go to **Settings** > **Inbound Parse**
2. Click **Add Host & URL**
3. Enter:
   - **Subdomain**: `deals`
   - **Domain**: `yourdomain.com`
   - **URL**: Your webhook endpoint (see below)
   - **Spam Check**: Enabled
   - **Send Raw**: Enabled (recommended)

## Step 6: Webhook URL Setup

### For Local Development (ngrok):

```bash
# Install ngrok
brew install ngrok

# Start your Python server
cd /Users/donaldross/ma-tracker-app/python-service
python3 start_server.py

# In another terminal, start ngrok
ngrok http 8000
```

Use the ngrok URL in SendGrid:
```
https://abc123.ngrok.io/webhooks/email/inbound
```

### For Production (Vercel/Railway/Heroku):

Your webhook URL will be:
```
https://your-app.vercel.app/webhooks/email/inbound
```

## Step 7: Verify DNS Records

### Check SPF:

```bash
dig yourdomain.com TXT | grep spf
```

Expected output:
```
yourdomain.com.  3600  IN  TXT  "v=spf1 include:sendgrid.net ~all"
```

### Check DMARC:

```bash
dig _dmarc.yourdomain.com TXT
```

Expected output:
```
_dmarc.yourdomain.com.  3600  IN  TXT  "v=DMARC1; p=none; rua=mailto:..."
```

### Check MX:

```bash
dig deals.yourdomain.com MX
```

Expected output:
```
deals.yourdomain.com.  3600  IN  MX  10 mx.sendgrid.net.
```

### Check DKIM:

```bash
dig s1._domainkey.yourdomain.com CNAME
```

Expected output:
```
s1._domainkey.yourdomain.com.  3600  IN  CNAME  s1.domainkey.u12345.wl.sendgrid.net.
```

## Step 8: Test Email Forwarding

### Send a test email to:

```
anything@deals.yourdomain.com
```

The email should arrive at your webhook within seconds.

### Check SendGrid Activity Feed:

1. Go to **Activity** in SendGrid
2. Look for "Inbound Parse" events
3. Check for any errors

### Check Your App Logs:

```bash
# Your Python server should log:
INFO: Processing email from sender@example.com: Subject Line
```

## DNS Record Summary

Here's a complete list of DNS records you need to add:

### For Domain Authentication (Main Domain):

| Type  | Host                              | Value/Target                                    | Priority |
|-------|-----------------------------------|-------------------------------------------------|----------|
| CNAME | s1._domainkey.yourdomain.com      | s1.domainkey.u12345.wl.sendgrid.net            | -        |
| CNAME | s2._domainkey.yourdomain.com      | s2.domainkey.u12345.wl.sendgrid.net            | -        |
| CNAME | em.yourdomain.com                 | u12345.wl.sendgrid.net                          | -        |
| TXT   | @ (yourdomain.com)                | v=spf1 include:sendgrid.net ~all                | -        |
| TXT   | _dmarc.yourdomain.com             | v=DMARC1; p=none; rua=mailto:you@yourdomain.com | -        |

### For Inbound Parse (Subdomain):

| Type  | Host                   | Value/Target      | Priority |
|-------|------------------------|-------------------|----------|
| MX    | deals.yourdomain.com   | mx.sendgrid.net   | 10       |

## Common DNS Providers

### Namecheap:

1. Log in to Namecheap
2. Go to **Domain List** > Your domain > **Manage**
3. Click **Advanced DNS**
4. Add records using the tables above

### GoDaddy:

1. Log in to GoDaddy
2. Go to **My Products** > **DNS**
3. Click **Add** for each record type

### Cloudflare:

1. Log in to Cloudflare
2. Select your domain
3. Go to **DNS** > **Records**
4. Click **Add record**

**Important for Cloudflare:** Make sure to set the MX record to "DNS only" (gray cloud), not "Proxied" (orange cloud).

## Troubleshooting

### Emails not arriving at webhook:

1. **Check DNS propagation** (can take up to 48 hours):
   - Use https://dnschecker.org
   - Search for your MX record: `deals.yourdomain.com`

2. **Check SendGrid Activity Feed**:
   - Look for inbound parse events
   - Check for webhook errors

3. **Verify webhook is accessible**:
   ```bash
   curl https://your-app.com/webhooks/email/test
   ```

4. **Check SendGrid Inbound Parse settings**:
   - Ensure URL is correct
   - Enable "Check incoming emails for spam"
   - Enable "POST the raw, full MIME message"

### DMARC alignment failures:

- If using subdomain for inbound (`deals.yourdomain.com`), ensure your DMARC policy uses `adkim=r` and `aspf=r` (relaxed alignment)

### SPF record issues:

- Each domain can only have ONE SPF record
- If you have multiple mail providers, include all in one record:
  ```
  v=spf1 include:sendgrid.net include:_spf.google.com ~all
  ```

## Security Best Practices

1. **Start with lenient DMARC** (`p=none`) to monitor
2. **After 1-2 weeks, tighten policy**:
   ```
   v=DMARC1; p=quarantine; rua=mailto:you@yourdomain.com
   ```
3. **Eventually move to strict**:
   ```
   v=DMARC1; p=reject; rua=mailto:you@yourdomain.com; adkim=s; aspf=s
   ```
4. **Monitor DMARC reports** to catch issues before tightening policy

## Alternative: Quick Test Without Custom Domain

If you don't have a domain yet or want to test quickly:

1. Use SendGrid's email testing feature
2. Or use a service like **Mailtrap** for testing
3. Or forward from your existing Gmail/Outlook to the webhook

Let me know if you need help with any specific DNS provider!
