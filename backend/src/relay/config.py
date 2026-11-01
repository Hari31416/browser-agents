"""Configuration defaults for the model relay service."""

from typing import Set


class RelaySettings:
    """Relay service settings with loopback defaults."""

    host: str = "127.0.0.1"
    port: int = 8765
    allowed_origins: Set[str] = {
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:4173",
        "http://localhost:4173",
    }
    request_timeout_seconds: float = 60.0
    max_payload_bytes: int = 2_000_000


settings = RelaySettings()
