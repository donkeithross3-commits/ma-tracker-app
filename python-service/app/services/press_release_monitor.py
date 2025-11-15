"""Press Release Monitor - Detects M&A announcements from news and PR sources"""
import os
import logging
import httpx
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
import re
import asyncpg

logger = logging.getLogger(__name__)


class PressReleaseMonitor:
    """Monitors press releases and news for M&A announcements"""

    def __init__(self, db_url: str):
        self.db_url = db_url

        # NewsAPI for news aggregation (free tier: 100 requests/day)
        self.newsapi_key = os.getenv("NEWSAPI_KEY")

        # M&A-related keywords
        self.ma_keywords = [
            "merger", "acquisition", "acquired", "acquires",
            "definitive agreement", "tender offer", "takeover",
            "buyout", "combination", "to acquire", "to be acquired"
        ]

    async def search_news_api(self, lookback_hours: int = 24) -> List[Dict[str, Any]]:
        """
        Search NewsAPI for M&A-related articles.
        Free tier: 100 requests/day, 1 month history
        """
        if not self.newsapi_key:
            logger.warning("NEWSAPI_KEY not configured, skipping NewsAPI search")
            return []

        results = []

        try:
            # Search for M&A keywords
            query = ' OR '.join([f'"{kw}"' for kw in self.ma_keywords[:5]])  # Limit query length

            from_date = datetime.now() - timedelta(hours=lookback_hours)

            url = "https://newsapi.org/v2/everything"
            params = {
                "q": query,
                "language": "en",
                "sortBy": "publishedAt",
                "from": from_date.isoformat(),
                "apiKey": self.newsapi_key,
                "pageSize": 100  # Max per request
            }

            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(url, params=params)
                response.raise_for_status()

                data = response.json()
                articles = data.get("articles", [])

                for article in articles:
                    # Check if article mentions definitive deal terms
                    if self._is_definitive_announcement(article.get("title", ""), article.get("description", "")):
                        results.append({
                            "source": "NewsAPI",
                            "headline": article.get("title"),
                            "content": article.get("description"),
                            "url": article.get("url"),
                            "published_at": article.get("publishedAt"),
                            "source_name": article.get("source", {}).get("name")
                        })

        except Exception as e:
            logger.error(f"NewsAPI search failed: {e}")

        return results

    async def search_google_news_rss(self, lookback_hours: int = 24) -> List[Dict[str, Any]]:
        """
        Search Google News RSS feeds for M&A announcements.
        Free, no API key required.
        """
        results = []

        try:
            # Google News RSS for M&A topics
            search_terms = ["merger+acquisition", "definitive+agreement", "tender+offer"]

            async with httpx.AsyncClient(timeout=30.0) as client:
                for term in search_terms:
                    url = f"https://news.google.com/rss/search?q={term}+when:1d&hl=en-US&gl=US&ceid=US:en"

                    response = await client.get(url)
                    response.raise_for_status()

                    # Parse RSS feed
                    import xml.etree.ElementTree as ET
                    root = ET.fromstring(response.text)

                    for item in root.findall('.//item'):
                        title = item.find('title').text if item.find('title') is not None else ""
                        link = item.find('link').text if item.find('link') is not None else ""
                        pub_date = item.find('pubDate').text if item.find('pubDate') is not None else ""

                        if self._is_definitive_announcement(title, ""):
                            results.append({
                                "source": "Google News RSS",
                                "headline": title,
                                "content": "",
                                "url": link,
                                "published_at": pub_date,
                                "source_name": "Google News"
                            })

        except Exception as e:
            logger.error(f"Google News RSS search failed: {e}")

        return results

    def _is_definitive_announcement(self, title: str, description: str) -> bool:
        """
        Determine if text indicates a definitive M&A announcement.

        Definitive indicators:
        - "definitive agreement"
        - "entered into agreement"
        - "signed agreement"
        - "to acquire" + company name + "for $X"
        - "acquires" (present tense = completed or definitive)
        """
        text = (title + " " + description).lower()

        # Definitive keywords
        definitive_patterns = [
            r"definitive agreement",
            r"enters into agreement",
            r"entered into agreement",
            r"signs agreement",
            r"signed agreement",
            r"signs definitive",
            r"to acquire .+ for \$",
            r"acquires .+ for \$",
            r"completes acquisition",
            r"completed acquisition",
        ]

        for pattern in definitive_patterns:
            if re.search(pattern, text, re.IGNORECASE):
                return True

        # Exclude rumor language
        rumor_keywords = [
            "exploring", "considering", "potential", "rumor", "rumored",
            "reported to be", "said to be", "talks", "discussions",
            "may acquire", "could acquire", "might acquire"
        ]

        for keyword in rumor_keywords:
            if keyword in text:
                return False

        return False

    def _extract_company_names(self, text: str) -> List[str]:
        """
        Extract company names from announcement text.
        Basic extraction - looks for capitalized phrases.
        """
        # Simple pattern: Capitalized words (potential company names)
        # This is a basic approach - could be enhanced with NER
        words = text.split()
        companies = []
        current_company = []

        for word in words:
            # Check if word starts with capital (excluding common words)
            if word and word[0].isupper() and word.lower() not in ['the', 'and', 'or', 'of', 'to', 'in', 'a', 'for']:
                current_company.append(word)
            else:
                if current_company and len(current_company) >= 2:
                    companies.append(' '.join(current_company))
                current_company = []

        # Add last company if exists
        if current_company and len(current_company) >= 2:
            companies.append(' '.join(current_company))

        return companies[:5]  # Limit to first 5 potential companies

    async def create_staged_deal_from_press_release(
        self,
        headline: str,
        content: str,
        source_url: str,
        source_name: str,
        published_at: Optional[str] = None
    ) -> Optional[str]:
        """
        Create a staged deal from a press release announcement.
        Returns staged_deal_id if created.
        """
        conn = await asyncpg.connect(self.db_url)
        try:
            # Use AI to extract deal information from press release
            import os
            from anthropic import AsyncAnthropic
            import json
            import re

            anthropic = AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

            text = f"Title: {headline}\n\nContent: {content[:1000]}"  # Limit content to first 1000 chars

            prompt = f"""Analyze this press release for M&A deal information.

{text}

CRITICAL: Correctly identify TARGET vs ACQUIRER:
- TARGET = Company being acquired/bought (the company being sold)
- ACQUIRER = Company doing the acquiring/buying (the buyer)

Key indicators to help you identify the target:
- "Company A to be acquired by Company B" → Target: A, Acquirer: B
- "Company B acquires Company A" → Target: A, Acquirer: B
- "Company A adds go-shop provision" → Target: A (the company ADDING the provision is the target)
- "Company A adds go-shop TO Company B transaction" → Target: A, Acquirer: B (ignore the "TO Company B" part - whoever ADDS the provision is the target)
- "Company A receives tender offer from Company B" → Target: A, Acquirer: B
- "Company B makes offer for Company A" → Target: A, Acquirer: B
- "Merger of equals" → Both could be considered target/acquirer, use context

Extract:
1. Target company name (company being acquired/bought)
2. Acquirer company name (company doing the acquisition/buying)

If this is NOT about an M&A deal, respond with: NOT_MA_RELEVANT

Otherwise, respond in this exact JSON format:
{{
  "target_name": "Company Name",
  "acquirer_name": "Acquirer Name" or null,
  "is_ma_relevant": true
}}"""

            try:
                response = await anthropic.messages.create(
                    model="claude-3-5-haiku-20241022",
                    max_tokens=300,
                    messages=[{"role": "user", "content": prompt}]
                )

                result = response.content[0].text.strip()

                if "NOT_MA_RELEVANT" in result:
                    logger.debug(f"Press release not M&A relevant: {headline}")
                    return None

                # Parse JSON response
                try:
                    data = json.loads(result)
                except json.JSONDecodeError:
                    # Try to extract JSON from response
                    json_match = re.search(r'\{.*\}', result, re.DOTALL)
                    if json_match:
                        data = json.loads(json_match.group())
                    else:
                        logger.warning(f"Could not parse AI response for press release: {result}")
                        return None

                if not data.get("is_ma_relevant"):
                    return None

                target_name = data.get("target_name", "Unknown")
                acquirer_name = data.get("acquirer_name")

            except Exception as e:
                logger.error(f"AI extraction failed for press release, falling back to basic extraction: {e}")
                # Fallback to basic extraction if AI fails
                companies = self._extract_company_names(headline)
                if not companies:
                    logger.debug(f"No companies found in: {headline}")
                    return None
                target_name = companies[0] if len(companies) > 0 else "Unknown"
                acquirer_name = companies[1] if len(companies) > 1 else None

            # Check if deal already exists
            existing = await conn.fetchval(
                """SELECT staged_deal_id FROM staged_deals
                   WHERE target_name ILIKE $1
                   AND created_at > NOW() - INTERVAL '7 days'""",
                f"%{target_name}%"
            )

            if existing:
                logger.debug(f"Deal for {target_name} already exists: {existing}")
                return None

            # Create staged deal
            staged_deal_id = await conn.fetchval(
                """INSERT INTO staged_deals (
                    target_name, acquirer_name, deal_tier, status,
                    sources, confidence_score, filing_type
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING staged_deal_id""",
                target_name,
                acquirer_name,
                'active',  # Press releases are typically definitive
                'pending',
                [{
                    "source_name": source_name,
                    "source_url": source_url,
                    "headline": headline,
                    "content_snippet": content,
                    "detected_at": datetime.now().isoformat()
                }],
                0.70,  # Medium confidence from press release alone
                'PR'  # Press Release
            )

            logger.info(f"Created staged deal from press release: {staged_deal_id} - {target_name}")
            return str(staged_deal_id)

        finally:
            await conn.close()

    async def monitor_and_stage_deals(self, lookback_hours: int = 24) -> Dict[str, Any]:
        """
        Monitor press releases and create staged deals for new announcements.
        Returns summary of monitoring results.
        """
        logger.info(f"Starting press release monitoring (lookback: {lookback_hours}h)")

        # Collect announcements from all sources
        all_announcements = []

        # NewsAPI
        newsapi_results = await self.search_news_api(lookback_hours)
        all_announcements.extend(newsapi_results)
        logger.info(f"Found {len(newsapi_results)} articles from NewsAPI")

        # Google News RSS
        google_news_results = await self.search_google_news_rss(lookback_hours)
        all_announcements.extend(google_news_results)
        logger.info(f"Found {len(google_news_results)} articles from Google News")

        # Create staged deals
        created_deals = []
        for announcement in all_announcements:
            try:
                staged_deal_id = await self.create_staged_deal_from_press_release(
                    announcement['headline'],
                    announcement.get('content', ''),
                    announcement['url'],
                    announcement['source_name'],
                    announcement.get('published_at')
                )

                if staged_deal_id:
                    created_deals.append({
                        "staged_deal_id": staged_deal_id,
                        "headline": announcement['headline'],
                        "source": announcement['source']
                    })
            except Exception as e:
                logger.error(f"Failed to create staged deal: {e}")

        return {
            "total_announcements_found": len(all_announcements),
            "newsapi_count": len(newsapi_results),
            "google_news_count": len(google_news_results),
            "staged_deals_created": len(created_deals),
            "deals": created_deals
        }


# Singleton instance
_press_release_monitor = None

def get_press_release_monitor() -> PressReleaseMonitor:
    """Get or create the press release monitor instance"""
    global _press_release_monitor
    if _press_release_monitor is None:
        db_url = os.getenv("DATABASE_URL")
        if not db_url:
            raise ValueError("DATABASE_URL environment variable not set")
        _press_release_monitor = PressReleaseMonitor(db_url)
    return _press_release_monitor
