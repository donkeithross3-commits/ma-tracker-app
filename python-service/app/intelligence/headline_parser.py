"""Rule-based M&A headline/article parser - no AI required

This parser extracts M&A deal information from news headlines and summaries
using keyword patterns and heuristics, similar to the EDGAR detector but
adapted for rumor/announcement detection from news sources.
"""
import logging
import re
from typing import Optional, Dict, Any, List
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# M&A announcement keywords for news articles
MA_ANNOUNCEMENT_KEYWORDS = [
    # Deal announcement verbs (present/future tense - indicates NEW news)
    "to acquire", "to be acquired", "will acquire", "will be acquired",
    "agrees to acquire", "agreed to acquire", "has agreed to acquire",
    "to buy", "will buy", "agrees to buy", "agreed to buy",
    "to purchase", "will purchase", "agrees to purchase", "agreed to purchase",
    "to merge", "will merge", "agrees to merge", "agreed to merge",

    # Tender offers
    "tender offer", "to tender", "launches tender offer", "announces tender offer",
    "bids for", "bid for", "makes offer for", "offer to purchase",

    # Deal nouns
    "acquisition deal", "merger deal", "takeover deal",
    "merger agreement", "acquisition agreement", "definitive agreement",

    # Deal structure
    "all-cash deal", "stock deal", "cash and stock",
    "per share", "billion deal", "million deal",

    # Regulatory/process
    "go-shop provision", "go-shop period",
    "regulatory approval", "antitrust review",
    "shareholder approval", "board approval",
]

# Keywords that indicate rumors/speculation (lower confidence)
RUMOR_KEYWORDS = [
    "reportedly", "reports", "sources say", "sources said",
    "is said to", "are said to", "people familiar",
    "according to sources", "Bloomberg reports", "Reuters reports",
    "exploring", "considering", "mulling", "weighing", "weigh",
    "potential", "possible", "may", "could",
    "in talks", "in discussions", "negotiating",
    "seeking", "looking to", "eyeing",
]

# Keywords indicating historical/past deals (filter out)
HISTORICAL_KEYWORDS = [
    "completed", "closed", "finalized", "finished",
    "last year", "last month", "in 2023", "in 2024",
    "previously announced", "previously disclosed",
    "after acquiring", "following the acquisition",
    "since acquiring", "since the merger",
]

# Patterns to extract company names and deal details
# Format: "Company A to acquire Company B for $X billion"
ACQUISITION_PATTERNS = [
    # "Company A to acquire Company B"
    r'([A-Z][A-Za-z0-9\s&\.,]+?)\s+(?:to acquire|will acquire|agrees to acquire|acquires)\s+([A-Z][A-Za-z0-9\s&\.,]+?)(?:\s+for|\s+in|\s+\(|$)',

    # "Company B to be acquired by Company A"
    r'([A-Z][A-Za-z0-9\s&\.,]+?)\s+(?:to be acquired|will be acquired)\s+by\s+([A-Z][A-Za-z0-9\s&\.,]+?)(?:\s+for|\s+in|\s+\(|$)',

    # "Company A buys/purchases Company B"
    r'([A-Z][A-Za-z0-9\s&\.,]+?)\s+(?:buys|purchases|buying|purchasing)\s+([A-Z][A-Za-z0-9\s&\.,]+?)(?:\s+for|\s+in|\s+\(|$)',

    # "Company A weighs/mulls/considers bid for Company B"
    # Use word boundary and non-greedy matching to stop at lowercase words like "is said to"
    r'([A-Z][A-Za-z0-9&]+)\s+.*?\b(?:weigh|mull|consider|eye)s?\s+(?:a\s+)?(?:bid|offer|takeover|acquisition)\s+for\s+(?:[a-z]+\s+)*([A-Z][A-Za-z0-9\s&\.,]+?)(?:\s*\(|$)',

    # "Company A-Company B merger"
    r'([A-Z][A-Za-z0-9\s&\.,]+?)\s*-\s*([A-Z][A-Za-z0-9\s&\.,]+?)\s+(?:merger|deal|acquisition)',
]

# Patterns for extracting tickers
# News often mentions tickers in parentheses or with dollar signs
TICKER_PATTERNS = [
    r'\(([A-Z]{1,5})\)',  # (TICK)
    r'\$([A-Z]{1,5})(?:\s|,|\.)',  # $TICK
    r'NYSE:\s*([A-Z]{1,5})',  # NYSE: TICK
    r'NASDAQ:\s*([A-Z]{1,5})',  # NASDAQ: TICK
]

