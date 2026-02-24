"""Unified messaging service for email (SendGrid) and WhatsApp (Meta Business API)"""
import logging
import os
from typing import Any, Dict, List, Optional

import httpx
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail

from .message_templates import (
    filing_alert_email,
    morning_report_email,
    risk_change_alert,
    spread_alert_whatsapp,
)

logger = logging.getLogger(__name__)


class MessagingService:
    """General-purpose messaging service supporting email and WhatsApp channels."""

    def __init__(
        self,
        sendgrid_api_key: Optional[str] = None,
        sendgrid_from_email: Optional[str] = None,
        whatsapp_api_key: Optional[str] = None,
        whatsapp_phone_number: Optional[str] = None,
        email_recipients: Optional[List[str]] = None,
        whatsapp_recipients: Optional[List[str]] = None,
    ):
        self.sendgrid_api_key = sendgrid_api_key or os.getenv("SENDGRID_API_KEY")
        self.sendgrid_from_email = sendgrid_from_email or os.getenv("SENDGRID_FROM_EMAIL", "alerts@ma-tracker.com")
        self.whatsapp_api_key = whatsapp_api_key or os.getenv("WHATSAPP_API_KEY")
        self.whatsapp_phone_number = whatsapp_phone_number or os.getenv("WHATSAPP_PHONE_NUMBER")

        self.email_recipients = email_recipients or _parse_csv_env("ALERT_EMAIL_RECIPIENTS")
        self.whatsapp_recipients = whatsapp_recipients or _parse_csv_env("ALERT_WHATSAPP_RECIPIENTS")

        self.sendgrid_client: Optional[SendGridAPIClient] = None
        if self.sendgrid_api_key:
            self.sendgrid_client = SendGridAPIClient(self.sendgrid_api_key)

        self.http_client = httpx.AsyncClient(timeout=30.0)

    # ------------------------------------------------------------------
    # Low-level channel methods
    # ------------------------------------------------------------------

    async def send_email(
        self,
        to: str,
        subject: str,
        html_body: str,
        text_body: Optional[str] = None,
        from_email: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Send a single email via SendGrid.

        Returns:
            dict with keys: success (bool), message_id (str|None), error (str|None)
        """
        if not self.sendgrid_client:
            logger.warning("Email skipped: SendGrid not configured")
            return {"success": False, "message_id": None, "error": "SendGrid not configured"}

        try:
            message = Mail(
                from_email=from_email or self.sendgrid_from_email,
                to_emails=to,
                subject=subject,
                html_content=html_body,
            )
            if text_body:
                message.plain_text_content = text_body

            response = self.sendgrid_client.send(message)
            message_id = response.headers.get("X-Message-Id")
            logger.info(f"Email sent to {to}: status={response.status_code} id={message_id}")
            return {"success": True, "message_id": message_id, "error": None}

        except Exception as e:
            logger.error(f"Failed to send email to {to}: {e}")
            return {"success": False, "message_id": None, "error": str(e)}

    async def send_whatsapp(
        self,
        to: str,
        message: str,
        template: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Send a WhatsApp message via Meta Business API.

        Args:
            to: Recipient phone number (E.164 format).
            message: Message body text.
            template: Optional template name (for template messages).

        Returns:
            dict with keys: success (bool), error (str|None)
        """
        if not self.whatsapp_api_key or not self.whatsapp_phone_number:
            logger.warning("WhatsApp skipped: not configured")
            return {"success": False, "error": "WhatsApp not configured"}

        try:
            url = f"https://graph.facebook.com/v18.0/{self.whatsapp_phone_number}/messages"
            headers = {
                "Authorization": f"Bearer {self.whatsapp_api_key}",
                "Content-Type": "application/json",
            }

            if template:
                payload = {
                    "messaging_product": "whatsapp",
                    "to": to,
                    "type": "template",
                    "template": {"name": template, "language": {"code": "en_US"}},
                }
            else:
                payload = {
                    "messaging_product": "whatsapp",
                    "to": to,
                    "type": "text",
                    "text": {"body": message},
                }

            response = await self.http_client.post(url, json=payload, headers=headers)
            response.raise_for_status()
            logger.info(f"WhatsApp message sent to {to}")
            return {"success": True, "error": None}

        except Exception as e:
            logger.error(f"Failed to send WhatsApp to {to}: {e}")
            return {"success": False, "error": str(e)}

    # ------------------------------------------------------------------
    # High-level alert methods
    # ------------------------------------------------------------------

    async def send_morning_report(
        self,
        report_data: Dict[str, Any],
        channels: Optional[List[str]] = None,
        *,
        html_body: Optional[str] = None,
        whatsapp_summary: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Format and send the daily morning report.

        Args:
            report_data: Must contain keys ``deals``, ``changes``, ``alerts``.
            channels: List of channels to use (``"email"``, ``"whatsapp"``).
                      Defaults to ``["email"]``.
            html_body: Pre-formatted HTML body. When provided, bypasses template
                       formatting and uses this directly.
            whatsapp_summary: Pre-formatted WhatsApp text. When provided, bypasses
                              the default text builder.

        Returns:
            dict mapping channel names to lists of per-recipient results.
        """
        channels = channels or ["email"]
        results: Dict[str, list] = {}

        deals = report_data.get("deals", [])
        changes = report_data.get("changes", [])
        alerts = report_data.get("alerts", [])

        if "email" in channels:
            if html_body:
                html = html_body
                subject = report_data.get("subject_line", f"M&A Morning Report - {len(deals)} Active Deal(s)")
            else:
                html = morning_report_email(deals, changes, alerts)
                subject = f"M&A Morning Report - {len(deals)} Active Deal(s)"
            results["email"] = await self._send_to_email_recipients(subject, html)

        if "whatsapp" in channels:
            if whatsapp_summary:
                text = whatsapp_summary
            else:
                # Build a concise text summary for WhatsApp
                lines = ["\U0001f4ca *M&A Morning Report*", ""]
                for d in deals:
                    ticker = d.get("ticker", "???")
                    spread = d.get("spread")
                    spread_str = f"{spread:+.2f}%" if spread is not None else "N/A"
                    lines.append(f"*{ticker}* spread: {spread_str}")
                if changes:
                    lines.append("")
                    lines.append(f"\U0001f504 {len(changes)} overnight change(s)")
                if alerts:
                    lines.append(f"\u26a0\ufe0f {len(alerts)} risk flag(s)")
                text = "\n".join(lines)
            results["whatsapp"] = await self._send_to_whatsapp_recipients(text)

        return results

    async def send_spread_alert(
        self,
        ticker: str,
        alert_type: str,
        details: Dict[str, Any],
        channels: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Format and send a spread change alert.

        Args:
            ticker: The deal ticker symbol.
            alert_type: E.g. ``"spread_widened"`` or ``"spread_tightened"``.
            details: Must contain ``old_spread``, ``new_spread``, ``pct_change``.
            channels: Defaults to ``["whatsapp"]``.

        Returns:
            dict mapping channel names to lists of per-recipient results.
        """
        channels = channels or ["whatsapp"]
        results: Dict[str, list] = {}

        old_spread = details.get("old_spread", 0.0)
        new_spread = details.get("new_spread", 0.0)
        pct_change = details.get("pct_change", 0.0)
        severity = details.get("severity", "")
        risk_context = details.get("risk_context", "")

        if "whatsapp" in channels:
            text = spread_alert_whatsapp(ticker, old_spread, new_spread, pct_change)
            # Append severity and risk context if present
            if severity and severity != "info":
                text += f"\n*Severity:* {severity.upper()}"
            if risk_context:
                text += f"\n*Risk:* {risk_context}"
            results["whatsapp"] = await self._send_to_whatsapp_recipients(text)

        if "email" in channels:
            direction = "Widened" if new_spread > old_spread else "Tightened"
            severity_tag = f" [{severity.upper()}]" if severity and severity != "info" else ""
            subject = f"Spread {direction}: {ticker} ({pct_change:+.1f}%){severity_tag}"
            # Simple HTML wrapper for the text alert
            base_text = spread_alert_whatsapp(ticker, old_spread, new_spread, pct_change)
            if risk_context:
                base_text += f"\n\n*Risk Context:* {risk_context}"
            html = _text_to_html(base_text, subject)
            results["email"] = await self._send_to_email_recipients(subject, html)

        return results

    async def send_filing_alert(
        self,
        filing: Dict[str, Any],
        deal: Dict[str, Any],
        channels: Optional[List[str]] = None,
        impact_summary: Optional[str] = None,
        impact_level: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Format and send a new SEC filing alert.

        Args:
            filing: Filing data dict.
            deal: Associated deal data dict.
            channels: Defaults to ``["email"]``.
            impact_summary: AI-generated one-line impact summary.
            impact_level: Impact severity (none/low/moderate/high/critical).

        Returns:
            dict mapping channel names to lists of per-recipient results.
        """
        channels = channels or ["email"]
        results: Dict[str, list] = {}

        if "email" in channels:
            html = filing_alert_email(filing, deal)
            filing_type = filing.get("filing_type", "Filing")
            ticker = deal.get("ticker", "")
            target = deal.get("target_name", ticker)
            impact_tag = f" [{impact_level.upper()}]" if impact_level and impact_level not in ("none", "low") else ""
            subject = f"New {filing_type} Filing: {target}{impact_tag}"
            # Append AI impact summary to the email if available
            if impact_summary:
                impact_block = (
                    f'<div style="margin-top:16px;padding:12px;background-color:#fef3c7;border-left:4px solid #f59e0b;border-radius:6px;">'
                    f'<strong>AI Impact Assessment ({impact_level or "unknown"}):</strong> {impact_summary}'
                    f'</div>'
                )
                html = html.replace("</div>\n</body>", f"{impact_block}</div>\n</body>", 1)
            results["email"] = await self._send_to_email_recipients(subject, html)

        if "whatsapp" in channels:
            filing_type = filing.get("filing_type", "Filing")
            target = deal.get("target_name", "Unknown")
            ticker = deal.get("ticker", "")
            text = (
                f"\U0001f4c4 *New SEC Filing: {filing_type}*\n"
                f"\n"
                f"*Target:* {target} ({ticker})\n"
                f"*Company:* {filing.get('company_name', 'N/A')}\n"
                f"*Filed:* {filing.get('filing_date', 'N/A')}\n"
            )
            if impact_summary:
                level_emoji = {
                    "critical": "\U0001f534",
                    "high": "\U0001f7e0",
                    "moderate": "\U0001f7e1",
                }.get(impact_level or "", "\U0001f7e2")
                text += f"\n{level_emoji} *AI Impact:* {impact_summary}\n"
            text += f"\n\U0001f449 {filing.get('filing_url', '')}"
            results["whatsapp"] = await self._send_to_whatsapp_recipients(text)

        return results

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _send_to_email_recipients(
        self, subject: str, html_body: str
    ) -> List[Dict[str, Any]]:
        """Send an email to all configured email recipients."""
        results = []
        for recipient in self.email_recipients:
            result = await self.send_email(recipient, subject, html_body)
            result["recipient"] = recipient
            results.append(result)
        return results

    async def _send_to_whatsapp_recipients(
        self, text: str
    ) -> List[Dict[str, Any]]:
        """Send a WhatsApp message to all configured WhatsApp recipients."""
        results = []
        for recipient in self.whatsapp_recipients:
            result = await self.send_whatsapp(recipient, text)
            result["recipient"] = recipient
            results.append(result)
        return results

    async def close(self):
        """Clean up resources."""
        await self.http_client.aclose()


# ------------------------------------------------------------------
# Module-level helpers
# ------------------------------------------------------------------

def _parse_csv_env(env_var: str) -> List[str]:
    """Parse a comma-separated environment variable into a list of stripped strings."""
    raw = os.getenv(env_var, "")
    if not raw:
        return []
    return [item.strip() for item in raw.split(",") if item.strip()]


def _text_to_html(text: str, title: str = "") -> str:
    """Wrap plain text in a minimal HTML email body."""
    # Strip WhatsApp bold markers for HTML
    clean = text.replace("*", "")
    lines = clean.split("\n")
    body_lines = "".join(f"<p style='margin:4px 0;'>{line}</p>" if line.strip() else "<br>" for line in lines)
    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;color:#1f2937;background-color:#f9fafb;">
    <div style="max-width:600px;margin:0 auto;padding:20px;">
        <h2 style="color:#1e3a5f;">{title}</h2>
        {body_lines}
        <hr style="border:none;border-top:1px solid #e5e7eb;margin-top:24px;">
        <p style="font-size:12px;color:#6b7280;">Automated alert from M&A Tracker.</p>
    </div>
</body>
</html>"""


# ------------------------------------------------------------------
# Singleton accessor
# ------------------------------------------------------------------

_messaging_service: Optional[MessagingService] = None


def get_messaging_service() -> MessagingService:
    """Get or create the singleton MessagingService instance."""
    global _messaging_service
    if _messaging_service is None:
        _messaging_service = MessagingService()
    return _messaging_service
