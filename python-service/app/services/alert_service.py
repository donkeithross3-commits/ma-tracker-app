"""Alert Service - Sends email notifications for deal announcements"""
import os
import logging
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Dict, Any, List, Optional
import asyncpg
from datetime import datetime

logger = logging.getLogger(__name__)


class AlertService:
    """Service to send deal announcement alerts via email"""

    def __init__(self, db_url: str):
        self.db_url = db_url

        # Email configuration from environment variables
        self.smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
        self.smtp_port = int(os.getenv("SMTP_PORT", "587"))
        self.smtp_user = os.getenv("SMTP_USER")
        self.smtp_password = os.getenv("SMTP_PASSWORD")
        self.from_email = os.getenv("ALERT_FROM_EMAIL", self.smtp_user)
        self.from_name = os.getenv("ALERT_FROM_NAME", "M&A Intelligence Alert")

    async def should_alert_deal(self, deal: Dict[str, Any]) -> bool:
        """
        Determine if a deal should trigger an alert.

        Criteria:
        - Deal tier is "active" (definitive announcement)
        - Confidence score >= 0.80 (high confidence)
        - Not already alerted
        """
        # Check tier and confidence
        if deal['deal_tier'] != 'active':
            logger.debug(f"Deal {deal['deal_id']} is not active tier, skipping alert")
            return False

        if deal['confidence_score'] < 0.80:
            logger.debug(f"Deal {deal['deal_id']} confidence too low ({deal['confidence_score']}), skipping alert")
            return False

        # Check if already alerted
        conn = await asyncpg.connect(self.db_url)
        try:
            already_alerted = await conn.fetchval(
                """SELECT EXISTS(
                    SELECT 1 FROM alert_notifications
                    WHERE deal_id = $1
                    AND alert_type = 'deal_announcement'
                    AND status = 'sent'
                )""",
                deal['deal_id']
            )

            if already_alerted:
                logger.debug(f"Deal {deal['deal_id']} already alerted, skipping")
                return False

            return True
        finally:
            await conn.close()

    async def get_active_recipients(self) -> List[Dict[str, Any]]:
        """Get all active alert recipients"""
        conn = await asyncpg.connect(self.db_url)
        try:
            recipients = await conn.fetch(
                """SELECT * FROM alert_recipients
                   WHERE enabled = true
                   ORDER BY created_at ASC"""
            )
            return [dict(r) for r in recipients]
        finally:
            await conn.close()

    def generate_alert_email(self, deal: Dict[str, Any]) -> tuple[str, str]:
        """
        Generate email subject and body for deal announcement alert.
        Returns (subject, html_body)
        """
        subject = f"🚨 New M&A Deal Announced: {deal['target_name']}"

        # Build email body
        target_display = deal['target_name']
        if deal.get('target_ticker'):
            target_display += f" ({deal['target_ticker']})"

        acquirer_display = deal.get('acquirer_name', 'Unknown')
        if deal.get('acquirer_ticker'):
            acquirer_display += f" ({deal['acquirer_ticker']})"

        deal_value_display = f"${deal['deal_value']}B" if deal.get('deal_value') else "Not disclosed"

        html_body = f"""
        <html>
        <head>
            <style>
                body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
                .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
                .header {{ background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                           color: white; padding: 20px; border-radius: 8px 8px 0 0; }}
                .content {{ background: #f9fafb; padding: 20px; border-radius: 0 0 8px 8px; }}
                .deal-info {{ background: white; padding: 15px; border-radius: 6px;
                             margin: 15px 0; border-left: 4px solid #667eea; }}
                .info-row {{ margin: 10px 0; }}
                .label {{ font-weight: bold; color: #666; }}
                .value {{ color: #333; }}
                .footer {{ margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd;
                          font-size: 12px; color: #666; }}
                .badge {{ display: inline-block; padding: 4px 12px; border-radius: 12px;
                         font-size: 11px; font-weight: bold; }}
                .badge-active {{ background: #10b981; color: white; }}
                .badge-confidence {{ background: #3b82f6; color: white; }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1 style="margin: 0; font-size: 24px;">🚨 New M&A Deal Announced</h1>
                    <p style="margin: 10px 0 0 0; opacity: 0.9;">High-confidence definitive announcement detected</p>
                </div>

                <div class="content">
                    <div class="deal-info">
                        <h2 style="margin-top: 0; color: #667eea;">{target_display}</h2>

                        <div class="info-row">
                            <span class="label">Acquirer:</span>
                            <span class="value">{acquirer_display}</span>
                        </div>

                        <div class="info-row">
                            <span class="label">Deal Value:</span>
                            <span class="value">{deal_value_display}</span>
                        </div>

                        <div class="info-row">
                            <span class="label">Deal Type:</span>
                            <span class="value">{deal.get('deal_type', 'Not specified')}</span>
                        </div>

                        <div class="info-row">
                            <span class="label">Status:</span>
                            <span class="badge badge-active">ACTIVE</span>
                            <span class="badge badge-confidence">
                                {int(deal['confidence_score'] * 100)}% Confidence
                            </span>
                        </div>

                        <div class="info-row">
                            <span class="label">Source Count:</span>
                            <span class="value">{deal.get('source_count', 0)} sources</span>
                        </div>

                        <div class="info-row">
                            <span class="label">First Detected:</span>
                            <span class="value">{deal.get('first_detected_at', 'Unknown')}</span>
                        </div>
                    </div>

                    <p style="margin-top: 20px;">
                        <strong>Next Steps:</strong> Review this deal in your M&A Intelligence dashboard
                        to see detailed source information, risk assessment, and deal terms.
                    </p>
                </div>

                <div class="footer">
                    <p>This is an automated alert from your M&A Intelligence Platform.</p>
                    <p>Deal ID: {deal['deal_id']}</p>
                </div>
            </div>
        </body>
        </html>
        """

        return subject, html_body

    async def send_email(self, to_email: str, subject: str, html_body: str) -> bool:
        """Send email via SMTP. Returns True if successful."""
        if not self.smtp_user or not self.smtp_password:
            logger.error("SMTP credentials not configured. Set SMTP_USER and SMTP_PASSWORD environment variables.")
            return False

        try:
            # Create message
            msg = MIMEMultipart('alternative')
            msg['Subject'] = subject
            msg['From'] = f"{self.from_name} <{self.from_email}>"
            msg['To'] = to_email

            # Add HTML body
            html_part = MIMEText(html_body, 'html')
            msg.attach(html_part)

            # Send via SMTP
            with smtplib.SMTP(self.smtp_host, self.smtp_port) as server:
                server.starttls()
                server.login(self.smtp_user, self.smtp_password)
                server.send_message(msg)

            logger.info(f"Successfully sent alert email to {to_email}")
            return True

        except Exception as e:
            logger.error(f"Failed to send email to {to_email}: {e}")
            return False

    async def record_alert(
        self,
        deal_id: str,
        recipient_email: str,
        subject: str,
        body: str,
        status: str = 'sent',
        error_message: Optional[str] = None
    ) -> str:
        """Record an alert notification in the database. Returns alert_id."""
        conn = await asyncpg.connect(self.db_url)
        try:
            alert_id = await conn.fetchval(
                """INSERT INTO alert_notifications (
                    deal_id, alert_type, alert_channel,
                    recipient_email, alert_subject, alert_body,
                    status, sent_at, error_message
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING alert_id""",
                deal_id, 'deal_announcement', 'email',
                recipient_email, subject, body,
                status, datetime.now() if status == 'sent' else None, error_message
            )
            return str(alert_id)
        finally:
            await conn.close()

    async def send_deal_announcement_alert(self, deal: Dict[str, Any]) -> Dict[str, Any]:
        """
        Send deal announcement alert to all active recipients.
        Returns summary of alert results.
        """
        # Check if deal should be alerted
        if not await self.should_alert_deal(deal):
            return {
                "alerted": False,
                "reason": "Deal does not meet alert criteria",
                "recipients_count": 0
            }

        # Get active recipients
        recipients = await self.get_active_recipients()

        if not recipients:
            logger.warning("No active alert recipients configured")
            return {
                "alerted": False,
                "reason": "No active recipients configured",
                "recipients_count": 0
            }

        # Generate email content
        subject, html_body = self.generate_alert_email(deal)

        # Send to all recipients
        results = []
        for recipient in recipients:
            email = recipient['email']
            if not email:
                continue

            # Check recipient preferences
            if 'deal_announcement' not in recipient['alert_types']:
                logger.debug(f"Recipient {email} doesn't want deal_announcement alerts")
                continue

            if deal['deal_tier'] not in recipient['deal_tiers']:
                logger.debug(f"Recipient {email} doesn't want {deal['deal_tier']} deals")
                continue

            if deal['confidence_score'] < recipient['min_confidence_score']:
                logger.debug(f"Recipient {email} confidence threshold not met")
                continue

            # Send email
            success = await self.send_email(email, subject, html_body)

            # Record notification
            alert_id = await self.record_alert(
                deal['deal_id'],
                email,
                subject,
                html_body,
                status='sent' if success else 'failed',
                error_message=None if success else "SMTP send failed"
            )

            results.append({
                "recipient": email,
                "success": success,
                "alert_id": alert_id
            })

        successful_count = sum(1 for r in results if r['success'])

        return {
            "alerted": True,
            "recipients_count": len(results),
            "successful_count": successful_count,
            "failed_count": len(results) - successful_count,
            "results": results
        }


# Singleton instance
_alert_service = None

def get_alert_service() -> AlertService:
    """Get or create the alert service instance"""
    global _alert_service
    if _alert_service is None:
        db_url = os.getenv("DATABASE_URL")
        if not db_url:
            raise ValueError("DATABASE_URL environment variable not set")
        _alert_service = AlertService(db_url)
    return _alert_service
