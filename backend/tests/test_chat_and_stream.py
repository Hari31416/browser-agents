"""Tests for streaming chat responses, tool calls, and error handling."""

import pytest
from httpx import ASGITransport, AsyncClient
from unittest.mock import AsyncMock, patch

from relay.client import normalize_provider_urls
from relay.main import app
from relay.session_store import session_store


@pytest.fixture(autouse=True)
def clean_store():
    session_store.clear()
    yield
    session_store.clear()


def test_url_normalization():
    """Verify standard normalization of base, chat, and models URLs without guessing provider."""
    # Root base URL
    base, chat, models = normalize_provider_urls("http://127.0.0.1:8000/v1")
    assert base == "http://127.0.0.1:8000/v1"
    assert chat == "http://127.0.0.1:8000/v1/chat/completions"
    assert models == "http://127.0.0.1:8000/v1/models"

    # Trailing slash base URL
    base, chat, models = normalize_provider_urls("https://api.example.com/v1/")
    assert base == "https://api.example.com/v1"
    assert chat == "https://api.example.com/v1/chat/completions"
    assert models == "https://api.example.com/v1/models"

    # Direct chat completions path provided
    base, chat, models = normalize_provider_urls(
        "http://127.0.0.1:8000/v1/chat/completions"
    )
    assert base == "http://127.0.0.1:8000/v1"
    assert chat == "http://127.0.0.1:8000/v1/chat/completions"
    assert models == "http://127.0.0.1:8000/v1/models"

    # Direct models path provided
    base, chat, models = normalize_provider_urls("http://127.0.0.1:8000/v1/models")
    assert base == "http://127.0.0.1:8000/v1"
    assert chat == "http://127.0.0.1:8000/v1/chat/completions"
    assert models == "http://127.0.0.1:8000/v1/models"


@pytest.mark.asyncio
async def test_stream_chat_forwarding():
    """Verify that SSE stream chunks and tool calls are cleanly forwarded to the client."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Create session and register provider
        s_res = await client.post(
            "/api/session", headers={"Origin": "http://127.0.0.1:5173"}
        )
        token = s_res.json()["session_token"]
        headers = {"Origin": "http://127.0.0.1:5173", "X-Relay-Session": token}

        p_res = await client.post(
            "/api/providers",
            headers=headers,
            json={"base_url": "http://127.0.0.1:8000/v1", "models": ["mock-model"]},
        )
        prov_id = p_res.json()["provider_id"]

        # Mock upstream stream response
        sse_chunks = [
            b'data: {"choices":[{"delta":{"role":"assistant","content":"Hello"}}]}\n\n',
            b'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"write_todos","arguments":"{}}"}}]}}]}\n\n',
            b"data: [DONE]\n\n",
        ]

        class MockUpstreamResponse:
            async def aiter_bytes(self):
                for chunk in sse_chunks:
                    yield chunk

            async def aclose(self):
                pass

        class MockClient:
            async def aclose(self):
                pass

        with patch(
            "relay.main.open_upstream_chat_stream",
            return_value=(MockClient(), MockUpstreamResponse()),
        ):
            chat_payload = {
                "provider_id": prov_id,
                "model": "mock-model",
                "messages": [{"role": "user", "content": "Hi"}],
                "stream": True,
            }
            res = await client.post(
                "/api/chat",
                headers=headers,
                json=chat_payload,
            )
            assert res.status_code == 200
            assert "text/event-stream" in res.headers["content-type"]
            body = res.content
            assert b"Hello" in body
            assert b"write_todos" in body
            assert b"[DONE]" in body
