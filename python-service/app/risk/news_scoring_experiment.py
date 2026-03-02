"""News Relevance Scoring Experiment — Heuristic vs AI.

Compares scoring methods against a Sonnet ground-truth judge to determine
which approach best selects the 10 most risk-relevant news articles per deal ticker.

Methods:
  A. heuristic_v1      — current keyword count / 5.0
  B. heuristic_v2      — source-weighted, title-aware, noise-penalized
  C. haiku             — Haiku AI scoring via batch API (1 req per article)
  D. sonnet_judge      — Sonnet ground-truth with richer deal context (1 req per article)
  E. sonnet_titles_only    — One prompt per ticker, all titles, ranked top 10
  F. sonnet_filtered_ranked — Heuristic pre-filter to top 30, Sonnet comparative rank
  G. sonnet_bucket_sort     — One prompt per ticker, 3-bucket categorical sort

All results stored in news_scoring_runs / news_scoring_results for SQL analysis.
"""

import asyncio
import json
import logging
import math
import re
import time
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from anthropic import Anthropic
from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
from anthropic.types.messages.batch_create_params import Request

from .api_cost_tracker import log_api_call
from .model_config import compute_cost

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

HAIKU_MODEL = "claude-haiku-4-5-20251001"
SONNET_MODEL = "claude-sonnet-4-6"

BATCH_POLL_INTERVAL = 30  # seconds
BATCH_TIMEOUT = 3600  # 1 hour

# All available methods
ALL_METHODS = [
    "heuristic_v1", "heuristic_v2", "haiku", "sonnet_judge",
    "sonnet_titles_only", "sonnet_filtered_ranked", "sonnet_bucket_sort",
]
HEURISTIC_METHODS = {"heuristic_v1", "heuristic_v2"}
AI_METHODS = {"haiku", "sonnet_judge", "sonnet_titles_only",
              "sonnet_filtered_ranked", "sonnet_bucket_sort"}
# Methods compared against sonnet_judge for metrics
COMPARATIVE_METHODS = [
    "heuristic_v1", "heuristic_v2", "haiku",
    "sonnet_titles_only", "sonnet_filtered_ranked", "sonnet_bucket_sort",
]

# Max articles to send to filtered_ranked per ticker (pre-filtered by heuristic_v2)
FILTERED_RANKED_TOP_N = 30

# --- Enhanced Heuristic Weights (Method B) ---

# Source authority bonuses (higher = more trustworthy for M&A)
SOURCE_BONUSES: dict[str, float] = {
    # Press release wires — primary source
    "pr newswire": 0.2,
    "prnewswire": 0.2,
    "business wire": 0.2,
    "businesswire": 0.2,
    "globenewswire": 0.2,
    "globe newswire": 0.2,
    # Government / regulatory
    "doj": 0.3,
    "ftc": 0.3,
    "department of justice": 0.3,
    "federal trade commission": 0.3,
    "sec": 0.25,
    # Financial news (higher quality)
    "reuters": 0.15,
    "bloomberg": 0.15,
    "wall street journal": 0.15,
    "wsj": 0.15,
    "cnbc": 0.1,
    "barron's": 0.1,
    "financial times": 0.15,
    # Analyst/opinion
    "seeking alpha": 0.05,
    "motley fool": 0.0,
    "investorplace": 0.0,
    "benzinga": 0.1,
    "zacks": 0.0,
    "yahoo finance": 0.05,
    "marketwatch": 0.1,
}

# Source-level bonuses by the `source` field on deal_news_articles
SOURCE_FIELD_BONUSES: dict[str, float] = {
    "polygon": 0.1,   # Polygon aggregates Benzinga + GlobeNewswire
    "finnhub": 0.0,   # Mixed quality
}

# Deal-action headline patterns -> multiplicative boost
DEAL_ACTION_PATTERNS = [
    r"\bfiles?\s+suit\b",
    r"\bblocks?\s+(merger|acquisition|deal)\b",
    r"\bapproves?\s+(merger|acquisition|deal)\b",
    r"\bextends?\s+(deadline|date)\b",
    r"\braises?\s+(bid|offer|price)\b",
    r"\bcompeting\s+bid\b",
    r"\bcounter\s*offer\b",
    r"\bsecond\s+request\b",
    r"\bphase\s+(ii|2)\b",
    r"\bterminate[ds]?\b",
    r"\bwalks?\s+away\b",
    r"\bwithdra(?:w[ns]?|wn)\b",
    r"\bamend(?:s|ed)?\s+(merger|deal|agreement)\b",
    r"\b(?:doj|ftc|cfius)\s+(?:approves?|blocks?|challenges?|clears?|sues?)\b",
    r"\binjunction\b",
    r"\bclass\s+action\b",
    r"\bgo[\-\s]?shop\b",
    r"\bsuperior\s+proposal\b",
    r"\btopping\s+bid\b",
    r"\boverbid\b",
]

# Noise headline patterns -> multiplicative penalty
NOISE_PATTERNS = [
    r"\bstocks?\s+to\s+watch\b",
    r"\btop\s+\d+\s+(stocks?|picks?)\b",
    r"\bshould\s+you\s+buy\b",
    r"\bis\s+trending\b",
    r"\bbest\s+stocks?\b",
    r"\bstocks?\s+to\s+buy\b",
    r"\bmarket\s+wrap\b",
    r"\bweekly\s+roundup\b",
    r"\bportfolio\s+update\b",
    r"\bearnings?\s+preview\b",
]

# M&A keywords (reused from news_monitor.py for heuristic_v1 reproduction)
MA_NEWS_KEYWORDS = {
    "merger", "acquisition", "acquire", "acquirer", "takeover", "buyout",
    "tender offer", "deal", "transaction",
    "regulatory", "antitrust", "ftc", "doj", "cfius",
    "committee on foreign investment", "national security review",
    "foreign ownership", "national security",
    "shareholder", "vote", "proxy", "approval",
    "closing", "close", "completion",
    "termination", "break", "walk away",
    "financing", "debt", "commitment",
    "injunction", "lawsuit", "litigation", "class action",
    "hsr", "second request", "phase ii",
    "go-shop", "topping bid", "superior proposal", "overbid",
    "material adverse", "mac",
}

# Risk factor classification keywords (same logic as news_monitor.classify_risk_factor)
RISK_FACTOR_KEYWORDS = {
    "regulatory": ["ftc", "doj", "antitrust", "regulatory", "cfius",
                    "hsr", "second request", "phase ii", "approval"],
    "vote": ["vote", "shareholder", "proxy", "meeting"],
    "financing": ["financing", "debt", "commitment", "loan", "credit"],
    "legal": ["lawsuit", "litigation", "injunction", "class action",
              "complaint", "fiduciary"],
    "mac": ["material adverse", "mac", "deterioration", "earnings", "guidance"],
    "competing_bid": ["topping bid", "go-shop", "superior proposal",
                      "overbid", "competing"],
    "timing": ["closing", "timeline", "delay", "extension", "outside date"],
}


# ---------------------------------------------------------------------------
# Haiku scorer prompt
# ---------------------------------------------------------------------------

HAIKU_SCORING_PROMPT = """You are scoring a news article's relevance to a specific M&A deal for a merger arbitrage risk assessment.

DEAL: {ticker} — {acquirer} acquiring {target} at ${deal_price}/share
ARTICLE TITLE: {title}
ARTICLE SUMMARY: {summary}
ARTICLE SOURCE: {publisher}

Score this article on two dimensions:

1. RELEVANCE (0.0 to 1.0): How likely is this article to contain information that should change a risk assessment grade?
   - 0.0-0.2: Not about this deal, or generic market commentary
   - 0.3-0.5: Mentions the deal but no new actionable information
   - 0.6-0.8: Contains deal-specific developments (filing updates, timeline changes, analyst takes)
   - 0.9-1.0: Contains material deal events (regulatory action, competing bid, deal amendment, lawsuit)

2. RISK_FACTOR: Which risk factor does this most affect? One of: regulatory, vote, financing, legal, mac, competing_bid, timing, or null if not deal-relevant.

3. REASONING: One sentence explaining your score.

Respond in JSON: {{"relevance": 0.X, "risk_factor": "...", "reasoning": "..."}}"""


# ---------------------------------------------------------------------------
# Sonnet judge prompt
# ---------------------------------------------------------------------------

SONNET_JUDGE_PROMPT = """You are an expert merger arbitrage analyst evaluating whether a news article contains information relevant to assessing deal risk.

DEAL CONTEXT:
- Ticker: {ticker}
- Deal: {acquirer} acquiring {target}
- Deal price: ${deal_price}/share
- Current price: ${current_price}
- Announce date: {announce_date}
- Status: {status}
- Key risks: {risk_summary}

ARTICLE:
- Title: {title}
- Publisher: {publisher}
- Published: {published_at}
- Summary: {summary}

Evaluate this article's relevance to THIS SPECIFIC DEAL's risk assessment:

1. Is this article actually about this deal, or does it merely mention the ticker/company in passing?
2. Does it contain NEW information that could change any of the 5 risk grades (vote, financing, legal, regulatory, MAC)?
3. What specific risk factor does it most affect, if any?

Respond in JSON:
{{
  "relevance": 0.X,
  "is_about_this_deal": true/false,
  "risk_factor": "regulatory|vote|financing|legal|mac|competing_bid|timing|null",
  "information_type": "material_event|development_update|analyst_commentary|generic_mention|unrelated",
  "reasoning": "2-3 sentences explaining your assessment"
}}"""


