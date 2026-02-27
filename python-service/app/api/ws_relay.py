"""
WebSocket Relay for IB Data Providers

This module provides a WebSocket endpoint that allows remote data providers (local agents)
to connect and serve IB market data requests from the frontend.

Architecture:
- Local agents connect via WSS and register as data providers
- Frontend HTTP requests are routed to connected providers
- Responses are relayed back to waiting HTTP requests
- Supports multi-user API keys stored in the database
"""

import asyncio
import json
import logging
import os
import sys
import time
import uuid
from dataclasses import dataclass, field
from typing import Dict, Optional, Any
from datetime import datetime

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException
from pydantic import BaseModel
import httpx

from app.utils.timing import RequestTimer

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["websocket"])

# Configuration
# Base URL for API key validation (the Next.js app)
API_BASE_URL = os.environ.get("API_BASE_URL", "http://localhost:3000")
REQUEST_TIMEOUT_SECONDS = 120  # Option chain fetches can take 60+ seconds
HEARTBEAT_INTERVAL_SECONDS = 30  # Longer interval to avoid timeout during long requests

# ── Request priority classification ──
# Priority 1: Account-specific, never delayed, never routed to a foreign agent
ACCOUNT_REQUESTS = frozenset({
    "get_positions", "get_open_orders", "place_order", "modify_order", "cancel_order",
})
# Priority 2: Scan requests that consume IB market data lines (throttled when borrowing)
SCAN_REQUESTS = frozenset({
    "fetch_chain", "fetch_prices", "sell_scan", "fetch_underlying", "test_futures",
})
# Priority 3: Lightweight status checks, no market-data-line impact
STATUS_REQUESTS = frozenset({
    "ib_status", "check_availability",
})
# Execution control requests: only routed to the user's own agent
EXECUTION_REQUESTS = frozenset({
    "execution_start", "execution_stop", "execution_status", "execution_config",
    "execution_budget", "execution_add_ticker", "execution_remove_ticker",
    "execution_close_position", "execution_list_models", "execution_swap_model",
})


async def validate_api_key(api_key: str) -> Optional[str]:
    """
    Validate an API key against the database.
    
    Returns the user_id if valid, None if invalid.
    All agents must use per-user API keys (legacy single-key mode removed).
    """
    logger.info("Validating API key...")
    
    # Validate against database via internal API
    try:
        logger.info(f"Checking key against database at {API_BASE_URL}")
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{API_BASE_URL}/api/ma-options/validate-agent-key",
                json={"key": api_key},
                timeout=5.0
            )
            logger.info(f"Validation response: status={response.status_code}")
            if response.status_code == 200:
                data = response.json()
                if data.get("valid"):
                    logger.info(f"Key validated for user: {data.get('userId')}")
                    return data.get("userId")
                else:
                    logger.warning(f"Key not valid in database")
    except Exception as e:
        logger.error(f"Error validating API key: {e}")
    
    return None


@dataclass
class PendingRequest:
    """A request waiting for a response from a provider"""
    request_id: str
    request_type: str
    payload: dict
    future: asyncio.Future
    created_at: float = field(default_factory=time.time)


@dataclass  
class DataProvider:
    """A connected data provider (local agent)"""
    provider_id: str
    websocket: WebSocket
    user_id: str  # The user this provider belongs to
    agent_version: str = "0.0.0"  # Version reported by agent on auth
    ib_accounts: list = field(default_factory=list)  # IB account IDs reported by agent
    connected_at: float = field(default_factory=time.time)
    last_heartbeat: float = field(default_factory=time.time)
    is_active: bool = True
    # Execution engine state (updated by agent_state messages; safe defaults for old agents)
    execution_active: bool = False
    execution_lines_held: int = 0
    available_scan_lines: int = 90  # conservative default (100 - 10 buffer)
    accept_external_scans: bool = True
    # Latest execution telemetry snapshot from the agent (updated periodically)
    execution_telemetry: Optional[dict] = field(default=None, repr=False)
    # Per-provider semaphore: limits concurrent external scan requests to 1
    # when execution is active. Initialized post-creation (dataclass can't hold asyncio objects).
    _external_scan_semaphore: Optional[asyncio.Semaphore] = field(default=None, repr=False)

    def __post_init__(self):
        self._external_scan_semaphore = asyncio.Semaphore(1)


