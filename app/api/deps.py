from __future__ import annotations

import datetime as dt
import hashlib
import secrets
from typing import TYPE_CHECKING

from fastapi import Depends, HTTPException, Request
from sqlalchemy import delete

from app.core.config import Config
from app.core.db import Database, WebSession

if TYPE_CHECKING:
    from app.api.discord_oauth import DiscordOAuthClient
    from app.bot.client import ComplexBot
    from app.core.services.music import MusicService

SESSION_COOKIE = "dcbot_session"
STATE_COOKIE = "dcbot_oauth_state"
SESSION_TTL = dt.timedelta(days=30)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# --- request-scoped accessors ---


def get_config(request: Request) -> Config:
    return request.app.state.config


def get_db(request: Request) -> Database:
    return request.app.state.db


def get_bot(request: Request) -> ComplexBot:
    return request.app.state.bot


def get_music(request: Request) -> MusicService:
    return request.app.state.music


def get_oauth(request: Request) -> DiscordOAuthClient:
    return request.app.state.oauth


# --- sessions ---


async def load_session(request: Request, db: Database = Depends(get_db)) -> WebSession | None:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    async with db.session_factory() as db_session:
        row = await db_session.get(WebSession, hash_token(token))
    if row is None or row.revoked:
        return None
    if row.expires_at is not None and row.expires_at < dt.datetime.now(dt.timezone.utc):
        return None
    return row


async def create_session(db: Database, token_payload: dict, user: dict) -> str:
    """Write a web session record to the database. Return the raw cookie token."""
    token = secrets.token_urlsafe(32)
    async with db.session_factory() as db_session:
        db_session.add(
            WebSession(
                id=hash_token(token),
                discord_id=int(user["id"]),
                username=user.get("username", ""),
                global_name=user.get("global_name") or user.get("username", ""),
                avatar=user.get("avatar"),
                access_token=token_payload["access_token"],
                refresh_token=token_payload.get("refresh_token", ""),
                expires_at=dt.datetime.now(dt.timezone.utc) + SESSION_TTL,
            )
        )
        await db_session.commit()
    return token


async def revoke_session(db: Database, request: Request) -> None:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return
    async with db.session_factory() as db_session:
        await db_session.execute(delete(WebSession).where(WebSession.id == hash_token(token)))
        await db_session.commit()


async def cleanup_expired_sessions(db: Database) -> None:
    async with db.session_factory() as db_session:
        await db_session.execute(
            delete(WebSession).where(WebSession.expires_at < dt.datetime.now(dt.timezone.utc))
        )
        await db_session.commit()


# --- current user & roles ---


class CurrentUser:
    def __init__(self, session: WebSession, config: Config) -> None:
        self.session_id = session.id
        self.discord_id = session.discord_id
        self.username = session.username
        self.global_name = session.global_name
        self.avatar = session.avatar
        self.access_token = session.access_token
        self.refresh_token = session.refresh_token
        self.is_superadmin = self.discord_id in config.superadmin_ids


async def get_current_user(
    session: WebSession | None = Depends(load_session),
    config: Config = Depends(get_config),
) -> CurrentUser:
    if session is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return CurrentUser(session, config)


async def is_guild_admin(db: Database, user: CurrentUser, guild_id: int) -> bool:
    admins = await db.list_guild_admins(guild_id)
    return user.discord_id in admins


async def _is_guild_member(
    user: CurrentUser, oauth: DiscordOAuthClient, bot: ComplexBot, db: Database, guild_id: int
) -> bool:
    """Check membership with a request to the Discord API. If the request fails, use the bot member cache."""
    try:
        from app.api.sessions import fetch_guilds_with_retry

        guilds = await fetch_guilds_with_retry(oauth, db, user)
        return any(int(g["id"]) == guild_id for g in guilds)
    except Exception:  # noqa: BLE001 - API hiccup should not lock the user out; try cache below
        guild = bot.get_guild(guild_id)
        return guild is not None and guild.get_member(user.discord_id) is not None


async def require_guild_member(
    guild_id: int,
    user: CurrentUser = Depends(get_current_user),
    oauth: DiscordOAuthClient = Depends(get_oauth),
    bot: ComplexBot = Depends(get_bot),
    db: Database = Depends(get_db),
) -> CurrentUser:
    if user.is_superadmin:
        return user
    if bot.get_guild(guild_id) is None:
        raise HTTPException(status_code=404, detail="Bot is not on this server")
    if not await _is_guild_member(user, oauth, bot, db, guild_id):
        raise HTTPException(status_code=403, detail="You are not a member of this server")
    return user


async def require_guild_admin(
    guild_id: int,
    user: CurrentUser = Depends(get_current_user),
    oauth: DiscordOAuthClient = Depends(get_oauth),
    bot: ComplexBot = Depends(get_bot),
    db: Database = Depends(get_db),
) -> CurrentUser:
    if user.is_superadmin:
        return user
    if bot.get_guild(guild_id) is None:
        raise HTTPException(status_code=404, detail="Bot is not on this server")
    if not await _is_guild_member(user, oauth, bot, db, guild_id):
        raise HTTPException(status_code=403, detail="You are not a member of this server")
    if await is_guild_admin(db, user, guild_id):
        return user
    raise HTTPException(status_code=403, detail="Server admin rights required")
