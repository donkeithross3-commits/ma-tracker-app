"""M&A relevance detection using LLM and keyword analysis"""
import logging
import re
from typing import List, Optional, Tuple
import httpx
from anthropic import Anthropic
from .models import EdgarFiling, MADetectionResult
from app.services.ticker_lookup import get_ticker_lookup_service

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

# Historical reference keywords indicating previously announced deals
HISTORICAL_REFERENCE_KEYWORDS = [
    # Direct references to prior announcements
    "previously announced",
    "as previously disclosed",
    "as previously reported",
    "previously entered into",
    "previously filed",
    "as disclosed in",
    "as announced on",
    "as announced in",
    "announcement dated",

    # Amendments and supplements (always retrospective)
    "amendment to",
    "amendment no.",
    "first amendment",
    "second amendment",
    "third amendment",
    "fourth amendment",
    "fifth amendment",
    "supplement to",
    "supplemental to",

    # References to original agreements
    "original business combination agreement",
    "original merger agreement",
    "original agreement",
    "the merger agreement dated",
    "agreement dated as of",
    "entered into on",

    # Proposed deals (definite article = already mentioned)
    # NOTE: Removed "the proposed transaction" - appears in forward-looking risk disclosures
    # for NEW deals, causing false positives. Keep more specific variants.
    "the proposed acquisition of",  # More specific - less likely in risk disclosures
    "the proposed merger with",     # More specific
    "the pending merger with",
    "the pending acquisition of",

    # Shareholder votes and proxies (happen after announcement)
    "special meeting of stockholders",
    "special meeting of shareholders",
    "vote on the merger",
    "vote on the acquisition",
    "recommend that stockholders vote",
    "recommend that shareholders vote",
    "soliciting proxies",
    "proxy statement",
    "definitive proxy",
    "preliminary proxy",

    # Regulatory updates (happen after announcement)
    "HSR clearance",
    "antitrust clearance",
    "regulatory approval received",
    "regulatory approval obtained",
    "satisfaction of conditions",
    # NOTE: Removed "closing conditions" - appears in both new announcements and updates
    # causing false positives. Too generic.

    # Quarterly earnings mentions (retrospective)
    "as previously discussed",
    "as we announced",
    "commenting on",
    "comment on",
    "in connection with the previously announced",

    # Completion/closing language (deal already done - PAST TENSE ONLY)
    # NOTE: Removed generic "completion of the merger", "closing of the merger", etc.
    # because they appear in forward-looking statements about NEW deals
    # (e.g., "closing of the merger is expected to occur by...")
    # Only keep past-tense verbs that clearly indicate historical events:
    "merger has been completed",
    "merger was completed",
    "acquisition has been completed",
    "acquisition was completed",
    "transaction has been completed",
    "transaction was completed",
    "merger has closed",
    "merger was closed",
    "acquisition has closed",
    "acquisition was closed",
]

# Non-US company indicators - these companies should be filtered out
NON_US_COMPANY_KEYWORDS = [
    "a german", "german company", "german developer", "german based", "based in germany",
    "a european", "european company", "european based", "based in europe",
    "a uk", "uk-based", "uk based", "british company", "based in uk", "based in the uk",
    "a french", "french company", "french based", "based in france",
    "a chinese", "chinese company", "chinese based", "based in china",
    "a japanese", "japanese company", "japanese based", "based in japan",
    "a korean", "korean company", "korean based", "based in korea", "south korean",
    "an israeli", "israeli company", "israeli based", "based in israel",
    "a swiss", "swiss company", "swiss based", "based in switzerland",
    "dutch company", "netherlands based", "based in the netherlands", "based in netherlands",
    "a canadian", "canadian company", "canadian based", "based in canada",
    "an indian", "indian company", "indian based", "based in india",
    "an australian", "australian company", "australian based", "based in australia",
    "privately held", "private company", "private entity",  # Often non-US or non-public
]

