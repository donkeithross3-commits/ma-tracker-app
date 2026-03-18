"""
Deal Enrichment Pipeline — Extract terms + acquirer from SEC filings.

Runs on the droplet using Claude CLI ($0 via Max subscription).
Fetches filing text from SEC.gov, sends to Claude for structured extraction,
updates research_deals with acquirer info, deal price, and structure.

Usage (on droplet):
    python -m app.research.extraction.deal_enricher --limit 100 --verbose
"""

import asyncio
import json
import logging
import os
import re
import subprocess
from datetime import datetime, date
from pathlib import Path
from typing import Dict, List, Optional
from uuid import UUID

import asyncpg
import httpx

from .prompts import DEAL_TERMS_EXTRACTION_PROMPT

logger = logging.getLogger(__name__)

SEC_USER_AGENT = os.environ.get(
    "SEC_USER_AGENT", "DR3 Research research@dr3-dashboard.com"
)
SEC_RATE_DELAY = 0.3  # SEC enforces rate limits aggressively; 3 req/s is safe


class DealEnricher:
    """
    Enriches research_deals with extracted terms from SEC filings.

    Priority order for filing selection:
      1. DEFM14A (definitive merger proxy — most complete)
      2. SC TO-T (tender offer statement)
      3. PREM14A (preliminary proxy)
      4. SC 14D9 (target response to tender)
      5. S-4 (registration for stock deals)
      6. Any other filing

    For each deal:
      1. Find the best filing
      2. Fetch its text from SEC.gov
      3. Extract terms via Claude CLI
      4. Update research_deals with acquirer, price, structure
    """

    def __init__(self):
        self.http_client: Optional[httpx.AsyncClient] = None
        self.cli_model = os.environ.get("CLI_MODEL", "opus")
        self.cli_effort = os.environ.get("CLI_EFFORT_LEVEL", "medium")

    async def _get_http(self) -> httpx.AsyncClient:
        if self.http_client is None:
            self.http_client = httpx.AsyncClient(
                timeout=60.0,
                headers={"User-Agent": SEC_USER_AGENT},
                follow_redirects=True,
            )
        return self.http_client

    async def close(self):
        if self.http_client:
            await self.http_client.aclose()

    async def resolve_primary_doc_url(self, accession: str, cik: str) -> Optional[str]:
        """
        Resolve the actual primary document URL from a filing's index page.

        The master.idx .txt file is an SGML index — not the document itself.
        We need to fetch the -index.htm page and parse it for the actual doc.
        """
        client = await self._get_http()
        acc_no_dash = accession.replace("-", "")
        index_url = f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc_no_dash}/{accession}-index.htm"

        try:
            for attempt in range(3):
                await asyncio.sleep(SEC_RATE_DELAY + attempt * 2)
                resp = await client.get(index_url)
                if resp.status_code == 503:
                    await asyncio.sleep(5 * (attempt + 1))
                    continue
                resp.raise_for_status()
                break
            else:
                return None
            html = resp.text

            # Parse the index page for document links
            # Look for the primary document — usually the largest .htm file
            # Pattern: <a href="/Archives/edgar/data/CIK/ACCESSION/filename.htm">
            doc_links = re.findall(
                r'<a\s+href="(/Archives/edgar/data/[^"]+\.htm)"[^>]*>',
                html, re.IGNORECASE
            )

            # Also look for table rows with document descriptions
            # SEC index pages have: Type | Description | Document | Size
            # The primary doc is usually the first .htm that isn't the index
            for link in doc_links:
                if "-index" not in link.lower():
                    return f"https://www.sec.gov{link}"

            # Fallback: try any .htm link
            all_links = re.findall(r'href="(/Archives/edgar/data/[^"]+)"', html)
            for link in all_links:
                if link.endswith(('.htm', '.html')) and '-index' not in link.lower():
                    return f"https://www.sec.gov{link}"

            logger.warning(f"No primary doc found in {index_url}")
            return None

        except Exception as e:
            logger.warning(f"Failed to fetch index {index_url}: {e}")
            return None

    async def fetch_filing_text(self, filing_url: str, accession: str = "",
                                 cik: str = "", max_chars: int = 60000) -> Optional[str]:
        """
        Fetch and clean filing text from SEC.gov.

        If the URL points to a .txt file (SGML index), resolves the actual
        document URL first via the filing index page.
        Retries on 503 Service Unavailable (SEC rate limiting).
        """
        client = await self._get_http()

        # If URL ends in .txt, it's an index file — resolve the real doc
        actual_url = filing_url
        if filing_url.endswith('.txt') and accession and cik:
            resolved = await self.resolve_primary_doc_url(accession, cik)
            if resolved:
                actual_url = resolved
                logger.debug(f"Resolved doc URL: {actual_url}")

        # Retry with backoff for 503s (SEC rate limiting)
        for attempt in range(3):
            try:
                await asyncio.sleep(SEC_RATE_DELAY + attempt * 2)
                resp = await client.get(actual_url)
                if resp.status_code == 503:
                    backoff = 5 * (attempt + 1)
                    logger.warning(f"SEC 503, backing off {backoff}s (attempt {attempt+1})")
                    await asyncio.sleep(backoff)
                    continue
                resp.raise_for_status()
                raw = resp.text
                break
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 503 and attempt < 2:
                    await asyncio.sleep(5 * (attempt + 1))
                    continue
                logger.warning(f"Failed to fetch {actual_url}: {e}")
                return None
            except Exception as e:
                logger.warning(f"Failed to fetch {actual_url}: {e}")
                return None
        else:
            return None

        # Strip HTML
        text = re.sub(r'<(script|style)[^>]*>.*?</\1>', '', raw, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r'<[^>]+>', ' ', text)
        text = text.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
        text = text.replace('&nbsp;', ' ').replace('&#160;', ' ')
        text = re.sub(r'\s+', ' ', text)

        return text[:max_chars]

    def extract_via_cli(self, filing_text: str) -> Optional[dict]:
        """Call Claude CLI for deal terms extraction. Synchronous (blocking)."""
        prompt = f"{DEAL_TERMS_EXTRACTION_PROMPT}\n\nFiling text:\n{filing_text}"

        env = os.environ.copy()
        env.pop("ANTHROPIC_API_KEY", None)  # Force OAuth, not API key
        # Ensure OAuth token is available (loaded from .env by dotenv)
        oauth = os.environ.get("CLAUDE_CODE_OAUTH_TOKEN", "")
        if oauth:
            env["CLAUDE_CODE_OAUTH_TOKEN"] = oauth

        # Find claude CLI
        cli_path = self._find_cli()
        if not cli_path:
            logger.error("Claude CLI not found")
            return None

        try:
            result = subprocess.run(
                [cli_path, "-p", prompt, "--output-format", "json",
                 "--model", self.cli_model],
                capture_output=True, text=True, timeout=180, env=env,
            )

            if result.returncode != 0:
                logger.warning(f"CLI failed: {result.stdout[:300]}")
                return None

            return self._extract_json(result.stdout)
        except subprocess.TimeoutExpired:
            logger.warning("CLI timed out (180s)")
            return None
        except Exception as e:
            logger.error(f"CLI error: {e}")
            return None

    async def enrich_deal(self, conn: asyncpg.Connection, deal_id: UUID) -> bool:
        """Enrich a single deal with extracted terms."""
        # Get the deal and its filings
        deal = await conn.fetchrow(
            "SELECT * FROM research_deals WHERE deal_id = $1", deal_id
        )
        if not deal:
            return False

        filings = await conn.fetch(
            """
            SELECT id, accession_number, filing_type, filing_url, primary_doc_url
            FROM research_deal_filings
            WHERE deal_id = $1
            ORDER BY
                CASE filing_type
                    WHEN 'DEFM14A' THEN 1
                    WHEN 'SC TO-T' THEN 2
                    WHEN 'PREM14A' THEN 3
                    WHEN 'SC 14D9' THEN 4
                    WHEN 'SC 14D-9' THEN 5
                    WHEN 'SC 14D9/A' THEN 6
                    WHEN 'S-4' THEN 7
                    WHEN 'F-4' THEN 8
                    WHEN 'DEFA14A' THEN 9
                    ELSE 10
                END,
                filing_date
            LIMIT 3
            """,
            deal_id,
        )

        if not filings:
            return False

        # Try each filing until extraction succeeds
        target_cik = deal["target_cik"] or ""
        for filing in filings:
            url = filing["primary_doc_url"] or filing["filing_url"]
            accession = filing["accession_number"]
            if not url:
                continue

            # Resolve the actual document (not the SGML index)
            text = await self.fetch_filing_text(
                url, accession=accession, cik=target_cik.lstrip("0")
            )
            if not text or len(text) < 500:
                continue

            logger.info(f"Extracting from {filing['filing_type']} for {deal['deal_key']}")

            # Run CLI extraction (blocking — runs in thread pool)
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, self.extract_via_cli, text)

            if not result:
                continue

            # Update the deal record
            await self._apply_extraction(conn, deal_id, result, filing["accession_number"])
            return True

        logger.warning(f"Enrichment failed for {deal['deal_key']}")
        return False

    async def _apply_extraction(
        self, conn: asyncpg.Connection, deal_id: UUID, data: dict, accession: str
    ) -> None:
        """Apply extracted terms to research_deals."""
        consideration = data.get("consideration", {}) or {}

        acquirer_name = data.get("acquirer_name") or "Unknown"
        acquirer_ticker = data.get("acquirer_ticker")
        deal_structure = consideration.get("type", "other")
        deal_value = consideration.get("total_deal_value_mm")
        premium = consideration.get("premium_to_prior_close_pct")
        buyer_type = data.get("buyer_type", "other")
        is_hostile = data.get("is_hostile", False) or False
        is_mbo = data.get("is_mbo", False) or False
        is_going_private = data.get("is_going_private", False) or False

        # Parse dates
        expected_close = self._parse_date(data.get("expected_close_date"))
        outside_date = self._parse_date(data.get("outside_date"))
        signing_date = self._parse_date(data.get("signing_date"))

        # Validate deal_structure against enum
        valid_structures = {
            'all_cash', 'all_stock', 'cash_and_stock', 'cash_and_cvr',
            'stock_and_cvr', 'cash_stock_cvr', 'election', 'other'
        }
        if deal_structure not in valid_structures:
            deal_structure = 'other'

        valid_buyer_types = {
            'strategic_public', 'strategic_private', 'financial_sponsor',
            'consortium', 'management', 'government', 'spac', 'other'
        }
        if buyer_type not in valid_buyer_types:
            buyer_type = 'other'

        await conn.execute(
            """
            UPDATE research_deals SET
                acquirer_name = $2,
                acquirer_ticker = $3,
                acquirer_type = $4,
                deal_structure = $5,
                initial_deal_value_mm = $6,
                initial_premium_1d_pct = $7,
                is_hostile = $8,
                is_mbo = $9,
                is_going_private = $10,
                expected_close_date = $11,
                outside_date = $12,
                signing_date = $13,
                has_cvr = $14,
                last_enriched = NOW(),
                updated_at = NOW()
            WHERE deal_id = $1
            """,
            deal_id,
            acquirer_name,
            acquirer_ticker,
            buyer_type,
            deal_structure,
            deal_value,
            premium,
            is_hostile,
            is_mbo,
            is_going_private,
            expected_close,
            outside_date,
            signing_date,
            consideration.get("type", "") in ("cash_and_cvr", "stock_and_cvr"),
        )

        # Also insert initial consideration record
        cash = consideration.get("cash_per_share")
        total_ps = consideration.get("total_per_share")
        if cash or total_ps:
            deal_row = await conn.fetchrow(
                "SELECT announced_date FROM research_deals WHERE deal_id = $1", deal_id
            )
            ann_date = deal_row["announced_date"] if deal_row else date.today()

            await conn.execute(
                """
                INSERT INTO research_deal_consideration (
                    deal_id, version, bidder_name, is_original_bidder,
                    cash_per_share, stock_ratio, total_per_share,
                    total_deal_value_mm, premium_to_prior_close,
                    effective_date, announced_date
                ) VALUES ($1, 1, $2, true, $3, $4, $5, $6, $7, $8, $8)
                ON CONFLICT (deal_id, version) DO UPDATE SET
                    cash_per_share = $3, total_per_share = $5
                """,
                deal_id, acquirer_name,
                cash,
                consideration.get("stock_ratio"),
                total_ps,
                deal_value,
                premium,
                ann_date,
            )

        logger.info(
            f"Enriched: acquirer={acquirer_name}, "
            f"structure={deal_structure}, value={deal_value}MM"
        )

    @staticmethod
    def _parse_date(s: Optional[str]):
        if not s:
            return None
        try:
            return datetime.strptime(s, "%Y-%m-%d").date()
        except (ValueError, TypeError):
            return None

    @staticmethod
    def _find_cli() -> Optional[str]:
        candidates = ["/usr/local/bin/claude"]
        nvm = Path.home() / ".nvm" / "versions" / "node"
        if nvm.exists():
            for d in sorted(nvm.iterdir(), reverse=True):
                candidates.append(str(d / "bin" / "claude"))
        for p in candidates:
            if os.path.isfile(p) and os.access(p, os.X_OK):
                return p
        try:
            r = subprocess.run(["which", "claude"], capture_output=True, text=True, timeout=5)
            if r.returncode == 0:
                return r.stdout.strip()
        except Exception:
            pass
        return None

    @staticmethod
    def _extract_json(text: str) -> Optional[dict]:
        """Extract JSON from Claude output."""
        # Try parsing the output-format json wrapper
        try:
            wrapper = json.loads(text)
            if isinstance(wrapper, dict) and "result" in wrapper:
                content = wrapper["result"]
                if isinstance(content, str):
                    return json.loads(content)
                return content
        except (json.JSONDecodeError, TypeError):
            pass

        # Direct parse
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

        # Strip markdown fences
        cleaned = re.sub(r'```(?:json)?\s*', '', text)
        cleaned = re.sub(r'```\s*$', '', cleaned)

        # Find outermost braces
        match = re.search(r'\{.*\}', cleaned, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                fixed = re.sub(r',\s*([}\]])', r'\1', match.group(0))
                try:
                    return json.loads(fixed)
                except json.JSONDecodeError:
                    pass

        return None


async def run_enrichment(
    limit: int = 50,
    offset: int = 0,
    priority_types: Optional[List[str]] = None,
) -> Dict:
    """
    Run deal enrichment on priority deals.

    Prioritizes deals with DEFM14A filings (most complete data).
    Use --offset to partition work across parallel workers.
    """
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parents[3] / ".env")

    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    enricher = DealEnricher()

    if not priority_types:
        priority_types = ["DEFM14A", "SC TO-T", "PREM14A", "SC 14D9", "SC 14D-9", "SC 14D9/A"]

    type_list = "', '".join(priority_types)

    # Find deals with high-quality M&A filings that still need enrichment.
    # Use OFFSET for parallel worker partitioning (each worker gets a different slice).
    deals = await conn.fetch(f"""
        SELECT DISTINCT ON (rd.deal_id) rd.deal_id, rd.deal_key, rd.target_ticker
        FROM research_deals rd
        JOIN research_deal_filings rdf ON rd.deal_id = rdf.deal_id
        WHERE rd.acquirer_name = 'Unknown'
          AND rdf.filing_type IN ('{type_list}')
        ORDER BY rd.deal_id, rd.deal_key
        LIMIT $1 OFFSET $2
    """, limit, offset)

    logger.info(f"Enriching {len(deals)} deals with priority filings")
    results = {"enriched": 0, "failed": 0, "skipped": 0}

    for i, deal in enumerate(deals):
        try:
            success = await enricher.enrich_deal(conn, deal["deal_id"])
            if success:
                results["enriched"] += 1
            else:
                results["failed"] += 1
        except Exception as e:
            logger.error(f"Error enriching {deal['deal_key']}: {e}")
            results["failed"] += 1

        if (i + 1) % 10 == 0:
            logger.info(f"Progress: {i+1}/{len(deals)} ({results['enriched']} enriched)")

    await enricher.close()
    await conn.close()

    logger.info(f"Enrichment complete: {results}")
    return results


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Enrich research deals with filing data")
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--offset", type=int, default=0, help="Skip first N deals (for parallel workers)")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    result = asyncio.run(run_enrichment(limit=args.limit, offset=args.offset))
    print(f"Done: {result}")
