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
    from app.core.db.models import UserApiToken
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


# --- personal API keys (browser userscript) ---

API_KEY_PREFIX = "vkq_"


class ApiKeyUser(CurrentUser):
    """A CurrentUser without Discord OAuth tokens: membership checks fall
    back to the bot's member cache, and OAuth-only endpoints reject it
    through the empty access_token."""

    def __init__(self, row: UserApiToken, config: Config) -> None:
        self.session_id = f"key:{row.id[:12]}"
        self.discord_id = row.discord_id
        self.username = row.username
        self.global_name = row.global_name
        self.avatar = None
        self.access_token = ""
        self.refresh_token = ""
        self.is_superadmin = self.discord_id in config.superadmin_ids


def _bearer_key(request: Request) -> str | None:
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer ") and auth[7:].strip():
        return auth[7:].strip()
    header = request.headers.get("X-API-Key", "")
    return header.strip() or None


async def get_api_user(
    request: Request,
    db: Database = Depends(get_db),
    config: Config = Depends(get_config),
) -> ApiKeyUser:
    key = _bearer_key(request)
    if key is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not key.startswith(API_KEY_PREFIX):
        raise HTTPException(status_code=401, detail="Invalid API key")
    row = await db.get_user_api_token(hash_token(key))
    if row is None or row.revoked:
        raise HTTPException(status_code=401, detail="Invalid API key")
    await db.touch_user_api_token(row.id)
    return ApiKeyUser(row, config)


async def require_guild_member_key(
    guild_id: int,
    user: ApiKeyUser = Depends(get_api_user),
    bot: ComplexBot = Depends(get_bot),
) -> CurrentUser:
    """Guild gate for API-key callers: membership via the bot cache only
    (the key carries no Discord OAuth tokens)."""
    if user.is_superadmin:
        return user
    guild = bot.get_guild(guild_id)
    if guild is None:
        raise HTTPException(status_code=404, detail="Bot is not on this server")
    if guild.get_member(user.discord_id) is None:
        raise HTTPException(status_code=403, detail="You are not a member of this server")
    return user


async def is_guild_admin(db: Database, user: CurrentUser, guild_id: int) -> bool:
    admins = await db.list_guild_admins(guild_id)
    return user.discord_id in admins


# Membership and Discord-level admin check results.
# Key: (discord_id, guild_id), value: (expires_at, is_member, is_discord_admin).
# The panel polls the player every few seconds. Without this cache each poll
# would call the Discord API and burn the rate limit.
_MEMBER_CACHE_TTL = 600.0
_member_cache: dict[tuple[int, int], tuple[float, bool, bool]] = {}


# --- access mock (super-admin testing) ---

# Pretend tiers for the panel: "owner" (the guild owner without any
# super-admin powers), "admin" (owner/MANAGE_GUILD), "member" (plain
# member) and "guest" (not a member). The super-admin is the operator
# identity and is deliberately not mockable. Key: session id, value:
# {guild_id: tier}. In memory on purpose: a restart resets every mock
# to the real permissions.
MOCK_TIERS = ("owner", "admin", "member", "guest")
_access_mock: dict[int, dict[int, str]] = {}


def get_access_mock(session_id: int, guild_id: int) -> str | None:
    return _access_mock.get(session_id, {}).get(guild_id)


def get_access_mock_all(session_id: int) -> dict[int, str]:
    return _access_mock.get(session_id, {})


def set_access_mock(session_id: int, guild_id: int, tier: str | None) -> None:
    guilds = _access_mock.setdefault(session_id, {})
    if tier is None:
        guilds.pop(guild_id, None)
        if not guilds:
            _access_mock.pop(session_id, None)
    else:
        guilds[guild_id] = tier


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
    # An active mock replaces the Discord lookups entirely, so the panel
    # gates behave exactly as they would for the pretended tier.
    mock = get_access_mock(user.session_id, guild_id)
    if mock is not None:
        return mock != "guest", mock in ("admin", "owner")
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
        # Permissions instances expose per-flag booleans; the class-level
        # discord.Permissions.manage_guild is a flag_value descriptor and
        # cannot take part in "&" (crashes inside the fallback).
        is_discord_admin = guild.owner_id == user.discord_id or member.guild_permissions.manage_guild
        return True, is_discord_admin


async def _is_guild_member(
    user: CurrentUser, oauth: DiscordOAuthClient, bot: ComplexBot, db: Database, guild_id: int
) -> bool:
    is_member, _ = await _guild_access(user, oauth, bot, db, guild_id)
    return is_member


