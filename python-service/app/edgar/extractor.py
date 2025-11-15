"""Extract structured deal information from M&A filings using LLM"""
import logging
import re
import json
from typing import Optional
from anthropic import Anthropic
from .models import EdgarFiling, DealExtraction

logger = logging.getLogger(__name__)


class DealExtractor:
    """Extracts structured deal information from filings"""

    def __init__(self, anthropic_api_key: str):
        self.anthropic = Anthropic(api_key=anthropic_api_key)

    async def extract_deal_info(self, filing: EdgarFiling, filing_text: str) -> Optional[DealExtraction]:
        """Extract structured deal information using LLM"""

        try:
            prompt = f"""Extract structured information about the M&A deal from this SEC filing.

Filing Type: {filing.filing_type}
Company: {filing.company_name}
Date: {filing.filing_date}

Filing Text:
{filing_text[:30000]}

Extract the following information:
1. Target Company Name and Ticker (if mentioned)
2. Target Company Country (2-letter ISO code: US, DE, GB, etc. - look for incorporation location, headquarters, or nationality mentions)
3. Acquirer Company Name and Ticker (if mentioned)
4. Deal Value (in billions USD, if mentioned)
5. Deal Type (merger, acquisition, tender_offer, spin_off, etc.)
6. Key Terms (list important deal terms)
7. Brief Summary (2-3 sentences)
8. Confidence Score (0.0-1.0) on accuracy of extraction

IMPORTANT: We primarily track US-listed targets valued over $50M. Non-US companies should be noted for proper filtering.

Return ONLY valid JSON (no markdown, no extra text):
{{
  "target_name": "string",
  "target_ticker": "string or null",
  "target_country": "US|DE|GB|etc or null",
  "acquirer_name": "string or null",
  "acquirer_ticker": "string or null",
  "deal_value": number or null,
  "deal_type": "merger|acquisition|tender_offer|spin_off",
  "key_terms": ["term1", "term2"],
  "announcement_summary": "string",
  "confidence_score": 0.0-1.0
}}
"""

            response = self.anthropic.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=1000,
                messages=[{"role": "user", "content": prompt}]
            )

            response_text = response.content[0].text.strip()

            # Remove markdown code blocks if present
            response_text = re.sub(r'^```json\s*', '', response_text)
            response_text = re.sub(r'\s*```$', '', response_text)

            # Parse JSON
            data = json.loads(response_text)

            # Validate required fields
            if not data.get("target_name"):
                logger.warning(f"Missing target_name in extraction for {filing.accession_number}")
                return None

            # Get base confidence score
            base_confidence = float(data.get("confidence_score", 0.7))

            # Apply confidence penalty for non-US targets
            # System targets "US listed targets > $50M", so non-US companies get lower priority
            target_country = data.get("target_country", "US")
            adjusted_confidence = base_confidence

            if target_country and target_country != "US":
                # Apply 30% confidence penalty for foreign companies
                adjusted_confidence = base_confidence * 0.7
                logger.info(
                    f"Applied foreign target penalty: {filing.company_name} "
                    f"(country: {target_country}). Confidence: {base_confidence:.2%} → {adjusted_confidence:.2%}"
                )

            return DealExtraction(
                target_name=data["target_name"],
                target_ticker=data.get("target_ticker"),
                target_country=target_country,
                acquirer_name=data.get("acquirer_name"),
                acquirer_ticker=data.get("acquirer_ticker"),
                deal_value=float(data["deal_value"]) if data.get("deal_value") else None,
                deal_type=data.get("deal_type", "acquisition"),
                confidence_score=adjusted_confidence,
                key_terms=data.get("key_terms", []),
                announcement_summary=data.get("announcement_summary", "")
            )

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse LLM JSON response for {filing.accession_number}: {e}")
            logger.debug(f"Response was: {response_text[:500]}")
            return None
        except Exception as e:
            logger.error(f"Deal extraction failed for {filing.accession_number}: {e}")
            return None