# ---------------------------------------------------------------------------
# Method E prompt: Titles-only comparative ranking
# ---------------------------------------------------------------------------

TITLES_ONLY_PROMPT = """You are an expert merger arbitrage analyst. Your task is to identify which news articles are most relevant to a specific M&A deal's risk assessment.

DEAL: {ticker} — {acquirer} acquiring {target} at ${deal_price}/share
Current risk grades: {risk_summary}

Rank the following articles by relevance to THIS M&A deal's risk assessment.
Return the top 10 most relevant article numbers with scores (0.0-1.0) and the primary risk factor each article affects.

Scoring guide:
- 0.9-1.0: Material deal events (regulatory action, bid change, amendment, lawsuit, vote result)
- 0.7-0.8: Deal-specific developments (filing update, timeline change, financing terms)
- 0.5-0.6: Deal-related context (analyst commentary, spread discussion)
- 0.3-0.4: Tangentially related (industry M&A trends mentioning this deal)
- Below 0.3: Not relevant — do NOT include in the top 10

Articles:
{article_list}

Return ONLY the top 10 most relevant articles as a JSON array. If fewer than 10 are relevant, return fewer.
JSON: [{{"id": 1, "score": 0.85, "risk_factor": "financing"}}, ...]"""


# ---------------------------------------------------------------------------
# Method F prompt: Filtered ranked (title + summary)
# ---------------------------------------------------------------------------

FILTERED_RANKED_PROMPT = """You are an expert merger arbitrage analyst. These articles were pre-filtered as potentially relevant to a specific M&A deal. Your task is to rank the most important ones for a risk assessment.

DEAL: {ticker} — {acquirer} acquiring {target} at ${deal_price}/share
Current risk grades: {risk_summary}

Rank the top 10 articles by importance to a risk assessment. Score each 0.0-1.0.

Scoring guide:
- 0.9-1.0: Material deal events (regulatory action, bid change, amendment, lawsuit, vote result, financing terms)
- 0.7-0.8: Deal-specific developments (filing update, timeline change, position disclosure)
- 0.5-0.6: Deal-related context (analyst commentary, spread discussion, market impact)
- 0.3-0.4: Tangentially related (mentions deal but no new information)
- Below 0.3: Not actually relevant — do NOT include

Articles:
{article_list}

Return ONLY the top 10 most relevant articles as a JSON array. If fewer than 10 are relevant, return fewer.
JSON: [{{"id": 1, "score": 0.85, "risk_factor": "financing"}}, ...]"""


# ---------------------------------------------------------------------------
# Method G prompt: Bucket sort
# ---------------------------------------------------------------------------

BUCKET_SORT_PROMPT = """You are an expert merger arbitrage analyst. Sort these news articles into three categories based on their relevance to a specific M&A deal's risk assessment.

DEAL: {ticker} — {acquirer} acquiring {target} at ${deal_price}/share
Current risk grades: {risk_summary}

CRITICAL: Contains material deal events that could change a risk grade (regulatory action, bid change, amendment, lawsuit, vote result, financing terms, closing date change)
RELEVANT: About this deal with useful context (timeline update, analyst take, spread commentary, position disclosure)
NOISE: Not about this deal, generic market commentary, wrong company, listicle, or no actionable information

Articles:
{article_list}

Return a JSON object with three arrays of article numbers:
JSON: {{"critical": [1, 7, 12], "relevant": [3, 5, 8, 15, 22], "noise": [2, 4, 6, 9, 10, 11, ...]}}

IMPORTANT: Every article number must appear in exactly one category. Do not omit any."""


# ---------------------------------------------------------------------------
# JSON extraction (reuse from engine.py pattern)
# ---------------------------------------------------------------------------

def _extract_json(raw_text: str) -> dict:
    """Extract a JSON object from an AI response."""
    text = raw_text.strip()

    # Strip markdown fences
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*\n?", "", text)
        text = re.sub(r"\n?```\s*$", "", text)
        text = text.strip()

    # Direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Find outermost braces
    first = text.find("{")
    last = text.rfind("}")
    if first >= 0 and last > first:
        candidate = text[first:last + 1]
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass
        # Fix trailing commas
        fixed = re.sub(r",\s*([}\]])", r"\1", candidate)
        try:
            return json.loads(fixed)
        except json.JSONDecodeError:
            pass

    raise json.JSONDecodeError("No valid JSON found", raw_text, 0)


def _extract_json_or_array(raw_text: str):
    """Extract a JSON object or array from an AI response."""
    text = raw_text.strip()

    # Strip markdown fences
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*\n?", "", text)
        text = re.sub(r"\n?```\s*$", "", text)
        text = text.strip()

    # Direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Find outermost braces or brackets
    first_brace = text.find("{")
    first_bracket = text.find("[")
    last_brace = text.rfind("}")
    last_bracket = text.rfind("]")

    # Try array first if [ appears before {
    if first_bracket >= 0 and (first_brace < 0 or first_bracket < first_brace):
        if last_bracket > first_bracket:
            candidate = text[first_bracket:last_bracket + 1]
            try:
                return json.loads(candidate)
            except json.JSONDecodeError:
                fixed = re.sub(r",\s*([}\]])", r"\1", candidate)
                try:
                    return json.loads(fixed)
                except json.JSONDecodeError:
                    pass

    # Try object
    if first_brace >= 0 and last_brace > first_brace:
        candidate = text[first_brace:last_brace + 1]
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            fixed = re.sub(r",\s*([}\]])", r"\1", candidate)
            try:
                return json.loads(fixed)
            except json.JSONDecodeError:
                pass

    raise json.JSONDecodeError("No valid JSON found", raw_text, 0)


def _json_default(o):
    """JSON serializer for asyncpg types."""
    if isinstance(o, Decimal):
        return float(o)
    if isinstance(o, (date, datetime)):
        return o.isoformat()
    if isinstance(o, uuid.UUID):
        return str(o)
    raise TypeError(f"Type {type(o).__name__} not serializable")


# ---------------------------------------------------------------------------
# Method A: Heuristic v1 (reproduce current scoring)
# ---------------------------------------------------------------------------

def _score_heuristic_v1(articles: list[dict]) -> list[dict]:
    """Current keyword-count scoring reproduced for comparison.

    Each article dict must have 'title', 'summary', 'ticker'.
    Returns list of dicts with 'relevance_score' and 'risk_factor'.
    """
    results = []
    for art in articles:
        text = ((art.get("title") or "") + " " + (art.get("summary") or "")).lower()
        matched = [kw for kw in MA_NEWS_KEYWORDS if kw in text]
        if matched:
            score = min(len(matched) / 5.0, 1.0)
        else:
            score = 0.1

        risk_factor = _classify_risk_factor(text)

        results.append({
            "article_id": art["id"],
            "ticker": art["ticker"],
            "relevance_score": round(score, 2),
            "risk_factor": risk_factor,
            "is_about_deal": None,
            "information_type": None,
            "reasoning": None,
            "raw_response": None,
            "model": None,
            "input_tokens": None,
            "output_tokens": None,
            "cost_usd": None,
        })
    return results


def _classify_risk_factor(text: str) -> str | None:
    """Classify risk factor from article text (same logic as news_monitor)."""
    for factor, keywords in RISK_FACTOR_KEYWORDS.items():
        if any(kw in text for kw in keywords):
            return factor
    return None


# ---------------------------------------------------------------------------
# Method B: Enhanced Heuristic v2
# ---------------------------------------------------------------------------

