"""Configuration defaults for the model relay service."""

import os
from typing import Set


class RelaySettings:
    """Relay service settings with loopback defaults."""

    def __init__(self) -> None:
        self.host: str = os.getenv("RELAY_HOST", "127.0.0.1")
        self.port: int = int(os.getenv("RELAY_PORT", "8765"))
        default_origins = {
            "http://127.0.0.1:5173",
            "http://localhost:5173",
            "http://127.0.0.1:4173",
            "http://localhost:4173",
        }
        extra_origins = os.getenv("ALLOWED_ORIGINS", "")
        if extra_origins:
            for origin in extra_origins.split(","):
                cleaned = origin.strip()
                if cleaned:
                    default_origins.add(cleaned)
        self.allowed_origins: Set[str] = default_origins
        self.request_timeout_seconds: float = float(
            os.getenv("RELAY_TIMEOUT_SECONDS", "60.0")
        )
        self.max_payload_bytes: int = int(os.getenv("MAX_PAYLOAD_BYTES", "2000000"))


settings = RelaySettings()
