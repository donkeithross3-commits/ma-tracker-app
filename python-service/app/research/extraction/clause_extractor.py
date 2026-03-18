"""
Clause Extractor — LLM-powered extraction of deal protection terms from SEC filings.

Uses Claude CLI (Opus via Max subscription, $0 marginal cost) for extraction.
Falls back to Claude API if CLI is unavailable.

Architecture:
  1. Fetch filing text from SEC.gov (with caching)
  2. Identify relevant sections (merger agreement, deal protection)
  3. Send to Claude for structured JSON extraction
  4. Validate and store results
"""

import asyncio
import json
import logging
import os
import re
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import asyncpg
import httpx

from .prompts import (
    BACKGROUND_SECTION_EXTRACTION_PROMPT,
    CLAUSE_EXTRACTION_SYSTEM_PROMPT,
    DEAL_TERMS_EXTRACTION_PROMPT,
    EVENT_EXTRACTION_PROMPT,
)

logger = logging.getLogger(__name__)

# SEC rate limit
SEC_RATE_LIMIT_DELAY = 0.3  # Conservative — SEC is aggressive about blocking
SEC_USER_AGENT = os.environ.get(
    "SEC_USER_AGENT",
    "DR3 Research research@dr3-dashboard.com"
)


class FilingFetcher:
    """Fetches and caches SEC filing content."""

    def __init__(self):
        self.client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self.client is None:
            self.client = httpx.AsyncClient(
                timeout=60.0,
                headers={"User-Agent": SEC_USER_AGENT},
                follow_redirects=True,
            )
        return self.client

    async def close(self):
        if self.client:
            await self.client.aclose()
            self.client = None

    async def fetch_filing_text(
        self,
        filing_url: str,
        conn: Optional[asyncpg.Connection] = None,
        accession: Optional[str] = None,
        cik: Optional[str] = None,
        max_chars: int = 80000,
    ) -> Optional[str]:
        """
        Fetch filing text, using database cache if available.

        If the URL points to a .txt file (SGML index), resolves the actual
        document URL first via the filing index page.
        Strips HTML tags to get raw text for LLM processing.
        """
        # Check cache first
        if not accession:
            accession = self._url_to_accession(filing_url)
        if conn and accession:
            cached = await conn.fetchrow(
                "SELECT content_text FROM research_filing_cache WHERE accession_number = $1",
                accession,
            )
            if cached and cached["content_text"]:
                return cached["content_text"][:max_chars]

        # Resolve .txt index URLs to actual HTML document
        actual_url = filing_url
        if filing_url.endswith('.txt') and accession:
            resolved = await self._resolve_primary_doc_url(accession, cik or "")
            if resolved:
                actual_url = resolved
                logger.debug(f"Resolved doc URL: {actual_url}")

        # Fetch from SEC with retry
        client = await self._get_client()
        for attempt in range(3):
            try:
                await asyncio.sleep(SEC_RATE_LIMIT_DELAY + attempt * 2)
                response = await client.get(actual_url)
                if response.status_code == 503:
                    backoff = 5 * (attempt + 1)
                    logger.warning(f"SEC 503, backing off {backoff}s (attempt {attempt+1})")
                    await asyncio.sleep(backoff)
                    continue
                response.raise_for_status()
                raw_html = response.text
                break
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 503 and attempt < 2:
                    await asyncio.sleep(5 * (attempt + 1))
                    continue
                logger.error(f"Error fetching {actual_url}: {e}")
                return None
            except Exception as e:
                logger.error(f"Error fetching {actual_url}: {e}")
                return None
        else:
            return None

        text = self._strip_html(raw_html)[:max_chars]

        # Cache it
        if conn and accession:
            try:
                await conn.execute(
                    """
                    INSERT INTO research_filing_cache
                        (accession_number, filing_type, filing_url, content_text, content_length)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (accession_number) DO UPDATE SET
                        content_text = $4, content_length = $5, fetched_at = NOW()
                    """,
                    accession,
                    self._guess_filing_type(actual_url),
                    actual_url,
                    text,
                    len(text),
                )
            except Exception as e:
                logger.warning(f"Failed to cache filing {accession}: {e}")

        return text

    async def _resolve_primary_doc_url(self, accession: str, cik: str) -> Optional[str]:
        """
        Resolve the actual primary document URL from a filing's index page.

        Same logic as DealEnricher.resolve_primary_doc_url — the .txt URL from
        master.idx is an SGML index, not the actual document.
        """
        client = await self._get_client()
        acc_no_dash = accession.replace("-", "")
        cik_clean = cik.lstrip("0") if cik else ""

        # Try both CIK-based and accession-based index URLs
        index_urls = []
        if cik_clean:
            index_urls.append(
                f"https://www.sec.gov/Archives/edgar/data/{cik_clean}/{acc_no_dash}/{accession}-index.htm"
            )
        # Also try the accession-only URL pattern
        index_urls.append(
            f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&accession={accession}&type=&dateb=&owner=include&count=40"
        )

        for index_url in index_urls[:1]:  # Just try the first pattern
            try:
                await asyncio.sleep(SEC_RATE_LIMIT_DELAY)
                resp = await client.get(index_url)
                if resp.status_code == 503:
                    await asyncio.sleep(5)
                    resp = await client.get(index_url)
                if resp.status_code != 200:
                    continue
                html = resp.text

                # Find the primary document link
                doc_links = re.findall(
                    r'<a\s+href="(/Archives/edgar/data/[^"]+\.htm)"[^>]*>',
                    html, re.IGNORECASE,
                )
                for link in doc_links:
                    if "-index" not in link.lower():
                        return f"https://www.sec.gov{link}"

                # Fallback: any .htm/.html link
                all_links = re.findall(r'href="(/Archives/edgar/data/[^"]+)"', html)
                for link in all_links:
                    if link.endswith(('.htm', '.html')) and '-index' not in link.lower():
                        return f"https://www.sec.gov{link}"

            except Exception as e:
                logger.warning(f"Failed to resolve {index_url}: {e}")

        return None

    @staticmethod
    def _strip_html(html: str) -> str:
        """Strip HTML tags to get raw text."""
        # Remove script/style blocks
        text = re.sub(r'<(script|style)[^>]*>.*?</\1>', '', html, flags=re.DOTALL | re.IGNORECASE)
        # Remove HTML tags
        text = re.sub(r'<[^>]+>', ' ', text)
        # Decode entities
        text = text.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
        text = text.replace('&nbsp;', ' ').replace('&#160;', ' ')
        # Normalize whitespace
        text = re.sub(r'\s+', ' ', text)
        text = re.sub(r'\n\s*\n', '\n\n', text)
        return text.strip()

    @staticmethod
    def _url_to_accession(url: str) -> Optional[str]:
        """Extract accession number from a filing URL."""
        match = re.search(r'(\d{10}-\d{2}-\d{6})', url)
        if match:
            return match.group(1)
        # Try without dashes
        match = re.search(r'/(\d{18})/', url)
        if match:
            raw = match.group(1)
            return f"{raw[:10]}-{raw[10:12]}-{raw[12:]}"
        return None

    @staticmethod
    def _guess_filing_type(url: str) -> str:
        """Guess filing type from URL."""
        url_lower = url.lower()
        if "defm14a" in url_lower:
            return "DEFM14A"
        if "prem14a" in url_lower:
            return "PREM14A"
        if "sc-to" in url_lower or "sc+to" in url_lower:
            return "SC TO-T"
        if "8-k" in url_lower:
            return "8-K"
        if "s-4" in url_lower:
            return "S-4"
        return "UNKNOWN"


