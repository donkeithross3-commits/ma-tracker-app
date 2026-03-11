"""Chief of Staff — API routes."""

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import Optional

router = APIRouter(prefix="/cos", tags=["chief-of-staff"])


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=10000)
    conversation_history: Optional[list] = None


class ChatResponse(BaseModel):
    response: str
    specialist: str
    escalated: bool
    thinking: Optional[str] = None
    message_id: str
    latency_ms: int
    model: str
    confidence: float = 0.0


@router.post("/chat", response_model=ChatResponse)
async def cos_chat(req: ChatRequest):
    """Send a message to the Chief of Staff brain (non-streaming)."""
    from ..services.cos_service import get_cos_service

    svc = get_cos_service()
    result = await svc.chat(req.message, req.conversation_history)
    return ChatResponse(**result.to_dict())


@router.post("/chat/stream")
async def cos_chat_stream(req: ChatRequest):
    """Streaming version — returns SSE events as Sancho thinks."""
    from ..services.cos_service import get_cos_service

    svc = get_cos_service()

    async def generate():
        async for event in svc.chat_stream(req.message, req.conversation_history):
            if event:  # skip None yields
                yield event

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/activity")
async def cos_activity(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    specialist: Optional[str] = Query(None),
):
    """Get recent CoS activity log entries."""
    from ..services.cos_activity import read_activity

    entries = read_activity(limit=limit, offset=offset, specialist_filter=specialist)
    return {"entries": entries, "count": len(entries)}


@router.get("/health")
async def cos_health():
    """Check vLLM reachability and CoS configuration."""
    from ..services.cos_service import get_cos_service

    svc = get_cos_service()
    health = await svc.check_vllm_health()
    return health
