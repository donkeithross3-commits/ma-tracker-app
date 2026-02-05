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
import time
import uuid
from dataclasses import dataclass, field
from typing import Dict, Optional, Any
from datetime import datetime

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException
from pydantic import BaseModel
import httpx

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["websocket"])

# Configuration
# Legacy single API key (still supported for backwards compatibility)
LEGACY_PROVIDER_API_KEY = os.environ.get("IB_PROVIDER_API_KEY", "")
# Base URL for API key validation (the Next.js app)
API_BASE_URL = os.environ.get("API_BASE_URL", "http://localhost:3000")
REQUEST_TIMEOUT_SECONDS = 120  # Option chain fetches can take 60+ seconds
HEARTBEAT_INTERVAL_SECONDS = 30  # Longer interval to avoid timeout during long requests


async def validate_api_key(api_key: str) -> Optional[str]:
    """
    Validate an API key against the database.
    
    Returns the user_id if valid, None if invalid.
    Also supports legacy single-key mode for backwards compatibility.
    """
    # Log key prefix for debugging (first 10 chars only)
    key_prefix = api_key[:10] if len(api_key) > 10 else api_key
    logger.info(f"Validating API key starting with: {key_prefix}...")
    
    # Check legacy key first (for backwards compatibility)
    if LEGACY_PROVIDER_API_KEY and api_key == LEGACY_PROVIDER_API_KEY:
        logger.info("Using legacy API key authentication")
        return "legacy"
    
    # Validate against database via internal API
    try:
        logger.info(f"Checking key against database at {API_BASE_URL}")
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{API_BASE_URL}/api/ma-options/validate-agent-key",
                json={"key": api_key},
                timeout=5.0
            )
            logger.info(f"Validation response: status={response.status_code}, body={response.text[:100]}")
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
    connected_at: float = field(default_factory=time.time)
    last_heartbeat: float = field(default_factory=time.time)
    is_active: bool = True


class ProviderRegistry:
    """Manages connected data providers and pending requests"""
    
    def __init__(self):
        self.providers: Dict[str, DataProvider] = {}
        self.pending_requests: Dict[str, PendingRequest] = {}
        self._lock = asyncio.Lock()
    
    async def register_provider(self, provider_id: str, websocket: WebSocket, user_id: str) -> DataProvider:
        """Register a new data provider"""
        async with self._lock:
            provider = DataProvider(
                provider_id=provider_id,
                websocket=websocket,
                user_id=user_id
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
                for provider in self.providers.values():
                    if provider.is_active and provider.user_id == user_id:
                        return provider
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
                    "connected_at": datetime.fromtimestamp(p.connected_at).isoformat(),
                    "last_heartbeat": datetime.fromtimestamp(p.last_heartbeat).isoformat(),
                    "is_active": p.is_active
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
        provider = await registry.register_provider(provider_id, websocket, user_id)
        
        await websocket.send_json({
            "type": "auth_response",
            "success": True,
            "provider_id": provider_id
        })
        
        logger.info(f"Provider {provider_id} authenticated for user {user_id}")
        
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
    provider = await registry.get_active_provider(
        user_id=user_id,
        allow_fallback_to_any=allow_fallback_to_any_provider,
    )
    
    if provider and user_id:
        logger.info(f"Routing request to provider for user {user_id}: {provider.provider_id}")
    
    if not provider:
        raise HTTPException(
            status_code=503,
            detail="No IB data provider connected. Please start the local agent."
        )
    
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
        await provider.websocket.send_json({
            "type": "request",
            "request_id": request_id,
            "request_type": request_type,
            "payload": payload
        })
        
        # Wait for response
        result = await asyncio.wait_for(future, timeout=timeout)
        return result
        
    except asyncio.TimeoutError:
        await registry.fail_request(request_id, "Request timeout")
        raise HTTPException(
            status_code=504,
            detail=f"Request to IB data provider timed out after {timeout}s"
        )
    except Exception as e:
        await registry.fail_request(request_id, str(e))
        raise HTTPException(
            status_code=500,
            detail=f"Error communicating with IB data provider: {str(e)}"
        )


@router.get("/provider-status")
async def get_provider_status():
    """Get status of connected data providers"""
    return registry.get_status()
