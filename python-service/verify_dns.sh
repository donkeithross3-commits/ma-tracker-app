#!/bin/bash

# DNS Verification Script for Email Ingestion Setup
# Usage: ./verify_dns.sh yourdomain.com deals

DOMAIN=$1
SUBDOMAIN=$2

if [ -z "$DOMAIN" ]; then
    echo "Usage: ./verify_dns.sh yourdomain.com [subdomain]"
    echo "Example: ./verify_dns.sh example.com deals"
    exit 1
fi

if [ -z "$SUBDOMAIN" ]; then
    SUBDOMAIN="deals"
fi

FULL_SUBDOMAIN="${SUBDOMAIN}.${DOMAIN}"

echo "======================================"
echo "DNS Verification for Email Ingestion"
echo "======================================"
echo "Domain: $DOMAIN"
echo "Subdomain: $FULL_SUBDOMAIN"
echo ""

# Check SPF
echo "1. Checking SPF record..."
SPF=$(dig +short $DOMAIN TXT | grep "v=spf1")
if [ -z "$SPF" ]; then
    echo "   ❌ SPF record NOT FOUND"
    echo "   Add this TXT record to $DOMAIN:"
    echo "   v=spf1 include:sendgrid.net ~all"
else
    echo "   ✅ SPF record found:"
    echo "   $SPF"
    if [[ $SPF == *"sendgrid"* ]]; then
        echo "   ✅ SendGrid is included in SPF"
    else
        echo "   ⚠️  SendGrid NOT included in SPF"
        echo "   Update your SPF to include: include:sendgrid.net"
    fi
fi
echo ""

# Check DMARC
echo "2. Checking DMARC record..."
DMARC=$(dig +short _dmarc.$DOMAIN TXT)
if [ -z "$DMARC" ]; then
    echo "   ❌ DMARC record NOT FOUND"
    echo "   Add this TXT record to _dmarc.$DOMAIN:"
    echo "   v=DMARC1; p=none; rua=mailto:dmarc-reports@$DOMAIN; pct=100; adkim=r; aspf=r"
else
    echo "   ✅ DMARC record found:"
    echo "   $DMARC"
fi
echo ""

# Check DKIM (s1)
echo "3. Checking DKIM records..."
DKIM1=$(dig +short s1._domainkey.$DOMAIN CNAME)
if [ -z "$DKIM1" ]; then
    echo "   ❌ DKIM s1 record NOT FOUND"
    echo "   Add CNAME record for s1._domainkey.$DOMAIN"
    echo "   (Get value from SendGrid domain authentication)"
else
    echo "   ✅ DKIM s1 record found:"
    echo "   $DKIM1"
fi

DKIM2=$(dig +short s2._domainkey.$DOMAIN CNAME)
if [ -z "$DKIM2" ]; then
    echo "   ❌ DKIM s2 record NOT FOUND"
else
    echo "   ✅ DKIM s2 record found:"
    echo "   $DKIM2"
fi
echo ""

# Check MX Record for subdomain
echo "4. Checking MX record for inbound email..."
MX=$(dig +short $FULL_SUBDOMAIN MX)
if [ -z "$MX" ]; then
    echo "   ❌ MX record NOT FOUND for $FULL_SUBDOMAIN"
    echo "   Add this MX record:"
    echo "   Host: $FULL_SUBDOMAIN"
    echo "   Priority: 10"
    echo "   Value: mx.sendgrid.net"
else
    echo "   ✅ MX record found for $FULL_SUBDOMAIN:"
    echo "   $MX"
    if [[ $MX == *"sendgrid"* ]]; then
        echo "   ✅ Points to SendGrid"
    else
        echo "   ⚠️  Does NOT point to SendGrid"
        echo "   Should be: 10 mx.sendgrid.net"
    fi
fi
echo ""

# DNS Propagation Check
echo "5. Checking DNS propagation..."
echo "   (This can take up to 48 hours for new records)"
echo ""
echo "   Check global propagation at:"
echo "   https://dnschecker.org/#MX/$FULL_SUBDOMAIN"
echo ""

# Summary
echo "======================================"
echo "Summary"
echo "======================================"

ISSUES=0

if [ -z "$SPF" ]; then
    echo "❌ Missing SPF record"
    ISSUES=$((ISSUES+1))
elif [[ $SPF != *"sendgrid"* ]]; then
    echo "⚠️  SPF doesn't include SendGrid"
    ISSUES=$((ISSUES+1))
fi

if [ -z "$DMARC" ]; then
    echo "❌ Missing DMARC record"
    ISSUES=$((ISSUES+1))
fi

if [ -z "$DKIM1" ]; then
    echo "❌ Missing DKIM s1 record"
    ISSUES=$((ISSUES+1))
fi

if [ -z "$DKIM2" ]; then
    echo "❌ Missing DKIM s2 record"
    ISSUES=$((ISSUES+1))
fi

if [ -z "$MX" ]; then
    echo "❌ Missing MX record for $FULL_SUBDOMAIN"
    ISSUES=$((ISSUES+1))
elif [[ $MX != *"sendgrid"* ]]; then
    echo "⚠️  MX record doesn't point to SendGrid"
    ISSUES=$((ISSUES+1))
fi

if [ $ISSUES -eq 0 ]; then
    echo ""
    echo "✅ All DNS records are configured correctly!"
    echo ""
    echo "Next steps:"
    echo "1. Wait for DNS propagation (check dnschecker.org)"
    echo "2. Configure SendGrid Inbound Parse with your webhook URL"
    echo "3. Send a test email to: test@$FULL_SUBDOMAIN"
else
    echo ""
    echo "⚠️  Found $ISSUES issue(s). Please fix the records above."
    echo ""
    echo "See DNS_SETUP_GUIDE.md for detailed instructions."
fi
echo ""