class ProviderRegistry:
    """Manages connected data providers and pending requests"""
    
    def __init__(self):
        self.providers: Dict[str, DataProvider] = {}
        self.pending_requests: Dict[str, PendingRequest] = {}
        self._lock = asyncio.Lock()
        # Per-user account event queues for near-real-time UI updates
        # Events are pushed by agents on order fills, cancels, etc.
        from collections import deque
        self._account_events: Dict[str, deque] = {}  # user_id -> deque of events
        self._account_events_lock = asyncio.Lock()

    async def push_account_event(self, user_id: str, event: dict):
        """Store an account event for a user (called when agent pushes events)."""
        from collections import deque
        async with self._account_events_lock:
            if user_id not in self._account_events:
                self._account_events[user_id] = deque(maxlen=200)
            event["received_at"] = time.time()
            self._account_events[user_id].append(event)

    async def get_account_events(self, user_id: str, since: float = 0) -> list:
        """Return account events for a user since a given timestamp."""
        async with self._account_events_lock:
            events = self._account_events.get(user_id)
            if not events:
                return []
            return [e for e in events if e.get("received_at", 0) > since]
    
    async def register_provider(self, provider_id: str, websocket: WebSocket, user_id: str, agent_version: str = "0.0.0") -> DataProvider:
        """Register a new data provider"""
        async with self._lock:
            provider = DataProvider(
                provider_id=provider_id,
                websocket=websocket,
                user_id=user_id,
                agent_version=agent_version
            )
            self.providers[provider_id] = provider
            logger.info(f"Provider registered: {provider_id} for user {user_id}")
            return provider
    
    async def unregister_provider(self, provider_id: str):
        """Unregister a data provider"""
        async with self._lock:
            if provider_id in self.providers:
                del self.providers[provider_id]
                logger.info(f"Provider unregistered: {provider_id}")
                
                # Cancel any pending requests that were routed to this provider
                for req_id, req in list(self.pending_requests.items()):
                    if not req.future.done():
                        req.future.set_exception(
                            Exception("Provider disconnected")
                        )
    
    async def get_active_provider(
        self,
        user_id: Optional[str] = None,
        allow_fallback_to_any: bool = True,
    ) -> Optional[DataProvider]:
        """Get an active provider to handle a request.

        - If user_id is specified, tries to find a provider for that user first.
        - If allow_fallback_to_any is True (default), and no user-specific provider
          is found, returns any active provider (for read-only quotes from any connection).
        - If allow_fallback_to_any is False, returns only a provider that matches user_id;
          never returns another user's provider. Use this for positions and orders so
          users only see their own account data and only send orders to their own account.
        """
        async with self._lock:
            if user_id:
                # When multiple providers match the same user_id, prefer the
                # one with the highest agent version (most features). On a tie,
                # prefer the most recently connected one.
                best: Optional[DataProvider] = None
                for provider in self.providers.values():
                    if provider.is_active and provider.user_id == user_id:
                        if best is None:
                            best = provider
                        else:
                            # Compare versions as tuples, fall back to connected_at
                            try:
                                cur = tuple(int(x) for x in best.agent_version.split("."))
                                new = tuple(int(x) for x in provider.agent_version.split("."))
                            except (ValueError, AttributeError):
                                cur, new = (0,), (0,)
                            if new > cur or (new == cur and provider.connected_at > best.connected_at):
                                best = provider
                if best:
                    return best
                if not allow_fallback_to_any:
                    return None
            for provider in self.providers.values():
                if provider.is_active:
                    return provider
            return None
    
    async def get_provider_by_id(self, provider_id: str) -> Optional[DataProvider]:
        """Get a provider by its ID"""
        async with self._lock:
            return self.providers.get(provider_id)
    
    async def add_pending_request(self, request: PendingRequest):
        """Add a pending request"""
        async with self._lock:
            self.pending_requests[request.request_id] = request
    
    async def resolve_request(self, request_id: str, response: dict):
        """Resolve a pending request with a response"""
        async with self._lock:
            if request_id in self.pending_requests:
                req = self.pending_requests.pop(request_id)
                if not req.future.done():
                    req.future.set_result(response)
    
    async def fail_request(self, request_id: str, error: str):
        """Fail a pending request with an error"""
        async with self._lock:
            if request_id in self.pending_requests:
                req = self.pending_requests.pop(request_id)
                if not req.future.done():
                    req.future.set_exception(Exception(error))
    
    async def remove_pending_request(self, request_id: str):
        """Remove a pending request (cleanup)"""
        async with self._lock:
            self.pending_requests.pop(request_id, None)
    
    def get_status(self) -> dict:
        """Get current status of providers and requests"""
        return {
            "providers_connected": len(self.providers),
            "provider_ids": list(self.providers.keys()),
            "pending_requests": len(self.pending_requests),
            "providers": [
                {
                    "id": p.provider_id,
                    "user_id": p.user_id,
                    "agent_version": p.agent_version,
                    "ib_accounts": p.ib_accounts,
                    "connected_at": datetime.fromtimestamp(p.connected_at).isoformat(),
                    "last_heartbeat": datetime.fromtimestamp(p.last_heartbeat).isoformat(),
                    "is_active": p.is_active,
                    "execution_active": p.execution_active,
                    "execution_lines_held": p.execution_lines_held,
                    "available_scan_lines": p.available_scan_lines,
                    "accept_external_scans": p.accept_external_scans,
                }
                for p in self.providers.values()
            ]
        }


