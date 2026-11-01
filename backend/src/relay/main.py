"""FastAPI entry point for the browser agent model relay."""

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from relay.client import (
    RelayUpstreamError,
    discover_models,
    normalize_provider_urls,
    open_upstream_chat_stream,
)
from relay.config import settings
from relay.models import (
    ChatRequest,
    CreateSessionResponse,
    ModelDiscoveryResponse,
    ProviderRegisterRequest,
    ProviderResponse,
    RelayError,
)
from relay.security import (
    SESSION_HEADER_NAME,
    generate_session_token,
    validate_origin,
    validate_upstream_url,
)
from relay.session_store import Session, session_store

# Configure standard logging: log metadata only, no request bodies or credentials
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("relay")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan managing store cleanup on shutdown."""
    logger.info("Relay service starting up on %s:%d", settings.host, settings.port)
    yield
    logger.info("Relay service shutting down, purging credentials from memory")
    session_store.clear()


app = FastAPI(
    title="Browser Agents Model Relay",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS restriction
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.allowed_origins),
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", SESSION_HEADER_NAME],
)


def verify_trusted_origin(request: Request) -> None:
    """Verify that incoming browser request originated from an approved UI origin."""
    origin = request.headers.get("origin")
    if origin and not validate_origin(origin):
        logger.warning("Rejected request from untrusted origin: %s", origin)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Untrusted origin",
        )


def get_current_session(
    request: Request,
    x_relay_session: str | None = Header(default=None, alias=SESSION_HEADER_NAME),
) -> Session:
    """Validate trusted session token header."""
    verify_trusted_origin(request)
    if not x_relay_session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing session token",
        )
    session = session_store.get_session(x_relay_session)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or expired session token",
        )
    return session


@app.get("/api/health")
async def health() -> dict[str, str]:
    """Relay health check."""
    return {"status": "ok"}


@app.post(
    "/api/session",
    response_model=CreateSessionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_session(request: Request) -> CreateSessionResponse:
    """Establish a new trusted setup session."""
    verify_trusted_origin(request)
    token = generate_session_token()
    session_store.create_session(token)
    return CreateSessionResponse(session_token=token)


@app.delete("/api/session", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(session: Session = Depends(get_current_session)) -> Response:
    """End a trusted session and wipe all associated credentials."""
    session_store.remove_session(session.session_token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post(
    "/api/providers",
    response_model=ProviderResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register_provider(
    body: ProviderRegisterRequest,
    session: Session = Depends(get_current_session),
) -> ProviderResponse:
    """Register an OpenAI-compatible endpoint with optional credentials."""
    validated_url = validate_upstream_url(body.base_url)
    prefix, _, models_url = normalize_provider_urls(validated_url)

    # Perform discovery if models not manually supplied
    discovered: list[str] = []
    if body.models:
        discovered = list(body.models)
    else:
        discovered = await discover_models(models_url, api_key=body.api_key)

    provider = session_store.register_provider(
        token=session.session_token,
        base_url=prefix,
        api_key=body.api_key,
        models=body.models,
    )
    provider.discovered_models = discovered

    return ProviderResponse(
        provider_id=provider.provider_id,
        base_url=provider.base_url,
        has_api_key=bool(provider.api_key),
        discovered_models=discovered,
    )


@app.get(
    "/api/providers/{provider_id}/models",
    response_model=ModelDiscoveryResponse,
)
async def list_models(
    provider_id: str,
    session: Session = Depends(get_current_session),
) -> ModelDiscoveryResponse:
    """Retrieve discovered or configured models for a registered provider."""
    provider = session_store.get_provider(session.session_token, provider_id)
    if not provider:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Provider not registered in session",
        )

    if provider.configured_models:
        return ModelDiscoveryResponse(
            provider_id=provider.provider_id,
            models=provider.configured_models,
            supports_discovery=False,
        )

    _, _, models_url = normalize_provider_urls(provider.base_url)
    models = await discover_models(models_url, api_key=provider.api_key)
    provider.discovered_models = models

    return ModelDiscoveryResponse(
        provider_id=provider.provider_id,
        models=models,
        supports_discovery=len(models) > 0,
    )


@app.delete("/api/providers/{provider_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_provider(
    provider_id: str,
    session: Session = Depends(get_current_session),
) -> Response:
    """Remove a provider and wipe its credentials from memory."""
    removed = session_store.remove_provider(session.session_token, provider_id)
    if not removed:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Provider not registered in session",
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/api/chat")
async def chat_completion(
    body: ChatRequest,
    session: Session = Depends(get_current_session),
) -> Response:
    """Forward chat generation request to upstream provider as a stream."""
    provider = session_store.get_provider(session.session_token, body.provider_id)
    if not provider:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Provider not found in current session",
        )

    _, chat_url, _ = normalize_provider_urls(provider.base_url)

    upstream_payload = {
        "model": body.model,
        "messages": [msg.model_dump(exclude_none=True) for msg in body.messages],
        "stream": True,
    }
    if body.tools:
        upstream_payload["tools"] = body.tools

    logger.info("Forwarding chat request for model=%s (stream=True)", body.model)

    try:
        client, upstream_response = await open_upstream_chat_stream(
            chat_url=chat_url,
            payload=upstream_payload,
            api_key=provider.api_key,
        )

        async def stream_chunks() -> AsyncGenerator[bytes, None]:
            try:
                async for chunk in upstream_response.aiter_bytes():
                    yield chunk
            finally:
                await upstream_response.aclose()
                await client.aclose()

        return StreamingResponse(
            stream_chunks(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache, no-transform",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )
    except RelayUpstreamError as exc:
        logger.warning(
            "Upstream relay error: code=%s status=%d", exc.code, exc.status_code
        )
        return JSONResponse(
            status_code=exc.status_code,
            content=RelayError(error=exc.code, message=exc.message).model_dump(),
        )