class ClaudeExtractor:
    """
    Calls Claude (CLI or API) for structured extraction.

    Prefers CLI ($0 cost via Max subscription) over API.
    """

    def __init__(self):
        # Default to CLI (free via Max subscription) — only fall back to API if CLI not found
        self.use_cli = os.environ.get("USE_CLI_EXTRACTION", "true").lower() == "true"
        self.cli_model = os.environ.get("CLI_MODEL", "opus")
        self.cli_effort = os.environ.get("CLI_EFFORT_LEVEL", "medium")

    async def extract(
        self,
        system_prompt: str,
        filing_text: str,
        max_text_length: int = 80000,
    ) -> Optional[dict]:
        """
        Extract structured data from filing text using Claude.

        Truncates filing text to max_text_length to stay within context limits.
        """
        truncated = filing_text[:max_text_length]
        user_prompt = f"Extract the requested information from this SEC filing text:\n\n{truncated}"

        if self.use_cli:
            return await self._extract_cli(system_prompt, user_prompt)
        else:
            return await self._extract_api(system_prompt, user_prompt)

    async def _extract_cli(
        self,
        system_prompt: str,
        user_prompt: str,
    ) -> Optional[dict]:
        """Extract using Claude CLI ($0 cost)."""
        cli_path = self._find_claude_cli()
        if not cli_path:
            logger.warning("Claude CLI not found, falling back to API")
            return await self._extract_api(system_prompt, user_prompt)

        full_prompt = f"{system_prompt}\n\n{user_prompt}"

        env = os.environ.copy()
        env.pop("ANTHROPIC_API_KEY", None)  # Force OAuth, not API
        env["HOME"] = "/tmp/claude-cli-home"

        # Add nvm to PATH if available
        nvm_bin = os.path.expanduser("~/.nvm/versions/node")
        if os.path.exists(nvm_bin):
            for node_dir in sorted(Path(nvm_bin).iterdir(), reverse=True):
                bin_dir = node_dir / "bin"
                if bin_dir.exists():
                    env["PATH"] = f"{bin_dir}:{env.get('PATH', '')}"
                    break

        try:
            cmd = [
                cli_path,
                "-p", full_prompt,
                "--output-format", "json",
                "--model", self.cli_model,
            ]

            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )

            stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=300,  # 5 min timeout for large filings
            )

            if process.returncode != 0:
                error_text = stdout.decode() + stderr.decode()
                logger.error(f"CLI extraction failed: {error_text[:500]}")
                return None

            output = stdout.decode()
            return self._extract_json(output)

        except asyncio.TimeoutError:
            logger.error("CLI extraction timed out (5 min)")
            return None
        except Exception as e:
            logger.error(f"CLI extraction error: {e}")
            return None

    async def _extract_api(
        self,
        system_prompt: str,
        user_prompt: str,
    ) -> Optional[dict]:
        """Extract using Claude API (costs money)."""
        try:
            import anthropic

            client = anthropic.Anthropic()
            response = client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=4096,
                system=system_prompt,
                messages=[{"role": "user", "content": user_prompt}],
            )

            text = response.content[0].text
            return self._extract_json(text)

        except Exception as e:
            logger.error(f"API extraction error: {e}")
            return None

    @staticmethod
    def _find_claude_cli() -> Optional[str]:
        """Find the Claude CLI binary."""
        # Check common locations
        candidates = [
            "/usr/local/bin/claude",
            os.path.expanduser("~/.npm-global/bin/claude"),
        ]
        # Check nvm versions
        nvm_base = os.path.expanduser("~/.nvm/versions/node")
        if os.path.exists(nvm_base):
            for node_dir in sorted(Path(nvm_base).iterdir(), reverse=True):
                candidates.append(str(node_dir / "bin" / "claude"))

        for path in candidates:
            if os.path.isfile(path) and os.access(path, os.X_OK):
                return path

        # Try which
        try:
            result = subprocess.run(
                ["which", "claude"], capture_output=True, text=True, timeout=5
            )
            if result.returncode == 0:
                return result.stdout.strip()
        except Exception:
            pass

        return None

    @staticmethod
    def _extract_json(text: str) -> Optional[dict]:
        """
        Extract JSON from LLM output, handling common format issues.

        Recovery pipeline:
        1. Direct json.loads
        2. Strip markdown fences
        3. Find outermost braces
        4. Fix trailing commas
        """
        # Try direct parse
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

        # Try stripping markdown fences
        cleaned = re.sub(r'```(?:json)?\s*', '', text)
        cleaned = re.sub(r'```\s*$', '', cleaned)
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            pass

        # Find outermost braces
        match = re.search(r'\{.*\}', cleaned, re.DOTALL)
        if match:
            candidate = match.group(0)
            try:
                return json.loads(candidate)
            except json.JSONDecodeError:
                # Fix trailing commas
                fixed = re.sub(r',\s*([}\]])', r'\1', candidate)
                try:
                    return json.loads(fixed)
                except json.JSONDecodeError:
                    pass

        logger.warning(f"Failed to extract JSON from response ({len(text)} chars)")
        return None


