from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from app.api.discord_oauth import DiscordAPIError

if TYPE_CHECKING:
    from app.api.deps import CurrentUser
    from app.api.discord_oauth import DiscordOAuthClient
    from app.core.db import Database

logger = logging.getLogger(__name__)


async def _persist_tokens(db: Database, user: CurrentUser, token_payload: dict[str, Any]) -> None:
    from app.core.db import WebSession

    async with db.session_factory() as session:
        row = await session.get(WebSession, user.session_id)
        if row is None:
            return
        row.access_token = token_payload["access_token"]
        row.refresh_token = token_payload.get("refresh_token", row.refresh_token)
        await session.commit()


async def refresh_session_token(oauth: DiscordOAuthClient, db: Database, user: CurrentUser) -> str:
    """Refresh the user's Discord access token. Save the new token on the session row."""
    if not user.refresh_token:
        raise DiscordAPIError("Session has no refresh token")
    payload = await oauth.refresh_token(user.refresh_token)
    user.access_token = payload["access_token"]
    user.refresh_token = payload.get("refresh_token", user.refresh_token)
    await _persist_tokens(db, user, payload)
    return user.access_token


async def fetch_guilds_with_retry(oauth: DiscordOAuthClient, db: Database, user: CurrentUser) -> list[dict]:
    """Get /users/@me/guilds. If the API rejects the token, refresh the token one time and try again."""
    try:
        return await oauth.fetch_guilds(user.access_token)
    except DiscordAPIError:
        logger.info("Discord token rejected for user %s, refreshing", user.discord_id)
        token = await refresh_session_token(oauth, db, user)
        return await oauth.fetch_guilds(token)
