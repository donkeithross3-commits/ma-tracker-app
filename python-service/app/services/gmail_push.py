"""Gmail Push Notifications - Real-time email processing using Cloud Pub/Sub"""
import os
import logging
import base64
import json
from typing import Dict, Any
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
import asyncpg

logger = logging.getLogger(__name__)

# Gmail API scopes
SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']

# Global service instance
_gmail_push_service = None


def get_gmail_push_service() -> 'GmailPushService':
    """Get or create Gmail push service instance"""
    global _gmail_push_service
    if _gmail_push_service is None:
        db_url = os.getenv("DATABASE_URL")
        if not db_url:
            raise ValueError("DATABASE_URL environment variable not set")
        _gmail_push_service = GmailPushService(db_url)
    return _gmail_push_service


class GmailPushService:
    """Service to handle Gmail push notifications and fetch emails in real-time"""

    def __init__(self, db_url: str):
        self.db_url = db_url
        self.credentials = None
        self.gmail_service = None

        # Trusted sender domains
        self.trusted_domains = [
            "yetanothervalueblog.com",
            "pitchbook.com",
            "bloomberg.com",
            "reuters.com",
            "wsj.com",
            "ft.com"
        ]

    def _get_credentials(self):
        """Get or refresh Gmail API credentials"""
        creds = None
        token_path = '/Users/donaldross/ma-tracker-app/python-service/token.json'
        credentials_path = '/Users/donaldross/ma-tracker-app/python-service/credentials.json'

        # Try to load existing token
        if os.path.exists(token_path):
            creds = Credentials.from_authorized_user_file(token_path, SCOPES)

        # If no valid credentials, get new ones
        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
            else:
                if not os.path.exists(credentials_path):
                    raise FileNotFoundError(
                        f"credentials.json not found at {credentials_path}. "
                        "Download it from Google Cloud Console."
                    )
                flow = InstalledAppFlow.from_client_secrets_file(
                    credentials_path, SCOPES)
                creds = flow.run_local_server(port=0)

            # Save credentials for next run
            with open(token_path, 'w') as token:
                token.write(creds.to_json())

        return creds

    def _get_gmail_service(self):
        """Get or create Gmail API service"""
        if not self.gmail_service:
            creds = self._get_credentials()
            self.gmail_service = build('gmail', 'v1', credentials=creds)
        return self.gmail_service

    def setup_watch(self, topic_name: str):
        """
        Set up Gmail watch on inbox to receive push notifications.

        Args:
            topic_name: Full Pub/Sub topic name like
                       'projects/PROJECT_ID/topics/gmail-push'

        Returns:
            Watch response with historyId and expiration
        """
        try:
            service = self._get_gmail_service()

            # Set up watch request
            request = {
                'labelIds': ['INBOX'],
                'topicName': topic_name
            }

            # Call Gmail API to start watching
            result = service.users().watch(userId='me', body=request).execute()

            logger.info(f"Gmail watch set up successfully: {result}")
            return result

        except HttpError as error:
            logger.error(f"Failed to set up Gmail watch: {error}")
            raise

    def stop_watch(self):
        """Stop Gmail watch"""
        try:
            service = self._get_gmail_service()
            service.users().stop(userId='me').execute()
            logger.info("Gmail watch stopped successfully")
        except HttpError as error:
            logger.error(f"Failed to stop Gmail watch: {error}")
            raise

    async def fetch_message(self, message_id: str) -> Dict[str, Any]:
        """
        Fetch a specific message from Gmail by message ID.

        Returns:
            Dict with email data (from, subject, body)
        """
        try:
            service = self._get_gmail_service()

            # Fetch message
            message = service.users().messages().get(
                userId='me',
                id=message_id,
                format='full'
            ).execute()

            # Extract headers
            headers = message['payload']['headers']
            from_email = next((h['value'] for h in headers if h['name'] == 'From'), '')
            subject = next((h['value'] for h in headers if h['name'] == 'Subject'), '')

            # Extract body
            body = self._get_message_body(message['payload'])

            return {
                'message_id': message_id,
                'from': from_email,
                'subject': subject,
                'body': body
            }

        except HttpError as error:
            logger.error(f"Failed to fetch message {message_id}: {error}")
            raise

    def _get_message_body(self, payload):
        """Extract email body from message payload"""
        body = ''

        if 'parts' in payload:
            for part in payload['parts']:
                if part['mimeType'] == 'text/plain':
                    if 'data' in part['body']:
                        body = base64.urlsafe_b64decode(part['body']['data']).decode('utf-8')
                        break
                elif 'parts' in part:
                    # Recursively search for text/plain in nested parts
                    body = self._get_message_body(part)
                    if body:
                        break
        elif 'body' in payload and 'data' in payload['body']:
            body = base64.urlsafe_b64decode(payload['body']['data']).decode('utf-8')

        return body

    def _is_trusted_sender(self, from_email: str) -> bool:
        """Check if sender is from a trusted domain"""
        domain = from_email.split('@')[-1].lower()
        # Extract domain from "Name <email@domain.com>" format
        if '>' in domain:
            domain = domain.split('>')[0]
        return any(trusted in domain for trusted in self.trusted_domains)

    async def process_notification(self, notification_data: Dict[str, Any]):
        """
        Process a Pub/Sub notification about new email.

        Args:
            notification_data: Decoded Pub/Sub message data containing emailAddress and historyId
        """
        try:
            email_address = notification_data.get('emailAddress')
            history_id = notification_data.get('historyId')

            logger.info(f"Processing Gmail notification for {email_address}, history ID: {history_id}")

            # Get history since last check
            service = self._get_gmail_service()

            # Fetch history to get new message IDs
            history = service.users().history().list(
                userId='me',
                startHistoryId=history_id,
                historyTypes=['messageAdded'],
                labelId='INBOX'
            ).execute()

            if 'history' not in history:
                logger.info("No new messages in history")
                return

            # Process each new message
            for history_record in history['history']:
                if 'messagesAdded' in history_record:
                    for msg_added in history_record['messagesAdded']:
                        message_id = msg_added['message']['id']

                        # Fetch full message
                        email_data = await self.fetch_message(message_id)

                        # Check if from trusted sender
                        if not self._is_trusted_sender(email_data['from']):
                            logger.info(f"Skipping email from untrusted sender: {email_data['from']}")
                            continue

                        logger.info(f"Processing email: {email_data['subject']} from {email_data['from']}")

                        # Process email with existing ingestion service
                        from app.services.email_ingestion import get_email_ingestion_service
                        ingestion_service = get_email_ingestion_service()

                        result = await ingestion_service.process_inbound_email(
                            from_email=email_data['from'],
                            from_name=None,
                            subject=email_data['subject'],
                            body_text=email_data['body']
                        )

                        logger.info(f"Email processing result: {result}")

        except Exception as e:
            logger.error(f"Error processing Gmail notification: {e}", exc_info=True)
            raise
