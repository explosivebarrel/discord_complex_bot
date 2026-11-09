from __future__ import annotations

import logging
from typing import Any
from urllib.parse import urlencode

import httpx

from app.core.config import Config

logger = logging.getLogger(__name__)

API_BASE = "https://discord.com/api/v10"


class DiscordAPIError(Exception):
    pass


class DiscordUnreachableError(DiscordAPIError):
    """The network to Discord is down (timeout, TLS reset, DNS).

    Distinct from a plain DiscordAPIError: a rejection means the token is
    bad (session must expire), an outage means "try again" — the session
    must survive it."""


async def _map_network_errors(aw: Any) -> Any:
    """A dead network (TLS reset, DNS, timeout) must surface as
    DiscordUnreachableError, not as an unhandled httpx error that turns
    every authed route into a 500."""
    try:
        return await aw
    except httpx.HTTPError as exc:
        raise DiscordUnreachableError("Discord is unreachable right now.") from exc


class DiscordOAuthClient:
    """Helper for the Discord OAuth2 Authorization Code flow and for Discord REST requests."""

    def __init__(self, config: Config) -> None:
        self.config = config

    def authorize_url(self, state: str) -> str:
        params = {
            "client_id": self.config.discord_client_id,
            "redirect_uri": self.config.discord_redirect_uri,
            "response_type": "code",
            "scope": "identify guilds",
            "state": state,
            "prompt": "consent",
        }
        return f"{API_BASE}/oauth2/authorize?{urlencode(params)}"

    async def exchange_code(self, code: str) -> dict[str, Any]:
        return await self._token_request(
            {
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": self.config.discord_redirect_uri,
            }
        )

    async def refresh_token(self, refresh_token: str) -> dict[str, Any]:
        return await self._token_request(
            {
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
            }
        )

    async def _token_request(self, data: dict[str, Any]) -> dict[str, Any]:
        basic = httpx.BasicAuth(self.config.discord_client_id, self.config.discord_client_secret)
        async with httpx.AsyncClient() as client:
            resp = await _map_network_errors(client.post(f"{API_BASE}/oauth2/token", data=data, auth=basic))
        if resp.status_code != 200:
            logger.warning("Discord token request failed: %s %s", resp.status_code, resp.text)
            raise DiscordAPIError("Failed to exchange the authorization code.")
        return resp.json()

    @staticmethod
    async def _get(path: str, access_token: str) -> Any:
        headers = {"Authorization": f"Bearer {access_token}"}
        async with httpx.AsyncClient() as client:
            resp = await _map_network_errors(client.get(f"{API_BASE}{path}", headers=headers, timeout=15.0))
        if resp.status_code != 200:
            logger.warning("Discord API %s failed: %s", path, resp.status_code)
            raise DiscordAPIError(f"Discord API error on {path}")
        return resp.json()

    async def fetch_user(self, access_token: str) -> dict[str, Any]:
        return await self._get("/users/@me", access_token)

    async def fetch_guilds(self, access_token: str) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        after = "0"
        while True:
            page = await self._get(f"/users/@me/guilds?limit=200&after={after}", access_token)
            result.extend(page)
            if len(page) < 200:
                return result
            after = str(page[-1]["id"])
