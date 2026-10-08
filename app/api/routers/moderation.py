from __future__ import annotations

import datetime as dt
from typing import TYPE_CHECKING, Any

import discord
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.deps import (
    CurrentUser,
    get_bot,
    get_db,
    is_admin_tier,
    require_guild_admin,
    require_section_access,
)
from app.core.db import Database
from app.core.services.directory import collect_known_users

if TYPE_CHECKING:
    from app.bot.client import ComplexBot

router = APIRouter(prefix="/api/guilds/{guild_id}/moderation", tags=["moderation"])
section = require_section_access("moderation")

TIMEOUT_MAX_MINUTES = 28 * 24 * 60  # Discord caps timeouts at 28 days


class TimeoutBody(BaseModel):
    user_id: int
    minutes: int = Field(ge=1, le=TIMEOUT_MAX_MINUTES)
    reason: str = ""


class KickBody(BaseModel):
    user_id: int
    reason: str = ""


class BanBody(BaseModel):
    user_id: int
    delete_days: int = Field(default=0, ge=0, le=7)
    reason: str = ""


@router.get("/users")
async def known_users(
    guild_id: int,
    user: CurrentUser = Depends(section),
    bot: ComplexBot = Depends(get_bot),
    db: Database = Depends(get_db),
) -> list[dict[str, Any]]:
    return await collect_known_users(bot, db, guild_id)


@router.get("/warnings")
async def warnings(
    guild_id: int,
    user_id: int | None = None,
    user: CurrentUser = Depends(section),
    db: Database = Depends(get_db),
) -> list[dict[str, Any]]:
    return await db.list_warnings(guild_id, user_id=user_id, limit=100)


@router.get("/log")
async def moderation_log(
    guild_id: int,
    user: CurrentUser = Depends(section),
    db: Database = Depends(get_db),
) -> list[dict[str, Any]]:
    return await db.recent_actions(guild_id, "moderation.", limit=30)


async def _resolve_target(
    bot: ComplexBot, guild_id: int, user_id: int
) -> tuple[discord.Guild, discord.Member]:
    guild = bot.get_guild(guild_id)
    if guild is None:
        raise HTTPException(status_code=404, detail="Bot is not on this server")
    try:
        member = await guild.fetch_member(user_id)
    except discord.NotFound as exc:
        raise HTTPException(status_code=404, detail="User is not on this server") from exc
    except discord.Forbidden as exc:
        raise HTTPException(status_code=400, detail="I cannot see members of this server") from exc
    return guild, member


async def _mod_log(
    bot: ComplexBot, db: Database, guild: discord.Guild, title: str, description: str, color: discord.Color
) -> None:
    settings = await db.get_guild_settings(guild.id)
    if settings.mod_log_channel_id is None:
        return
    channel = guild.get_channel(settings.mod_log_channel_id)
    if not isinstance(channel, discord.TextChannel):
        return
    try:
        await channel.send(embed=discord.Embed(title=title, description=description, color=color))
    except discord.Forbidden:
        pass  # the log channel lost permissions; the action itself still happened


@router.post("/timeout")
async def timeout_user(
    guild_id: int,
    body: TimeoutBody,
    user: CurrentUser = Depends(require_guild_admin),
    bot: ComplexBot = Depends(get_bot),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    guild, member = await _resolve_target(bot, guild_id, body.user_id)
    until = discord.utils.utcnow() + dt.timedelta(minutes=body.minutes)
    try:
        await member.timeout(until, reason=body.reason or None)
    except discord.Forbidden as exc:
        raise HTTPException(
            status_code=400, detail="I cannot timeout this member (role hierarchy or missing rights)"
        ) from exc
    await db.audit(
        "moderation.timeout",
        guild_id=guild_id,
        actor_id=user.discord_id,
        actor_kind="web",
        details={"user_id": str(body.user_id), "minutes": body.minutes, "reason": body.reason},
    )
    description = f"{member.mention} for {body.minutes} min — {body.reason or 'no reason'}"
    await _mod_log(bot, db, guild, "Member timed out", description, discord.Color.orange())
    return {"timed_out": str(body.user_id), "minutes": body.minutes}


@router.post("/kick")
async def kick_user(
    guild_id: int,
    body: KickBody,
    user: CurrentUser = Depends(require_guild_admin),
    bot: ComplexBot = Depends(get_bot),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    guild, member = await _resolve_target(bot, guild_id, body.user_id)
    try:
        await member.kick(reason=body.reason or None)
    except discord.Forbidden as exc:
        raise HTTPException(
            status_code=400, detail="I cannot kick this member (role hierarchy or missing rights)"
        ) from exc
    await db.audit(
        "moderation.kick",
        guild_id=guild_id,
        actor_id=user.discord_id,
        actor_kind="web",
        details={"user_id": str(body.user_id), "reason": body.reason},
    )
    description = f"{member.mention} — {body.reason or 'no reason'}"
    await _mod_log(bot, db, guild, "Member kicked", description, discord.Color.red())
    return {"kicked": str(body.user_id)}


@router.post("/ban")
async def ban_user(
    guild_id: int,
    body: BanBody,
    user: CurrentUser = Depends(require_guild_admin),
    bot: ComplexBot = Depends(get_bot),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    guild = bot.get_guild(guild_id)
    if guild is None:
        raise HTTPException(status_code=404, detail="Bot is not on this server")
    try:
        await guild.ban(
            discord.Object(id=body.user_id),
            delete_message_seconds=body.delete_days * 86400,
            reason=body.reason or None,
        )
    except discord.NotFound as exc:
        raise HTTPException(status_code=404, detail="Discord user not found") from exc
    except discord.Forbidden as exc:
        raise HTTPException(status_code=400, detail="I cannot ban this user (missing rights)") from exc
    await db.audit(
        "moderation.ban",
        guild_id=guild_id,
        actor_id=user.discord_id,
        actor_kind="web",
        details={"user_id": str(body.user_id), "delete_days": body.delete_days, "reason": body.reason},
    )
    await _mod_log(
        bot, db, guild, "User banned",
        f"<@{body.user_id}> — {body.reason or 'no reason'}",
        discord.Color.red(),
    )
    return {"banned": str(body.user_id)}


@router.get("/access")
async def access_info(
    guild_id: int,
    user: CurrentUser = Depends(section),
    db: Database = Depends(get_db),
    admin_check: bool = Depends(is_admin_tier),
) -> dict[str, Any]:
    """Whether the current user may act (admin tier) or only view."""
    return {"can_act": admin_check}
