"""Email Ingestion Service - Processes inbound emails for deal research and announcements"""
import os
import logging
import re
import uuid
import json
from typing import Dict, Any, Optional, List
from datetime import datetime
import asyncpg
from email import message_from_string
from email.utils import parseaddr
import base64

logger = logging.getLogger(__name__)


# Global instance (initialized on first use)
_email_ingestion_service = None


def get_email_ingestion_service() -> 'EmailIngestionService':
    """Get or create email ingestion service instance"""
    global _email_ingestion_service
    if _email_ingestion_service is None:
        db_url = os.getenv("DATABASE_URL")
        if not db_url:
            raise ValueError("DATABASE_URL environment variable not set")
        _email_ingestion_service = EmailIngestionService(db_url)
    return _email_ingestion_service


class EmailIngestionService:
    """Service to process inbound emails and extract deal information"""

    def __init__(self, db_url: str):
        self.db_url = db_url

        # Whitelist of trusted sender domains for auto-processing
        self.trusted_domains = [
            "yetanothervalueblog.com",
            "pitchbook.com",
            "bloomberg.com",
            "reuters.com",
            "wsj.com",
            "ft.com"
        ]

    def _is_trusted_sender(self, from_email: str) -> bool:
        """Check if sender is from a trusted domain"""
        domain = from_email.split('@')[-1].lower()
        return any(trusted in domain for trusted in self.trusted_domains)

    def _extract_ticker_from_subject(self, subject: str) -> Optional[str]:
        """
        Extract ticker symbol from email subject line.
        Common patterns:
        - "ACME ($ACME) - Deal Update"
        - "[ACME] Merger Update"
        - "ACME (Ticker: ACME) News"
        """
        # Pattern 1: ($TICKER)
        match = re.search(r'\(\$([A-Z]{1,5})\)', subject)
        if match:
            return match.group(1)

        # Pattern 2: [TICKER]
        match = re.search(r'\[([A-Z]{1,5})\]', subject)
        if match:
            return match.group(1)

        # Pattern 3: Ticker: TICKER
        match = re.search(r'Ticker:\s*([A-Z]{1,5})', subject, re.IGNORECASE)
        if match:
            return match.group(1)

        # Pattern 4: Standalone ticker at start
        match = re.search(r'^([A-Z]{1,5})\s+[-:]', subject)
        if match:
            return match.group(1)

        return None

    def _extract_company_name_from_subject(self, subject: str) -> Optional[str]:
        """Extract company name from subject line"""
        # Remove common prefixes
        subject = re.sub(r'^(Re:|Fwd:|FW:|RE:)\s*', '', subject, flags=re.IGNORECASE)

        # If there's a dash, the first part is often the company name
        if ' - ' in subject:
            return subject.split(' - ')[0].strip()

        # If there's a colon, similar pattern
        if ': ' in subject:
            parts = subject.split(': ')
            if len(parts[0]) < 50:  # Reasonable company name length
                return parts[0].strip()

        return None

    def _extract_deal_terms_from_text(self, text: str) -> Dict[str, Any]:
        """
        Extract deal terms from email body text.
        Looks for common patterns like deal values, dates, etc.
        """
        terms = {}

        # Deal value patterns
        value_patterns = [
            r'deal value[:\s]+\$?([0-9.]+)\s*(billion|million|B|M)',
            r'acquisition price[:\s]+\$?([0-9.]+)\s*(billion|million|B|M)',
            r'purchase price[:\s]+\$?([0-9.]+)\s*(billion|million|B|M)',
            r'\$([0-9.]+)\s*(billion|million|B|M)\s+deal'
        ]

        for pattern in value_patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                value = float(match.group(1))
                unit = match.group(2).upper()
                if unit.startswith('M'):
                    value = value / 1000  # Convert millions to billions
                terms['deal_value'] = value
                break

        # Date patterns
        date_patterns = [
            r'announced[:\s]+(\d{4}-\d{2}-\d{2})',
            r'expected close[:\s]+(\d{4}-\d{2}-\d{2})',
            r'closing date[:\s]+(\d{4}-\d{2}-\d{2})'
        ]

        for pattern in date_patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                if 'announced' in pattern:
                    terms['announced_date'] = match.group(1)
                elif 'close' in pattern:
                    terms['expected_close_date'] = match.group(1)

        # Deal type patterns
        if re.search(r'merger', text, re.IGNORECASE):
            terms['deal_type'] = 'merger'
        elif re.search(r'acquisition', text, re.IGNORECASE):
            terms['deal_type'] = 'acquisition'
        elif re.search(r'tender offer', text, re.IGNORECASE):
            terms['deal_type'] = 'tender_offer'

        return terms

    async def find_matching_deal(self, ticker: Optional[str], company_name: Optional[str]) -> Optional[str]:
        """
        Find an existing deal in deal_intelligence that matches the email.
        Returns deal_id if found.
        """
        if not ticker and not company_name:
            return None

        conn = await asyncpg.connect(self.db_url)
        try:
            # Try ticker match first (most reliable)
            if ticker:
                deal_id = await conn.fetchval(
                    """SELECT deal_id FROM deal_intelligence
                       WHERE target_ticker = $1
                       AND deal_status NOT IN ('completed', 'terminated')
                       ORDER BY first_detected_at DESC
                       LIMIT 1""",
                    ticker
                )
                if deal_id:
                    return str(deal_id)

            # Try company name match
            if company_name:
                deal_id = await conn.fetchval(
                    """SELECT deal_id FROM deal_intelligence
                       WHERE target_name ILIKE $1
                       AND deal_status NOT IN ('completed', 'terminated')
                       ORDER BY first_detected_at DESC
                       LIMIT 1""",
                    f"%{company_name}%"
                )
                if deal_id:
                    return str(deal_id)

            return None
        finally:
            await conn.close()

    async def create_deal_source_from_email(
        self,
        deal_id: str,
        from_email: str,
        subject: str,
        body_text: str,
        attachments: List[Dict[str, Any]]
    ) -> str:
        """Add email as a source for an existing deal"""
        conn = await asyncpg.connect(self.db_url)
        try:
            source_id = await conn.fetchval(
                """INSERT INTO deal_sources (
                    deal_id, source_name, source_url, headline, content_snippet, detected_at
                ) VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING source_id""",
                deal_id,
                f"Email from {from_email}",
                f"mailto:{from_email}",
                subject,
                body_text[:1000],  # First 1000 chars as snippet
                datetime.now()
            )

            # Update source count on deal
            await conn.execute(
                """UPDATE deal_intelligence
                   SET source_count = source_count + 1,
                       last_update_at = NOW()
                   WHERE deal_id = $1""",
                deal_id
            )

            logger.info(f"Added email as source for deal {deal_id}: {source_id}")
            return str(source_id)
        finally:
            await conn.close()

    async def create_staged_deal_from_email(
        self,
        from_email: str,
        subject: str,
        body_text: str,
        ticker: Optional[str],
        company_name: Optional[str],
        extracted_terms: Dict[str, Any]
    ) -> Optional[str]:
        """Create a new staged deal from email if no matching deal exists"""
        if not company_name and not ticker:
            logger.debug("Cannot create staged deal without company name or ticker")
            return None

        conn = await asyncpg.connect(self.db_url)
        try:
            # Use ticker lookup if we have company name but no ticker
            if company_name and not ticker:
                from app.services.ticker_lookup import get_ticker_lookup_service
                ticker_service = get_ticker_lookup_service()
                ticker = await ticker_service.lookup_ticker(company_name)

            # Generate unique source_filing_id for email
            timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
            source_filing_id = f"email-{from_email.replace('@', '-at-')}-{timestamp}"

            # Prepare source data for raw_extracted_data
            source_data = {
                "source_name": f"Email from {from_email}",
                "source_url": f"mailto:{from_email}",
                "headline": subject,
                "content_snippet": body_text[:500],
                "detected_at": datetime.now().isoformat(),
                "extracted_terms": extracted_terms
            }

            # Create staged deal with proper schema
            staged_deal_id = await conn.fetchval(
                """INSERT INTO staged_deals (
                    staged_deal_id,
                    target_name,
                    target_ticker,
                    deal_value,
                    deal_type,
                    source_filing_id,
                    source_filing_type,
                    detected_at,
                    confidence_score,
                    "extractionMethod",
                    raw_extracted_data,
                    status,
                    "researchStatus",
                    alert_sent,
                    created_at,
                    updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                RETURNING staged_deal_id""",
                str(uuid.uuid4()),  # staged_deal_id
                company_name or ticker,  # target_name
                ticker,  # target_ticker
                extracted_terms.get('deal_value'),  # deal_value
                extracted_terms.get('deal_type'),  # deal_type
                source_filing_id,  # source_filing_id
                'EMAIL',  # source_filing_type
                datetime.now(),  # detected_at
                0.60,  # confidence_score - medium-low for single email
                'email_webhook',  # extractionMethod
                json.dumps(source_data),  # raw_extracted_data (JSONB)
                'pending',  # status
                'pending',  # researchStatus
                False,  # alert_sent
                datetime.now(),  # created_at
                datetime.now()  # updated_at
            )

            logger.info(f"Created staged deal from email: {staged_deal_id}")
            return str(staged_deal_id)
        finally:
            await conn.close()

    async def process_inbound_email(
        self,
        from_email: str,
        from_name: Optional[str],
        subject: str,
        body_text: str,
        body_html: Optional[str] = None,
        attachments: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """
        Process an inbound email and extract deal information.
        Returns summary of processing results.
        """
        logger.info(f"Processing email from {from_email}: {subject}")

        attachments = attachments or []

        # Extract potential deal identifiers
        ticker = self._extract_ticker_from_subject(subject)
        company_name = self._extract_company_name_from_subject(subject)

        # Extract deal terms from body
        extracted_terms = self._extract_deal_terms_from_text(body_text)

        # Check if sender is trusted
        is_trusted = self._is_trusted_sender(from_email)

        # Try to find matching deal
        matching_deal_id = await self.find_matching_deal(ticker, company_name)

        result = {
            "processed_at": datetime.now().isoformat(),
            "from_email": from_email,
            "subject": subject,
            "ticker": ticker,
            "company_name": company_name,
            "is_trusted_sender": is_trusted,
            "extracted_terms": extracted_terms,
            "matching_deal_id": matching_deal_id,
            "action_taken": None
        }

        if matching_deal_id:
            # Add email as source for existing deal
            source_id = await self.create_deal_source_from_email(
                matching_deal_id,
                from_email,
                subject,
                body_text,
                attachments
            )
            result["action_taken"] = "added_source_to_existing_deal"
            result["source_id"] = source_id

        else:
            # Log for manual review
            # Note: We don't create staged deals from emails since they don't have EDGAR filings
            # Emails should ideally match existing deals or be manually reviewed
            result["action_taken"] = "logged_for_review"
            if is_trusted:
                logger.info(f"Email from trusted sender logged for review: no matching deal found")
            else:
                logger.info(f"Email logged for manual review: untrusted sender or no deal identifiers")

        return result


# Singleton instance
_email_ingestion_service = None

def get_email_ingestion_service() -> EmailIngestionService:
    """Get or create the email ingestion service instance"""
    global _email_ingestion_service
    if _email_ingestion_service is None:
        db_url = os.getenv("DATABASE_URL")
        if not db_url:
            raise ValueError("DATABASE_URL environment variable not set")
        _email_ingestion_service = EmailIngestionService(db_url)
    return _email_ingestion_service