# Patterns for extracting deal value
DEAL_VALUE_PATTERNS = [
    r'\$(\d+(?:\.\d+)?)\s*billion',  # $5.2 billion
    r'\$(\d+(?:\.\d+)?)\s*bn',       # $5.2bn
    r'(\d+(?:\.\d+)?)-billion',      # 5.2-billion
]


@dataclass
class ParsedDeal:
    """Parsed deal information from headline/article"""
    target_name: Optional[str] = None
    target_ticker: Optional[str] = None
    acquirer_name: Optional[str] = None
    acquirer_ticker: Optional[str] = None
    deal_value: Optional[float] = None  # In billions USD
    is_rumor: bool = False
    is_ma_relevant: bool = False
    confidence: float = 0.0
    reasoning: str = ""


class HeadlineParser:
    """Rule-based parser for M&A news headlines and article summaries"""

    def __init__(self):
        self.logger = logging.getLogger(__name__)

    def parse(self, headline: str, summary: str = "") -> ParsedDeal:
        """Parse M&A information from headline and optional summary

        Args:
            headline: Article headline
            summary: Optional article summary/snippet

        Returns:
            ParsedDeal with extracted information
        """
        # Combine headline and summary for analysis
        text = f"{headline} {summary}".strip()
        text_lower = text.lower()

        result = ParsedDeal()

        # Step 1: Check if this is M&A relevant
        if not self._is_ma_relevant(text_lower):
            result.reasoning = "No M&A keywords detected"
            return result

        # Step 2: Check for historical references (filter out)
        if self._is_historical(text_lower):
            result.reasoning = "Historical reference detected - past deal, not new announcement"
            return result

        # Step 3: Determine if this is a rumor or announcement
        result.is_rumor = self._is_rumor(text_lower)

        # Step 4: Extract company names
        target, acquirer = self._extract_companies(text)

        if not target:
            # Can't identify target company
            result.reasoning = "M&A keywords found but could not extract target company"
            return result

        result.target_name = target
        result.acquirer_name = acquirer

        # Step 5: Extract tickers if mentioned
        tickers = self._extract_tickers(text)
        if tickers:
            # First ticker is usually the target, second is acquirer
            result.target_ticker = tickers[0] if len(tickers) >= 1 else None
            result.acquirer_ticker = tickers[1] if len(tickers) >= 2 else None

        # Step 6: Extract deal value if mentioned
        result.deal_value = self._extract_deal_value(text)

        # Step 7: Calculate confidence
        result.confidence = self._calculate_confidence(result, text_lower)

        # Step 8: Set relevance flag
        result.is_ma_relevant = result.confidence >= 0.50

        # Step 9: Build reasoning
        result.reasoning = self._build_reasoning(result)

        return result

    def _is_ma_relevant(self, text_lower: str) -> bool:
        """Check if text contains M&A keywords"""
        for keyword in MA_ANNOUNCEMENT_KEYWORDS:
            if keyword in text_lower:
                return True

        # Also check rumor keywords (still M&A relevant, just lower confidence)
        for keyword in RUMOR_KEYWORDS:
            if keyword in text_lower and any(k in text_lower for k in ['merger', 'acquisition', 'acquire', 'takeover']):
                return True

        return False

    def _is_historical(self, text_lower: str) -> bool:
        """Check if text refers to a past/historical deal"""
        for keyword in HISTORICAL_KEYWORDS:
            if keyword in text_lower:
                self.logger.debug(f"Historical keyword detected: '{keyword}'")
                return True
        return False

    def _is_rumor(self, text_lower: str) -> bool:
        """Check if text indicates a rumor vs confirmed announcement"""
        for keyword in RUMOR_KEYWORDS:
            if keyword in text_lower:
                self.logger.debug(f"Rumor keyword detected: '{keyword}'")
                return True
        return False

    def _extract_companies(self, text: str) -> tuple[Optional[str], Optional[str]]:
        """Extract target and acquirer company names

        Returns:
            (target_name, acquirer_name) tuple
        """
        for pattern in ACQUISITION_PATTERNS:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                company1 = match.group(1).strip()
                company2 = match.group(2).strip()

                # Clean up company names
                company1 = self._clean_company_name(company1)
                company2 = self._clean_company_name(company2)

                # Skip if names are too generic
                if not company1 or not company2:
                    continue
                if len(company1) < 2 or len(company2) < 2:
                    continue

                # Determine which is target vs acquirer based on pattern
                # Pattern 1: "A to acquire B" -> acquirer=A, target=B
                # Pattern 2: "A to be acquired by B" -> target=A, acquirer=B
                if 'to be acquired' in text.lower() or 'will be acquired' in text.lower():
                    target = company1
                    acquirer = company2
                else:
                    target = company2
                    acquirer = company1

                self.logger.debug(f"Extracted companies: target={target}, acquirer={acquirer}")
                return (target, acquirer)

        # If no pattern matched, try to find just the target company
        # Look for company name before "to be acquired" or after "acquire"
        target_patterns = [
            r'([A-Z][A-Za-z0-9\s&\.,]+?)\s+(?:to be acquired|will be acquired)',
            r'(?:acquire|acquiring)\s+([A-Z][A-Za-z0-9\s&\.,]+?)(?:\s+for|\s+in|\(|$)',
        ]

        for pattern in target_patterns:
            match = re.search(pattern, text)
            if match:
                target = self._clean_company_name(match.group(1).strip())
                if target and len(target) >= 2:
                    self.logger.debug(f"Extracted target only: {target}")
                    return (target, None)

        return (None, None)

    def _clean_company_name(self, name: str) -> Optional[str]:
        """Clean up extracted company name"""
        if not name:
            return None

        # Remove common prefixes/suffixes that got captured
        name = re.sub(r'^(The|A|An)\s+', '', name, flags=re.IGNORECASE)
        name = re.sub(r'\s+(Inc|Corp|Company|Ltd|LLC|PLC)\.?$', r' \1', name, flags=re.IGNORECASE)

        # Remove trailing punctuation
        name = name.rstrip('.,;:')

        # Skip generic terms
        generic_terms = ['company', 'firm', 'business', 'group', 'the', 'for', 'will', 'has']
        if name.lower() in generic_terms:
            return None

        # Must start with capital letter
        if not name or not name[0].isupper():
            return None

        return name.strip()

    def _extract_tickers(self, text: str) -> List[str]:
        """Extract ticker symbols from text"""
        tickers = []
        seen = set()

        for pattern in TICKER_PATTERNS:
            matches = re.findall(pattern, text)
            for ticker in matches:
                if ticker not in seen and len(ticker) >= 1 and len(ticker) <= 5:
                    tickers.append(ticker)
                    seen.add(ticker)

        return tickers

    def _extract_deal_value(self, text: str) -> Optional[float]:
        """Extract deal value in billions USD"""
        for pattern in DEAL_VALUE_PATTERNS:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                try:
                    value = float(match.group(1))
                    self.logger.debug(f"Extracted deal value: ${value}B")
                    return value
                except ValueError:
                    continue
        return None

    def _calculate_confidence(self, result: ParsedDeal, text_lower: str) -> float:
        """Calculate confidence score based on extracted information

        Confidence tiers:
        - 0.85-0.95: Strong announcement with clear details
        - 0.70-0.80: Solid announcement but missing some details
        - 0.50-0.65: Rumor or announcement with limited info
        - <0.50: Not relevant or too vague
        """
        score = 0.0

        # Base score for having target company
        if result.target_name:
            score = 0.50
        else:
            return 0.0

        # Bonus for having acquirer
        if result.acquirer_name:
            score += 0.15

        # Bonus for having ticker(s)
        if result.target_ticker:
            score += 0.10
        if result.acquirer_ticker:
            score += 0.05

        # Bonus for having deal value
        if result.deal_value:
            score += 0.10

        # Penalty for rumors (but still track them)
        if result.is_rumor:
            score -= 0.15

        # Bonus for strong announcement keywords
        strong_keywords = ['agrees to acquire', 'agreed to acquire', 'merger agreement', 'definitive agreement']
        if any(kw in text_lower for kw in strong_keywords):
            score += 0.10

        # Cap at 0.95
        return min(0.95, max(0.0, score))

    def _build_reasoning(self, result: ParsedDeal) -> str:
        """Build human-readable reasoning string"""
        if not result.is_ma_relevant:
            return result.reasoning if result.reasoning else "Not M&A relevant"

        parts = []

        # Deal type
        if result.is_rumor:
            parts.append("RUMOR")
        else:
            parts.append("ANNOUNCEMENT")

        # Companies
        if result.target_name and result.acquirer_name:
            parts.append(f"{result.acquirer_name} acquiring {result.target_name}")
        elif result.target_name:
            parts.append(f"Target: {result.target_name}")

        # Tickers
        if result.target_ticker:
            parts.append(f"Ticker: {result.target_ticker}")

        # Deal value
        if result.deal_value:
            parts.append(f"${result.deal_value}B")

        # Confidence
        if result.confidence >= 0.80:
            parts.append("HIGH confidence")
        elif result.confidence >= 0.65:
            parts.append("MEDIUM confidence")
        else:
            parts.append("needs verification")

        return " | ".join(parts)


# Singleton instance
_parser_instance = None

def get_headline_parser() -> HeadlineParser:
    """Get singleton headline parser instance"""
    global _parser_instance
    if _parser_instance is None:
        _parser_instance = HeadlineParser()
    return _parser_instance
