from __future__ import annotations

import datetime as dt
import hashlib
import secrets
from typing import TYPE_CHECKING, Any

import discord
from fastapi import Depends, HTTPException, Request
from sqlalchemy import delete

from app.core.config import Config
from app.core.db import Database, WebSession
from app.core.db.models import utcnow

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
    if row.expires_at is not None and row.expires_at < utcnow():
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
                expires_at=utcnow() + SESSION_TTL,
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
        await db_session.execute(delete(WebSession).where(WebSession.expires_at < utcnow()))
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


# Membership and Discord-level admin check results.
# Key: (discord_id, guild_id), value: (expires_at, is_member, is_discord_admin).
# The panel polls the player every few seconds. Without this cache each poll
# would call the Discord API and burn the rate limit.
_MEMBER_CACHE_TTL = 600.0
_member_cache: dict[tuple[int, int], tuple[float, bool, bool]] = {}


def _cached_access(user: CurrentUser, guild_id: int) -> tuple[bool, bool] | None:
    import time

    entry = _member_cache.get((user.discord_id, guild_id))
    if entry is None:
        return None
    expires_at, is_member, is_discord_admin = entry
    if expires_at < time.monotonic():
        _member_cache.pop((user.discord_id, guild_id), None)
        return None
    return is_member, is_discord_admin


def _store_access(user: CurrentUser, guild_id: int, is_member: bool, is_discord_admin: bool) -> None:
    import time

    _member_cache[(user.discord_id, guild_id)] = (
        time.monotonic() + _MEMBER_CACHE_TTL,
        is_member,
        is_discord_admin,
    )


def _guild_payload_is_admin(payload: dict) -> bool:
    """Owner or MANAGE_GUILD in a raw Discord guild payload."""
    return bool(payload.get("owner")) or bool(int(payload.get("permissions", "0")) & 0x20)


async def _guild_access(
    user: CurrentUser, oauth: DiscordOAuthClient, bot: ComplexBot, db: Database, guild_id: int
) -> tuple[bool, bool]:
    """(is_member, is_discord_admin) for the user in the guild.

    The Discord API is the primary source; if it fails, fall back to the bot
    member cache so an API hiccup does not lock the user out.
    """
    cached = _cached_access(user, guild_id)
    if cached is not None:
        return cached
    try:
        from app.api.sessions import fetch_guilds_with_retry

        guilds = await fetch_guilds_with_retry(oauth, db, user)
        payload = next((g for g in guilds if int(g["id"]) == guild_id), None)
        is_member = payload is not None
        is_discord_admin = _guild_payload_is_admin(payload) if payload else False
        _store_access(user, guild_id, is_member, is_discord_admin)
        return is_member, is_discord_admin
    except Exception:  # noqa: BLE001 - API hiccup should not lock the user out; try cache below
        guild = bot.get_guild(guild_id)
        member = guild.get_member(user.discord_id) if guild else None
        if guild is None or member is None:
            return False, False
        is_discord_admin = guild.owner_id == user.discord_id or bool(
            member.guild_permissions & discord.Permissions.manage_guild
        )
        return True, is_discord_admin


async def _is_guild_member(
    user: CurrentUser, oauth: DiscordOAuthClient, bot: ComplexBot, db: Database, guild_id: int
) -> bool:
    is_member, _ = await _guild_access(user, oauth, bot, db, guild_id)
    return is_member


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


def section_allows(level: str, is_admin_tier: bool) -> bool:
    """Pure rule for panel section visibility.

    Levels: "admins" (admin tier only), "everyone" (any member), "off"
    (nobody except the super-admin, who is handled before this check).
    """
    if is_admin_tier:
        return level in ("admins", "everyone")
    return level == "everyone"


async def is_admin_tier(
    user: CurrentUser, oauth: DiscordOAuthClient, bot: ComplexBot, db: Database, guild_id: int
) -> bool:
    """Super-admin, Discord owner/MANAGE_GUILD, or a panel-added admin."""
    if user.is_superadmin:
        return True
    _, is_discord_admin = await _guild_access(user, oauth, bot, db, guild_id)
    return is_discord_admin or await is_guild_admin(db, user, guild_id)


def require_section_access(section: str):
    """Dependency factory: gate a router on a panel section (stats/posts/moderation)."""

    async def dep(
        guild_id: int,
        user: CurrentUser = Depends(get_current_user),
        oauth: DiscordOAuthClient = Depends(get_oauth),
        bot: ComplexBot = Depends(get_bot),
        db: Database = Depends(get_db),
    ) -> Any:
        # Any, not CurrentUser: FastAPI >= 0.14x builds a response model from a
        # dependency return annotation, and CurrentUser is not a Pydantic model.
        if user.is_superadmin:
            return user
        if bot.get_guild(guild_id) is None:
            raise HTTPException(status_code=404, detail="Bot is not on this server")
        if not await _is_guild_member(user, oauth, bot, db, guild_id):
            raise HTTPException(status_code=403, detail="You are not a member of this server")
        settings = await db.get_guild_settings(guild_id)
        level = getattr(settings, f"{section}_access", "admins")
        admin_tier = await is_admin_tier(user, oauth, bot, db, guild_id)
        if not section_allows(level, admin_tier):
            raise HTTPException(status_code=403, detail="This section is not available for you")
        return user

    return dep


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
    _, is_discord_admin = await _guild_access(user, oauth, bot, db, guild_id)
    if is_discord_admin or await is_guild_admin(db, user, guild_id):
        return user
    raise HTTPException(status_code=403, detail="Server admin rights required")
