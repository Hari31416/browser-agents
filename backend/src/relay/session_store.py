"""In-memory session and credential store.

API keys and provider configurations exist only in memory during the active session.
Credentials are never written to disk or echoed in logs.
"""

import logging
import uuid
from dataclasses import dataclass, field
from typing import Dict, List, Optional

logger = logging.getLogger("relay.session_store")


@dataclass
class RegisteredProvider:
    """In-memory provider registration holding credentials and endpoint details."""

    provider_id: str
    base_url: str
    api_key: Optional[str]
    configured_models: List[str]
    discovered_models: List[str] = field(default_factory=list)


@dataclass
class Session:
    """Trusted session instance holding providers."""

    session_token: str
    providers: Dict[str, RegisteredProvider] = field(default_factory=dict)


class SessionStore:
    """Thread-safe in-memory session and credential repository."""

    def __init__(self) -> None:
        self._sessions: Dict[str, Session] = {}

    def create_session(self, token: str) -> Session:
        """Create a new trusted session."""
        session = Session(session_token=token)
        self._sessions[token] = session
        logger.info("Created trusted session")
        return session

    def get_session(self, token: str) -> Optional[Session]:
        """Look up a session by its token."""
        return self._sessions.get(token)

    def register_provider(
        self,
        token: str,
        base_url: str,
        api_key: Optional[str] = None,
        models: Optional[List[str]] = None,
    ) -> RegisteredProvider:
        """Register a provider within a session."""
        session = self.get_session(token)
        if not session:
            raise KeyError("Session does not exist")

        provider_id = f"prov_{uuid.uuid4().hex[:12]}"
        provider = RegisteredProvider(
            provider_id=provider_id,
            base_url=base_url,
            api_key=api_key if api_key else None,
            configured_models=list(models or []),
        )
        session.providers[provider_id] = provider
        logger.info(
            "Registered provider %s (has_key=%s)",
            provider_id,
            bool(provider.api_key),
        )
        return provider

    def get_provider(
        self, token: str, provider_id: str
    ) -> Optional[RegisteredProvider]:
        """Get a provider within a session."""
        session = self.get_session(token)
        if not session:
            return None
        return session.providers.get(provider_id)

    def remove_provider(self, token: str, provider_id: str) -> bool:
        """Remove a provider and wipe its credentials from memory."""
        session = self.get_session(token)
        if not session or provider_id not in session.providers:
            return False
        # Overwrite in-memory reference
        provider = session.providers.pop(provider_id)
        provider.api_key = None
        logger.info("Removed provider %s and cleared credentials", provider_id)
        return True

    def remove_session(self, token: str) -> bool:
        """Destroy an entire session and clear all contained provider credentials."""
        session = self._sessions.pop(token, None)
        if not session:
            return False
        for prov in session.providers.values():
            prov.api_key = None
        session.providers.clear()
        logger.info("Destroyed session and purged all session credentials")
        return True

    def clear(self) -> None:
        """Purge all sessions and credentials on shutdown."""
        for session in self._sessions.values():
            for prov in session.providers.values():
                prov.api_key = None
            session.providers.clear()
        self._sessions.clear()
        logger.info("Cleared all sessions from store")


session_store = SessionStore()
