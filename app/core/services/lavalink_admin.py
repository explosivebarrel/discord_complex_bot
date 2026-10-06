from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.config import Config

logger = logging.getLogger(__name__)


class LavalinkAdminError(Exception):
    pass


class LavalinkAdmin:
    """Small HTTP client for the Lavalink plugin admin routes (GET/POST /youtube)."""

    def __init__(self, config: Config) -> None:
        scheme = "https" if config.lavalink_secure else "http"
        self._base = f"{scheme}://{config.lavalink_host}:{config.lavalink_port}"
        self._password = config.lavalink_password

    async def get_youtube_config(self) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(f"{self._base}/youtube", headers={"Authorization": self._password})
        except httpx.HTTPError as exc:
            raise LavalinkAdminError(f"Lavalink is not reachable: {exc}") from exc
        if resp.status_code != 200:
            raise LavalinkAdminError(f"GET /youtube returned {resp.status_code}")
        return resp.json()

    async def update_youtube_config(
        self,
        refresh_token: str = "x",
        skip_initialization: bool = False,
        po_token: str = "",
        visitor_data: str = "",
    ) -> None:
        """Apply the youtube plugin config at runtime.

        The refresh token value "x" means "keep the current token".
        Empty poToken and visitorData keep the current POT values.
        """
        body = {
            "refreshToken": refresh_token,
            "skipInitialization": skip_initialization,
            "poToken": po_token,
            "visitorData": visitor_data,
        }
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    f"{self._base}/youtube", headers={"Authorization": self._password}, json=body
                )
        except httpx.HTTPError as exc:
            raise LavalinkAdminError(f"Lavalink is not reachable: {exc}") from exc
        if resp.status_code != 204:
            raise LavalinkAdminError(f"POST /youtube returned {resp.status_code}: {resp.text[:200]}")

    @staticmethod
    def mask_token(token: str | None) -> str | None:
        if not token:
            return None
        return f"{token[:8]}…{token[-4:]} ({len(token)} chars)"
