"""Tests for session management, provider registration, URL validation, and credential purging."""

import pytest
from httpx import ASGITransport, AsyncClient

from relay.main import app
from relay.session_store import session_store


@pytest.fixture(autouse=True)
def clean_store():
    """Clear session store before and after each test."""
    session_store.clear()
    yield
    session_store.clear()


@pytest.mark.asyncio
async def test_session_lifecycle():
    """Verify session creation, authentication header enforcement, and deletion."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Create session with valid origin
        res = await client.post(
            "/api/session", headers={"Origin": "http://127.0.0.1:5173"}
        )
        assert res.status_code == 201
        data = res.json()
        assert "session_token" in data
        token = data["session_token"]
        assert len(token) > 20

        # Attempt to access protected endpoint without session token
        res_unauth = await client.post(
            "/api/providers",
            headers={"Origin": "http://127.0.0.1:5173"},
            json={"base_url": "http://127.0.0.1:11434/v1"},
        )
        assert res_unauth.status_code == 401

        # Attempt to access with invalid token
        res_invalid = await client.post(
            "/api/providers",
            headers={
                "Origin": "http://127.0.0.1:5173",
                "X-Relay-Session": "invalid-token",
            },
            json={"base_url": "http://127.0.0.1:11434/v1"},
        )
        assert res_invalid.status_code == 403

        # Delete session
        res_del = await client.delete(
            "/api/session",
            headers={"Origin": "http://127.0.0.1:5173", "X-Relay-Session": token},
        )
        assert res_del.status_code == 204

        # Token should now be invalid
        res_after = await client.post(
            "/api/providers",
            headers={"Origin": "http://127.0.0.1:5173", "X-Relay-Session": token},
            json={"base_url": "http://127.0.0.1:11434/v1"},
        )
        assert res_after.status_code == 403


@pytest.mark.asyncio
async def test_provider_registration_and_url_validation():
    """Verify provider registration, loopback permission, and rejection of unsafe URLs."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Create session
        s_res = await client.post(
            "/api/session", headers={"Origin": "http://127.0.0.1:5173"}
        )
        token = s_res.json()["session_token"]
        headers = {"Origin": "http://127.0.0.1:5173", "X-Relay-Session": token}

        # Safe loopback HTTP with manual models
        p_res = await client.post(
            "/api/providers",
            headers=headers,
            json={
                "base_url": "http://127.0.0.1:8000/v1",
                "models": ["mock-model-1", "mock-model-2"],
            },
        )
        assert p_res.status_code == 201
        p_data = p_res.json()
        assert p_data["base_url"] == "http://127.0.0.1:8000/v1"
        assert p_data["has_api_key"] is False
        assert p_data["discovered_models"] == ["mock-model-1", "mock-model-2"]
        prov_id = p_data["provider_id"]

        # Credentials should not be exposed in model list endpoint
        m_res = await client.get(f"/api/providers/{prov_id}/models", headers=headers)
        assert m_res.status_code == 200
        assert m_res.json()["models"] == ["mock-model-1", "mock-model-2"]

        # Safe HTTPS endpoint with API key
        p_https = await client.post(
            "/api/providers",
            headers=headers,
            json={
                "base_url": "https://api.openai.com/v1",
                "api_key": "secret-test-key",
                "models": ["gpt-4o"],
            },
        )
        assert p_https.status_code == 201
        assert p_https.json()["has_api_key"] is True
        # Ensure API key is NOT in returned response
        assert "secret-test-key" not in p_https.text

        # Unsafe non-loopback HTTP endpoint must be rejected
        bad_http = await client.post(
            "/api/providers",
            headers=headers,
            json={"base_url": "http://192.168.1.100:8000/v1"},
        )
        assert bad_http.status_code == 400
        assert "Non-loopback HTTP endpoints are prohibited" in bad_http.json()["detail"]

        # Disallowed schemes must be rejected
        bad_scheme = await client.post(
            "/api/providers",
            headers=headers,
            json={"base_url": "file:///etc/passwd"},
        )
        assert bad_scheme.status_code == 400
        assert (
            "Only http and https protocols are permitted" in bad_scheme.json()["detail"]
        )

        # Deleting provider purges credentials
        del_res = await client.delete(f"/api/providers/{prov_id}", headers=headers)
        assert del_res.status_code == 204
        assert session_store.get_provider(token, prov_id) is None
