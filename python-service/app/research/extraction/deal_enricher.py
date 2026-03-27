"""
Deal Enrichment Pipeline — Extract terms + acquirer from SEC filings.

Runs on the droplet using Claude CLI ($0 via Max subscription).
Fetches filing text from SEC.gov, sends to Claude for structured extraction,
updates research_deals with acquirer info, deal price, and structure.

IMPORTANT: Uses BATCHED CLI calls — one prompt per batch of up to 20 filings.
Never call CLI in a per-filing loop (see CLAUDE.md "AI Token Economics").

Usage (on droplet):
    python -m app.research.extraction.deal_enricher --limit 100 --verbose
    python -m app.research.extraction.deal_enricher --limit 5 --verbose   # test first
"""

import asyncio
import json
import logging
import os
import re
import subprocess
import time as _time
from datetime import datetime, date
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from uuid import UUID

import asyncpg
import httpx

from ...utils.quota_gate import QuotaGate
from .prompts import DEAL_TERMS_EXTRACTION_PROMPT

logger = logging.getLogger(__name__)

SEC_USER_AGENT = os.environ.get(
    "SEC_USER_AGENT", "DR3 Research research@dr3-dashboard.com"
)
SEC_RATE_DELAY = 0.3  # SEC enforces rate limits aggressively; 3 req/s is safe

# Batching constants
BATCH_SIZE = 20  # Max filings per CLI call (~20 × 8K chars ≈ 40K tokens content)
FILING_TRUNCATE_CHARS = 32000  # ~8K tokens — deal terms are near the top
LARGE_FILING_THRESHOLD = 60000  # >15K tokens — too large to batch, use single fallback
BATCH_SLEEP_SEC = 5  # Sleep between batches to avoid hammering subscription
DEFAULT_MAX_PER_RUN = 100