class ClauseExtractionPipeline:
    """
    Full clause extraction pipeline for a deal.

    Orchestrates:
      1. Find the merger agreement filing
      2. Fetch its text
      3. Extract clauses via LLM
      4. Validate confidence scores
      5. Store in research_deal_clauses
    """

    def __init__(self):
        self.fetcher = FilingFetcher()
        self.extractor = ClaudeExtractor()

    async def close(self):
        await self.fetcher.close()

    async def extract_clauses_for_deal(
        self,
        conn: asyncpg.Connection,
        deal_id: str,
    ) -> Optional[dict]:
        """
        Extract deal protection clauses for a single deal.

        Returns the extracted clause data, or None if extraction failed.
        """
        import uuid

        deal_uuid = uuid.UUID(deal_id) if isinstance(deal_id, str) else deal_id

        # Find the merger agreement filing (priority: 8-K with merger agreement, then DEFM14A)
        filings = await conn.fetch(
            """
            SELECT * FROM research_deal_filings
            WHERE deal_id = $1
            ORDER BY
                CASE
                    WHEN is_merger_agreement THEN 0
                    WHEN filing_type = 'DEFM14A' THEN 1
                    WHEN filing_type = 'PREM14A' THEN 2
                    WHEN filing_type LIKE 'SC TO%' THEN 3
                    WHEN filing_type = '8-K' THEN 4
                    ELSE 5
                END,
                filing_date
            """,
            deal_uuid,
        )

        if not filings:
            logger.warning(f"No filings found for deal {deal_id}")
            return None

        # Get target CIK for URL resolution
        deal = await conn.fetchrow(
            "SELECT target_cik FROM research_deals WHERE deal_id = $1", deal_uuid
        )
        target_cik = (deal["target_cik"] or "") if deal else ""

        # Try each filing until we get a successful extraction
        for filing_row in filings[:3]:  # Try top 3 priority filings
            filing_url = filing_row["primary_doc_url"] or filing_row["filing_url"]
            if not filing_url:
                continue

            logger.info(
                f"Extracting clauses from {filing_row['filing_type']} "
                f"({filing_row['accession_number']})"
            )

            text = await self.fetcher.fetch_filing_text(
                filing_url, conn,
                accession=filing_row["accession_number"],
                cik=target_cik,
            )
            if not text or len(text) < 500:
                continue

            # Extract clauses
            result = await self.extractor.extract(
                system_prompt=CLAUSE_EXTRACTION_SYSTEM_PROMPT,
                filing_text=text,
            )

            if result:
                # Store the extraction
                await self._store_clauses(conn, deal_uuid, result, filing_row["accession_number"])
                return result

        logger.warning(f"Clause extraction failed for all filings of deal {deal_id}")

        # Update status to failed
        await conn.execute(
            "UPDATE research_deals SET clause_extraction_status = 'failed' WHERE deal_id = $1",
            deal_uuid,
        )
        return None

    async def extract_deal_terms(
        self,
        conn: asyncpg.Connection,
        deal_id: str,
        filing_url: str,
    ) -> Optional[dict]:
        """Extract deal terms (price, parties, structure) from a filing."""
        import uuid
        deal_uuid = uuid.UUID(deal_id) if isinstance(deal_id, str) else deal_id

        text = await self.fetcher.fetch_filing_text(filing_url, conn)
        if not text:
            return None

        return await self.extractor.extract(
            system_prompt=DEAL_TERMS_EXTRACTION_PROMPT,
            filing_text=text,
        )

    async def extract_events(
        self,
        conn: asyncpg.Connection,
        deal_id: str,
        filing_url: str,
    ) -> Optional[dict]:
        """Extract deal events from a filing."""
        text = await self.fetcher.fetch_filing_text(filing_url, conn)
        if not text:
            return None

        return await self.extractor.extract(
            system_prompt=EVENT_EXTRACTION_PROMPT,
            filing_text=text,
        )

    async def _store_clauses(
        self,
        conn: asyncpg.Connection,
        deal_id,
        data: dict,
        accession_number: str,
    ) -> None:
        """Store extracted clauses in research_deal_clauses."""
        go_shop = data.get("go_shop", {}) or {}
        no_shop = data.get("no_shop", {}) or {}
        match = data.get("match_rights", {}) or {}
        fees = data.get("termination_fees", {}) or {}
        financing = data.get("financing", {}) or {}
        regulatory = data.get("regulatory", {}) or {}
        collar = data.get("collar", {}) or {}
        mac = data.get("mac", {}) or {}

        # Compute overall confidence
        confidences = [
            go_shop.get("confidence", 0.5),
            no_shop.get("confidence", 0.5),
            match.get("confidence", 0.5),
            fees.get("confidence", 0.5),
        ]
        avg_confidence = sum(confidences) / len(confidences)

        await conn.execute(
            """
            INSERT INTO research_deal_clauses (
                deal_id,
                has_go_shop, go_shop_period_days, go_shop_start_date, go_shop_end_date,
                go_shop_fee_mm, go_shop_fee_pct, post_go_shop_match,
                no_shop_strength, fiduciary_out, fiduciary_out_type, window_shop_allowed,
                has_match_right, match_right_days, match_right_rounds, match_right_type,
                target_termination_fee_mm, target_termination_fee_pct,
                acquirer_termination_fee_mm, acquirer_termination_fee_pct,
                two_tier_fee, force_the_vote,
                has_financing_condition, financing_committed, financing_sources,
                requires_hsr, requires_cfius, requires_eu_merger,
                requires_other_regulatory, regulatory_complexity,
                mac_exclusion_breadth, pandemic_carveout, industry_carveout,
                has_collar, collar_type, collar_floor, collar_ceiling, walk_away_right,
                extraction_method, extraction_confidence, extraction_source
            ) VALUES (
                $1,
                $2, $3, $4, $5, $6, $7, $8,
                $9, $10, $11, $12,
                $13, $14, $15, $16,
                $17, $18, $19, $20, $21, $22,
                $23, $24, $25,
                $26, $27, $28, $29, $30,
                $31, $32, $33,
                $34, $35, $36, $37, $38,
                $39, $40, $41
            )
            ON CONFLICT (deal_id) DO UPDATE SET
                has_go_shop = $2, go_shop_period_days = $3,
                go_shop_start_date = $4, go_shop_end_date = $5,
                extraction_confidence = $40, extraction_source = $41,
                updated_at = NOW()
            """,
            deal_id,
            go_shop.get("has_go_shop"),
            go_shop.get("period_days"),
            self._parse_date(go_shop.get("start_date")),
            self._parse_date(go_shop.get("end_date")),
            go_shop.get("go_shop_fee_mm"),
            go_shop.get("go_shop_fee_pct"),
            match.get("post_go_shop_match"),
            no_shop.get("strength"),
            no_shop.get("fiduciary_out"),
            no_shop.get("fiduciary_out_type"),
            no_shop.get("window_shop"),
            match.get("has_match_right"),
            match.get("match_period_days"),
            match.get("match_rounds"),
            match.get("match_type"),
            fees.get("target_fee_mm"),
            fees.get("target_fee_pct"),
            fees.get("acquirer_fee_mm"),
            fees.get("acquirer_fee_pct"),
            fees.get("two_tier"),
            data.get("force_the_vote"),
            financing.get("has_financing_condition"),
            financing.get("committed"),
            financing.get("sources"),
            regulatory.get("requires_hsr"),
            regulatory.get("requires_cfius"),
            regulatory.get("requires_eu"),
            regulatory.get("other_approvals"),
            regulatory.get("complexity"),
            mac.get("exclusion_breadth"),
            mac.get("pandemic_carveout"),
            mac.get("industry_carveout"),
            collar.get("has_collar"),
            collar.get("type"),
            collar.get("floor"),
            collar.get("ceiling"),
            collar.get("walk_away"),
            "llm_claude",
            avg_confidence,
            accession_number,
        )

        # Update deal status
        status = "complete" if avg_confidence >= 0.7 else "partial"
        await conn.execute(
            "UPDATE research_deals SET clause_extraction_status = $1 WHERE deal_id = $2",
            status,
            deal_id,
        )

        logger.info(
            f"Stored clauses for deal {deal_id}: "
            f"go_shop={go_shop.get('has_go_shop')}, "
            f"confidence={avg_confidence:.2f}"
        )

    @staticmethod
    def _parse_date(date_str: Optional[str]):
        """Parse a date string, returning None on failure."""
        if not date_str:
            return None
        try:
            from datetime import datetime
            return datetime.strptime(date_str, "%Y-%m-%d").date()
        except (ValueError, TypeError):
            return None