def _superadmin_unmocked(user: CurrentUser, guild_id: int) -> bool:
    """The super-admin shortcut applies only without an active access mock."""
    return user.is_superadmin and get_access_mock(user.session_id, guild_id) is None


async def require_guild_member(
    guild_id: int,
    user: CurrentUser = Depends(get_current_user),
    oauth: DiscordOAuthClient = Depends(get_oauth),
    bot: ComplexBot = Depends(get_bot),
    db: Database = Depends(get_db),
) -> CurrentUser:
    if _superadmin_unmocked(user, guild_id):
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


def bot_section_available(bot: ComplexBot, guild_id: int, section: str) -> bool:
    """Whether the BOT's own Discord permissions allow the section to work.

    A user with full rights still cannot use a section the bot cannot
    perform: invited with a narrow permission set, it cannot connect to
    voice, send messages or moderate. Guild-level permissions only —
    per-channel overrides are the bot's runtime error messages.
    """
    guild = bot.get_guild(guild_id)
    if guild is None or guild.me is None:
        return False
    p = guild.me.guild_permissions
    if section == "player":
        return p.connect and p.speak
    if section == "stats":
        # Stats come from collected messages; without view_channel the
        # bot never sees any.
        return p.view_channel
    if section == "posts":
        return p.view_channel and p.send_messages
    if section == "moderation":
        return p.moderate_members or p.kick_members or p.ban_members
    # manage: the bot configures itself, no Discord permission involved.
    return True


async def is_admin_tier(
    guild_id: int,
    user: CurrentUser = Depends(get_current_user),
    oauth: DiscordOAuthClient = Depends(get_oauth),
    bot: ComplexBot = Depends(get_bot),
    db: Database = Depends(get_db),
) -> bool:
    """Super-admin, Discord owner/MANAGE_GUILD, or a panel-added admin."""
    if _superadmin_unmocked(user, guild_id):
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
        # The bot's permissions come before every user tier: no shortcut makes
        # a section work the bot cannot perform.
        if not bot_section_available(bot, guild_id, section):
            raise HTTPException(
                status_code=403,
                detail="The bot is missing Discord permissions for this section",
            )
        if _superadmin_unmocked(user, guild_id):
            return user
        if bot.get_guild(guild_id) is None:
            raise HTTPException(status_code=404, detail="Bot is not on this server")
        if not await _is_guild_member(user, oauth, bot, db, guild_id):
            raise HTTPException(status_code=403, detail="You are not a member of this server")
        settings = await db.get_guild_settings(guild_id)
        level = getattr(settings, f"{section}_access", "admins")
        admin_tier = await is_admin_tier(guild_id, user, oauth, bot, db)
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
    if _superadmin_unmocked(user, guild_id):
        return user
    if bot.get_guild(guild_id) is None:
        raise HTTPException(status_code=404, detail="Bot is not on this server")
    if not await _is_guild_member(user, oauth, bot, db, guild_id):
        raise HTTPException(status_code=403, detail="You are not a member of this server")
    admin_tier = await is_admin_tier(guild_id, user, oauth, bot, db)
    if admin_tier:
        return user
    raise HTTPException(status_code=403, detail="Server admin rights required")


def is_guild_owner(bot: ComplexBot, guild_id: int, user: CurrentUser) -> bool:
    """Owner-level trust: the Discord owner or an unmocked super-admin.

    An active access mock replaces the user's tier for the whole session:
    "owner" grants the trust, any other tier removes it — so a super-admin
    previewing "admin" sees exactly what a real admin sees.
    """
    mock = get_access_mock(user.session_id, guild_id)
    if mock is not None:
        return mock == "owner"
    if user.is_superadmin:
        return True
    guild = bot.get_guild(guild_id)
    return guild is not None and user.discord_id == guild.owner_id


async def require_guild_owner(
    guild_id: int,
    user: CurrentUser = Depends(get_current_user),
    bot: ComplexBot = Depends(get_bot),
) -> CurrentUser:
    """Strict gate for destructive moderation actions: the guild owner only.

    No membership call is needed: the owner of the guild is always a member,
    and guild.owner_id comes from the bot cache.
    """
    if bot.get_guild(guild_id) is None:
        raise HTTPException(status_code=404, detail="Bot is not on this server")
    if not is_guild_owner(bot, guild_id, user):
        raise HTTPException(status_code=403, detail="Only the server owner can do this")
    return user