def _score_heuristic_v2(articles: list[dict], deal_context: dict[str, dict]) -> list[dict]:
    """Enhanced heuristic: source-weighted, title-aware, noise-penalized.

    Args:
        articles: list of article dicts with title, summary, ticker, publisher, source.
        deal_context: dict mapping ticker -> deal info (target name, acquirer, etc.)
    """
    results = []
    for art in articles:
        ticker = art["ticker"]
        title = (art.get("title") or "").strip()
        title_lower = title.lower()
        summary = (art.get("summary") or "").strip()
        text = (title_lower + " " + summary.lower())
        publisher = (art.get("publisher") or "").lower().strip()
        source_field = (art.get("source") or "").lower().strip()
        deal = deal_context.get(ticker, {})

        # Base: keyword count (same as v1)
        matched = [kw for kw in MA_NEWS_KEYWORDS if kw in text]
        base = min(len(matched) / 5.0, 1.0) if matched else 0.1

        # Source authority bonus (publisher name match)
        source_bonus = SOURCE_FIELD_BONUSES.get(source_field, 0.0)
        for pub_key, bonus in SOURCE_BONUSES.items():
            if pub_key in publisher:
                source_bonus = max(source_bonus, bonus)
                break

        # Title-match boost: ticker or company name in headline
        title_boost = 0.0
        # Ticker word-boundary match in title
        if re.search(rf"\b{re.escape(ticker)}\b", title, re.IGNORECASE):
            title_boost = 0.2
        else:
            # Company name match
            target_name = deal.get("target", "")
            acquirer_name = deal.get("acquirer", "")
            for name in [target_name, acquirer_name]:
                if name and len(name) > 2 and name.lower() in title_lower:
                    title_boost = 0.2
                    break

        # Headline pattern classification (multiplicative)
        headline_mult = 1.0
        # Deal-action boost
        for pattern in DEAL_ACTION_PATTERNS:
            if re.search(pattern, title_lower):
                headline_mult = 1.5
                break
        # Noise penalty (overrides deal-action if both match, unlikely)
        for pattern in NOISE_PATTERNS:
            if re.search(pattern, title_lower):
                headline_mult = 0.3
                break
        # Listicle penalty: title starts with digit
        if re.match(r"^\d+\s", title):
            headline_mult = min(headline_mult, 0.3)

        # Risk factor confidence boost
        risk_factor = _classify_risk_factor(text)
        risk_confidence = 0.0
        if risk_factor and title_boost > 0:
            # Classification is more trustworthy when article mentions the ticker in title
            risk_confidence = 0.1

        # Combine
        score = base + source_bonus + title_boost
        score *= headline_mult
        score += risk_confidence
        score = max(0.0, min(1.0, score))

        results.append({
            "article_id": art["id"],
            "ticker": ticker,
            "relevance_score": round(score, 3),
            "risk_factor": risk_factor,
            "is_about_deal": None,
            "information_type": None,
            "reasoning": None,
            "raw_response": None,
            "model": None,
            "input_tokens": None,
            "output_tokens": None,
            "cost_usd": None,
        })
    return results


# ---------------------------------------------------------------------------
# Method C: Haiku AI scoring (batch)
# ---------------------------------------------------------------------------

async def _score_haiku_batch(
    client: Anthropic,
    articles: list[dict],
    deal_context: dict[str, dict],
    pool,
) -> list[dict]:
    """Score articles using Haiku via the batch API.

    Returns list of result dicts matching the scoring_results schema.
    """
    if not articles:
        return []

    # Build batch requests
    requests = []
    article_map: dict[str, dict] = {}  # custom_id -> article

    for i, art in enumerate(articles):
        ticker = art["ticker"]
        deal = deal_context.get(ticker, {})
        custom_id = f"haiku-{i}-{art['id']}"
        article_map[custom_id] = art

        prompt = HAIKU_SCORING_PROMPT.format(
            ticker=ticker,
            acquirer=deal.get("acquirer", "Unknown"),
            target=deal.get("target", "Unknown"),
            deal_price=deal.get("deal_price", "N/A"),
            title=art.get("title", ""),
            summary=(art.get("summary") or "")[:500],
            publisher=art.get("publisher", "Unknown"),
        )

        requests.append(
            Request(
                custom_id=custom_id,
                params=MessageCreateParamsNonStreaming(
                    model=HAIKU_MODEL,
                    temperature=0,
                    max_tokens=200,
                    messages=[{"role": "user", "content": prompt}],
                ),
            )
        )

    return await _run_batch_and_collect(
        client, requests, article_map, HAIKU_MODEL, "haiku", pool
    )


# ---------------------------------------------------------------------------
# Method D: Sonnet judge (batch)
# ---------------------------------------------------------------------------

async def _score_sonnet_judge(
    client: Anthropic,
    articles: list[dict],
    deal_context: dict[str, dict],
    pool,
) -> list[dict]:
    """Score articles using Sonnet as ground-truth judge via batch API."""
    if not articles:
        return []

    requests = []
    article_map: dict[str, dict] = {}

    for i, art in enumerate(articles):
        ticker = art["ticker"]
        deal = deal_context.get(ticker, {})
        custom_id = f"sonnet-{i}-{art['id']}"
        article_map[custom_id] = art

        prompt = SONNET_JUDGE_PROMPT.format(
            ticker=ticker,
            acquirer=deal.get("acquirer", "Unknown"),
            target=deal.get("target", "Unknown"),
            deal_price=deal.get("deal_price", "N/A"),
            current_price=deal.get("current_price", "N/A"),
            announce_date=deal.get("announce_date", "N/A"),
            status=deal.get("status", "N/A"),
            risk_summary=deal.get("risk_summary", "N/A"),
            title=art.get("title", ""),
            publisher=art.get("publisher", "Unknown"),
            published_at=art.get("published_at", "N/A"),
            summary=(art.get("summary") or "")[:800],
        )

        requests.append(
            Request(
                custom_id=custom_id,
                params=MessageCreateParamsNonStreaming(
                    model=SONNET_MODEL,
                    temperature=0,
                    max_tokens=300,
                    messages=[{"role": "user", "content": prompt}],
                ),
            )
        )

    return await _run_batch_and_collect(
        client, requests, article_map, SONNET_MODEL, "sonnet_judge", pool
    )


# ---------------------------------------------------------------------------
# Batch runner (shared by Haiku and Sonnet)
# ---------------------------------------------------------------------------

async def _run_batch_and_collect(
    client: Anthropic,
    requests: list[Request],
    article_map: dict[str, dict],
    model: str,
    method: str,
    pool,
) -> list[dict]:
    """Submit a batch, poll for completion, extract results."""
    logger.info("[news_scoring] Submitting %s batch: %d requests", method, len(requests))
    t0 = time.monotonic()

    # Submit batch
    try:
        message_batch = client.messages.batches.create(requests=requests)
    except Exception as e:
        logger.error("[news_scoring] Failed to create %s batch: %s", method, e)
        raise

    batch_id = message_batch.id
    logger.info("[news_scoring] %s batch %s created, polling...", method, batch_id)

    # Poll
    elapsed = 0
    while elapsed < BATCH_TIMEOUT:
        await asyncio.sleep(BATCH_POLL_INTERVAL)
        elapsed = time.monotonic() - t0
        try:
            message_batch = client.messages.batches.retrieve(batch_id)
        except Exception as e:
            logger.warning("[news_scoring] %s batch poll error: %s", method, e)
            continue

        counts = message_batch.request_counts
        logger.info(
            "[news_scoring] %s batch %s: %d ok, %d processing, %d err, %d expired",
            method, batch_id, counts.succeeded, counts.processing,
            counts.errored, counts.expired,
        )
        if message_batch.processing_status == "ended":
            break
    else:
        logger.error("[news_scoring] %s batch %s timed out", method, batch_id)

    total_ms = int((time.monotonic() - t0) * 1000)

    # Collect results
    results = []
    total_cost = 0.0
    succeeded = 0
    failed = 0

    try:
        for result in client.messages.batches.results(batch_id):
            custom_id = result.custom_id
            art = article_map.get(custom_id)
            if not art:
                continue

            if result.result.type == "succeeded":
                msg = result.result.message
                raw_text = msg.content[0].text if msg.content else ""
                usage = msg.usage
                cache_creation = getattr(usage, "cache_creation_input_tokens", 0) or 0
                cache_read = getattr(usage, "cache_read_input_tokens", 0) or 0

                # Batch = 50% discount
                cost = compute_cost(
                    model, usage.input_tokens, usage.output_tokens,
                    cache_creation, cache_read,
                ) * 0.5
                total_cost += cost

                try:
                    parsed = _extract_json(raw_text)
                except (json.JSONDecodeError, ValueError):
                    logger.warning(
                        "[news_scoring] %s JSON parse failed for %s: %s",
                        method, art.get("title", "")[:60], raw_text[:200],
                    )
                    failed += 1
                    results.append({
                        "article_id": art["id"],
                        "ticker": art["ticker"],
                        "relevance_score": None,
                        "risk_factor": None,
                        "is_about_deal": None,
                        "information_type": None,
                        "reasoning": f"JSON parse failed: {raw_text[:200]}",
                        "raw_response": {"error": "json_parse_failed", "text": raw_text[:500]},
                        "model": model,
                        "input_tokens": usage.input_tokens,
                        "output_tokens": usage.output_tokens,
                        "cost_usd": cost,
                    })
                    continue

                succeeded += 1
                # Normalize the relevance score
                rel = parsed.get("relevance")
                if isinstance(rel, (int, float)):
                    rel = max(0.0, min(1.0, float(rel)))
                else:
                    rel = None

                results.append({
                    "article_id": art["id"],
                    "ticker": art["ticker"],
                    "relevance_score": rel,
                    "risk_factor": parsed.get("risk_factor"),
                    "is_about_deal": parsed.get("is_about_this_deal"),
                    "information_type": parsed.get("information_type"),
                    "reasoning": parsed.get("reasoning"),
                    "raw_response": parsed,
                    "model": model,
                    "input_tokens": usage.input_tokens,
                    "output_tokens": usage.output_tokens,
                    "cost_usd": cost,
                })

            else:
                # errored or expired
                failed += 1
                err_type = result.result.type
                results.append({
                    "article_id": art["id"],
                    "ticker": art["ticker"],
                    "relevance_score": None,
                    "risk_factor": None,
                    "is_about_deal": None,
                    "information_type": None,
                    "reasoning": f"Batch {err_type}",
                    "raw_response": {"error": err_type},
                    "model": model,
                    "input_tokens": None,
                    "output_tokens": None,
                    "cost_usd": None,
                })

    except Exception as e:
        logger.error("[news_scoring] Failed processing %s batch results: %s", method, e)

    logger.info(
        "[news_scoring] %s batch done: %d ok, %d failed, $%.4f, %dms",
        method, succeeded, failed, total_cost, total_ms,
    )

    # Log cost to unified tracker
    if pool and total_cost > 0:
        total_input = sum(r.get("input_tokens") or 0 for r in results)
        total_output = sum(r.get("output_tokens") or 0 for r in results)
        await log_api_call(
            pool,
            source="news_scoring",
            model=model,
            input_tokens=total_input,
            output_tokens=total_output,
            cost_usd=total_cost,
            metadata={
                "method": method,
                "batch_id": batch_id,
                "articles": len(requests),
                "succeeded": succeeded,
                "failed": failed,
            },
        )

    return results


