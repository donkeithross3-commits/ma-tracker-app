"""M&A relevance detection using LLM and keyword analysis"""
import logging
import re
from typing import List, Optional
import httpx
from anthropic import Anthropic
from .models import EdgarFiling, MADetectionResult

logger = logging.getLogger(__name__)

# M&A keywords for quick filtering
MA_KEYWORDS = [
    # Deal terms
    "merger", "acquisition", "acquire", "acquirer", "takeover", "buyout",
    "tender offer", "going private", "transaction", "combination",

    # Agreement terms
    "merger agreement", "definitive agreement", "letter of intent",
    "purchase agreement", "stock purchase", "asset purchase",

    # Deal structure
    "cash and stock", "all cash", "all stock", "exchange ratio",
    "premium", "consideration", "per share",

    # Process terms
    "closing", "regulatory approval", "shareholder approval",
    "antitrust", "HSR", "termination fee", "break-up fee",

    # Tender offer specific
    "commencement", "tender", "offer to purchase", "proration",

    # Spin-off/divestitures
    "spin-off", "split-off", "divestiture", "separation"
]


class MADetector:
    """Detects M&A relevance in EDGAR filings"""

    def __init__(self, anthropic_api_key: str):
        self.anthropic = Anthropic(api_key=anthropic_api_key)
        # SEC requires User-Agent header with contact info
        headers = {
            "User-Agent": "M&A Tracker yourname@company.com",
            "Accept-Encoding": "gzip, deflate",
            "Host": "www.sec.gov"
        }
        self.client = httpx.AsyncClient(timeout=60.0, headers=headers)

    async def fetch_primary_document_url(self, index_url: str) -> str:
        """Parse index page to find the primary document URL"""
        try:
            response = await self.client.get(index_url)
            response.raise_for_status()

            # Parse HTML to find document links
            # Primary document is usually the first .htm or .txt file in the table
            html = response.text

            # Look for table rows with document links
            # Pattern: <a href="FILENAME.htm">FILENAME.htm</a>
            # Exclude index.htm and -index.htm files
            doc_pattern = r'<a href="([^"]+\.(?:htm|html|txt))"'
            all_matches = re.findall(doc_pattern, html, re.IGNORECASE)

            # Filter to keep only filing documents (exclude index files and navigation links)
            # Get the filing directory path (everything before the index filename)
            filing_dir = index_url.rsplit('/', 1)[0]

            matches = []
            for match in all_matches:
                filename = match.split('/')[-1].lower()  # Get just the filename

                # Skip index files
                if filename.endswith('index.htm') or filename.endswith('index.html'):
                    continue

                # Skip empty matches
                if not match or not filename:
                    continue

                # For absolute paths (starting with /), check if file is in the same directory as index
                if match.startswith('/'):
                    full_url = f"https://www.sec.gov{match}"
                    # Must be in the filing directory (not a parent dir, subdirectory, or navigation link)
                    # Extract directory from the match
                    match_dir = full_url.rsplit('/', 1)[0]
                    if match_dir != filing_dir:
                        continue
                else:
                    # Relative path - should be just a filename, not a path with directories
                    if '/' in match:
                        continue

                matches.append(match)

            if matches:
                # Get the first non-index document (primary document)
                primary_doc = matches[0]

                # If href is absolute path (starts with /), use SEC base domain
                if primary_doc.startswith('/'):
                    return f"https://www.sec.gov{primary_doc}"
                else:
                    # Relative path - append to base URL
                    base_url = index_url.rsplit('/', 1)[0]
                    return f"{base_url}/{primary_doc}"

            logger.warning(f"No primary document found in index: {index_url}")
            return index_url  # Fallback to index URL

        except Exception as e:
            logger.error(f"Failed to parse index page {index_url}: {e}")
            return index_url  # Fallback to index URL

    async def fetch_filing_text(self, filing_url: str, max_chars: int = 50000) -> str:
        """Fetch filing text from SEC EDGAR"""
        try:
            # If this is an index page, get the primary document URL
            if '-index.htm' in filing_url:
                filing_url = await self.fetch_primary_document_url(filing_url)
                logger.info(f"Resolved primary document: {filing_url}")

            response = await self.client.get(filing_url)
            response.raise_for_status()

            # Extract text from HTML (basic parsing)
            text = response.text
            # Remove HTML tags
            text = re.sub(r'<[^>]+>', ' ', text)
            # Remove extra whitespace
            text = re.sub(r'\s+', ' ', text)

            # Limit to first N characters for efficiency
            return text[:max_chars]
        except Exception as e:
            logger.error(f"Failed to fetch filing text from {filing_url}: {e}")
            return ""

    def keyword_scan(self, text: str) -> List[str]:
        """Quick keyword scan for M&A terms"""
        text_lower = text.lower()
        detected = []

        for keyword in MA_KEYWORDS:
            if keyword in text_lower:
                detected.append(keyword)

        return detected

    async def detect_ma_relevance(self, filing: EdgarFiling) -> MADetectionResult:
        """Detect if filing is M&A relevant using LLM + keywords"""

        # Fetch filing text
        filing_text = await self.fetch_filing_text(filing.filing_url)

        if not filing_text:
            return MADetectionResult(
                is_ma_relevant=False,
                confidence_score=0.0,
                detected_keywords=[],
                reasoning="Could not fetch filing text"
            )

        # Quick keyword scan
        detected_keywords = self.keyword_scan(filing_text)

        # If no keywords, likely not M&A relevant
        if len(detected_keywords) == 0:
            return MADetectionResult(
                is_ma_relevant=False,
                confidence_score=0.1,
                detected_keywords=[],
                reasoning="No M&A keywords detected"
            )

        # Use LLM for deeper analysis
        try:
            prompt = f"""Analyze this SEC filing to determine if it announces or relates to a merger or acquisition.

Filing Type: {filing.filing_type}
Company: {filing.company_name}
Date: {filing.filing_date}

Filing Text (first 50,000 chars):
{filing_text}

Determine:
1. Is this filing announcing a merger, acquisition, tender offer, or similar M&A transaction?
2. Confidence score (0.0 to 1.0)
3. Brief reasoning

Return JSON format:
{{
  "is_ma_relevant": true/false,
  "confidence_score": 0.0-1.0,
  "reasoning": "brief explanation"
}}
"""

            response = self.anthropic.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=500,
                messages=[{"role": "user", "content": prompt}]
            )

            # Parse LLM response
            response_text = response.content[0].text

            # Extract JSON from response
            import json
            json_match = re.search(r'\{[^}]+\}', response_text, re.DOTALL)
            if json_match:
                result_data = json.loads(json_match.group())

                return MADetectionResult(
                    is_ma_relevant=result_data.get("is_ma_relevant", False),
                    confidence_score=float(result_data.get("confidence_score", 0.5)),
                    detected_keywords=detected_keywords,
                    reasoning=result_data.get("reasoning", "LLM analysis")
                )
            else:
                # Fallback based on keywords
                return MADetectionResult(
                    is_ma_relevant=len(detected_keywords) >= 3,
                    confidence_score=0.6,
                    detected_keywords=detected_keywords,
                    reasoning=f"Keyword-based detection: {len(detected_keywords)} terms found"
                )

        except Exception as e:
            logger.error(f"LLM detection failed for {filing.accession_number}: {e}")

            # Fallback: use keyword count
            confidence = min(len(detected_keywords) * 0.15, 0.9)
            return MADetectionResult(
                is_ma_relevant=len(detected_keywords) >= 3,
                confidence_score=confidence,
                detected_keywords=detected_keywords,
                reasoning=f"Keyword-based (LLM unavailable): {len(detected_keywords)} terms"
            )

    async def close(self):
        """Clean up resources"""
        await self.client.aclose()
