"""Chief of Staff — orchestration service (vLLM + Opus escalation)."""

import json
import logging
import os
import re
import time
import uuid
from typing import AsyncGenerator, Optional

import httpx

logger = logging.getLogger(__name__)

# Lazy singleton
_instance: Optional["ChiefOfStaffService"] = None


def get_cos_service() -> "ChiefOfStaffService":
    global _instance
    if _instance is None:
        _instance = ChiefOfStaffService()
    return _instance


class ChatResult:
    __slots__ = ("response", "specialist", "escalated", "thinking", "message_id", "latency_ms", "model", "confidence", "context_sources", "token_usage")

    def __init__(self, **kwargs):
        for k in self.__slots__:
            setattr(self, k, kwargs.get(k, ""))

    def to_dict(self) -> dict:
        return {k: getattr(self, k) for k in self.__slots__}


class ChiefOfStaffService:
    def __init__(self):
        self.vllm_url = os.environ.get("COS_VLLM_URL", "")
        self.vllm_model = os.environ.get("COS_VLLM_MODEL", "")
        self.escalation_threshold = float(os.environ.get("COS_ESCALATION_THRESHOLD", "0.5"))
        self.anthropic_key = os.environ.get("ANTHROPIC_API_KEY", "")
        self._http: Optional[httpx.AsyncClient] = None
        self._internal_http: Optional[httpx.AsyncClient] = None
        self._corrections_file = os.environ.get(
            "COS_CORRECTIONS_FILE",
            os.path.join(os.environ.get("COS_DATA_DIR", "/home/don/apps/data/cos"), "corrections.txt"),
        )

    def _load_corrections(self) -> str:
        """Load persistent corrections from file."""
        try:
            if os.path.isfile(self._corrections_file):
                with open(self._corrections_file, encoding="utf-8") as f:
                    text = f.read().strip()
                if text:
                    return text
        except Exception as e:
            logger.warning(f"Failed to load corrections: {e}")
        return "(No corrections yet — you're doing great. Keep it that way.)"

    def _save_correction(self, correction: str) -> None:
        """Append a correction to the persistent file."""
        try:
            os.makedirs(os.path.dirname(self._corrections_file), exist_ok=True)
            with open(self._corrections_file, "a", encoding="utf-8") as f:
                f.write(f"- {correction.strip()}\n")
            logger.info(f"Saved correction: {correction.strip()[:80]}")
        except Exception as e:
            logger.warning(f"Failed to save correction: {e}")

    def _extract_and_save_corrections(self, response: str) -> str:
        """Extract ===CORRECTION=== blocks from response, save them, return cleaned response."""
        import re as _re
        pattern = r"===CORRECTION===\s*(.*?)\s*===END_CORRECTION==="
        matches = _re.findall(pattern, response, _re.DOTALL)
        for match in matches:
            self._save_correction(match)
        # Remove the correction blocks from the visible response
        cleaned = _re.sub(r"\s*===CORRECTION===.*?===END_CORRECTION===\s*", "", response, flags=_re.DOTALL)
        return cleaned.strip()

    def _get_http(self) -> httpx.AsyncClient:
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(timeout=240.0)
        return self._http

    def _get_internal_http(self) -> httpx.AsyncClient:
        if self._internal_http is None or self._internal_http.is_closed:
            self._internal_http = httpx.AsyncClient(timeout=10.0)
        return self._internal_http

    async def close(self):
        if self._http and not self._http.is_closed:
            await self._http.aclose()
        if self._internal_http and not self._internal_http.is_closed:
            await self._internal_http.aclose()

    async def chat(self, message: str, conversation_history: Optional[list] = None, silent: bool = False) -> ChatResult:
        from .cos_activity import ActivityEntry, append_activity

        start = time.monotonic()
        history = (conversation_history or [])[-20:]  # Truncate to last 20

        # Phase 1: Route
        routing = await self._route(message, history)
        specialist = routing.get("specialist", "cos")
        confidence = routing.get("confidence", 0.5)
        escalate = routing.get("escalate", False)
        context_sources = routing.get("needs_context", [])

        # Ensure cos and bmc_research always get fleet context (prevents empty context)
        if specialist in ("cos", "bmc_research"):
            default_sources = ["fleet", "fleet_utilization"]
            for src in default_sources:
                if src not in context_sources:
                    context_sources.append(src)

        # Phase 2: Fetch context (live API data + static knowledge)
        context_text = await self._fetch_context(context_sources)

        from .cos_knowledge import get_knowledge_for_specialist

        knowledge_text = get_knowledge_for_specialist(specialist)
        if knowledge_text:
            combined_context = f"# Static Knowledge\n\n{knowledge_text}\n\n# Live Context\n\n{context_text}"
        else:
            combined_context = context_text

        # Phase 3: Execute
        from .cos_prompts import SPECIALISTS

        specialist_prompt = SPECIALISTS.get(specialist, SPECIALISTS["cos"])
        specialist_prompt = specialist_prompt.replace("{context}", combined_context)

        # Inject persistent corrections into the prompt
        corrections = self._load_corrections()
        specialist_prompt = specialist_prompt.replace("{corrections}", corrections)

        # Build messages for execution
        exec_messages = []
        for msg in history:
            exec_messages.append({"role": msg.get("role", "user"), "content": msg.get("content", "")})
        exec_messages.append({"role": "user", "content": message})

        token_usage = {}
        if escalate or confidence < self.escalation_threshold:
            raw_response, model_used, token_usage = await self._call_opus(specialist_prompt, exec_messages)
            escalated = True
        else:
            raw_response, model_used = await self._call_vllm(specialist_prompt, exec_messages)
            escalated = False

        thinking, clean_response = self._parse_think_blocks(raw_response)

        # Extract and persist any corrections from Sancho's response
        clean_response = self._extract_and_save_corrections(clean_response)

        latency_ms = int((time.monotonic() - start) * 1000)

        message_id = str(uuid.uuid4())

        result = ChatResult(
            response=clean_response,
            specialist=specialist,
            escalated=escalated,
            thinking=thinking,
            message_id=message_id,
            latency_ms=latency_ms,
            model=model_used,
            confidence=confidence,
            context_sources=context_sources,
            token_usage=token_usage,
        )

        # Log activity (skip if silent — internal pipeline calls)
        if not silent:
            entry = ActivityEntry(
                message_id=message_id,
                user_message=message,
                specialist=specialist,
                escalated=escalated,
                thinking=thinking,
                response=clean_response,
                confidence=confidence,
                latency_ms=latency_ms,
                model=model_used,
                context_sources=context_sources,
                token_usage=token_usage,
            )
            try:
                append_activity(entry)
            except Exception as e:
                logger.warning(f"Failed to log activity: {e}")

        return result

    async def _route(self, message: str, history: list) -> dict:
        """Send message to vLLM with CoS routing prompt to get JSON routing decision."""
        from .cos_prompts import COS_ROUTING_PROMPT
        from .cos_activity import get_escalation_stats

        routing_prompt = COS_ROUTING_PROMPT

        # Inject escalation feedback so routing learns from Don's ratings
        stats = get_escalation_stats()
        if stats.get("feedback_count", 0) > 0:
            routing_prompt += f"""

ESCALATION FEEDBACK FROM DON (learn from this):
- Total Opus escalations: {stats['total_escalations']} (${stats['total_cost_usd']:.2f} spent)
- Don rated {stats['feedback_count']} escalations:
  - Escalation was warranted: {stats['escalation_worthy_yes']} yes, {stats['escalation_worthy_no']} no
  - Response quality was good: {stats['quality_good_yes']} yes, {stats['quality_good_no']} no
- If many escalations are rated "not warranted", raise your confidence threshold — handle more locally.
- If quality ratings are poor, escalate MORE for those specialist domains."""
        messages = []
        for msg in history[-5:]:  # Only last 5 for routing context
            messages.append({"role": msg.get("role", "user"), "content": msg.get("content", "")})
        messages.append({"role": "user", "content": message})

        try:
            raw, _ = await self._call_vllm(routing_prompt, messages)
            _, clean = self._parse_think_blocks(raw)
            # Extract JSON from response
            match = re.search(r'\{[^{}]*"specialist"[^{}]*\}', clean, re.DOTALL)
            if match:
                return json.loads(match.group())
        except Exception as e:
            logger.warning(f"Routing failed, defaulting to cos: {e}")

        return {"specialist": "cos", "confidence": 0.5, "needs_context": [], "escalate": False}

    async def _fetch_context(self, sources: list) -> str:
        """Fetch context from internal FastAPI endpoints and portfolio container."""
        base = "http://localhost:8000"
        portfolio_base = "http://localhost:8001"

        source_map = {
            # Fleet & Ops
            "fleet": f"{base}/fleet/status",
            "fleet_alerts": f"{base}/fleet/alerts",
            "fleet_utilization": f"{base}/fleet/utilization",
            "fleet_cpu": f"{base}/fleet/cpu-utilization",
            # Trading & Execution
            "ib_status": f"{base}/options/relay/ib-status",
            "positions": f"{base}/options/relay/positions",
            "open_orders": f"{base}/options/relay/open-orders",
            "execution_status": f"{base}/options/relay/execution/status",
            "ib_pnl": f"{base}/options/relay/execution/ib-pnl",
            "pnl_summary": f"{base}/options/relay/pnl-history/summary",
            "agent_state": f"{base}/options/relay/agent-state",
            # EDGAR & Intelligence
            "deals": f"{base}/intelligence/deals",
            "edgar_status": f"{base}/edgar/monitoring/status",
            "staged_deals": f"{base}/edgar/staged-deals",
            "halts": f"{base}/halts/stats",
            "halt_recent": f"{base}/halts/recent",
            "watchlist": f"{base}/intelligence/watch-list",
            # KRJ Signals
            "signals": f"{base}/krj/signals/single?ticker=SPY",
            # Portfolio (port 8001)
            "portfolio": f"{portfolio_base}/portfolio/deals",
            "portfolio_health": f"{portfolio_base}/portfolio/health",
            "risk_summary": f"{portfolio_base}/risk/summary",
            "risk_changes": f"{portfolio_base}/risk/changes",
            "scheduler": f"{portfolio_base}/scheduler/health",
        }

        parts = []
        client = self._get_internal_http()
        for source in sources:
            url = source_map.get(source)
            if not url:
                continue
            try:
                resp = await client.get(url)
                if resp.status_code == 200:
                    data = resp.json()
                    parts.append(f"[{source}]: {json.dumps(data, default=str)[:4000]}")
                else:
                    parts.append(f"[{source}]: HTTP {resp.status_code}")
            except Exception as e:
                parts.append(f"[{source}]: Error -- {e}")

        # Always inject recent activity so Sancho knows what he's been doing
        # Only include autoloop entries (from daemon) — skip chat entries to avoid
        # circular self-reinforcement of bad response patterns
        try:
            from .cos_activity import read_activity
            recent = read_activity(limit=20)
            if recent:
                activity_lines = []
                for entry in recent:
                    # Only show autoloop/system entries, not chat responses
                    spec = entry.get("specialist", "?")
                    model = entry.get("model", "")
                    if spec == "autoloop" or model == "system":
                        ts = entry.get("timestamp", "")[:16]
                        msg = entry.get("user_message", "")[:100]
                        resp = entry.get("response", "")[:200]
                        activity_lines.append(f"  {ts} {msg} → {resp}")
                if activity_lines:
                    parts.append(f"[your_recent_activity — actions taken by your autoloop daemon]:\n" + "\n".join(activity_lines[-10:]))
        except Exception:
            pass

        return "\n\n".join(parts) if parts else "Context fetch returned no data."

    async def _call_vllm(self, system_prompt: str, messages: list) -> tuple[str, str]:
        """Call vLLM via streaming API (avoids Cloudflare 100s proxy timeout)."""
        import httpx

        api_messages = [{"role": "system", "content": system_prompt}] + messages
        content_parts: list[str] = []
        model_name = self.vllm_model
        repeat_char = ""
        repeat_count = 0

        async with httpx.AsyncClient(timeout=httpx.Timeout(240.0, connect=10.0)) as client:
            async with client.stream(
                "POST",
                f"{self.vllm_url}/v1/chat/completions",
                json={
                    "model": self.vllm_model,
                    "messages": api_messages,
                    "max_tokens": 8192,
                    "temperature": 0.6,
                    "repetition_penalty": 1.3,
                    "frequency_penalty": 0.5,
                    "stream": True,
                },
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    payload = line[6:].strip()
                    if payload == "[DONE]":
                        break
                    try:
                        import json as _json
                        chunk = _json.loads(payload)
                        delta = chunk["choices"][0].get("delta", {})
                        token = delta.get("content", "")
                        if not token:
                            continue
                        # Circuit breaker: abort on repetition loops
                        for ch in token:
                            if ch == repeat_char:
                                repeat_count += 1
                                if repeat_count >= 20:
                                    logger.warning(f"Repetition loop in _call_vllm ('{repeat_char}' x{repeat_count}), truncating")
                                    return "".join(content_parts), model_name
                            else:
                                repeat_char = ch
                                repeat_count = 1
                        content_parts.append(token)
                        if "model" in chunk:
                            model_name = chunk["model"]
                    except (KeyError, ValueError):
                        continue

        return "".join(content_parts), model_name

    async def _call_opus(self, system_prompt: str, messages: list) -> tuple[str, str, dict]:
        """Escalate to Claude Opus via Anthropic API. Returns (content, model, token_usage)."""
        from anthropic import Anthropic

        client = Anthropic(api_key=self.anthropic_key)
        model = "claude-opus-4-20250514"

        response = client.messages.create(
            model=model,
            max_tokens=4096,
            system=system_prompt,
            messages=messages,
        )
        content = response.content[0].text
        input_tokens = response.usage.input_tokens
        output_tokens = response.usage.output_tokens
        # Opus pricing: $15/M input, $75/M output
        cost_usd = round(input_tokens * 15 / 1_000_000 + output_tokens * 75 / 1_000_000, 4)
        token_usage = {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cost_usd": cost_usd,
        }
        return content, model, token_usage

    async def chat_stream(self, message: str, conversation_history: Optional[list] = None) -> AsyncGenerator[str, None]:
        """Streaming version of chat() — yields SSE events as they arrive."""
        from .cos_activity import ActivityEntry, append_activity
        from .cos_knowledge import get_knowledge_for_specialist

        start = time.monotonic()
        history = (conversation_history or [])[-20:]

        # Phase 1: Route (non-streaming, fast)
        yield self._sse("phase", {"phase": "routing"})
        routing = await self._route(message, history)
        specialist = routing.get("specialist", "cos")
        confidence = routing.get("confidence", 0.5)
        escalate = routing.get("escalate", False)
        context_sources = routing.get("needs_context", [])
        yield self._sse("routed", {"specialist": specialist, "confidence": confidence, "escalate": escalate})

        # Phase 2: Fetch context
        yield self._sse("phase", {"phase": "context", "sources": context_sources})
        context_text = await self._fetch_context(context_sources)
        knowledge_text = get_knowledge_for_specialist(specialist)
        if knowledge_text:
            combined_context = f"# Static Knowledge\n\n{knowledge_text}\n\n# Live Context\n\n{context_text}"
        else:
            combined_context = context_text

        # Phase 3: Build execution prompt
        from .cos_prompts import SPECIALISTS
        specialist_prompt = SPECIALISTS.get(specialist, SPECIALISTS["cos"])
        specialist_prompt = specialist_prompt.replace("{context}", combined_context)
        corrections = self._load_corrections()
        specialist_prompt = specialist_prompt.replace("{corrections}", corrections)

        exec_messages = []
        for msg in history:
            exec_messages.append({"role": msg.get("role", "user"), "content": msg.get("content", "")})
        exec_messages.append({"role": "user", "content": message})

        escalated = escalate or confidence < self.escalation_threshold

        token_usage = {}
        if escalated:
            # Opus doesn't stream in our current setup — fall back to non-streaming
            yield self._sse("phase", {"phase": "executing", "model": "opus", "escalated": True})
            raw_response, model_used, token_usage = await self._call_opus(specialist_prompt, exec_messages)
            thinking, clean_response = self._parse_think_blocks(raw_response)
            yield self._sse("thinking", {"content": thinking}) if thinking else None
            yield self._sse("text", {"content": clean_response})
        else:
            # Stream from vLLM
            yield self._sse("phase", {"phase": "executing", "model": "vllm", "escalated": False})
            full_text = ""
            # DeepSeek-R1 models always think first (often without <think> tag).
            # Other models (Qwen, etc.) don't use think blocks — stream as response directly.
            is_reasoning_model = "deepseek" in self.vllm_model.lower() and "r1" in self.vllm_model.lower()
            in_think = is_reasoning_model  # Only default to thinking for R1 models
            think_sent = 0  # chars of thinking already sent as deltas
            think_done = False

            async for token in self._stream_vllm(specialist_prompt, exec_messages):
                full_text += token

                # For non-reasoning models, check if they unexpectedly emit <think>
                if not is_reasoning_model and not in_think and "<think>" in full_text and not think_done:
                    in_think = True

                if in_think:
                    # Strip <think> tag if present (it's just a marker, not content)
                    think_text = full_text.replace("<think>", "")

                    if "</think>" in think_text:
                        # Thinking complete
                        in_think = False
                        think_done = True
                        parts = think_text.split("</think>", 1)
                        think_content = parts[0]
                        remainder = parts[1] if len(parts) > 1 else ""
                        # Send any unsent thinking
                        unsent = think_content[think_sent:]
                        if unsent:
                            yield self._sse("thinking_delta", {"content": unsent})
                        yield self._sse("thinking_done", {})
                        if remainder.strip():
                            yield self._sse("text_delta", {"content": remainder.strip()})
                    else:
                        # Still thinking — stream delta
                        unsent = think_text[think_sent:]
                        if unsent:
                            think_sent = len(think_text)
                            yield self._sse("thinking_delta", {"content": unsent})
                    continue

                # Past thinking — stream response tokens
                yield self._sse("text_delta", {"content": token})

            model_used = self.vllm_model
            thinking, clean_response = self._parse_think_blocks(full_text)

        # Extract and persist any corrections from Sancho's response
        clean_response = self._extract_and_save_corrections(clean_response)

        latency_ms = int((time.monotonic() - start) * 1000)
        message_id = str(uuid.uuid4())

        # Final metadata event
        yield self._sse("done", {
            "message_id": message_id,
            "specialist": specialist,
            "escalated": escalated,
            "latency_ms": latency_ms,
            "model": model_used,
            "confidence": confidence,
            "token_usage": token_usage,
        })

        # Log activity
        entry = ActivityEntry(
            message_id=message_id,
            user_message=message,
            specialist=specialist,
            escalated=escalated,
            thinking=thinking,
            response=clean_response,
            confidence=confidence,
            latency_ms=latency_ms,
            model=model_used,
            context_sources=context_sources,
            token_usage=token_usage,
        )
        try:
            append_activity(entry)
        except Exception as e:
            logger.warning(f"Failed to log activity: {e}")

    async def _stream_vllm(self, system_prompt: str, messages: list) -> AsyncGenerator[str, None]:
        """Stream tokens from vLLM OpenAI-compatible API."""
        api_messages = [{"role": "system", "content": system_prompt}] + messages

        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream(
                "POST",
                f"{self.vllm_url}/v1/chat/completions",
                json={
                    "model": self.vllm_model,
                    "messages": api_messages,
                    "max_tokens": 4096,
                    "temperature": 0.6,
                    "repetition_penalty": 1.15,
                    "frequency_penalty": 0.5,
                    "stream": True,
                },
            ) as resp:
                resp.raise_for_status()
                # Repetition detector: if the same char repeats 20+ times, abort
                repeat_char = ""
                repeat_count = 0
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data_str = line[6:]
                    if data_str.strip() == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data_str)
                        delta = chunk["choices"][0].get("delta", {})
                        content = delta.get("content", "")
                        if content:
                            # Check for degenerate repetition
                            for ch in content:
                                if ch == repeat_char:
                                    repeat_count += 1
                                    if repeat_count >= 20:
                                        logger.warning(f"Repetition loop detected ('{repeat_char}' x{repeat_count}), aborting stream")
                                        return
                                else:
                                    repeat_char = ch
                                    repeat_count = 1
                            yield content
                    except (json.JSONDecodeError, KeyError, IndexError):
                        continue

    @staticmethod
    def _sse(event: str, data: dict) -> str:
        """Format a Server-Sent Event."""
        return f"event: {event}\ndata: {json.dumps(data)}\n\n"

    @staticmethod
    def _parse_think_blocks(raw: str) -> tuple[str, str]:
        """Extract <think>...</think> blocks, return (thinking, clean_response).

        DeepSeek-R1 sometimes emits thinking without <think> tags — just a
        block of text followed by </think>. Handle both formats.
        """
        # Standard format: <think>...</think>
        think_pattern = re.compile(r"<think>(.*?)</think>", re.DOTALL)
        thinks = think_pattern.findall(raw)
        if thinks:
            thinking = "\n".join(t.strip() for t in thinks)
            clean = think_pattern.sub("", raw).strip()
            return thinking, clean

        # DeepSeek format: text</think>\nactual response (no opening tag)
        if "</think>" in raw:
            parts = raw.split("</think>", 1)
            thinking = parts[0].strip()
            clean = parts[1].strip() if len(parts) > 1 else ""
            return thinking, clean

        return "", raw.strip()

    async def check_vllm_health(self) -> dict:
        """Check if vLLM endpoint is reachable."""
        try:
            client = self._get_http()
            resp = await client.get(f"{self.vllm_url}/v1/models", timeout=5.0)
            reachable = resp.status_code == 200
            models = resp.json().get("data", []) if reachable else []
            return {
                "vllm_reachable": reachable,
                "vllm_url": self.vllm_url,
                "vllm_model": self.vllm_model,
                "available_models": [m.get("id") for m in models],
                "escalation_threshold": self.escalation_threshold,
            }
        except Exception as e:
            return {
                "vllm_reachable": False,
                "vllm_url": self.vllm_url,
                "error": str(e),
                "escalation_threshold": self.escalation_threshold,
            }
