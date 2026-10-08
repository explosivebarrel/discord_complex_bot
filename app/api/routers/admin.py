from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import (
    CurrentUser,
    get_bot,
    get_current_user,
    get_db,
    require_guild_admin,
    require_section_access,
)
from app.core.db import Database

if TYPE_CHECKING:
    from app.bot.client import ComplexBot

router = APIRouter(prefix="/api/admin", tags=["admin"])

stats_section = require_section_access("stats")


class UpdateSettingsBody(BaseModel):
    default_voice_channel_id: int | None = None
    autoplay_enabled: bool | None = None
    autoplay_query: str | None = None
    stats_access: str | None = None
    posts_access: str | None = None
    moderation_access: str | None = None
    mod_log_channel_id: int | None = None


class AddAdminBody(BaseModel):
    discord_id: int


def _guild_brief(guild: Any) -> dict[str, Any]:
    return {"id": str(guild.id), "name": guild.name, "member_count": guild.member_count}


@router.get("/guilds")
async def all_bot_guilds(
    user: CurrentUser = Depends(get_current_user),
    bot: ComplexBot = Depends(get_bot),
) -> list[dict[str, Any]]:
    """Return all guilds that the bot is on. Super-admin only."""
    if not user.is_superadmin:
        raise HTTPException(status_code=403, detail="Super-admin only")
    return [_guild_brief(g) for g in bot.guilds]


@router.get("/guilds/{guild_id}/settings")
async def get_settings(
    guild_id: int,
    user: CurrentUser = Depends(require_guild_admin),
    bot: ComplexBot = Depends(get_bot),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    settings = await db.get_guild_settings(guild_id)
    admins = await db.list_guild_admins(guild_id)
    guild = bot.get_guild(guild_id)
    return {
        "guild": _guild_brief(guild) if guild else {"id": str(guild_id), "name": settings.name},
        # Snowflake ids travel as strings: JavaScript numbers lose precision above 2^53.
        "default_voice_channel_id": (
            str(settings.default_voice_channel_id) if settings.default_voice_channel_id is not None else None
        ),
        "admin_role_ids": json.loads(settings.admin_role_ids),
        "admins": [str(a) for a in admins],
        "autoplay_enabled": settings.autoplay_enabled,
        "autoplay_query": settings.autoplay_query,
        "stats_access": settings.stats_access,
        "posts_access": settings.posts_access,
        "moderation_access": settings.moderation_access,
        "mod_log_channel_id": (
            str(settings.mod_log_channel_id) if settings.mod_log_channel_id is not None else None
        ),
    }


@router.put("/guilds/{guild_id}/settings")
async def update_settings(
    guild_id: int,
    body: UpdateSettingsBody,
    user: CurrentUser = Depends(require_guild_admin),
    bot: ComplexBot = Depends(get_bot),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    guild = bot.get_guild(guild_id)
    await db.update_guild_settings(
        guild_id,
        name=guild.name if guild else None,
        default_voice_channel_id=body.default_voice_channel_id,
        autoplay_enabled=body.autoplay_enabled,
        autoplay_query=body.autoplay_query,
        stats_access=body.stats_access,
        posts_access=body.posts_access,
        moderation_access=body.moderation_access,
        mod_log_channel_id=body.mod_log_channel_id,
    )
    await db.audit(
        "admin.update_settings",
        guild_id=guild_id,
        actor_id=user.discord_id,
        actor_kind="web",
        details=body.model_dump(exclude_none=True),
    )
    return await get_settings(guild_id, user, bot, db)


@router.get("/guilds/{guild_id}/stats")
async def guild_stats(
    guild_id: int,
    user: CurrentUser = Depends(stats_section),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    """Playback statistics for the stats page of the web panel."""
    requesters = await db.top_requesters(guild_id, days=30, limit=10)
    return {
        "totals": await db.history_totals(guild_id, days=30),
        "top_tracks": await db.top_tracks(guild_id, days=30, limit=10),
        # The discord id is not shown on the page; name and count are enough.
        "top_requesters": [{"name": r["name"], "plays": r["plays"]} for r in requesters],
        "recent": await db.recent_history(guild_id, limit=50),
    }


@router.post("/guilds/{guild_id}/admins")
async def add_admin(
    guild_id: int,
    body: AddAdminBody,
    user: CurrentUser = Depends(require_guild_admin),
    bot: ComplexBot = Depends(get_bot),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    if bot.get_guild(guild_id) is None:
        raise HTTPException(status_code=404, detail="Bot is not on this server")
    if bot.get_user(body.discord_id) is None:
        raise HTTPException(
            status_code=400, detail="User id not found by the bot (user must share a server with the bot)"
        )
    await db.add_guild_admin(guild_id, body.discord_id, added_by=user.discord_id)
    await db.audit(
        "admin.add_guild_admin",
        guild_id=guild_id,
        actor_id=user.discord_id,
        actor_kind="web",
        details={"discord_id": body.discord_id},
    )
    return {"admins": [str(a) for a in await db.list_guild_admins(guild_id)]}


@router.delete("/guilds/{guild_id}/admins/{discord_id}")
async def remove_admin(
    guild_id: int,
    discord_id: int,
    user: CurrentUser = Depends(require_guild_admin),
    bot: ComplexBot = Depends(get_bot),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    if not user.is_superadmin and user.discord_id == discord_id:
        raise HTTPException(status_code=400, detail="You cannot revoke your own admin rights")
    await db.remove_guild_admin(guild_id, discord_id)
    await db.audit(
        "admin.remove_guild_admin",
        guild_id=guild_id,
        actor_id=user.discord_id,
        actor_kind="web",
        details={"discord_id": discord_id},
    )
    return {"admins": [str(a) for a in await db.list_guild_admins(guild_id)]}