# ---------------------------------------------------------------------------
# Ticker-level batch runner (for Methods E, F, G)
# ---------------------------------------------------------------------------

async def _run_ticker_batch_and_collect(
    client: Anthropic,
    requests: list[Request],
    ticker_article_map: dict[str, list[dict]],
    model: str,
    method: str,
    pool,
    parse_fn,
) -> list[dict]:
    """Submit a batch with one request per ticker, parse multi-article responses.

    Args:
        client: Anthropic client
        requests: Batch request objects (one per ticker)
        ticker_article_map: custom_id -> list of article dicts for that ticker
        model: Model ID for cost computation
        method: Method name for logging
        pool: DB pool for cost tracking
        parse_fn: Callable(raw_text, articles) -> list[dict] of per-article results
    """
    if not requests:
        return []

    logger.info("[news_scoring] Submitting %s ticker batch: %d requests", method, len(requests))
    t0 = time.monotonic()

    try:
        message_batch = client.messages.batches.create(requests=requests)
    except Exception as e:
        logger.error("[news_scoring] Failed to create %s batch: %s", method, e)
        raise

    batch_id = message_batch.id
    logger.info("[news_scoring] %s batch %s created, polling...", method, batch_id)

    # Poll
    elapsed = 0
    while elapsed < BATCH_TIMEOUT:
        await asyncio.sleep(BATCH_POLL_INTERVAL)
        elapsed = time.monotonic() - t0
        try:
            message_batch = client.messages.batches.retrieve(batch_id)
        except Exception as e:
            logger.warning("[news_scoring] %s batch poll error: %s", method, e)
            continue

        counts = message_batch.request_counts
        logger.info(
            "[news_scoring] %s batch %s: %d ok, %d processing, %d err, %d expired",
            method, batch_id, counts.succeeded, counts.processing,
            counts.errored, counts.expired,
        )
        if message_batch.processing_status == "ended":
            break
    else:
        logger.error("[news_scoring] %s batch %s timed out", method, batch_id)

    total_ms = int((time.monotonic() - t0) * 1000)

    # Collect results
    all_results = []
    total_cost = 0.0
    succeeded = 0
    failed = 0

    try:
        for result in client.messages.batches.results(batch_id):
            custom_id = result.custom_id
            articles = ticker_article_map.get(custom_id, [])
            if not articles:
                continue

            if result.result.type == "succeeded":
                msg = result.result.message
                raw_text = msg.content[0].text if msg.content else ""
                usage = msg.usage
                cache_creation = getattr(usage, "cache_creation_input_tokens", 0) or 0
                cache_read = getattr(usage, "cache_read_input_tokens", 0) or 0

                # Batch = 50% discount
                cost = compute_cost(
                    model, usage.input_tokens, usage.output_tokens,
                    cache_creation, cache_read,
                ) * 0.5
                total_cost += cost

                # Cost per article for this ticker
                cost_per_article = cost / max(len(articles), 1)

                try:
                    parsed_results = parse_fn(raw_text, articles)
                    succeeded += 1
                    # Attach token/cost info to each result
                    for r in parsed_results:
                        r["model"] = model
                        r["input_tokens"] = usage.input_tokens // max(len(articles), 1)
                        r["output_tokens"] = usage.output_tokens // max(len(articles), 1)
                        r["cost_usd"] = cost_per_article
                    all_results.extend(parsed_results)
                except Exception as e:
                    logger.warning(
                        "[news_scoring] %s parse failed for %s: %s (raw: %s)",
                        method, custom_id, e, raw_text[:300],
                    )
                    failed += 1
                    # Score all articles in this ticker as 0
                    for art in articles:
                        all_results.append({
                            "article_id": art["id"],
                            "ticker": art["ticker"],
                            "relevance_score": None,
                            "risk_factor": None,
                            "is_about_deal": None,
                            "information_type": None,
                            "reasoning": f"Parse failed: {str(e)[:200]}",
                            "raw_response": {"error": "parse_failed", "text": raw_text[:500]},
                            "model": model,
                            "input_tokens": usage.input_tokens // max(len(articles), 1),
                            "output_tokens": usage.output_tokens // max(len(articles), 1),
                            "cost_usd": cost_per_article,
                        })
            else:
                # errored or expired
                failed += 1
                err_type = result.result.type
                for art in articles:
                    all_results.append({
                        "article_id": art["id"],
                        "ticker": art["ticker"],
                        "relevance_score": None,
                        "risk_factor": None,
                        "is_about_deal": None,
                        "information_type": None,
                        "reasoning": f"Batch {err_type}",
                        "raw_response": {"error": err_type},
                        "model": model,
                        "input_tokens": None,
                        "output_tokens": None,
                        "cost_usd": None,
                    })

    except Exception as e:
        logger.error("[news_scoring] Failed processing %s batch results: %s", method, e)

    logger.info(
        "[news_scoring] %s ticker batch done: %d ok, %d failed, $%.4f, %dms",
        method, succeeded, failed, total_cost, total_ms,
    )

    # Log cost to unified tracker
    if pool and total_cost > 0:
        total_input = sum(r.get("input_tokens") or 0 for r in all_results)
        total_output = sum(r.get("output_tokens") or 0 for r in all_results)
        await log_api_call(
            pool,
            source="news_scoring",
            model=model,
            input_tokens=total_input,
            output_tokens=total_output,
            cost_usd=total_cost,
            metadata={
                "method": method,
                "batch_id": batch_id,
                "tickers": len(requests),
                "articles": sum(len(arts) for arts in ticker_article_map.values()),
                "succeeded": succeeded,
                "failed": failed,
            },
        )

    return all_results


# ---------------------------------------------------------------------------
# Helper: group articles by ticker
# ---------------------------------------------------------------------------

def _group_by_ticker(articles: list[dict]) -> dict[str, list[dict]]:
    """Group articles by ticker, preserving order."""
    by_ticker: dict[str, list[dict]] = {}
    for art in articles:
        by_ticker.setdefault(art["ticker"], []).append(art)
    return by_ticker


# ---------------------------------------------------------------------------
# Method E: Sonnet titles-only comparative ranking
# ---------------------------------------------------------------------------

async def _score_sonnet_titles_only(
    client: Anthropic,
    articles: list[dict],
    deal_context: dict[str, dict],
    pool,
) -> list[dict]:
    """Method E: One prompt per ticker, all titles, ranked top 10."""
    if not articles:
        return []

    by_ticker = _group_by_ticker(articles)
    requests = []
    ticker_article_map: dict[str, list[dict]] = {}

    for ticker, ticker_arts in by_ticker.items():
        deal = deal_context.get(ticker, {})
        custom_id = f"titles-{ticker}"

        # Build numbered article list
        article_lines = []
        for idx, art in enumerate(ticker_arts, 1):
            title = (art.get("title") or "Untitled").strip()
            article_lines.append(f"{idx}. {title}")

        prompt = TITLES_ONLY_PROMPT.format(
            ticker=ticker,
            acquirer=deal.get("acquirer", "Unknown"),
            target=deal.get("target", "Unknown"),
            deal_price=deal.get("deal_price", "N/A"),
            risk_summary=deal.get("risk_summary", "N/A"),
            article_list="\n".join(article_lines),
        )

        requests.append(
            Request(
                custom_id=custom_id,
                params=MessageCreateParamsNonStreaming(
                    model=SONNET_MODEL,
                    temperature=0,
                    max_tokens=400,
                    messages=[{"role": "user", "content": prompt}],
                ),
            )
        )
        ticker_article_map[custom_id] = ticker_arts

    def parse_ranked_response(raw_text: str, articles_list: list[dict]) -> list[dict]:
        """Parse ranked top-10 response, assign 0.0 to unmentioned articles."""
        parsed = _extract_json_or_array(raw_text)

        # Handle both array and object-with-array responses
        if isinstance(parsed, dict):
            # Look for an array value in the dict
            for v in parsed.values():
                if isinstance(v, list):
                    parsed = v
                    break

        if not isinstance(parsed, list):
            raise ValueError(f"Expected array, got {type(parsed).__name__}")

        # Build id -> score/risk_factor map (1-indexed article IDs in response)
        scored = {}
        for item in parsed:
            if not isinstance(item, dict):
                continue
            art_idx = item.get("id")
            if isinstance(art_idx, int) and 1 <= art_idx <= len(articles_list):
                score = item.get("score", 0.0)
                if isinstance(score, (int, float)):
                    score = max(0.0, min(1.0, float(score)))
                else:
                    score = 0.5
                scored[art_idx] = {
                    "score": score,
                    "risk_factor": item.get("risk_factor"),
                }

        # Produce results for ALL articles, unmentioned get 0.0
        results = []
        for idx, art in enumerate(articles_list, 1):
            info = scored.get(idx)
            results.append({
                "article_id": art["id"],
                "ticker": art["ticker"],
                "relevance_score": info["score"] if info else 0.0,
                "risk_factor": info["risk_factor"] if info else None,
                "is_about_deal": None,
                "information_type": None,
                "reasoning": f"Ranked #{idx}" if info else None,
                "raw_response": None,
            })
        return results

    return await _run_ticker_batch_and_collect(
        client, requests, ticker_article_map, SONNET_MODEL,
        "sonnet_titles_only", pool, parse_ranked_response,
    )


