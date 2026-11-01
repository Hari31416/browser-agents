"""Security helpers for origin validation, URL safety, and session token checks."""

import ipaddress
import logging
import secrets
from urllib.parse import urlparse

from fastapi import HTTPException, Security
from fastapi.security.api_key import APIKeyHeader

from relay.config import settings

logger = logging.getLogger("relay.security")

SESSION_HEADER_NAME = "X-Relay-Session"
session_header = APIKeyHeader(name=SESSION_HEADER_NAME, auto_error=False)


def generate_session_token() -> str:
    """Generate a cryptographically secure session token."""
    return secrets.token_urlsafe(32)


def validate_origin(origin: str | None) -> bool:
    """Check if the requesting origin is among allowed UI origins."""
    if not origin:
        return False
    return origin in settings.allowed_origins


def validate_upstream_url(raw_url: str) -> str:
    """Validate that upstream URL is safe.

    Allows HTTPS endpoints or explicit loopback HTTP endpoints.
    Rejects other schemes (file:, ftp:, gopher:, etc.) and internal private networks.
    """
    try:
        parsed = urlparse(raw_url)
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail="Invalid base URL format",
        ) from exc

    scheme = parsed.scheme.lower()
    if scheme not in ("http", "https"):
        raise HTTPException(
            status_code=400,
            detail="Only http and https protocols are permitted",
        )

    hostname = (parsed.hostname or "").lower()
    if not hostname:
        raise HTTPException(
            status_code=400,
            detail="Missing hostname in endpoint URL",
        )

    # For HTTP, only loopback is allowed (e.g. local Ollama, vLLM, mock test servers)
    if scheme == "http":
        is_loopback = False
        if hostname in ("localhost", "127.0.0.1", "::1"):
            is_loopback = True
        else:
            try:
                ip = ipaddress.ip_address(hostname)
                if ip.is_loopback:
                    is_loopback = True
            except ValueError:
                pass

        if not is_loopback:
            raise HTTPException(
                status_code=400,
                detail="Non-loopback HTTP endpoints are prohibited; use HTTPS",
            )

    return raw_url.rstrip("/")
