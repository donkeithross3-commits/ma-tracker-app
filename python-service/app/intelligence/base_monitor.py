"""Base source monitor for M&A intelligence platform"""
from abc import ABC, abstractmethod
from typing import List, Optional, Dict, Any
import logging
from datetime import datetime

from app.intelligence.models import DealMention, SourceType

logger = logging.getLogger(__name__)


class BaseSourceMonitor(ABC):
    """
    Abstract base class for all M&A intelligence source monitors.

    Each source monitor is responsible for:
    1. Fetching updates from its source
    2. Parsing content into structured format
    3. Extracting deal mentions
    4. Providing credibility scores
    """

    def __init__(self, source_name: str, source_type: SourceType, config: Optional[Dict[str, Any]] = None):
        """
        Initialize source monitor.

        Args:
            source_name: Unique identifier for this source (e.g., "edgar", "ftc_early_termination")
            source_type: Type of source (official, news, social, indicator)
            config: Optional configuration dictionary
        """
        self.source_name = source_name
        self.source_type = source_type
        self.config = config or {}
        self.logger = logging.getLogger(f"{__name__}.{source_name}")

    @abstractmethod
    async def fetch_updates(self) -> List[Any]:
        """
        Fetch new updates from the source.

        Returns:
            List of raw update items (format varies by source)

        Raises:
            Exception: If fetching fails
        """
        pass

    @abstractmethod
    async def parse_item(self, item: Any) -> Optional[DealMention]:
        """
        Parse a single item into a DealMention.

        Args:
            item: Raw item from fetch_updates()

        Returns:
            DealMention if item is M&A-relevant, None otherwise
        """
        pass

    async def monitor(self) -> List[DealMention]:
        """
        Execute a full monitoring cycle: fetch, parse, extract.

        Returns:
            List of DealMention objects found in this cycle
        """
        try:
            self.logger.info(f"Starting monitoring cycle for {self.source_name}")

            # Fetch updates
            items = await self.fetch_updates()
            self.logger.info(f"Fetched {len(items)} items from {self.source_name}")

            # Parse each item
            mentions = []
            for item in items:
                try:
                    mention = await self.parse_item(item)
                    if mention:
                        mentions.append(mention)
                except Exception as e:
                    self.logger.error(f"Error parsing item from {self.source_name}: {e}", exc_info=True)

            self.logger.info(f"Found {len(mentions)} M&A mentions from {self.source_name}")
            return mentions

        except Exception as e:
            self.logger.error(f"Error in monitoring cycle for {self.source_name}: {e}", exc_info=True)
            raise

    def get_credibility_score(self) -> float:
        """
        Get the credibility score for this source.

        Returns:
            Float between 0.0 and 1.0
        """
        from app.intelligence.models import SOURCE_CREDIBILITY
        return SOURCE_CREDIBILITY.get(self.source_name, 0.5)

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__}(source={self.source_name}, type={self.source_type})>"