class DealEnricher:
    """
    Enriches research_deals with extracted terms from SEC filings.

    Uses batched CLI calls: one Claude invocation extracts terms from up to
    20 filings simultaneously, amortizing ~100K tokens of system prompt overhead
    across the batch instead of paying it per-filing.

    Priority order for filing selection:
      1. DEFM14A (definitive merger proxy -- most complete)
      2. SC TO-T (tender offer statement)
      3. PREM14A (preliminary proxy)
      4. SC 14D9 (target response to tender)
      5. S-4 (registration for stock deals)
      6. Any other filing
    """

    def __init__(self):
        self.http_client: Optional[httpx.AsyncClient] = None
        # Sonnet for structured extraction -- equally reliable, 5x cheaper tokens
        self.cli_model = os.environ.get("CLI_MODEL", "sonnet")
        self.cli_effort = os.environ.get("CLI_EFFORT_LEVEL", "medium")
        # Quota gate: adaptive rate limiting for subscription budget
        self.gate = QuotaGate()

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

        The master.idx .txt file is an SGML index -- not the document itself.
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

            doc_links = re.findall(
                r'<a\s+href="(/Archives/edgar/data/[^"]+\.htm)"[^>]*>',
                html, re.IGNORECASE
            )

            for link in doc_links:
                if "-index" not in link.lower():
                    return f"https://www.sec.gov{link}"

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

        # If URL ends in .txt, it's an index file -- resolve the real doc
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

    # ─── Batch extraction (primary path) ────────────────────────────────

    def extract_batch_via_cli(
        self, filings: List[Tuple[str, str]]
    ) -> Dict[str, Optional[dict]]:
        """
        Extract deal terms from multiple filings in ONE CLI call.

        Args:
            filings: List of (accession_number, filing_text) tuples, max 20.

        Returns:
            Dict mapping accession_number -> extracted dict (or None on failure).
            System prompt overhead is paid once for the entire batch.
        """
        if not filings:
            return {}

        # Build the batched prompt
        batch_prompt = (
            f"{DEAL_TERMS_EXTRACTION_PROMPT}\n\n"
            "You will now receive multiple SEC filings. Extract deal terms from EACH filing "
            "independently. Return a JSON array with one object per filing. Each object MUST "
            "include an \"accession\" field matching the accession number from the filing header.\n\n"
            f"There are {len(filings)} filings below.\n\n"
        )

        for i, (accession, text) in enumerate(filings):
            truncated = text[:FILING_TRUNCATE_CHARS]
            batch_prompt += (
                f"--- FILING {i + 1} (accession: {accession}) ---\n"
                f"{truncated}\n\n"
            )

        batch_prompt += (
            "Return ONLY a JSON array with one object per filing. "
            "Each object must have an \"accession\" field plus all the extraction fields "
            "from the schema above. Example:\n"
            "[{\"accession\": \"0001193125-24-012345\", \"target_name\": \"...\", ...}, ...]\n"
        )

        cli_path = self._find_cli()
        if not cli_path:
            logger.error("Claude CLI not found")
            return {acc: None for acc, _ in filings}

        env = self._build_cli_env(cli_path)

        accession_list = [acc for acc, _ in filings]
        results: Dict[str, Optional[dict]] = {acc: None for acc in accession_list}

        try:
            t0 = _time.monotonic()
            # Pipe prompt via stdin to avoid E2BIG (OS arg limit ~2MB).
            # Batch prompts with 14+ filings × 32K chars easily exceed that.
            # `claude -p` with no argument reads from stdin.
            result = subprocess.run(
                [cli_path, "-p", "--output-format", "json",
                 "--model", self.cli_model],
                input=batch_prompt,
                capture_output=True, text=True,
                timeout=600,  # 10 min for batch
                env=env,
            )
            elapsed_ms = int((_time.monotonic() - t0) * 1000)

            if result.returncode != 0:
                logger.warning(f"Batch CLI failed (rc={result.returncode}): {result.stdout[:500]}")
                return results

            # Parse the batch response
            parsed_array = self._extract_json_array(result.stdout)

            if parsed_array is None:
                # Try parsing as single object (model might return one if only 1 filing)
                if len(filings) == 1:
                    single = self._extract_json(result.stdout)
                    if single:
                        results[accession_list[0]] = single
                        logger.info(f"Batch of 1: parsed single result for {accession_list[0]}")
                else:
                    logger.warning(
                        f"Failed to parse batch JSON array from CLI output "
                        f"({len(result.stdout)} chars)"
                    )
                self._report_batch_usage(result, elapsed_ms, len(filings), batch_prompt)
                return results

            # Map results back to accession numbers
            matched = 0
            for item in parsed_array:
                if not isinstance(item, dict):
                    continue
                acc = item.get("accession", "").strip()
                if acc in results:
                    results[acc] = item
                    matched += 1
                else:
                    # Try fuzzy match (model might reformat accession)
                    for known_acc in accession_list:
                        if known_acc in acc or acc in known_acc:
                            results[known_acc] = item
                            matched += 1
                            break

            # If model returned positional results without accession keys, map by index
            if matched == 0 and len(parsed_array) == len(filings):
                logger.info("Batch: no accession keys in output, mapping by position")
                for i, item in enumerate(parsed_array):
                    if isinstance(item, dict):
                        results[accession_list[i]] = item
                        matched += 1

            logger.info(
                f"Batch extraction: {matched}/{len(filings)} filings parsed, "
                f"{elapsed_ms}ms, model={self.cli_model}"
            )

            self._report_batch_usage(result, elapsed_ms, len(filings), batch_prompt)
            return results

        except subprocess.TimeoutExpired:
            logger.warning(f"Batch CLI timed out (600s) for {len(filings)} filings")
            return results
        except Exception as e:
            logger.error(f"Batch CLI error: {e}")
            return results

    # ─── Single-filing fallback (for oversized filings) ─────────────────

    def extract_via_cli(self, filing_text: str) -> Optional[dict]:
        """
        Call Claude CLI for deal terms extraction from a SINGLE filing.

        WARNING: This is the high-overhead fallback path. Each call pays ~100K tokens
        of system prompt overhead. Use extract_batch_via_cli() for normal operation.
        Only use this for filings too large to batch (>15K tokens).
        """
        logger.warning(
            "Single-filing CLI fallback -- high overhead. "
            "Consider truncating to use batch path instead."
        )

        prompt = f"{DEAL_TERMS_EXTRACTION_PROMPT}\n\nFiling text:\n{filing_text}"

        cli_path = self._find_cli()
        if not cli_path:
            logger.error("Claude CLI not found")
            return None

        env = self._build_cli_env(cli_path)

        try:
            t0 = _time.monotonic()
            result = subprocess.run(
                [cli_path, "-p", prompt, "--output-format", "json",
                 "--model", self.cli_model],
                capture_output=True, text=True, timeout=180, env=env,
            )
            elapsed_ms = int((_time.monotonic() - t0) * 1000)

            if result.returncode != 0:
                logger.warning(f"CLI failed: {result.stdout[:300]}")
                return None

            parsed = self._extract_json(result.stdout)

            # Log to central telemetry (non-fatal, best-effort)
            try:
                raw_output = result.stdout.strip()
                cli_json = json.loads(raw_output) if raw_output.startswith("{") else {}
                usage = cli_json.get("usage", {})
                input_tokens = usage.get("input_tokens", len(prompt) // 4)
                output_tokens = usage.get("output_tokens", len(raw_output) // 4)
                cache_c = usage.get("cache_creation_input_tokens", 0)
                cache_r = usage.get("cache_read_input_tokens", 0)
                logger.info(
                    "Deal enricher CLI (SINGLE fallback): model=%s, %d in/%d out, %dms",
                    self.cli_model, input_tokens, output_tokens, elapsed_ms,
                )
                self._report_usage(
                    input_tokens=input_tokens, output_tokens=output_tokens,
                    cache_creation_tokens=cache_c, cache_read_tokens=cache_r,
                    model=f"cli-{self.cli_model}", elapsed_ms=elapsed_ms,
                    metadata={"batch_size": 1, "filings_processed": 1, "fallback": True},
                )
            except Exception:
                pass  # Telemetry must never break enrichment

            return parsed
        except subprocess.TimeoutExpired:
            logger.warning("CLI timed out (180s)")
            return None
        except Exception as e:
            logger.error(f"CLI error: {e}")
            return None

    # ─── Telemetry ──────────────────────────────────────────────────────

    def _report_batch_usage(self, result: subprocess.CompletedProcess,
                            elapsed_ms: int, batch_size: int,
                            prompt: str) -> None:
        """Report batch CLI usage to central telemetry."""
        try:
            raw_output = result.stdout.strip()
            cli_json = json.loads(raw_output) if raw_output.startswith("{") else {}
            usage = cli_json.get("usage", {})
            input_tokens = usage.get("input_tokens", len(prompt) // 4)
            output_tokens = usage.get("output_tokens", len(raw_output) // 4)
            cache_c = usage.get("cache_creation_input_tokens", 0)
            cache_r = usage.get("cache_read_input_tokens", 0)
            logger.info(
                "Deal enricher BATCH CLI: model=%s, batch=%d, %d in/%d out, %dms",
                self.cli_model, batch_size, input_tokens, output_tokens, elapsed_ms,
            )
            self._report_usage(
                input_tokens=input_tokens, output_tokens=output_tokens,
                cache_creation_tokens=cache_c, cache_read_tokens=cache_r,
                model=f"cli-{self.cli_model}", elapsed_ms=elapsed_ms,
                metadata={"batch_size": batch_size, "filings_processed": batch_size},
            )
        except Exception:
            pass  # Telemetry must never break enrichment

    def _report_usage(self, *, input_tokens: int, output_tokens: int,
                      cache_creation_tokens: int, cache_read_tokens: int,
                      model: str, elapsed_ms: int,
                      metadata: Optional[dict] = None) -> None:
        """Best-effort POST to the central AI usage ingest endpoint."""
        try:
            import urllib.request
            meta = {"elapsed_ms": elapsed_ms}
            if metadata:
                meta.update(metadata)
            payload = json.dumps({"calls": [{
                "source": "deal_enricher",
                "model": model,
                "auth_method": "cli_oauth",
                "machine": "droplet",
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cache_creation_tokens": cache_creation_tokens,
                "cache_read_tokens": cache_read_tokens,
                "cost_usd": 0.0,
                "metadata": meta,
            }]}).encode()
            fleet_key = os.environ.get("FLEET_API_KEY", "")
            req = urllib.request.Request(
                "http://localhost:8000/ai-usage/ingest",
                data=payload,
                headers={
                    "Content-Type": "application/json",
                    "X-Fleet-Key": fleet_key,
                },
                method="POST",
            )
            urllib.request.urlopen(req, timeout=5)
        except Exception:
            pass  # Non-fatal

    # ─── Deal enrichment (now batch-aware) ──────────────────────────────

    async def fetch_best_filing_text(
        self, conn: asyncpg.Connection, deal_id: UUID
    ) -> Optional[Tuple[str, str, str]]:
        """
        Fetch the best filing text for a deal.

        Returns (accession_number, filing_text, filing_type) or None.
        Tries filings in priority order until one succeeds.
        """
        deal = await conn.fetchrow(
            "SELECT target_cik FROM research_deals WHERE deal_id = $1", deal_id
        )
        if not deal:
            return None

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
            return None

        target_cik = deal["target_cik"] or ""
        for filing in filings:
            url = filing["primary_doc_url"] or filing["filing_url"]
            accession = filing["accession_number"]
            if not url:
                continue

            text = await self.fetch_filing_text(
                url, accession=accession, cik=target_cik.lstrip("0")
            )
            if not text or len(text) < 500:
                continue

            return (accession, text, filing["filing_type"])

        return None

    async def enrich_deal(self, conn: asyncpg.Connection, deal_id: UUID) -> bool:
        """
        Enrich a single deal with extracted terms.

        DEPRECATED for batch use -- prefer enrich_deals_batch() which calls
        extract_batch_via_cli() for much better token efficiency.
        Kept for single-deal fallback (oversized filings).
        """
        result = await self.fetch_best_filing_text(conn, deal_id)
        if not result:
            return False

        accession, text, filing_type = result
        logger.info(f"Extracting from {filing_type} for deal {deal_id}")

        # Use single-filing fallback (blocking -- runs in thread pool)
        loop = asyncio.get_event_loop()
        extracted = await loop.run_in_executor(None, self.extract_via_cli, text)

        if not extracted:
            return False

        await self._apply_extraction(conn, deal_id, extracted, accession)
        return True

    async def enrich_deals_batch(
        self,
        conn: asyncpg.Connection,
        deal_ids: List[UUID],
    ) -> Dict[str, int]:
        """
        Enrich multiple deals using batched CLI extraction.

        1. Fetch filing texts for all deals
        2. Separate into batchable (<15K tokens) and oversized (>15K tokens)
        3. Process batchable filings in groups of BATCH_SIZE via extract_batch_via_cli()
        4. Process oversized filings individually via extract_via_cli() fallback
        5. Apply results to database

        Returns: {"enriched": N, "failed": N, "skipped": N}
        """
        results = {"enriched": 0, "failed": 0, "skipped": 0}

        # Phase 1: Fetch all filing texts
        # List of (deal_id, accession, text, filing_type)
        batchable: List[Tuple[UUID, str, str, str]] = []
        oversized: List[Tuple[UUID, str, str, str]] = []

        for deal_id in deal_ids:
            filing_result = await self.fetch_best_filing_text(conn, deal_id)
            if not filing_result:
                results["skipped"] += 1
                continue

            accession, text, filing_type = filing_result
            if len(text) > LARGE_FILING_THRESHOLD:
                oversized.append((deal_id, accession, text, filing_type))
            else:
                batchable.append((deal_id, accession, text, filing_type))

        logger.info(
            f"Filing fetch complete: {len(batchable)} batchable, "
            f"{len(oversized)} oversized, {results['skipped']} skipped"
        )

        # Phase 2: Process batchable filings in batches
        batch_num = 0
        total_batches = (len(batchable) + BATCH_SIZE - 1) // BATCH_SIZE if batchable else 0

        for i in range(0, len(batchable), BATCH_SIZE):
            batch_num += 1
            batch = batchable[i:i + BATCH_SIZE]

            # Quota gate: adaptive delay + budget check before each batch
            await asyncio.get_event_loop().run_in_executor(None, self.gate.wait)
            if not self.gate.can_proceed(estimated_cost=5.0):
                logger.warning(
                    "Quota gate: stopping enrichment at batch %d/%d "
                    "(session cost: $%.2f)",
                    batch_num, total_batches, self.gate.session_cost,
                )
                break

            # Build filing list for CLI: (accession, truncated_text)
            cli_filings = [(acc, text[:FILING_TRUNCATE_CHARS]) for _, acc, text, _ in batch]

            # Run batch extraction in thread pool (blocking subprocess)
            loop = asyncio.get_event_loop()
            batch_results = await loop.run_in_executor(
                None, self.extract_batch_via_cli, cli_filings
            )

            # Apply results
            for deal_id, accession, _, filing_type in batch:
                extracted = batch_results.get(accession)
                if extracted:
                    try:
                        await self._apply_extraction(conn, deal_id, extracted, accession)
                        results["enriched"] += 1
                        await conn.execute(
                            """UPDATE research_deals SET
                                enrichment_status = 'enriched',
                                enrichment_failure_reason = NULL,
                                enrichment_attempts = COALESCE(enrichment_attempts, 0) + 1
                               WHERE deal_id = $1""",
                            deal_id,
                        )
                    except Exception as e:
                        logger.error(f"Failed to apply extraction for {accession}: {e}")
                        results["failed"] += 1
                        await conn.execute(
                            """UPDATE research_deals SET
                                enrichment_attempts = COALESCE(enrichment_attempts, 0) + 1
                               WHERE deal_id = $1""",
                            deal_id,
                        )
                else:
                    results["failed"] += 1
                    await conn.execute(
                        """UPDATE research_deals SET
                            enrichment_attempts = COALESCE(enrichment_attempts, 0) + 1
                           WHERE deal_id = $1""",
                        deal_id,
                    )

            # Report estimated cost for this batch
            self.gate.report(actual_cost=len(batch) * 0.35)

            logger.info(
                f"Batch {batch_num}/{total_batches} complete, "
                f"{results['enriched']}/{len(deal_ids)} filings enriched "
                f"(session cost: ${self.gate.session_cost:.2f})"
            )

            # QuotaGate.wait() handles adaptive delay — no hardcoded sleep needed

        # Phase 3: Process oversized filings individually (fallback)
        for deal_id, accession, text, filing_type in oversized:
            # Quota gate before each oversized filing
            await asyncio.get_event_loop().run_in_executor(None, self.gate.wait)
            if not self.gate.can_proceed(estimated_cost=2.0):
                logger.warning(
                    "Quota gate: stopping oversized processing "
                    "(session cost: $%.2f)", self.gate.session_cost,
                )
                break

            logger.info(
                f"Oversized filing ({len(text)} chars) for {accession}, "
                f"using single-filing fallback"
            )
            loop = asyncio.get_event_loop()
            extracted = await loop.run_in_executor(None, self.extract_via_cli, text)

            if extracted:
                try:
                    await self._apply_extraction(conn, deal_id, extracted, accession)
                    results["enriched"] += 1
                    await conn.execute(
                        """UPDATE research_deals SET
                            enrichment_status = 'enriched',
                            enrichment_failure_reason = NULL,
                            enrichment_attempts = COALESCE(enrichment_attempts, 0) + 1
                           WHERE deal_id = $1""",
                        deal_id,
                    )
                except Exception as e:
                    logger.error(f"Failed to apply extraction for {accession}: {e}")
                    results["failed"] += 1
            else:
                results["failed"] += 1
                await conn.execute(
                    """UPDATE research_deals SET
                        enrichment_attempts = COALESCE(enrichment_attempts, 0) + 1
                       WHERE deal_id = $1""",
                    deal_id,
                )

            # Report cost for oversized filing
            self.gate.report(actual_cost=0.50)
            # QuotaGate.wait() handles adaptive delay

        return results

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

        # Validate target_listing_status
        valid_listing = {'us_domestic', 'us_foreign_private', 'otc', None}
        target_listing = data.get("target_listing_status")
        if target_listing not in valid_listing:
            target_listing = None

        # Validate tax_treatment
        valid_tax = {'taxable', 'tax_free', 'mixed', None}
        tax_treatment = data.get("tax_treatment")
        if tax_treatment not in valid_tax:
            tax_treatment = None

        # Validate shareholder_approval_threshold
        valid_approval = {'simple_majority', 'supermajority', 'tender_majority', 'written_consent', 'not_required', None}
        approval_threshold = data.get("shareholder_approval_threshold")
        if approval_threshold not in valid_approval:
            approval_threshold = None

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
                target_listing_status = COALESCE($15, target_listing_status),
                target_incorporation = COALESCE($16, target_incorporation),
                is_non_binding_offer = $17,
                is_cash_distribution = $18,
                is_bankruptcy_363 = $19,
                has_earnout = $20,
                acquirer_toehold_pct = $21,
                tax_treatment = COALESCE($22, tax_treatment),
                shareholder_approval_threshold = COALESCE($23, shareholder_approval_threshold),
                target_exchange = COALESCE($24, target_exchange),
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
            target_listing,
            data.get("target_incorporation"),
            data.get("is_non_binding_offer", False) or False,
            data.get("is_cash_distribution", False) or False,
            data.get("is_bankruptcy_363", False) or False,
            consideration.get("has_earnout", False) or False,
            data.get("acquirer_toehold_pct"),
            tax_treatment,
            approval_threshold,
            data.get("target_exchange"),
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
                    cvr_value_est,
                    effective_date, announced_date
                ) VALUES ($1, 1, $2, true, $3, $4, $5, $6, $7, $8, $9, $9)
                ON CONFLICT (deal_id, version) DO UPDATE SET
                    cash_per_share = $3, total_per_share = $5,
                    cvr_value_est = COALESCE($8, research_deal_consideration.cvr_value_est)
                """,
                deal_id, acquirer_name,
                cash,
                consideration.get("stock_ratio"),
                total_ps,
                deal_value,
                premium,
                consideration.get("cvr_value_est"),
                ann_date,
            )

        logger.info(
            f"Enriched: acquirer={acquirer_name}, "
            f"structure={deal_structure}, value={deal_value}MM"
        )

    # ─── Utilities ──────────────────────────────────────────────────────

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

    def _build_cli_env(self, cli_path: str) -> dict:
        """
        Build subprocess env for Claude CLI.

        Handles two critical issues:
        1. Removes ANTHROPIC_API_KEY so CLI uses OAuth (Max subscription = $0)
        2. Injects nvm node bin dir into PATH so `#!/usr/bin/env node` resolves
           (without nvm in PATH, the shebang fails with rc=127)
        """
        env = os.environ.copy()
        env.pop("ANTHROPIC_API_KEY", None)

        oauth = os.environ.get("CLAUDE_CODE_OAUTH_TOKEN", "")
        if oauth:
            env["CLAUDE_CODE_OAUTH_TOKEN"] = oauth

        # Inject the node bin dir into PATH so the claude shebang works
        cli_dir = str(Path(cli_path).parent)
        current_path = env.get("PATH", "/usr/bin:/bin")
        if cli_dir not in current_path:
            env["PATH"] = f"{cli_dir}:{current_path}"

        return env

    @staticmethod
    def _parse_json_string(s: str) -> Optional[dict]:
        """Parse JSON with recovery for markdown fences and trailing commas."""
        try:
            result = json.loads(s)
            if isinstance(result, dict):
                return result
        except (json.JSONDecodeError, TypeError):
            pass

        cleaned = re.sub(r'```(?:json)?\s*', '', s)
        cleaned = re.sub(r'```\s*$', '', cleaned)
        try:
            result = json.loads(cleaned)
            if isinstance(result, dict):
                return result
        except (json.JSONDecodeError, TypeError):
            pass

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

    @classmethod
    def _extract_json(cls, text: str) -> Optional[dict]:
        """Extract JSON dict from Claude CLI output, handling wrapper + markdown fences."""
        # Try parsing the output-format json wrapper
        try:
            wrapper = json.loads(text)
            if isinstance(wrapper, dict) and "result" in wrapper:
                content = wrapper["result"]
                if isinstance(content, dict):
                    return content
                if isinstance(content, str):
                    parsed = cls._parse_json_string(content)
                    if parsed:
                        return parsed
        except (json.JSONDecodeError, TypeError):
            pass

        # Fallback: parse the entire text
        return cls._parse_json_string(text)

    @classmethod
    def _extract_json_array(cls, text: str) -> Optional[List[dict]]:
        """Extract JSON array from Claude CLI output, handling wrapper + markdown fences."""
        # Try parsing the output-format json wrapper first
        try:
            wrapper = json.loads(text)
            if isinstance(wrapper, dict) and "result" in wrapper:
                content = wrapper["result"]
                if isinstance(content, list):
                    return content
                if isinstance(content, str):
                    return cls._parse_json_array_string(content)
        except (json.JSONDecodeError, TypeError):
            pass

        # Fallback: parse entire text
        return cls._parse_json_array_string(text)

    @staticmethod
    def _parse_json_array_string(s: str) -> Optional[List[dict]]:
        """Parse a JSON array from a string, with recovery for markdown fences."""
        # Direct parse
        try:
            result = json.loads(s)
            if isinstance(result, list):
                return result
        except (json.JSONDecodeError, TypeError):
            pass

        # Strip markdown fences
        cleaned = re.sub(r'```(?:json)?\s*', '', s)
        cleaned = re.sub(r'```\s*$', '', cleaned)
        try:
            result = json.loads(cleaned)
            if isinstance(result, list):
                return result
        except (json.JSONDecodeError, TypeError):
            pass

        # Find outermost [...] brackets
        match = re.search(r'\[.*\]', cleaned, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                # Fix trailing commas
                fixed = re.sub(r',\s*([}\]])', r'\1', match.group(0))
                try:
                    return json.loads(fixed)
                except json.JSONDecodeError:
                    pass
        return None


async def run_enrichment(
    limit: int = DEFAULT_MAX_PER_RUN,
    offset: int = 0,
    priority_types: Optional[List[str]] = None,
    retry_mode: bool = False,
    max_per_run: int = DEFAULT_MAX_PER_RUN,
) -> Dict:
    """
    Run deal enrichment on priority deals using batched CLI extraction.

    Uses extract_batch_via_cli() to process up to 20 filings per CLI call,
    amortizing system prompt overhead across the batch.

    Args:
        limit: Max deals to process (alias for max_per_run, kept for compat)
        offset: Skip first N deals (for parallel workers)
        priority_types: Filing types to filter on
        retry_mode: If True, only retry sec_failed and extraction_failed deals
        max_per_run: Hard cap on filings per run (default 100)
    """
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parents[3] / ".env")

    # Use the smaller of limit and max_per_run
    effective_limit = min(limit, max_per_run)

    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    enricher = DealEnricher()

    if not priority_types:
        priority_types = ["DEFM14A", "SC TO-T", "PREM14A", "SC 14D9", "SC 14D-9", "SC 14D9/A"]

    type_list = "', '".join(priority_types)

    if retry_mode:
        deals = await conn.fetch(f"""
            SELECT DISTINCT ON (rd.deal_id) rd.deal_id, rd.deal_key, rd.target_ticker,
                   rd.enrichment_status, rd.enrichment_attempts
            FROM research_deals rd
            JOIN research_deal_filings rdf ON rd.deal_id = rdf.deal_id
            WHERE rd.enrichment_status IN ('sec_failed', 'extraction_failed')
              AND rdf.filing_type IN ('{type_list}')
            ORDER BY rd.deal_id, rd.deal_key
            LIMIT $1 OFFSET $2
        """, effective_limit, offset)
        logger.info(f"RETRY MODE: {len(deals)} retriable deals (sec_failed + extraction_failed)")
    else:
        deals = await conn.fetch(f"""
            SELECT DISTINCT ON (rd.deal_id) rd.deal_id, rd.deal_key, rd.target_ticker
            FROM research_deals rd
            JOIN research_deal_filings rdf ON rd.deal_id = rdf.deal_id
            WHERE rd.acquirer_name = 'Unknown'
              AND rdf.filing_type IN ('{type_list}')
            ORDER BY rd.deal_id, rd.deal_key
            LIMIT $1 OFFSET $2
        """, effective_limit, offset)
        logger.info(f"Enriching {len(deals)} deals with priority filings (batched)")

    if not deals:
        logger.info("No deals to enrich")
        await enricher.close()
        await conn.close()
        return {"enriched": 0, "failed": 0, "skipped": 0}

    # Collect deal IDs and run batch enrichment
    deal_ids = [deal["deal_id"] for deal in deals]
    results = await enricher.enrich_deals_batch(conn, deal_ids)

    await enricher.close()
    await conn.close()

    logger.info(f"Enrichment complete: {results}")
    return results


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Enrich research deals with filing data")
    parser.add_argument("--limit", type=int, default=DEFAULT_MAX_PER_RUN)
    parser.add_argument("--max-per-run", type=int, default=DEFAULT_MAX_PER_RUN,
                        help="Hard cap on filings per run (default 100)")
    parser.add_argument("--offset", type=int, default=0, help="Skip first N deals (for parallel workers)")
    parser.add_argument("--retry", action="store_true", help="Retry only sec_failed and extraction_failed deals")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    result = asyncio.run(run_enrichment(
        limit=args.limit, offset=args.offset,
        retry_mode=args.retry, max_per_run=args.max_per_run,
    ))
    print(f"Done: {result}")
