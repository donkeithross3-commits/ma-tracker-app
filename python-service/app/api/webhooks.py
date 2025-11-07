"""Webhook endpoints for external integrations"""
from fastapi import APIRouter, Request, HTTPException, Form, File, UploadFile
from typing import Optional, List
import logging
import base64
import json
from app.services.email_ingestion import get_email_ingestion_service
from app.services.gmail_push import get_gmail_push_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/webhooks", tags=["webhooks"])


@router.post("/email/inbound")
async def receive_inbound_email(
    request: Request,
    # SendGrid Inbound Parse sends these fields
    to: Optional[str] = Form(None),
    from_: str = Form(..., alias="from"),
    subject: str = Form(...),
    text: Optional[str] = Form(None),
    html: Optional[str] = Form(None),
    envelope: Optional[str] = Form(None),
    attachments: Optional[List[UploadFile]] = File(None)
):
    """
    Webhook endpoint for receiving inbound emails via SendGrid Inbound Parse
    or similar email forwarding services.

    SendGrid Inbound Parse configuration:
    1. Go to Settings > Inbound Parse in SendGrid
    2. Add your domain (e.g., deals@yourdomain.com)
    3. Set webhook URL: https://your-app.com/webhooks/email/inbound
    4. Enable spam check and post raw email options

    Also compatible with:
    - Mailgun Routes
    - Postmark Inbound
    - Amazon SES with SNS
    """
    try:
        logger.info(f"Received email webhook from {from_}: {subject}")

        # Extract sender name from "Name <email>" format
        from_name = None
        from_email = from_
        if '<' in from_:
            parts = from_.split('<')
            from_name = parts[0].strip().strip('"')
            from_email = parts[1].strip('>')

        # Get email body (prefer text, fallback to html)
        body_text = text or ""
        body_html = html

        # Process attachments
        attachment_list = []
        if attachments:
            for attachment in attachments:
                attachment_list.append({
                    "filename": attachment.filename,
                    "content_type": attachment.content_type,
                    "size": attachment.size
                })

        # Process the email
        ingestion_service = get_email_ingestion_service()
        result = await ingestion_service.process_inbound_email(
            from_email=from_email,
            from_name=from_name,
            subject=subject,
            body_text=body_text,
            body_html=body_html,
            attachments=attachment_list
        )

        return {
            "status": "success",
            "message": "Email processed successfully",
            "result": result
        }

    except Exception as e:
        logger.error(f"Failed to process inbound email: {e}", exc_info=True)
        # Return 200 to prevent email service from retrying
        # Log the error for manual review
        return {
            "status": "error",
            "message": str(e),
            "note": "Email logged for manual review"
        }


@router.post("/email/sendgrid")
async def receive_sendgrid_webhook(request: Request):
    """
    Alternative endpoint specifically for SendGrid's webhook format.
    Handles both form-encoded and JSON payloads.
    """
    content_type = request.headers.get("content-type", "")

    if "application/json" in content_type:
        # JSON payload (from SendGrid Event Webhook)
        data = await request.json()
        logger.info(f"Received SendGrid JSON webhook: {data}")
        return {"status": "received"}

    elif "multipart/form-data" in content_type or "application/x-www-form-urlencoded" in content_type:
        # Form data (from SendGrid Inbound Parse)
        # Delegate to main endpoint
        form = await request.form()
        return await receive_inbound_email(
            request=request,
            to=form.get("to"),
            from_=form.get("from"),
            subject=form.get("subject"),
            text=form.get("text"),
            html=form.get("html"),
            envelope=form.get("envelope"),
            attachments=None  # Handle separately if needed
        )

    else:
        raise HTTPException(status_code=400, detail="Unsupported content type")


@router.post("/email/gmail-push")
async def receive_gmail_push(request: Request):
    """
    Gmail Push Notifications endpoint - receives instant notifications from Google Cloud Pub/Sub
    when new emails arrive in Gmail inbox.

    This endpoint receives Pub/Sub messages with format:
    {
        "message": {
            "data": "<base64-encoded-json>",
            "messageId": "...",
            "publishTime": "..."
        },
        "subscription": "..."
    }

    The decoded data contains:
    {
        "emailAddress": "user@gmail.com",
        "historyId": "123456"
    }

    Setup:
    1. Create Google Cloud project
    2. Enable Gmail API
    3. Create Pub/Sub topic
    4. Set up push subscription to this endpoint
    5. Run setup script to start Gmail watch
    """
    try:
        body = await request.json()
        logger.info(f"Received Gmail push notification: {body}")

        # Extract Pub/Sub message
        if 'message' not in body:
            logger.warning("No message in Pub/Sub payload")
            return {"status": "no_message"}

        message = body['message']

        # Decode base64 data
        if 'data' not in message:
            logger.warning("No data in Pub/Sub message")
            return {"status": "no_data"}

        data_bytes = base64.b64decode(message['data'])
        data = json.loads(data_bytes)

        logger.info(f"Decoded Gmail notification data: {data}")

        # Process the notification
        gmail_push_service = get_gmail_push_service()
        await gmail_push_service.process_notification(data)

        return {"status": "success", "message": "Gmail notification processed"}

    except Exception as e:
        logger.error(f"Failed to process Gmail push notification: {e}", exc_info=True)
        # Return 200 to prevent Pub/Sub from retrying
        return {"status": "error", "message": str(e)}


@router.get("/email/test")
async def test_email_webhook():
    """Test endpoint to verify webhook is accessible"""
    return {
        "status": "ok",
        "message": "Email webhook endpoint is active",
        "endpoints": [
            "POST /webhooks/email/inbound - Main inbound email handler",
            "POST /webhooks/email/sendgrid - SendGrid specific handler",
            "POST /webhooks/email/gmail-push - Gmail Push Notifications (instant)",
            "GET /webhooks/email/test - This test endpoint"
        ]
    }
