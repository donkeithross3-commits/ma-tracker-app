"""Chief of Staff — orchestration service (DeepSeek-R1 + Opus escalation)."""

import json
import logging
import os
import re
import time
import uuid
from typing import Optional

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
    __slots__ = ("response", "specialist", "escalated", "thinking", "message_id", "latency_ms", "model", "confidence", "context_sources")

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

    def _get_http(self) -> httpx.AsyncClient:
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(timeout=120.0)
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

    async def chat(self, message: str, conversation_history: Optional[list] = None) -> ChatResult:
        from .cos_activity import ActivityEntry, append_activity

        start = time.monotonic()
        history = (conversation_history or [])[-20:]  # Truncate to last 20

        # Phase 1: Route
        routing = await self._route(message, history)
        specialist = routing.get("specialist", "cos")
        confidence = routing.get("confidence", 0.5)
        escalate = routing.get("escalate", False)
        context_sources = routing.get("needs_context", [])

        # Phase 2: Fetch context
        context_text = await self._fetch_context(context_sources)

        # Phase 3: Execute
        from .cos_prompts import SPECIALISTS

        specialist_prompt = SPECIALISTS.get(specialist, SPECIALISTS["cos"])
        specialist_prompt = specialist_prompt.replace("{context}", context_text)

        # Build messages for execution
        exec_messages = []
        for msg in history:
            exec_messages.append({"role": msg.get("role", "user"), "content": msg.get("content", "")})
        exec_messages.append({"role": "user", "content": message})

        if escalate or confidence < self.escalation_threshold:
            raw_response, model_used = await self._call_opus(specialist_prompt, exec_messages)
            escalated = True
        else:
            raw_response, model_used = await self._call_vllm(specialist_prompt, exec_messages)
            escalated = False

        thinking, clean_response = self._parse_think_blocks(raw_response)

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
        )

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
        )
        try:
            append_activity(entry)
        except Exception as e:
            logger.warning(f"Failed to log activity: {e}")

        return result

    async def _route(self, message: str, history: list) -> dict:
        """Send message to DeepSeek with CoS routing prompt to get JSON routing decision."""
        from .cos_prompts import COS_ROUTING_PROMPT

        routing_prompt = COS_ROUTING_PROMPT
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
        """Fetch context from internal FastAPI endpoints."""
        if not sources:
            return "No additional context requested."

        base = "http://localhost:8000"
        source_map = {
            "fleet": f"{base}/fleet/status",
            "deals": f"{base}/intelligence/deals",
            "positions": f"{base}/options/relay/ib-status",
            "signals": f"{base}/krj/signals/latest",
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

        return "\n\n".join(parts) if parts else "Context fetch returned no data."

    async def _call_vllm(self, system_prompt: str, messages: list) -> tuple[str, str]:
        """Call DeepSeek-R1 via vLLM OpenAI-compatible API."""
        client = self._get_http()
        api_messages = [{"role": "system", "content": system_prompt}] + messages

        resp = await client.post(
            f"{self.vllm_url}/v1/chat/completions",
            json={
                "model": self.vllm_model,
                "messages": api_messages,
                "max_tokens": 4096,
                "temperature": 0.6,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        content = data["choices"][0]["message"]["content"]
        model_name = data.get("model", self.vllm_model)
        return content, model_name

    async def _call_opus(self, system_prompt: str, messages: list) -> tuple[str, str]:
        """Escalate to Claude Opus via Anthropic API."""
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
        return content, model

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