# ---------------------------------------------------------------------------
# Method F: Sonnet filtered ranked (heuristic pre-filter + comparative rank)
# ---------------------------------------------------------------------------

async def _score_sonnet_filtered_ranked(
    client: Anthropic,
    articles: list[dict],
    deal_context: dict[str, dict],
    pool,
    heuristic_v2_results: list[dict] | None = None,
) -> list[dict]:
    """Method F: Heuristic v2 pre-filters to top 30 per ticker, Sonnet ranks those.

    If heuristic_v2_results is not provided, runs heuristic_v2 internally.
    Articles not in the top 30 (or not selected by Sonnet) get score 0.0.
    """
    if not articles:
        return []

    # Run heuristic_v2 if not provided
    if heuristic_v2_results is None:
        heuristic_v2_results = _score_heuristic_v2(articles, deal_context)

    # Build article ID -> heuristic score
    h2_scores = {r["article_id"]: r.get("relevance_score", 0.0) for r in heuristic_v2_results}

    by_ticker = _group_by_ticker(articles)
    requests = []
    ticker_article_map: dict[str, list[dict]] = {}  # custom_id -> top-30 articles
    ticker_all_articles: dict[str, list[dict]] = {}  # custom_id -> ALL articles

    for ticker, ticker_arts in by_ticker.items():
        deal = deal_context.get(ticker, {})
        custom_id = f"filtered-{ticker}"

        # Sort by heuristic_v2 score, take top N
        sorted_arts = sorted(
            ticker_arts,
            key=lambda a: h2_scores.get(a["id"], 0.0),
            reverse=True,
        )
        top_arts = sorted_arts[:FILTERED_RANKED_TOP_N]

        # Build numbered article list with date, title, publisher, summary
        article_lines = []
        for idx, art in enumerate(top_arts, 1):
            title = (art.get("title") or "Untitled").strip()
            publisher = art.get("publisher") or "Unknown"
            pub_date = ""
            if art.get("published_at"):
                pub_str = str(art["published_at"])[:10]
                pub_date = f"[{pub_str}] "
            summary = (art.get("summary") or "")[:100].strip()
            line = f"{idx}. {pub_date}{title} | {publisher}"
            if summary:
                line += f"\n   Summary: {summary}"
            article_lines.append(line)

        prompt = FILTERED_RANKED_PROMPT.format(
            ticker=ticker,
            acquirer=deal.get("acquirer", "Unknown"),
            target=deal.get("target", "Unknown"),
            deal_price=deal.get("deal_price", "N/A"),
            risk_summary=deal.get("risk_summary", "N/A"),
            article_list="\n".join(article_lines),
        )

        requests.append(
            Request(
                custom_id=custom_id,
                params=MessageCreateParamsNonStreaming(
                    model=SONNET_MODEL,
                    temperature=0,
                    max_tokens=400,
                    messages=[{"role": "user", "content": prompt}],
                ),
            )
        )
        ticker_article_map[custom_id] = top_arts
        ticker_all_articles[custom_id] = ticker_arts

    def parse_filtered_response(raw_text: str, top_articles: list[dict]) -> list[dict]:
        """Parse ranked response, include ALL articles (unranked get 0.0)."""
        parsed = _extract_json_or_array(raw_text)

        if isinstance(parsed, dict):
            for v in parsed.values():
                if isinstance(v, list):
                    parsed = v
                    break

        if not isinstance(parsed, list):
            raise ValueError(f"Expected array, got {type(parsed).__name__}")

        # Map 1-indexed IDs to scores
        scored = {}
        for item in parsed:
            if not isinstance(item, dict):
                continue
            art_idx = item.get("id")
            if isinstance(art_idx, int) and 1 <= art_idx <= len(top_articles):
                score = item.get("score", 0.0)
                if isinstance(score, (int, float)):
                    score = max(0.0, min(1.0, float(score)))
                else:
                    score = 0.5
                scored[art_idx] = {
                    "score": score,
                    "risk_factor": item.get("risk_factor"),
                }

        # Build set of scored article IDs
        scored_ids = set()
        results = []
        for idx, art in enumerate(top_articles, 1):
            info = scored.get(idx)
            scored_ids.add(art["id"])
            results.append({
                "article_id": art["id"],
                "ticker": art["ticker"],
                "relevance_score": info["score"] if info else 0.0,
                "risk_factor": info["risk_factor"] if info else None,
                "is_about_deal": None,
                "information_type": None,
                "reasoning": f"Filtered rank #{idx}" if info else "Pre-filtered, unranked",
                "raw_response": None,
            })

        return results

    # Run batch
    batch_results = await _run_ticker_batch_and_collect(
        client, requests, ticker_article_map, SONNET_MODEL,
        "sonnet_filtered_ranked", pool, parse_filtered_response,
    )

    # Add 0.0 scores for articles NOT in the top-30 pre-filter
    scored_ids = {r["article_id"] for r in batch_results}
    for art in articles:
        if art["id"] not in scored_ids:
            batch_results.append({
                "article_id": art["id"],
                "ticker": art["ticker"],
                "relevance_score": 0.0,
                "risk_factor": None,
                "is_about_deal": None,
                "information_type": None,
                "reasoning": "Below heuristic pre-filter threshold",
                "raw_response": None,
                "model": None,
                "input_tokens": None,
                "output_tokens": None,
                "cost_usd": None,
            })

    return batch_results


# ---------------------------------------------------------------------------
# Method G: Sonnet bucket sort
# ---------------------------------------------------------------------------

async def _score_sonnet_bucket_sort(
    client: Anthropic,
    articles: list[dict],
    deal_context: dict[str, dict],
    pool,
) -> list[dict]:
    """Method G: One prompt per ticker, sort all articles into 3 buckets."""
    if not articles:
        return []

    by_ticker = _group_by_ticker(articles)
    requests = []
    ticker_article_map: dict[str, list[dict]] = {}

    for ticker, ticker_arts in by_ticker.items():
        deal = deal_context.get(ticker, {})
        custom_id = f"bucket-{ticker}"

        # Build numbered article list (titles only)
        article_lines = []
        for idx, art in enumerate(ticker_arts, 1):
            title = (art.get("title") or "Untitled").strip()
            article_lines.append(f"{idx}. {title}")

        prompt = BUCKET_SORT_PROMPT.format(
            ticker=ticker,
            acquirer=deal.get("acquirer", "Unknown"),
            target=deal.get("target", "Unknown"),
            deal_price=deal.get("deal_price", "N/A"),
            risk_summary=deal.get("risk_summary", "N/A"),
            article_list="\n".join(article_lines),
        )

        requests.append(
            Request(
                custom_id=custom_id,
                params=MessageCreateParamsNonStreaming(
                    model=SONNET_MODEL,
                    temperature=0,
                    max_tokens=300,
                    messages=[{"role": "user", "content": prompt}],
                ),
            )
        )
        ticker_article_map[custom_id] = ticker_arts

    # Bucket -> score mapping
    BUCKET_SCORES = {"critical": 1.0, "relevant": 0.6, "noise": 0.1}

    def parse_bucket_response(raw_text: str, articles_list: list[dict]) -> list[dict]:
        """Parse bucket sort response, assign scores based on bucket."""
        parsed = _extract_json_or_array(raw_text)

        if not isinstance(parsed, dict):
            raise ValueError(f"Expected object with buckets, got {type(parsed).__name__}")

        # Normalize bucket keys to lowercase
        buckets = {}
        for k, v in parsed.items():
            k_lower = k.lower().strip()
            if k_lower in BUCKET_SCORES and isinstance(v, list):
                buckets[k_lower] = set()
                for item in v:
                    if isinstance(item, int):
                        buckets[k_lower].add(item)

        # Map article index -> bucket
        idx_to_bucket = {}
        for bucket_name, indices in buckets.items():
            for idx in indices:
                if 1 <= idx <= len(articles_list):
                    idx_to_bucket[idx] = bucket_name

        # Produce results for ALL articles
        results = []
        for idx, art in enumerate(articles_list, 1):
            bucket = idx_to_bucket.get(idx, "noise")  # Default unmentioned to noise
            results.append({
                "article_id": art["id"],
                "ticker": art["ticker"],
                "relevance_score": BUCKET_SCORES.get(bucket, 0.1),
                "risk_factor": None,
                "is_about_deal": bucket != "noise",
                "information_type": bucket,
                "reasoning": f"Bucket: {bucket}",
                "raw_response": None,
            })
        return results

    return await _run_ticker_batch_and_collect(
        client, requests, ticker_article_map, SONNET_MODEL,
        "sonnet_bucket_sort", pool, parse_bucket_response,
    )