# Graphic/social media filing indicators - retrospective communications
RETROSPECTIVE_COMMUNICATION_KEYWORDS = [
    "graphic",
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".pdf",
    "image file",
    "social media",
    "investor presentation",
    "infographic",
    "twitter",
    "linkedin",
    "facebook",
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
                # For 8-K filings, prefer the document with "_8k" in the name
                # Prefer .htm/.html over .txt (HTML is formatted better for parsing)
                primary_doc = None

                # First try: Find _8k.htm document
                for match in matches:
                    if '_8k' in match.lower() and match.lower().endswith(('.htm', '.html')):
                        primary_doc = match
                        break

                # Second try: Find _8k document (any format)
                if not primary_doc:
                    for match in matches:
                        if '_8k' in match.lower():
                            primary_doc = match
                            break

                # Third try: Find non-exhibit .htm/.html document
                if not primary_doc:
                    for match in matches:
                        if '_ex' not in match.lower() and match.lower().endswith(('.htm', '.html')):
                            primary_doc = match
                            break

                # Fourth try: Find non-exhibit document (any format)
                if not primary_doc:
                    for match in matches:
                        if '_ex' not in match.lower():
                            primary_doc = match
                            break

                # Fallback: Just use first match
                if not primary_doc:
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

    def extract_matched_text_excerpt(self, text: str, detected_keywords: List[str], max_length: int = 500) -> Optional[str]:
        """Extract a text excerpt showing where M&A keywords were found

        Args:
            text: Full filing text
            detected_keywords: List of keywords that were detected
            max_length: Maximum length of excerpt to return

        Returns:
            Text excerpt showing context around first matched keyword, or None if no keywords
        """
        if not detected_keywords or not text:
            return None

        # Metadata patterns to avoid (filing headers, SGML, etc.)
        metadata_patterns = [
            r'ACCESSION NUMBER:',
            r'CONFORMED SUBMISSION TYPE:',
            r'PUBLIC DOCUMENT COUNT:',
            r'CONFORMED PERIOD OF REPORT:',
            r'FILED AS OF DATE:',
            r'DATE AS OF CHANGE:',
            r'FILER:',
            r'COMPANY DATA:',
            r'COMPANY CONFORMED NAME:',
            r'CENTRAL INDEX KEY:',
            r'STANDARD INDUSTRIAL CLASSIFICATION:',
            r'IRS EMPLOYER IDENTIFICATION',
            r'STATE OF INCORPORATION:',
            r'FISCAL YEAR END:',
            r'FILING VALUES:',
            r'FORM TYPE:',
            r'SEC ACT:',
            r'SEC FILE NUMBER:',
            r'FILM NUMBER:',
            r'\d{10,}\.txt',  # Numeric filenames
            r'\d{4}-\d{2}-\d{2}\.sgml',  # SGML files
        ]

        # Find all occurrences of keywords, scoring by context quality
        text_lower = text.lower()
        candidates = []

        for keyword in detected_keywords:
            pos = 0
            while True:
                pos = text_lower.find(keyword.lower(), pos)
                if pos == -1:
                    break

                # Check if this position is in metadata (skip if so)
                context_start = max(0, pos - 200)
                context_end = min(len(text), pos + 200)
                context = text[context_start:context_end]

                # Score this match - penalize if near metadata
                in_metadata = any(re.search(pattern, context, re.IGNORECASE) for pattern in metadata_patterns)

                if not in_metadata:
                    # Calculate a quality score: prefer matches with more keywords nearby
                    nearby_keyword_count = sum(1 for kw in detected_keywords if kw.lower() in context.lower())
                    candidates.append({
                        'pos': pos,
                        'keyword': keyword,
                        'quality_score': nearby_keyword_count,
                        'in_metadata': in_metadata
                    })

                pos += 1

        # If all candidates are in metadata, fall back to best one anyway
        if not candidates:
            return None

        # Sort by quality score (descending), then by position (ascending)
        candidates.sort(key=lambda x: (-x['quality_score'], x['pos']))
        best_match = candidates[0]

        first_match_pos = best_match['pos']
        first_keyword = best_match['keyword']

        # Calculate excerpt boundaries (centered around the keyword)
        keyword_len = len(first_keyword)
        context_before = max_length // 2
        context_after = max_length // 2

        start = max(0, first_match_pos - context_before)
        end = min(len(text), first_match_pos + keyword_len + context_after)

        excerpt = text[start:end].strip()

        # Clean up common HTML entities
        excerpt = excerpt.replace('&#160;', ' ')
        excerpt = excerpt.replace('&nbsp;', ' ')
        excerpt = excerpt.replace('&#8220;', '"')
        excerpt = excerpt.replace('&#8221;', '"')
        excerpt = excerpt.replace('&#8217;', "'")
        excerpt = excerpt.replace('&amp;', '&')
        excerpt = excerpt.replace('&lt;', '<')
        excerpt = excerpt.replace('&gt;', '>')

        # Collapse multiple spaces
        excerpt = re.sub(r'\s+', ' ', excerpt).strip()

        # Add ellipsis if we truncated
        if start > 0:
            excerpt = "..." + excerpt
        if end < len(text):
            excerpt = excerpt + "..."

        return excerpt

    def detect_historical_reference(self, text: str, context_window: int = 2000) -> bool:
        """Detect if filing references a previously announced deal

        Args:
            text: Full filing text
            context_window: Number of characters to check from the beginning (default: 2000)
                           Historical references usually appear early in the document
        """
        # Focus on the beginning of the document where historical references typically appear
        text_to_check = text[:context_window].lower()

        for keyword in HISTORICAL_REFERENCE_KEYWORDS:
            if keyword in text_to_check:
                logger.info(f"Historical reference detected in first {context_window} chars: '{keyword}'")
                return True

        return False

    def detect_historical_reference_near_keywords(
        self,
        text: str,
        detected_keywords: List[str],
        context_radius: int = 300
    ) -> bool:
        """Detect if historical references appear near M&A keywords

        This is more precise than checking the entire document. If "previously disclosed"
        appears in the same paragraph as "merger agreement", it's likely an update.

        Args:
            text: Full filing text
            detected_keywords: M&A keywords that were found
            context_radius: Characters before/after keyword to check (default: 300)
        """
        if not detected_keywords:
            return False

        text_lower = text.lower()

        # Find positions of all M&A keywords
        for keyword in detected_keywords:
            keyword_lower = keyword.lower()
            pos = 0

            while True:
                pos = text_lower.find(keyword_lower, pos)
                if pos == -1:
                    break

                # Extract context around this keyword
                start = max(0, pos - context_radius)
                end = min(len(text), pos + len(keyword) + context_radius)
                context = text_lower[start:end]

                # Check if any historical reference keywords appear in this context
                for hist_keyword in HISTORICAL_REFERENCE_KEYWORDS:
                    if hist_keyword in context:
                        logger.info(
                            f"Historical reference '{hist_keyword}' found near M&A keyword '{keyword}' "
                            f"(within {context_radius} chars)"
                        )
                        return True

                pos += 1

        return False

    def detect_non_us_company(self, filing_text: str, context_window: int = 3000) -> bool:
        """Check if filing mentions a non-US company as the target

        Args:
            filing_text: Full filing text
            context_window: Number of characters from start to check (default 3000)

        Returns:
            True if non-US company indicators found, False otherwise
        """
        text_lower = filing_text[:context_window].lower()

        for keyword in NON_US_COMPANY_KEYWORDS:
            if keyword in text_lower:
                logger.info(
                    f"Non-US company indicator '{keyword}' found in filing "
                    f"(within first {context_window} chars) - likely foreign target"
                )
                return True

        return False

    def detect_retrospective_communication(self, filing_text: str, context_window: int = 2000) -> bool:
        """Check if filing is a retrospective communication (graphic, social media post, etc.)

        Args:
            filing_text: Full filing text
            context_window: Number of characters from start to check (default 2000)

        Returns:
            True if retrospective communication indicators found, False otherwise
        """
        text_lower = filing_text[:context_window].lower()

        for keyword in RETROSPECTIVE_COMMUNICATION_KEYWORDS:
            if keyword in text_lower:
                logger.info(
                    f"Retrospective communication indicator '{keyword}' found in filing "
                    f"(within first {context_window} chars) - likely social media/graphic filing"
                )
                return True

        return False

    def extract_8k_item_numbers(self, filing_text: str) -> List[str]:
        """Extract 8-K item numbers from filing text

        8-K filings must disclose specific "items" that describe the material event:
        - Item 1.01: Entry into Material Definitive Agreement (M&A deals)
        - Item 8.01: Other Events (often used for M&A announcements)
        - Item 2.01: Completion of Acquisition or Disposition of Assets

        Args:
            filing_text: Full filing text (first ~5000 chars usually sufficient)

        Returns:
            List of item numbers found (e.g., ['1.01', '8.01'])
        """
        # 8-K item numbers appear in standard format near beginning of filing
        # Pattern: "Item 1.01", "Item 8.01", etc.
        # Check first 5000 characters where items are typically disclosed
        text_to_check = filing_text[:5000]

        # Pattern to match "Item X.XX" format
        # Matches: Item 1.01, Item 8.01, Item 2.01, etc.
        item_pattern = r'Item\s+(\d+\.\d+)'

        matches = re.findall(item_pattern, text_to_check, re.IGNORECASE)

        # Remove duplicates while preserving order
        items = []
        seen = set()
        for item in matches:
            if item not in seen:
                items.append(item)
                seen.add(item)

        if items:
            logger.info(f"Extracted 8-K item numbers: {items}")

        return items

    def is_high_priority_8k(self, item_numbers: List[str]) -> bool:
        """Check if 8-K contains high-priority items for M&A announcements

        High-priority items for new M&A deal announcements:
        - Item 1.01: Entry into Material Definitive Agreement
        - Item 8.01: Other Events
        - Item 2.01: Completion of Acquisition or Disposition of Assets

        Args:
            item_numbers: List of 8-K item numbers extracted from filing

        Returns:
            True if filing contains high-priority M&A items
        """
        high_priority_items = {'1.01', '8.01', '2.01'}

        for item in item_numbers:
            if item in high_priority_items:
                logger.info(f"High-priority 8-K item detected: {item} (strong signal for new M&A announcement)")
                return True

        return False

    async def extract_target_company(self, filing_text: str, filing_company: str = None) -> Optional[str]:
        """Extract the target company name from filing text using basic heuristics

        Args:
            filing_text: Full filing text
            filing_company: Name of company that filed the document (often the target)

        Returns:
            Target company name or None
        """
        # Common patterns for target companies in M&A filings:
        # "acquire [Company Name]", "[Company Name] will be acquired",
        # "merger with [Company Name]", "acquisition of [Company Name]"

        patterns = [
            r'acquisition\s+of\s+([A-Z][A-Za-z0-9\s&,\.]+?)(?:\s+(?:for|by|from|through|Inc|Corp|Company|Ltd))',
            r'([A-Z][A-Za-z0-9\s&,\.]+?)\s+(?:will be acquired|to be acquired|has agreed to be acquired)',
            r'tender offer (?:for|to acquire)\s+([A-Z][A-Za-z0-9\s&,\.]+?)(?:\s+(?:for|by|from|through|Inc|Corp|Company|Ltd))',
        ]

        for pattern in patterns:
            matches = re.search(pattern, filing_text[:5000], re.IGNORECASE)  # Check first 5000 chars
            if matches:
                company_name = matches.group(1).strip()

                # Skip if it's clearly a generic term
                skip_terms = ['merger sub', 'acquisition sub', 'the company', 'the target']
                if any(term in company_name.lower() for term in skip_terms):
                    continue

                # Clean up common suffixes that might have been captured
                company_name = re.sub(r'\s+(Inc|Corp|Company|Ltd|LLC)\.?$', r' \1', company_name, flags=re.IGNORECASE)
                return company_name

        # If we couldn't extract a target from the patterns, and we have the filing company,
        # assume the filing company IS the target (most common case - target files their own 8-K)
        if filing_company:
            return filing_company

        return None

    async def check_target_is_public(self, filing_text: str, filing_company: str = None) -> Tuple[bool, Optional[str]]:
        """Check if the target company is publicly traded

        Args:
            filing_text: Full filing text
            filing_company: Name of company that filed the document

        Returns:
            Tuple of (is_public, company_name)
            - is_public: True if ticker found, False if not found, True if company name couldn't be extracted
            - company_name: Extracted company name or None
        """
        # Try to extract target company name
        target_name = await self.extract_target_company(filing_text, filing_company)

        if not target_name:
            # If we can't extract the company name, assume it's public to avoid false rejections
            logger.debug("Could not extract target company name from filing")
            return (True, None)

        # Look up ticker for this company
        ticker_service = get_ticker_lookup_service()
        try:
            ticker_data = await ticker_service.lookup_by_company_name(target_name, min_similarity=0.75)

            if ticker_data:
                logger.info(f"Found public ticker {ticker_data['ticker']} for '{target_name}'")
                return (True, target_name)
            else:
                logger.info(f"No public ticker found for '{target_name}' - likely private company")
                return (False, target_name)

        except Exception as e:
            logger.error(f"Error looking up ticker for '{target_name}': {e}")
            # On error, assume public to avoid false rejections
            return (True, target_name)

    async def detect_ma_relevance(self, filing: EdgarFiling, filing_priority: str = 'medium') -> MADetectionResult:
        """Detect if filing is M&A relevant using rule-based detection with confidence tiers

        Confidence Tiers:
        - HIGH (0.90-0.95): Clear new M&A announcement with strong signals
          * 8-K with high-priority items (1.01, 8.01, 2.01)
          * Many M&A keywords (10+)
          * No historical references
          * Public target verified
          → Creates staged deal for immediate review

        - MEDIUM (0.60-0.75): Potential M&A deal needing human verification
          * Moderate keywords (5-9)
          * OR target company can't be verified
          * OR mixed signals
          → Creates staged deal but flagged for careful review

        - LOW/REJECTED (<0.50): Not M&A relevant or update to existing deal
          * Historical references detected
          * Private company target (no public ticker)
          * Few keywords (<5)
          → Not added to staging queue

        Args:
            filing: EdgarFiling object to analyze
            filing_priority: Priority level ('high', 'medium', 'low') based on filing type
                - high: likely first-time announcements (8-K, SC TO, S-4)
                - low: likely updates to existing deals (8-K/A, PREM14A, DEFM14A)
        """

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

        # ============================================================================
        # RULE 1: IMMEDIATE REJECTION - Historical References (Easy to Rule Out)
        # ============================================================================
        # Two-level historical reference check:
        # 1. Check beginning of document (first 2000 chars) for historical references
        # 2. Check context around M&A keywords for historical references
        # 3. For filing types that are ALWAYS retrospective (425, PREM14A, DEFM14A, 8-K/A),
        #    check a much larger window (first 5000 chars)

        # Filing types that are almost always updates/communications about existing deals
        retrospective_filing_types = ['425', 'PREM14A', 'DEFM14A', 'DEFA14A', '8-K/A', 'SC 14D9']
        is_retrospective_filing = filing.filing_type in retrospective_filing_types

        # Use larger context window for retrospective filing types
        context_window = 5000 if is_retrospective_filing else 2000

        has_early_historical_ref = self.detect_historical_reference(filing_text, context_window=context_window)
        has_contextual_historical_ref = self.detect_historical_reference_near_keywords(
            filing_text,
            detected_keywords,
            context_radius=500  # Increased from 300 to catch more context
        )

        if has_contextual_historical_ref:
            # This is the most reliable signal - historical references NEAR the M&A keywords
            # "As previously disclosed... entered into a merger agreement" = update, not new deal
            return MADetectionResult(
                is_ma_relevant=False,
                confidence_score=0.05,
                detected_keywords=detected_keywords,
                reasoning="REJECTED: Historical reference found near M&A keywords - update to previously announced deal"
            )

        if has_early_historical_ref:
            # Historical reference at the beginning is also a strong signal
            # For retrospective filing types (425, PREM14A), be even more aggressive
            if is_retrospective_filing:
                return MADetectionResult(
                    is_ma_relevant=False,
                    confidence_score=0.05,
                    detected_keywords=detected_keywords,
                    reasoning=f"REJECTED: Historical reference in {filing.filing_type} filing (retrospective filing type) - update to previously announced deal"
                )
            # For other filing types with low priority, still apply penalty
            confidence_penalty = 0.1 if filing_priority == 'low' else 0.15
            return MADetectionResult(
                is_ma_relevant=False,
                confidence_score=confidence_penalty,
                detected_keywords=detected_keywords,
                reasoning=f"REJECTED: Historical reference at beginning of filing - likely update to previously announced deal"
            )

        # ============================================================================
        # RULE 2: IMMEDIATE REJECTION - Private Company Target (Easy to Rule Out)
        # ============================================================================
        # Check if target company is publicly traded
        # We only track deals where the target is a public company
        is_public, target_name = await self.check_target_is_public(filing_text, filing.company_name)

        if not is_public:
            # Target company is private (no public ticker found)
            logger.info(f"Rejecting deal - target '{target_name}' is private (no public ticker)")
            return MADetectionResult(
                is_ma_relevant=False,
                confidence_score=0.05,
                detected_keywords=detected_keywords,
                reasoning=f"REJECTED: Target company '{target_name}' is private (no public ticker) - not relevant for public M&A tracking"
            )

        # ============================================================================
        # RULE 3: EXTRACT 8-K ITEMS (Strong Signal for New Announcements)
        # ============================================================================
        # For 8-K filings, extract item numbers to identify high-priority M&A items
        item_numbers = []
        has_high_priority_items = False

        if filing.filing_type == "8-K":
            item_numbers = self.extract_8k_item_numbers(filing_text)
            has_high_priority_items = self.is_high_priority_8k(item_numbers)

            if has_high_priority_items:
                logger.info(f"8-K contains high-priority M&A items: {item_numbers}")

        # ============================================================================
        # RULE 4: RULE-BASED CONFIDENCE SCORING
        # ============================================================================
        # Now apply rule-based scoring based on signals we've collected

        keyword_count = len(detected_keywords)

        # Signal strength scoring
        signals = {
            'many_keywords': keyword_count >= 10,       # 10+ keywords
            'moderate_keywords': 5 <= keyword_count < 10,  # 5-9 keywords
            'high_priority_8k_items': has_high_priority_items,  # Items 1.01, 8.01, 2.01
            'is_8k': filing.filing_type == "8-K",
            'verified_public_target': is_public and target_name is not None,
            'target_unverified': target_name is None,  # Couldn't extract company name
        }

        # ============================================================================
        # HIGH CONFIDENCE (0.90-0.95): Clear new M&A announcement
        # ============================================================================
        # Criteria: 8-K + high-priority items + many keywords + no historical refs + verified target
        if (signals['is_8k'] and
            signals['high_priority_8k_items'] and
            signals['many_keywords'] and
            signals['verified_public_target']):

            confidence = 0.95
            reasoning = f"HIGH CONFIDENCE: 8-K Items {item_numbers} + {keyword_count} M&A keywords + verified public target"
            if target_name:
                reasoning += f" ({target_name})"
            reasoning += " - clear new M&A announcement"

            logger.info(f"HIGH confidence detection: {filing.company_name} - {reasoning}")

            return MADetectionResult(
                is_ma_relevant=True,
                confidence_score=confidence,
                detected_keywords=detected_keywords,
                reasoning=reasoning
            )

        # ============================================================================
        # MEDIUM-HIGH CONFIDENCE (0.75-0.85): Strong signals but missing one element
        # ============================================================================
        # Scenario 1: High-priority 8-K items + moderate keywords
        if (signals['is_8k'] and
            signals['high_priority_8k_items'] and
            signals['moderate_keywords']):

            confidence = 0.80
            reasoning = f"MEDIUM-HIGH: 8-K Items {item_numbers} + {keyword_count} M&A keywords"
            if target_name:
                reasoning += f" + target: {target_name}"
            reasoning += " - likely new announcement"

            logger.info(f"MEDIUM-HIGH confidence: {filing.company_name} - {reasoning}")

            return MADetectionResult(
                is_ma_relevant=True,
                confidence_score=confidence,
                detected_keywords=detected_keywords,
                reasoning=reasoning
            )

        # Scenario 2: Many keywords + verified target but not 8-K or no high-priority items
        if (signals['many_keywords'] and
            signals['verified_public_target']):

            confidence = 0.75
            reasoning = f"MEDIUM-HIGH: {keyword_count} M&A keywords + verified target"
            if target_name:
                reasoning += f" ({target_name})"
            reasoning += f" in {filing.filing_type} filing - likely M&A relevant"

            logger.info(f"MEDIUM-HIGH confidence: {filing.company_name} - {reasoning}")

            return MADetectionResult(
                is_ma_relevant=True,
                confidence_score=confidence,
                detected_keywords=detected_keywords,
                reasoning=reasoning
            )

        # ============================================================================
        # MEDIUM CONFIDENCE (0.60-0.70): Potential deal, needs human review
        # ============================================================================
        # Scenario 1: Moderate keywords but can't verify target
        if signals['moderate_keywords']:
            confidence = 0.65
            reasoning = f"MEDIUM: {keyword_count} M&A keywords in {filing.filing_type}"
            if signals['target_unverified']:
                reasoning += " (target company not identified)"
            reasoning += " - requires human verification"

            logger.info(f"MEDIUM confidence: {filing.company_name} - {reasoning}")

            return MADetectionResult(
                is_ma_relevant=True,
                confidence_score=confidence,
                detected_keywords=detected_keywords,
                reasoning=reasoning
            )

        # ============================================================================
        # LOW/REJECTED (<0.50): Not enough signals
        # ============================================================================
        # Few keywords (<5) - not M&A relevant
        confidence = 0.30
        reasoning = f"REJECTED: Only {keyword_count} M&A keywords - insufficient signal for M&A relevance"

        logger.info(f"LOW confidence (rejected): {filing.company_name} - {reasoning}")

        return MADetectionResult(
            is_ma_relevant=False,
            confidence_score=confidence,
            detected_keywords=detected_keywords,
            reasoning=reasoning
        )


    async def close(self):
        """Clean up resources"""
        await self.client.aclose()
