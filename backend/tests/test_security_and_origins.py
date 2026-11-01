"""Security tests for origin restrictions, error sanitization, and logging privacy."""

import logging
import pytest
from httpx import ASGITransport, AsyncClient

from relay.main import app
from relay.session_store import session_store


@pytest.fixture(autouse=True)
def clean_store():
    session_store.clear()
    yield
    session_store.clear()


@pytest.mark.asyncio
async def test_untrusted_origins_rejected():
    """Verify that requests from unauthorized origins are rejected with 403."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Untrusted origin attempting session creation
        res = await client.post(
            "/api/session", headers={"Origin": "http://malicious-website.com"}
        )
        assert res.status_code == 403
        assert res.json()["detail"] == "Untrusted origin"


@pytest.mark.asyncio
async def test_credentials_absent_from_logs(caplog):
    """Verify that sensitive API keys are never recorded in application logs."""
    transport = ASGITransport(app=app)
    secret_key = "super-sensitive-secret-token-12345"
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        with caplog.at_level(logging.INFO):
            s_res = await client.post(
                "/api/session", headers={"Origin": "http://127.0.0.1:5173"}
            )
            token = s_res.json()["session_token"]
            headers = {"Origin": "http://127.0.0.1:5173", "X-Relay-Session": token}

            await client.post(
                "/api/providers",
                headers=headers,
                json={
                    "base_url": "https://api.openai.com/v1",
                    "api_key": secret_key,
                    "models": ["gpt-4o"],
                },
            )

        # Confirm secret key does not appear anywhere in logs
        for record in caplog.records:
            assert secret_key not in record.message
            assert secret_key not in str(record)