# ---------------------------------------------------------------------------
# Deal context fetcher
# ---------------------------------------------------------------------------

async def _fetch_deal_context(pool) -> dict[str, dict]:
    """Fetch deal context for all active tickers.

    Returns dict mapping ticker -> {acquirer, target, deal_price, current_price,
    announce_date, status, risk_summary}.
    """
    context: dict[str, dict] = {}
    async with pool.acquire() as conn:
        # Get latest sheet snapshot for deal details
        snap = await conn.fetchrow(
            """SELECT id FROM sheet_snapshots
               WHERE status = 'success'
               ORDER BY ingested_at DESC LIMIT 1"""
        )
        if not snap:
            return context

        rows = await conn.fetch(
            """SELECT ticker, acquiror, category, deal_price_raw,
                      current_price_raw, go_shop_raw
               FROM sheet_rows
               WHERE snapshot_id = $1 AND ticker IS NOT NULL
                 AND (is_excluded IS NOT TRUE)""",
            snap["id"],
        )

        for row in rows:
            ticker = row["ticker"]
            # Extract target company from category (format: "Acquirer / Target")
            category = row.get("category") or ""
            parts = category.split("/")
            target = parts[-1].strip() if len(parts) > 1 else category.strip()
            acquirer = row.get("acquiror") or (parts[0].strip() if len(parts) > 1 else "Unknown")

            context[ticker] = {
                "acquirer": acquirer,
                "target": target,
                "deal_price": str(row.get("deal_price_raw") or "N/A"),
                "current_price": str(row.get("current_price_raw") or "N/A"),
                "announce_date": "N/A",
                "status": "active",
                "risk_summary": "N/A",
            }

        # Enrich with latest risk assessment grades
        for ticker in list(context.keys()):
            assessment = await conn.fetchrow(
                """SELECT vote_grade, financing_grade, legal_grade,
                          regulatory_grade, probability_of_success
                   FROM deal_risk_assessments
                   WHERE ticker = $1
                   ORDER BY assessment_date DESC LIMIT 1""",
                ticker,
            )
            if assessment:
                grades = []
                for field in ["vote_grade", "financing_grade", "legal_grade", "regulatory_grade"]:
                    val = assessment.get(field)
                    if val:
                        label = field.replace("_grade", "").replace("_", " ").title()
                        grades.append(f"{label}: {val}")
                prob = assessment.get("probability_of_success")
                if prob:
                    grades.append(f"Close prob: {prob}%")
                if grades:
                    context[ticker]["risk_summary"] = "; ".join(grades)

    return context


# ---------------------------------------------------------------------------
# Fetch articles
# ---------------------------------------------------------------------------

async def _fetch_articles(
    pool,
    ticker_filter: list[str] | None = None,
    max_articles: int | None = None,
) -> list[dict]:
    """Fetch all articles from deal_news_articles for scoring."""
    async with pool.acquire() as conn:
        if ticker_filter:
            query = """SELECT id, ticker, title, publisher, published_at,
                              summary, relevance_score, risk_factor_affected,
                              source, article_url
                       FROM deal_news_articles
                       WHERE ticker = ANY($1)
                       ORDER BY ticker, published_at DESC"""
            rows = await conn.fetch(query, ticker_filter)
        else:
            query = """SELECT id, ticker, title, publisher, published_at,
                              summary, relevance_score, risk_factor_affected,
                              source, article_url
                       FROM deal_news_articles
                       ORDER BY ticker, published_at DESC"""
            rows = await conn.fetch(query)

    articles = []
    for row in rows:
        d = dict(row)
        # Convert UUID to string for consistent handling
        d["id"] = str(d["id"])
        if isinstance(d.get("published_at"), datetime):
            d["published_at"] = d["published_at"].isoformat()
        articles.append(d)

    if max_articles and len(articles) > max_articles:
        articles = articles[:max_articles]

    return articles


# ---------------------------------------------------------------------------
# Store results
# ---------------------------------------------------------------------------

async def _store_results(
    pool,
    run_id: str,
    method: str,
    results: list[dict],
    articles_by_id: dict[str, dict],
) -> int:
    """Store scoring results into news_scoring_results table."""
    stored = 0
    async with pool.acquire() as conn:
        for r in results:
            art_id = r["article_id"]
            art = articles_by_id.get(art_id, {})

            try:
                await conn.execute(
                    """INSERT INTO news_scoring_results
                       (run_id, article_id, ticker, method,
                        relevance_score, risk_factor, is_about_deal,
                        information_type, reasoning, raw_response,
                        model, input_tokens, output_tokens, cost_usd,
                        article_title, article_source, article_publisher)
                       VALUES ($1, $2::uuid, $3, $4,
                               $5, $6, $7,
                               $8, $9, $10::jsonb,
                               $11, $12, $13, $14,
                               $15, $16, $17)
                       ON CONFLICT (run_id, article_id, method) DO UPDATE SET
                           relevance_score = EXCLUDED.relevance_score,
                           risk_factor = EXCLUDED.risk_factor,
                           reasoning = EXCLUDED.reasoning,
                           raw_response = EXCLUDED.raw_response""",
                    uuid.UUID(run_id),
                    art_id,
                    r["ticker"],
                    method,
                    r.get("relevance_score"),
                    r.get("risk_factor"),
                    r.get("is_about_deal"),
                    r.get("information_type"),
                    r.get("reasoning"),
                    json.dumps(r.get("raw_response"), default=_json_default) if r.get("raw_response") else None,
                    r.get("model"),
                    r.get("input_tokens"),
                    r.get("output_tokens"),
                    float(r["cost_usd"]) if r.get("cost_usd") is not None else None,
                    art.get("title", "")[:500] if art else None,
                    art.get("source"),
                    art.get("publisher", "")[:100] if art else None,
                )
                stored += 1
            except Exception:
                logger.error(
                    "[news_scoring] Failed to store result for %s/%s/%s",
                    method, r["ticker"], art_id, exc_info=True,
                )
    return stored


# ---------------------------------------------------------------------------
# Comparison metrics (SQL-based)
# ---------------------------------------------------------------------------

