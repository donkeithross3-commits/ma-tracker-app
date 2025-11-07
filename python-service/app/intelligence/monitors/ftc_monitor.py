"""FTC Early Termination Notices Monitor

Monitors: https://www.ftc.gov/legal-library/browse/early-termination-notices
Provides: HSR Act early termination grants (regulatory clearance)
"""
from typing import List, Optional, Any, Dict
from datetime import datetime
import httpx
from bs4 import BeautifulSoup
import re

from app.intelligence.base_monitor import BaseSourceMonitor
from app.intelligence.models import DealMention, SourceType, MentionType


class FTCEarlyTerminationMonitor(BaseSourceMonitor):
    """
    Monitor FTC Early Termination Notices for M&A regulatory clearances.

    These notices indicate that the FTC has granted early termination of the
    HSR Act waiting period, meaning the deal has cleared antitrust review.
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__(
            source_name="ftc_early_termination",
            source_type=SourceType.OFFICIAL,
            config=config or {"url": "https://www.ftc.gov/legal-library/browse/early-termination-notices"}
        )
        self.base_url = self.config["url"]
        self.seen_entries = set()  # Track processed entries to avoid duplicates

    async def fetch_updates(self) -> List[Dict[str, str]]:
        """
        Fetch early termination notices from FTC website.

        Returns:
            List of dictionaries with keys: date, acquiring_person, acquired_person, url
        """
        self.logger.info(f"Fetching FTC early termination notices from {self.base_url}")

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(self.base_url)
            response.raise_for_status()

            soup = BeautifulSoup(response.text, "html.parser")

            # Find the main content area - FTC page structure
            # Looking for table or list of notices
            entries = []

            # The FTC page typically has a list of notices in a specific format
            # We'll look for the common patterns:
            # 1. Tables with notice information
            # 2. List items with company names and dates

            # Try to find tables first
            tables = soup.find_all("table")
            for table in tables:
                rows = table.find_all("tr")
                for row in rows[1:]:  # Skip header row
                    cells = row.find_all("td")
                    if len(cells) >= 3:  # Expecting: Date, Acquiring, Acquired
                        date_text = cells[0].get_text(strip=True)
                        acquiring = cells[1].get_text(strip=True)
                        acquired = cells[2].get_text(strip=True)

                        # Find link if available
                        link = cells[0].find("a")
                        entry_url = self.base_url
                        if link and link.get("href"):
                            entry_url = link["href"]
                            if not entry_url.startswith("http"):
                                entry_url = f"https://www.ftc.gov{entry_url}"

                        entry_id = f"{date_text}_{acquiring}_{acquired}"
                        if entry_id not in self.seen_entries:
                            entries.append({
                                "date": date_text,
                                "acquiring_person": acquiring,
                                "acquired_person": acquired,
                                "url": entry_url,
                                "entry_id": entry_id
                            })

            # Also try to find list items
            if not entries:
                list_items = soup.find_all("li")
                for item in list_items:
                    text = item.get_text(strip=True)
                    # Look for date pattern (MM/DD/YYYY or Month DD, YYYY)
                    date_match = re.search(r"(\d{1,2}/\d{1,2}/\d{4})|(\w+ \d{1,2}, \d{4})", text)
                    if date_match:
                        date_text = date_match.group(0)

                        # Try to extract companies (typically "CompanyA to acquire CompanyB" or similar)
                        # This is heuristic-based
                        parts = text.split(" and ")
                        if len(parts) == 2:
                            acquiring = parts[0].replace(date_text, "").strip()
                            acquired = parts[1].strip()

                            link = item.find("a")
                            entry_url = self.base_url
                            if link and link.get("href"):
                                entry_url = link["href"]
                                if not entry_url.startswith("http"):
                                    entry_url = f"https://www.ftc.gov{entry_url}"

                            entry_id = f"{date_text}_{acquiring}_{acquired}"
                            if entry_id not in self.seen_entries:
                                entries.append({
                                    "date": date_text,
                                    "acquiring_person": acquiring,
                                    "acquired_person": acquired,
                                    "url": entry_url,
                                    "entry_id": entry_id
                                })

            self.logger.info(f"Found {len(entries)} FTC early termination entries")

            # Mark entries as seen
            for entry in entries:
                self.seen_entries.add(entry["entry_id"])

            return entries

    async def parse_item(self, item: Dict[str, str]) -> Optional[DealMention]:
        """
        Parse FTC early termination notice into DealMention.

        Args:
            item: Dictionary with date, acquiring_person, acquired_person, url

        Returns:
            DealMention if parseable, None otherwise
        """
        try:
            # Parse date
            date_str = item["date"]
            try:
                # Try MM/DD/YYYY format
                source_published_at = datetime.strptime(date_str, "%m/%d/%Y")
            except ValueError:
                try:
                    # Try Month DD, YYYY format
                    source_published_at = datetime.strptime(date_str, "%B %d, %Y")
                except ValueError:
                    source_published_at = None

            # Extract company names
            acquiring_name = item["acquiring_person"]
            acquired_name = item["acquired_person"]

            # Create DealMention
            mention = DealMention(
                source_name=self.source_name,
                source_type=self.source_type,
                mention_type=MentionType.CLEARANCE,  # FTC clearance is regulatory approval
                target_name=acquired_name,
                target_ticker=None,  # FTC doesn't provide tickers
                acquirer_name=acquiring_name,
                acquirer_ticker=None,
                source_url=item["url"],
                headline=f"FTC Early Termination: {acquiring_name} / {acquired_name}",
                content_snippet=f"HSR Act early termination granted on {date_str}",
                credibility_score=self.get_credibility_score(),  # Official source = 1.0
                extracted_data={
                    "clearance_date": date_str,
                    "regulatory_status": "cleared"
                },
                source_published_at=source_published_at,
            )

            return mention

        except Exception as e:
            self.logger.error(f"Error parsing FTC item: {e}", exc_info=True)
            return None


# Convenience factory function
def create_ftc_monitor(config: Optional[Dict[str, Any]] = None) -> FTCEarlyTerminationMonitor:
    """Create and return an FTC Early Termination monitor instance"""
    return FTCEarlyTerminationMonitor(config)
