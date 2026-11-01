"""Upstream client handling URL normalization, model discovery, and streaming proxying."""

import json
import logging
from typing import Any, AsyncGenerator, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import httpx

from relay.config import settings

logger = logging.getLogger("relay.client")


class RelayUpstreamError(Exception):
    """Exception for upstream relay failures."""

    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


def normalize_provider_urls(base_url: str) -> Tuple[str, str, str]:
    """Normalize base URL into root, chat completions, and models URLs.

    Does not guess provider; follows standard OpenAI REST path conventions.
    """
    clean_url = base_url.strip().rstrip("/")
    parsed = urlparse(clean_url)
    path = parsed.path.rstrip("/")

    if path.endswith("/chat/completions"):
        base_path = path[: -len("/chat/completions")].rstrip("/")
        prefix = f"{parsed.scheme}://{parsed.netloc}{base_path}"
        chat_url = clean_url
        models_url = f"{prefix}/models"
        return prefix, chat_url, models_url

    if path.endswith("/models"):
        base_path = path[: -len("/models")].rstrip("/")
        prefix = f"{parsed.scheme}://{parsed.netloc}{base_path}"
        chat_url = f"{prefix}/chat/completions"
        models_url = clean_url
        return prefix, chat_url, models_url

    prefix = clean_url
    chat_url = f"{prefix}/chat/completions"
    models_url = f"{prefix}/models"
    return prefix, chat_url, models_url


async def discover_models(
    models_url: str,
    api_key: Optional[str] = None,
    timeout_seconds: float = 10.0,
) -> List[str]:
    """Query upstream /models endpoint.

    Returns discovered model identifiers or an empty list if discovery is unsupported.
    """
    headers: Dict[str, str] = {"Accept": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        async with httpx.AsyncClient(
            follow_redirects=False, timeout=timeout_seconds
        ) as client:
            response = await client.get(models_url, headers=headers)
            if response.status_code == 200:
                data = response.json()
                models: List[str] = []
                if (
                    isinstance(data, dict)
                    and "data" in data
                    and isinstance(data["data"], list)
                ):
                    for item in data["data"]:
                        if (
                            isinstance(item, dict)
                            and "id" in item
                            and isinstance(item["id"], str)
                        ):
                            models.append(item["id"])
                elif isinstance(data, list):
                    for item in data:
                        if (
                            isinstance(item, dict)
                            and "id" in item
                            and isinstance(item["id"], str)
                        ):
                            models.append(item["id"])
                        elif isinstance(item, str):
                            models.append(item)
                return sorted(models)
            logger.info(
                "Upstream models endpoint returned HTTP %d, falling back to manual entry",
                response.status_code,
            )
            return []
    except (httpx.RequestError, json.JSONDecodeError) as exc:
        logger.info(
            "Model discovery request failed (%s), falling back to manual model entry",
            type(exc).__name__,
        )
        return []


async def open_upstream_chat_stream(
    chat_url: str,
    payload: Dict[str, Any],
    api_key: Optional[str] = None,
    timeout_seconds: float = settings.request_timeout_seconds,
) -> Tuple[httpx.AsyncClient, httpx.Response]:
    """Open streaming connection to upstream provider.

    Validates status codes and redirects prior to returning active stream response.
    Caller must close response and client upon completion or abort.
    """
    headers: Dict[str, str] = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    client = httpx.AsyncClient(follow_redirects=False, timeout=timeout_seconds)
    try:
        req = client.build_request("POST", chat_url, json=payload, headers=headers)
        response = await client.send(req, stream=True)

        if response.status_code in (401, 403):
            await response.aclose()
            await client.aclose()
            raise RelayUpstreamError(
                status_code=401,
                code="upstream_authentication_failed",
                message="Upstream provider rejected authentication credentials",
            )

        if 300 <= response.status_code < 400:
            await response.aclose()
            await client.aclose()
            raise RelayUpstreamError(
                status_code=502,
                code="unsafe_redirect_prohibited",
                message="Upstream attempted redirect which is disallowed for security",
            )

        if response.status_code != 200:
            content = await response.aread()
            await client.aclose()
            detail = "Upstream returned HTTP error"
            try:
                parsed_err = json.loads(content)
                if isinstance(parsed_err, dict) and "error" in parsed_err:
                    err_obj = parsed_err["error"]
                    if isinstance(err_obj, dict) and "message" in err_obj:
                        detail = str(err_obj["message"])
                    elif isinstance(err_obj, str):
                        detail = err_obj
            except Exception:
                pass
            raise RelayUpstreamError(
                status_code=502,
                code="upstream_http_error",
                message=f"Upstream returned status {response.status_code}: {detail}",
            )

        content_type = response.headers.get("content-type", "")
        if "text/event-stream" not in content_type:
            await response.aclose()
            await client.aclose()
            raise RelayUpstreamError(
                status_code=502,
                code="expected_event_stream",
                message="Upstream did not return an SSE text/event-stream response",
            )

        return client, response
    except httpx.TimeoutException as exc:
        await client.aclose()
        raise RelayUpstreamError(
            status_code=504,
            code="upstream_timeout",
            message="Upstream request timed out",
        ) from exc
    except httpx.RequestError as exc:
        await client.aclose()
        raise RelayUpstreamError(
            status_code=502,
            code="relay_request_failed",
            message=f"Network error connecting to upstream: {type(exc).__name__}",
        ) from exc
    except Exception:
        await client.aclose()
        raise