async def _compute_comparison_metrics(run_id: str, pool) -> dict:
    """Compute comparison metrics between all methods and Sonnet judge.

    Returns dict with:
      - per_method: {method: {rank_correlation, top10_overlap, ...}}
      - per_ticker: {ticker: {method: metrics}}
      - overall: summary stats
    """
    metrics: dict[str, Any] = {"per_method": {}, "per_ticker": {}, "overall": {}}

    async with pool.acquire() as conn:
        # Get all tickers in this run
        tickers = await conn.fetch(
            """SELECT DISTINCT ticker FROM news_scoring_results
               WHERE run_id = $1 AND method = 'sonnet_judge'""",
            uuid.UUID(run_id),
        )
        ticker_list = [r["ticker"] for r in tickers]

        # Discover all methods in this run (excluding sonnet_judge itself)
        method_rows = await conn.fetch(
            """SELECT DISTINCT method FROM news_scoring_results
               WHERE run_id = $1 AND method != 'sonnet_judge'""",
            uuid.UUID(run_id),
        )
        methods = [r["method"] for r in method_rows]
        for method in methods:
            method_metrics = {
                "top10_overlaps": [],
                "precision_at_05": {"tp": 0, "total": 0},
                "risk_factor_agreement": {"agree": 0, "total": 0},
                "noise_rejection": {"both_low": 0, "judge_low": 0},
                "critical_miss": {"missed": 0, "total_critical": 0},
            }

            for ticker in ticker_list:
                # Get both method and judge scores for this ticker
                pairs = await conn.fetch(
                    """SELECT m.article_id,
                              m.relevance_score AS m_score,
                              m.risk_factor AS m_rf,
                              j.relevance_score AS j_score,
                              j.risk_factor AS j_rf,
                              j.is_about_deal AS j_about,
                              j.article_title
                       FROM news_scoring_results m
                       JOIN news_scoring_results j
                         ON m.run_id = j.run_id
                         AND m.article_id = j.article_id
                         AND j.method = 'sonnet_judge'
                       WHERE m.run_id = $1
                         AND m.method = $2
                         AND m.ticker = $3
                         AND m.relevance_score IS NOT NULL
                         AND j.relevance_score IS NOT NULL
                       ORDER BY m.relevance_score DESC""",
                    uuid.UUID(run_id), method, ticker,
                )

                if not pairs:
                    continue

                # Top-10 overlap
                method_top10 = set(
                    str(p["article_id"]) for p in
                    sorted(pairs, key=lambda x: x["m_score"] or 0, reverse=True)[:10]
                )
                judge_top10 = set(
                    str(p["article_id"]) for p in
                    sorted(pairs, key=lambda x: x["j_score"] or 0, reverse=True)[:10]
                )
                overlap = len(method_top10 & judge_top10)
                overlap_pct = overlap / max(len(judge_top10), 1) * 100
                method_metrics["top10_overlaps"].append(overlap_pct)

                # Store per-ticker metrics
                if ticker not in metrics["per_ticker"]:
                    metrics["per_ticker"][ticker] = {}
                metrics["per_ticker"][ticker][method] = {
                    "top10_overlap_pct": round(overlap_pct, 1),
                    "article_count": len(pairs),
                }

                # Precision at 0.5: of articles method scores >=0.5,
                # what % did Sonnet mark is_about_this_deal=true?
                for p in pairs:
                    if (p["m_score"] or 0) >= 0.5:
                        method_metrics["precision_at_05"]["total"] += 1
                        if p["j_about"]:
                            method_metrics["precision_at_05"]["tp"] += 1

                # Risk factor agreement
                for p in pairs:
                    if p["m_rf"] and p["j_rf"]:
                        method_metrics["risk_factor_agreement"]["total"] += 1
                        if p["m_rf"] == p["j_rf"]:
                            method_metrics["risk_factor_agreement"]["agree"] += 1

                # Noise rejection: of articles Sonnet scores <0.2,
                # what % does method also score <0.2?
                for p in pairs:
                    if (p["j_score"] or 0) < 0.2:
                        method_metrics["noise_rejection"]["judge_low"] += 1
                        if (p["m_score"] or 0) < 0.2:
                            method_metrics["noise_rejection"]["both_low"] += 1

                # Critical miss: of articles Sonnet scores >=0.8,
                # how many does method rank outside top 10 for that ticker?
                judge_critical = [
                    str(p["article_id"]) for p in pairs
                    if (p["j_score"] or 0) >= 0.8
                ]
                method_metrics["critical_miss"]["total_critical"] += len(judge_critical)
                for crit_id in judge_critical:
                    if crit_id not in method_top10:
                        method_metrics["critical_miss"]["missed"] += 1

            # Aggregate per-method
            overlaps = method_metrics["top10_overlaps"]
            prec = method_metrics["precision_at_05"]
            rf_agree = method_metrics["risk_factor_agreement"]
            noise = method_metrics["noise_rejection"]
            crit = method_metrics["critical_miss"]

            metrics["per_method"][method] = {
                "avg_top10_overlap_pct": round(sum(overlaps) / max(len(overlaps), 1), 1),
                "min_top10_overlap_pct": round(min(overlaps), 1) if overlaps else None,
                "max_top10_overlap_pct": round(max(overlaps), 1) if overlaps else None,
                "precision_at_05": round(prec["tp"] / max(prec["total"], 1) * 100, 1),
                "precision_at_05_n": prec["total"],
                "risk_factor_agreement_pct": round(
                    rf_agree["agree"] / max(rf_agree["total"], 1) * 100, 1
                ),
                "risk_factor_agreement_n": rf_agree["total"],
                "noise_rejection_pct": round(
                    noise["both_low"] / max(noise["judge_low"], 1) * 100, 1
                ),
                "noise_rejection_n": noise["judge_low"],
                "critical_miss_rate": round(
                    crit["missed"] / max(crit["total_critical"], 1) * 100, 1
                ),
                "critical_miss_n": crit["total_critical"],
                "tickers_scored": len(overlaps),
            }

        # Overall summary
        metrics["overall"] = {
            "tickers": len(ticker_list),
            "methods_compared": methods,
        }

        # Score distributions per method
        for method in methods + ["sonnet_judge"]:
            dist = await conn.fetch(
                """SELECT
                     CASE
                       WHEN relevance_score < 0.2 THEN '0.0-0.2'
                       WHEN relevance_score < 0.4 THEN '0.2-0.4'
                       WHEN relevance_score < 0.6 THEN '0.4-0.6'
                       WHEN relevance_score < 0.8 THEN '0.6-0.8'
                       ELSE '0.8-1.0'
                     END AS bucket,
                     COUNT(*) AS cnt
                   FROM news_scoring_results
                   WHERE run_id = $1 AND method = $2
                     AND relevance_score IS NOT NULL
                   GROUP BY bucket
                   ORDER BY bucket""",
                uuid.UUID(run_id), method,
            )
            metrics["overall"][f"{method}_distribution"] = {
                r["bucket"]: r["cnt"] for r in dist
            }

    return metrics


# ---------------------------------------------------------------------------
# Main experiment runner
# ---------------------------------------------------------------------------