# Global registry instance
registry = ProviderRegistry()


def get_registry() -> ProviderRegistry:
    """Get the global provider registry"""
    return registry


# Request/Response models for relay communication
class RelayRequest(BaseModel):
    """Request sent through the relay"""
    request_id: str
    request_type: str  # 'fetch_chain', 'check_availability', 'ib_status', etc.
    payload: dict


class RelayResponse(BaseModel):
    """Response received through the relay"""
    request_id: str
    success: bool
    data: Optional[dict] = None
    error: Optional[str] = None


@router.websocket("/data-provider")
async def data_provider_websocket(websocket: WebSocket):
    """
    WebSocket endpoint for data providers (local agents) to connect.
    
    Protocol:
    1. Provider connects and sends auth message: {"type": "auth", "api_key": "..."}
    2. Server acknowledges: {"type": "auth_response", "success": true, "provider_id": "..."}
    3. Server sends requests: {"type": "request", "request_id": "...", "request_type": "...", "payload": {...}}
    4. Provider sends responses: {"type": "response", "request_id": "...", "success": true, "data": {...}}
    5. Provider sends heartbeats: {"type": "heartbeat"}
    6. Server acknowledges heartbeats: {"type": "heartbeat_ack"}
    """
    await websocket.accept()
    provider_id = None
    
    try:
        # Wait for authentication
        auth_msg = await asyncio.wait_for(
            websocket.receive_json(),
            timeout=10.0
        )
        
        if auth_msg.get("type") != "auth":
            await websocket.send_json({
                "type": "auth_response",
                "success": False,
                "error": "Expected auth message"
            })
            await websocket.close()
            return
        
        # Validate API key (supports both legacy and per-user keys)
        api_key = auth_msg.get("api_key", "")
        user_id = await validate_api_key(api_key)
        
        if not user_id:
            logger.warning(f"Invalid API key from provider")
            await websocket.send_json({
                "type": "auth_response", 
                "success": False,
                "error": "Invalid API key"
            })
            await websocket.close()
            return
        
        # Generate provider ID and register with user association
        provider_id = str(uuid.uuid4())[:8]
        agent_version = auth_msg.get("version", "0.0.0")
        provider = await registry.register_provider(provider_id, websocket, user_id, agent_version=agent_version)
        
        await websocket.send_json({
            "type": "auth_response",
            "success": True,
            "provider_id": provider_id
        })
        
        logger.info(f"Provider {provider_id} authenticated for user {user_id} (agent v{agent_version})")
        
        # Main message loop
        while True:
            try:
                msg = await asyncio.wait_for(
                    websocket.receive_json(),
                    timeout=HEARTBEAT_INTERVAL_SECONDS * 2
                )
                
                msg_type = msg.get("type")
                
                if msg_type == "heartbeat":
                    provider.last_heartbeat = time.time()
                    await websocket.send_json({"type": "heartbeat_ack"})
                
                elif msg_type == "response":
                    # Provider is responding to a request
                    request_id = msg.get("request_id")
                    if msg.get("success"):
                        await registry.resolve_request(request_id, msg.get("data", {}))
                    else:
                        # Return error as data so callers can show the agent's message (e.g. relay_test_futures rewrite)
                        await registry.resolve_request(request_id, {"error": msg.get("error", "Unknown error")})
                
                elif msg_type == "ib_accounts":
                    # Agent reports which IB accounts it manages
                    accounts = msg.get("accounts", [])
                    provider.ib_accounts = accounts
                    logger.info(f"Provider {provider_id} reported IB accounts: {accounts}")
                
                elif msg_type == "agent_state":
                    # Agent reports execution engine resource state
                    provider.execution_active = bool(msg.get("execution_active", False))
                    provider.execution_lines_held = int(msg.get("execution_lines_held", 0))
                    provider.available_scan_lines = int(msg.get("available_scan_lines", 90))
                    provider.accept_external_scans = bool(msg.get("accept_external_scans", True))
                    logger.debug(
                        f"Provider {provider_id} state: exec={provider.execution_active}, "
                        f"lines_held={provider.execution_lines_held}, "
                        f"scan_avail={provider.available_scan_lines}"
                    )
                
                elif msg_type == "execution_telemetry":
                    # Store latest execution telemetry for dashboard queries
                    provider.execution_telemetry = {
                        k: v for k, v in msg.items() if k != "type"
                    }
                    provider.execution_telemetry["received_at"] = time.time()
                    logger.debug(
                        f"Provider {provider_id} execution telemetry: "
                        f"strategies={msg.get('strategy_count', 0)}, "
                        f"lines={msg.get('lines_held', 0)}"
                    )
                
                elif msg_type == "account_event":
                    # Agent pushes order fill/status events for near-real-time UI
                    event = msg.get("event", {})
                    await registry.push_account_event(user_id, event)
                    logger.info(
                        f"Provider {provider_id} account event: "
                        f"{event.get('event')} orderId={event.get('orderId')}"
                    )
                
                else:
                    logger.warning(f"Unknown message type from provider: {msg_type}")
                    
            except asyncio.TimeoutError:
                # Check if provider is still alive
                if time.time() - provider.last_heartbeat > HEARTBEAT_INTERVAL_SECONDS * 3:
                    logger.warning(f"Provider {provider_id} heartbeat timeout")
                    break
                    
    except WebSocketDisconnect:
        logger.info(f"Provider {provider_id} disconnected")
    except Exception as e:
        logger.error(f"Error in provider websocket: {e}")
    finally:
        if provider_id:
            await registry.unregister_provider(provider_id)