async def run_clause_extraction(
    limit: int = 50,
    offset: int = 0,
    verbose: bool = False,
) -> Dict:
    """
    Run clause extraction on enriched deals.

    Targets deals that have:
    1. Been enriched (acquirer known)
    2. Have DEFM14A, PREM14A, or SC TO-T filings (most likely to contain clauses)
    3. Haven't already had clauses extracted

    Rate-limits SEC requests to avoid 503s.

    Args:
        limit: Max deals to process
        offset: Skip first N deals (for parallel workers)
        verbose: Enable debug logging
    """
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parents[3] / ".env")

    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    pipeline = ClauseExtractionPipeline()

    # Find enriched deals that need clause extraction
    deals = await conn.fetch(
        """
        SELECT DISTINCT ON (d.deal_id) d.deal_id, d.deal_key, d.target_ticker
        FROM research_deals d
        JOIN research_deal_filings f ON d.deal_id = f.deal_id
        WHERE d.acquirer_name IS NOT NULL AND d.acquirer_name != 'Unknown'
          AND f.filing_type IN ('DEFM14A', 'PREM14A', 'SC TO-T', 'SC 14D9')
          AND (d.clause_extraction_status IS NULL OR d.clause_extraction_status = 'pending')
        ORDER BY d.deal_id, d.deal_key
        LIMIT $1 OFFSET $2
        """,
        limit, offset,
    )

    logger.info(f"Extracting clauses for {len(deals)} deals")
    results = {"extracted": 0, "failed": 0, "skipped": 0}

    for i, deal in enumerate(deals):
        try:
            result = await pipeline.extract_clauses_for_deal(conn, deal["deal_id"])
            if result:
                results["extracted"] += 1
                go_shop = result.get("go_shop", {})
                logger.info(
                    f"[{i+1}/{len(deals)}] {deal['deal_key']}: "
                    f"go_shop={go_shop.get('has_go_shop')}, "
                    f"match={result.get('match_rights', {}).get('has_match_right')}"
                )
            else:
                results["failed"] += 1
        except Exception as e:
            logger.error(f"Error extracting clauses for {deal['deal_key']}: {e}")
            results["failed"] += 1

        if (i + 1) % 10 == 0:
            logger.info(f"Progress: {i+1}/{len(deals)} ({results})")

    await pipeline.close()
    await conn.close()

    logger.info(f"Clause extraction complete: {results}")
    return results


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Extract deal protection clauses from SEC filings")
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    result = asyncio.run(run_clause_extraction(
        limit=args.limit,
        offset=args.offset,
        verbose=args.verbose,
    ))
    print(f"Done: {result}")