async def run_news_scoring_experiment(
    pool,
    client: Anthropic | None = None,
    ticker_filter: list[str] | None = None,
    max_articles: int | None = None,
    methods: list[str] | None = None,
) -> dict:
    """Run the news scoring experiment with selected methods.

    Args:
        pool: asyncpg connection pool
        client: Anthropic client (required for AI methods)
        ticker_filter: Optional list of tickers to filter articles
        max_articles: Optional cap on total articles
        methods: Optional list of method names to run. Default = all available.
                 Available: heuristic_v1, heuristic_v2, haiku, sonnet_judge,
                            sonnet_titles_only, sonnet_filtered_ranked, sonnet_bucket_sort

    Returns summary dict with run_id, metrics, costs.
    """
    # Determine which methods to run
    if methods:
        # Validate
        invalid = [m for m in methods if m not in ALL_METHODS]
        if invalid:
            raise ValueError(f"Unknown methods: {invalid}. Valid: {ALL_METHODS}")
        methods_to_run = methods
    else:
        # Default: heuristics + AI methods if client available
        methods_to_run = list(HEURISTIC_METHODS)
        if client:
            methods_to_run.extend(sorted(AI_METHODS))

    # AI methods need a client
    ai_requested = [m for m in methods_to_run if m in AI_METHODS]
    if ai_requested and not client:
        logger.warning(
            "[news_scoring] No Anthropic client — skipping AI methods: %s",
            ai_requested,
        )
        methods_to_run = [m for m in methods_to_run if m not in AI_METHODS]

    run_id = str(uuid.uuid4())
    t0 = time.monotonic()

    # Create run record
    async with pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO news_scoring_runs
               (id, description, methods, config)
               VALUES ($1, $2, $3, $4::jsonb)""",
            uuid.UUID(run_id),
            f"News scoring experiment: {', '.join(methods_to_run)}",
            methods_to_run,
            json.dumps({
                "ticker_filter": ticker_filter,
                "max_articles": max_articles,
                "haiku_model": HAIKU_MODEL,
                "sonnet_model": SONNET_MODEL,
                "methods_requested": methods_to_run,
            }),
        )

    logger.info("[news_scoring] Starting experiment %s with methods: %s", run_id, methods_to_run)

    # Fetch articles
    articles = await _fetch_articles(pool, ticker_filter, max_articles)
    total_articles = len(articles)
    logger.info("[news_scoring] Loaded %d articles", total_articles)

    if not articles:
        async with pool.acquire() as conn:
            await conn.execute(
                """UPDATE news_scoring_runs
                   SET status = 'completed', total_articles = 0, completed_at = NOW()
                   WHERE id = $1""",
                uuid.UUID(run_id),
            )
        return {"run_id": run_id, "total_articles": 0, "status": "no_articles"}

    # Build lookup
    articles_by_id = {a["id"]: a for a in articles}

    # Fetch deal context for AI prompts and heuristic_v2 title matching
    deal_context = await _fetch_deal_context(pool)
    logger.info("[news_scoring] Deal context loaded for %d tickers", len(deal_context))

    total_cost = 0.0
    v2_results = None  # Cache for filtered_ranked reuse

    # --- Method A: Heuristic v1 ---
    if "heuristic_v1" in methods_to_run:
        logger.info("[news_scoring] Running heuristic_v1...")
        v1_results = _score_heuristic_v1(articles)
        stored = await _store_results(pool, run_id, "heuristic_v1", v1_results, articles_by_id)
        logger.info("[news_scoring] heuristic_v1: %d scored, %d stored", len(v1_results), stored)

    # --- Method B: Heuristic v2 ---
    if "heuristic_v2" in methods_to_run or "sonnet_filtered_ranked" in methods_to_run:
        logger.info("[news_scoring] Running heuristic_v2...")
        v2_results = _score_heuristic_v2(articles, deal_context)
        if "heuristic_v2" in methods_to_run:
            stored = await _store_results(pool, run_id, "heuristic_v2", v2_results, articles_by_id)
            logger.info("[news_scoring] heuristic_v2: %d scored, %d stored", len(v2_results), stored)

    # --- Method C: Haiku batch ---
    if "haiku" in methods_to_run and client:
        logger.info("[news_scoring] Running Haiku batch...")
        try:
            haiku_results = await _score_haiku_batch(client, articles, deal_context, pool)
            stored = await _store_results(pool, run_id, "haiku", haiku_results, articles_by_id)
            haiku_cost = sum(r.get("cost_usd") or 0 for r in haiku_results)
            total_cost += haiku_cost
            logger.info(
                "[news_scoring] haiku: %d scored, %d stored, $%.4f",
                len(haiku_results), stored, haiku_cost,
            )
        except Exception as e:
            logger.error("[news_scoring] Haiku batch failed: %s", e, exc_info=True)

    # --- Method D: Sonnet judge ---
    if "sonnet_judge" in methods_to_run and client:
        logger.info("[news_scoring] Running Sonnet judge batch...")
        try:
            sonnet_results = await _score_sonnet_judge(client, articles, deal_context, pool)
            stored = await _store_results(pool, run_id, "sonnet_judge", sonnet_results, articles_by_id)
            sonnet_cost = sum(r.get("cost_usd") or 0 for r in sonnet_results)
            total_cost += sonnet_cost
            logger.info(
                "[news_scoring] sonnet_judge: %d scored, %d stored, $%.4f",
                len(sonnet_results), stored, sonnet_cost,
            )
        except Exception as e:
            logger.error("[news_scoring] Sonnet judge batch failed: %s", e, exc_info=True)

    # --- Method E: Sonnet titles only ---
    if "sonnet_titles_only" in methods_to_run and client:
        logger.info("[news_scoring] Running sonnet_titles_only batch...")
        try:
            titles_results = await _score_sonnet_titles_only(client, articles, deal_context, pool)
            stored = await _store_results(pool, run_id, "sonnet_titles_only", titles_results, articles_by_id)
            titles_cost = sum(r.get("cost_usd") or 0 for r in titles_results)
            total_cost += titles_cost
            logger.info(
                "[news_scoring] sonnet_titles_only: %d scored, %d stored, $%.4f",
                len(titles_results), stored, titles_cost,
            )
        except Exception as e:
            logger.error("[news_scoring] sonnet_titles_only batch failed: %s", e, exc_info=True)

    # --- Method F: Sonnet filtered ranked ---
    if "sonnet_filtered_ranked" in methods_to_run and client:
        logger.info("[news_scoring] Running sonnet_filtered_ranked batch...")
        try:
            filtered_results = await _score_sonnet_filtered_ranked(
                client, articles, deal_context, pool, v2_results,
            )
            stored = await _store_results(pool, run_id, "sonnet_filtered_ranked", filtered_results, articles_by_id)
            filtered_cost = sum(r.get("cost_usd") or 0 for r in filtered_results)
            total_cost += filtered_cost
            logger.info(
                "[news_scoring] sonnet_filtered_ranked: %d scored, %d stored, $%.4f",
                len(filtered_results), stored, filtered_cost,
            )
        except Exception as e:
            logger.error("[news_scoring] sonnet_filtered_ranked batch failed: %s", e, exc_info=True)

    # --- Method G: Sonnet bucket sort ---
    if "sonnet_bucket_sort" in methods_to_run and client:
        logger.info("[news_scoring] Running sonnet_bucket_sort batch...")
        try:
            bucket_results = await _score_sonnet_bucket_sort(client, articles, deal_context, pool)
            stored = await _store_results(pool, run_id, "sonnet_bucket_sort", bucket_results, articles_by_id)
            bucket_cost = sum(r.get("cost_usd") or 0 for r in bucket_results)
            total_cost += bucket_cost
            logger.info(
                "[news_scoring] sonnet_bucket_sort: %d scored, %d stored, $%.4f",
                len(bucket_results), stored, bucket_cost,
            )
        except Exception as e:
            logger.error("[news_scoring] sonnet_bucket_sort batch failed: %s", e, exc_info=True)

    # Update run record
    async with pool.acquire() as conn:
        await conn.execute(
            """UPDATE news_scoring_runs
               SET status = 'completed',
                   total_articles = $2,
                   total_cost_usd = $3,
                   completed_at = NOW()
               WHERE id = $1""",
            uuid.UUID(run_id),
            total_articles,
            total_cost,
        )

    # Compute comparison metrics (only if Sonnet judge ran)
    comparison = {}
    if "sonnet_judge" in methods_to_run and client:
        try:
            comparison = await _compute_comparison_metrics(run_id, pool)
        except Exception as e:
            logger.error("[news_scoring] Metrics computation failed: %s", e, exc_info=True)

    elapsed_s = time.monotonic() - t0
    logger.info(
        "[news_scoring] Experiment %s complete: %d articles, $%.4f, %.0fs",
        run_id, total_articles, total_cost, elapsed_s,
    )

    return {
        "run_id": run_id,
        "total_articles": total_articles,
        "tickers": len(deal_context),
        "methods": methods_to_run,
        "total_cost_usd": round(total_cost, 4),
        "elapsed_seconds": round(elapsed_s, 1),
        "comparison": comparison,
    }


# ---------------------------------------------------------------------------
# Results query
# ---------------------------------------------------------------------------

async def get_experiment_results(
    pool,
    run_id: str,
    ticker: str | None = None,
) -> dict:
    """Fetch experiment results for a completed run.

    Returns run metadata, comparison metrics, and per-ticker breakdowns.
    """
    async with pool.acquire() as conn:
        # Run metadata
        run = await conn.fetchrow(
            "SELECT * FROM news_scoring_runs WHERE id = $1",
            uuid.UUID(run_id),
        )
        if not run:
            return {"error": "Run not found"}

        run_dict = dict(run)
        for k, v in run_dict.items():
            if isinstance(v, uuid.UUID):
                run_dict[k] = str(v)
            elif isinstance(v, (date, datetime)):
                run_dict[k] = v.isoformat()
            elif isinstance(v, Decimal):
                run_dict[k] = float(v)

        # Method summary stats
        method_stats = await conn.fetch(
            """SELECT method,
                      COUNT(*) AS total,
                      COUNT(*) FILTER (WHERE relevance_score IS NOT NULL) AS scored,
                      ROUND(AVG(relevance_score)::numeric, 3) AS avg_score,
                      ROUND(MIN(relevance_score)::numeric, 3) AS min_score,
                      ROUND(MAX(relevance_score)::numeric, 3) AS max_score,
                      COALESCE(SUM(cost_usd), 0) AS total_cost
               FROM news_scoring_results
               WHERE run_id = $1
               GROUP BY method
               ORDER BY method""",
            uuid.UUID(run_id),
        )

        method_summary = []
        for row in method_stats:
            d = dict(row)
            for k, v in d.items():
                if isinstance(v, Decimal):
                    d[k] = float(v)
            method_summary.append(d)

        # Sample divergences: articles where methods disagree most with judge
        divergences = []
        if not ticker:
            div_rows = await conn.fetch(
                """SELECT m.ticker, m.method, m.article_title,
                          m.relevance_score AS method_score,
                          j.relevance_score AS judge_score,
                          j.reasoning AS judge_reasoning,
                          ABS(m.relevance_score - j.relevance_score) AS delta
                   FROM news_scoring_results m
                   JOIN news_scoring_results j
                     ON m.run_id = j.run_id
                     AND m.article_id = j.article_id
                     AND j.method = 'sonnet_judge'
                   WHERE m.run_id = $1
                     AND m.method != 'sonnet_judge'
                     AND m.relevance_score IS NOT NULL
                     AND j.relevance_score IS NOT NULL
                   ORDER BY delta DESC
                   LIMIT 20""",
                uuid.UUID(run_id),
            )
            for row in div_rows:
                d = dict(row)
                for k, v in d.items():
                    if isinstance(v, Decimal):
                        d[k] = float(v)
                divergences.append(d)

        # Per-ticker details if requested
        ticker_detail = None
        if ticker:
            ticker_rows = await conn.fetch(
                """SELECT method, article_title, relevance_score,
                          risk_factor, is_about_deal, information_type,
                          reasoning, article_publisher, article_source
                   FROM news_scoring_results
                   WHERE run_id = $1 AND ticker = $2
                   ORDER BY method, relevance_score DESC NULLS LAST""",
                uuid.UUID(run_id), ticker,
            )
            ticker_detail = []
            for row in ticker_rows:
                d = dict(row)
                for k, v in d.items():
                    if isinstance(v, Decimal):
                        d[k] = float(v)
                ticker_detail.append(d)

    # Compute comparison metrics
    comparison = {}
    if run_dict.get("status") == "completed":
        try:
            comparison = await _compute_comparison_metrics(run_id, pool)
        except Exception as e:
            logger.error("Metrics computation failed: %s", e, exc_info=True)

    return {
        "run": run_dict,
        "method_summary": method_summary,
        "comparison": comparison,
        "top_divergences": divergences,
        "ticker_detail": ticker_detail,
    }
