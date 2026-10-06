from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import CurrentUser, get_bot, get_current_user, get_db, require_guild_admin
from app.core.db import Database

if TYPE_CHECKING:
    from app.bot.client import ComplexBot

router = APIRouter(prefix="/api/admin", tags=["admin"])


class UpdateSettingsBody(BaseModel):
    default_voice_channel_id: int | None = None


class AddAdminBody(BaseModel):
    discord_id: int


def _guild_brief(guild: Any) -> dict[str, Any]:
    return {"id": guild.id, "name": guild.name, "member_count": guild.member_count}


@router.get("/guilds")
async def all_bot_guilds(
    user: CurrentUser = Depends(get_current_user),
    bot: ComplexBot = Depends(get_bot),
) -> list[dict[str, Any]]:
    """Super-admin only: every guild the bot is on."""
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
        "guild": _guild_brief(guild) if guild else {"id": guild_id, "name": settings.name},
        "default_voice_channel_id": settings.default_voice_channel_id,
        "admin_role_ids": json.loads(settings.admin_role_ids),
        "admins": admins,
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
    )
    await db.audit(
        "admin.update_settings",
        guild_id=guild_id,
        actor_id=user.discord_id,
        actor_kind="web",
        details=body.model_dump(exclude_none=True),
    )
    return await get_settings(guild_id, user, bot, db)


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
    return {"admins": await db.list_guild_admins(guild_id)}


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
    return {"admins": await db.list_guild_admins(guild_id)}