async def send_request_to_provider(
    request_type: str,
    payload: dict,
    timeout: float = REQUEST_TIMEOUT_SECONDS,
    user_id: Optional[str] = None,
    allow_fallback_to_any_provider: bool = True,
) -> dict:
    """
    Send a request to a connected provider and wait for response.

    Args:
        request_type: Type of request (e.g., 'fetch_chain', 'ib_status')
        payload: Request payload
        timeout: Timeout in seconds
        user_id: Optional user ID for routing to user's own agent
        allow_fallback_to_any_provider: If True, when user_id has no provider, use any
            connected provider (for read-only quotes). If False, only use the provider
            that matches user_id; never use another user's provider (use for positions/orders).

    Returns:
        Response data from provider

    Raises:
        HTTPException if no provider is connected or request times out
    """
    timer = RequestTimer(f"relay:{request_type}")

    provider = await registry.get_active_provider(
        user_id=user_id,
        allow_fallback_to_any=allow_fallback_to_any_provider,
    )
    timer.stage("provider_lookup")
    
    if provider and user_id:
        logger.info(f"Routing request to provider for user {user_id}: {provider.provider_id}")
    
    if not provider:
        # Distinguish between "no agents at all" and "agent connected but for a different user"
        status = registry.get_status()
        if status["providers_connected"] == 0:
            raise HTTPException(
                status_code=503,
                detail="No IB data provider connected. Please start the local agent."
            )
        else:
            # Agent(s) connected but none match this user_id
            connected_users = [p.get("user_id", "?") for p in status["providers"]]
            logger.warning(
                f"send_request_to_provider: user_id={user_id} has no matching agent. "
                f"Connected agents belong to user(s): {connected_users}"
            )
            raise HTTPException(
                status_code=503,
                detail=(
                    "An IB agent is connected, but it belongs to a different account. "
                    "Make sure you are logged into the dashboard with the same account "
                    "that generated the agent's API key, or re-download the agent from "
                    "this account."
                ),
            )

    # ── Priority-aware throttling for scan requests on execution-active agents ──
    is_scan = request_type in SCAN_REQUESTS
    # Treat requests as "borrowing" when the requesting user is different from
    # the provider's owner, OR when no user_id was provided (anonymous/legacy).
    is_borrowing = (user_id is None) or (provider.user_id != user_id)
    use_semaphore = False

    if is_scan and is_borrowing and provider.execution_active:
        # External user borrowing an execution-active agent
        if not provider.accept_external_scans:
            raise HTTPException(
                status_code=503,
                detail=(
                    "The connected IB agent is running an execution algorithm and is not "
                    "accepting external scan requests. Please try again later or start "
                    "your own local agent."
                ),
            )
        # Annotate payload so the agent can throttle batch size
        payload = {**payload, "_priority": "external", "_max_batch_size": provider.available_scan_lines}
        use_semaphore = True
    elif is_scan and provider.execution_active:
        # Own user's scan while execution is active -- annotate but don't gate
        payload = {**payload, "_priority": "owner", "_max_batch_size": provider.available_scan_lines}

    async def _do_send() -> dict:
        """Inner send logic (may be wrapped with semaphore)."""
        request_id = str(uuid.uuid4())
        future = asyncio.get_event_loop().create_future()

        pending = PendingRequest(
            request_id=request_id,
            request_type=request_type,
            payload=payload,
            future=future
        )

        await registry.add_pending_request(pending)

        try:
            # Send request to provider
            payload_bytes = len(json.dumps(payload).encode())
            await provider.websocket.send_json({
                "type": "request",
                "request_id": request_id,
                "request_type": request_type,
                "payload": payload
            })
            timer.stage("ws_send")

            # Wait for response
            result = await asyncio.wait_for(future, timeout=timeout)
            response_bytes = len(json.dumps(result).encode()) if result else 0
            timer.stage("response_wait")
            timer.finish(extra={
                "timeout": timeout,
                "payload_bytes": payload_bytes,
                "response_bytes": response_bytes,
                "borrowing": is_borrowing,
                "execution_active": provider.execution_active,
            })
            return result

        except asyncio.TimeoutError:
            timer.stage("timeout")
            timer.finish(extra={"timeout": timeout, "status": "timeout"})
            await registry.fail_request(request_id, "Request timeout")
            raise HTTPException(
                status_code=504,
                detail=f"Request to IB data provider timed out after {timeout}s"
            )
        except Exception as e:
            timer.stage("error")
            timer.finish(extra={"timeout": timeout, "status": "error"})
            await registry.fail_request(request_id, str(e))
            raise HTTPException(
                status_code=500,
                detail=f"Error communicating with IB data provider: {str(e)}"
            )

    if use_semaphore and provider._external_scan_semaphore is not None:
        # Serialize external scan requests: one at a time per execution-active provider
        async with provider._external_scan_semaphore:
            return await _do_send()
    else:
        return await _do_send()


@router.get("/provider-status")
async def get_provider_status():
    """Get status of connected data providers"""
    return registry.get_status()
