"""Multi-channel alert system for new M&A deals"""
import logging
import os
from typing import Optional
from datetime import datetime
import httpx
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail
from .models import AlertPayload

logger = logging.getLogger(__name__)


class AlertManager:
    """Manages multi-channel alerts for new M&A deals"""

    def __init__(
        self,
        sendgrid_api_key: Optional[str] = None,
        whatsapp_api_key: Optional[str] = None,
        whatsapp_phone_number: Optional[str] = None,
        alert_recipients: Optional[list] = None
    ):
        self.sendgrid_api_key = sendgrid_api_key or os.getenv("SENDGRID_API_KEY")
        self.whatsapp_api_key = whatsapp_api_key or os.getenv("WHATSAPP_API_KEY")
        self.whatsapp_phone_number = whatsapp_phone_number or os.getenv("WHATSAPP_PHONE_NUMBER")
        self.alert_recipients = alert_recipients or []

        self.sendgrid_client = None
        if self.sendgrid_api_key:
            self.sendgrid_client = SendGridAPIClient(self.sendgrid_api_key)

        self.http_client = httpx.AsyncClient(timeout=30.0)

    def format_deal_value(self, value: Optional[float]) -> str:
        """Format deal value for display"""
        if value is None:
            return "Not disclosed"
        return f"${value:.2f}B"

    def create_email_body(self, alert: AlertPayload) -> str:
        """Create HTML email body"""
        return f"""
        <html>
        <head>
            <style>
                body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
                .header {{ background-color: #2563eb; color: white; padding: 20px; }}
                .content {{ padding: 20px; }}
                .deal-info {{ background-color: #f3f4f6; padding: 15px; border-radius: 5px; margin: 15px 0; }}
                .label {{ font-weight: bold; color: #1f2937; }}
                .value {{ color: #4b5563; }}
                .footer {{ margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; }}
                .button {{ display: inline-block; background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin-top: 15px; }}
            </style>
        </head>
        <body>
            <div class="header">
                <h1>🚨 New M&A Deal Detected</h1>
            </div>
            <div class="content">
                <p>A new merger or acquisition has been announced and is awaiting your review.</p>

                <div class="deal-info">
                    <p><span class="label">Target Company:</span> <span class="value">{alert.target_name}</span></p>
                    {f'<p><span class="label">Acquirer:</span> <span class="value">{alert.acquirer_name}</span></p>' if alert.acquirer_name else ''}
                    <p><span class="label">Deal Value:</span> <span class="value">{self.format_deal_value(alert.deal_value)}</span></p>
                    <p><span class="label">Filing Type:</span> <span class="value">{alert.filing_type}</span></p>
                    <p><span class="label">Confidence:</span> <span class="value">{alert.confidence_score:.0%}</span></p>
                    <p><span class="label">Detected:</span> <span class="value">{alert.detected_at.strftime('%Y-%m-%d %H:%M:%S')} ET</span></p>
                </div>

                <p><strong>Next Steps:</strong></p>
                <ul>
                    <li>Review the staged deal in your M&A Tracker dashboard</li>
                    <li>Examine the AI-generated research analysis</li>
                    <li>Approve to add to production, or reject if not relevant</li>
                </ul>

                <a href="http://localhost:3000/staging/{alert.staged_deal_id}" class="button">Review Deal Now</a>

                <p style="margin-top: 20px;">
                    <a href="{alert.filing_url}" style="color: #2563eb;">View SEC Filing</a>
                </p>
            </div>
            <div class="footer">
                <p>This is an automated alert from your M&A Tracker system.</p>
                <p>Deal ID: {alert.staged_deal_id}</p>
            </div>
        </body>
        </html>
        """

    def create_whatsapp_message(self, alert: AlertPayload) -> str:
        """Create WhatsApp message text"""
        message = f"""🚨 *New M&A Deal Detected*

*Target:* {alert.target_name}
"""

        if alert.acquirer_name:
            message += f"*Acquirer:* {alert.acquirer_name}\n"

        message += f"""*Deal Value:* {self.format_deal_value(alert.deal_value)}
*Filing:* {alert.filing_type}
*Confidence:* {alert.confidence_score:.0%}

⏰ Detected: {alert.detected_at.strftime('%Y-%m-%d %I:%M %p')} ET

👉 Review at: http://localhost:3000/staging/{alert.staged_deal_id}

📄 SEC Filing: {alert.filing_url}
"""
        return message

    async def send_email_alert(self, alert: AlertPayload) -> bool:
        """Send email alert via SendGrid"""
        if not self.sendgrid_client or not self.alert_recipients:
            logger.warning("Email alert skipped: SendGrid not configured")
            return False

        try:
            subject = f"🚨 New M&A Deal: {alert.target_name}"
            if alert.acquirer_name:
                subject += f" ← {alert.acquirer_name}"

            html_content = self.create_email_body(alert)

            for recipient in self.alert_recipients:
                message = Mail(
                    from_email='alerts@ma-tracker.com',
                    to_emails=recipient,
                    subject=subject,
                    html_content=html_content
                )

                response = self.sendgrid_client.send(message)
                logger.info(f"Email alert sent to {recipient}: status={response.status_code}")

            return True

        except Exception as e:
            logger.error(f"Failed to send email alert: {e}")
            return False

    async def send_whatsapp_alert(self, alert: AlertPayload) -> bool:
        """Send WhatsApp alert via WhatsApp Business API"""
        if not self.whatsapp_api_key or not self.whatsapp_phone_number:
            logger.warning("WhatsApp alert skipped: WhatsApp not configured")
            return False

        try:
            message_text = self.create_whatsapp_message(alert)

            # WhatsApp Business API endpoint (adjust based on provider)
            # This is a generic example - adjust for your WhatsApp provider
            url = f"https://graph.facebook.com/v18.0/{self.whatsapp_phone_number}/messages"

            headers = {
                "Authorization": f"Bearer {self.whatsapp_api_key}",
                "Content-Type": "application/json"
            }

            for recipient in self.alert_recipients:
                payload = {
                    "messaging_product": "whatsapp",
                    "to": recipient,
                    "type": "text",
                    "text": {"body": message_text}
                }

                response = await self.http_client.post(url, json=payload, headers=headers)
                response.raise_for_status()

                logger.info(f"WhatsApp alert sent to {recipient}")

            return True

        except Exception as e:
            logger.error(f"Failed to send WhatsApp alert: {e}")
            return False

    async def send_all_alerts(self, alert: AlertPayload) -> dict:
        """Send alerts via all configured channels"""
        results = {
            "email": False,
            "whatsapp": False
        }

        # Send email alert
        try:
            results["email"] = await self.send_email_alert(alert)
        except Exception as e:
            logger.error(f"Email alert error: {e}")

        # Send WhatsApp alert
        try:
            results["whatsapp"] = await self.send_whatsapp_alert(alert)
        except Exception as e:
            logger.error(f"WhatsApp alert error: {e}")

        logger.info(f"Alerts sent for deal {alert.staged_deal_id}: {results}")
        return results

    async def close(self):
        """Clean up resources"""
        await self.http_client.aclose()
