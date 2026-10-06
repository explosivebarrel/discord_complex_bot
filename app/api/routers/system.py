from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import CurrentUser, get_bot, get_config, get_current_user, get_db, get_music
from app.core.config import Config
from app.core.db import Database
from app.core.services.lavalink_admin import LavalinkAdmin, LavalinkAdminError
from app.core.services.music import MusicService

if TYPE_CHECKING:
    from app.bot.client import ComplexBot

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/system", tags=["system"])

YT_TOKEN_KEY = "youtube_oauth"


class YoutubeConfigBody(BaseModel):
    refresh_token: str | None = None
    po_token: str | None = None
    visitor_data: str | None = None


def _require_superadmin(user: CurrentUser) -> None:
    if not user.is_superadmin:
        raise HTTPException(status_code=403, detail="Super-admin only")


@router.get("/integrations")
async def integrations(
    user: CurrentUser = Depends(get_current_user),
    bot: ComplexBot = Depends(get_bot),
    db: Database = Depends(get_db),
    music: MusicService = Depends(get_music),
    config: Config = Depends(get_config),
) -> dict[str, Any]:
    """Live status of every external integration. Super-admin only."""
    _require_superadmin(user)

    admin = LavalinkAdmin(config)
    youtube: dict[str, Any] = {"reachable": False}
    try:
        raw = await admin.get_youtube_config()
        youtube = {
            "reachable": True,
            "oauth_configured": bool(raw.get("refreshToken")),
            "refresh_token_masked": LavalinkAdmin.mask_token(raw.get("refreshToken")),
        }
    except LavalinkAdminError as exc:
        youtube["error"] = str(exc)

    stored = await db.get_system_setting(YT_TOKEN_KEY)
    youtube["token_saved_in_db"] = bool(stored and stored.get("refresh_token"))
    youtube["pot_saved_in_db"] = bool(stored and (stored.get("po_token") and stored.get("visitor_data")))
    youtube["last_error"] = music.last_error

    nodes = list(__import__("wavelink").Pool.nodes.values())

    return {
        "discord": {
            "ready": bot.is_ready(),
            "user": str(bot.user) if bot.user else None,
            "guilds": len(bot.guilds),
        },
        "lavalink": {
            "host": f"{config.lavalink_host}:{config.lavalink_port}",
            "connected": len(nodes) > 0,
            "players": sum(len(getattr(n, "players", {}) or {}) for n in nodes),
        },
        "youtube": youtube,
        "superadmin_hint": "IDs in SUPERADMIN_IDS (.env) get this page",
    }


@router.put("/youtube")
async def update_youtube(
    body: YoutubeConfigBody,
    user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
    config: Config = Depends(get_config),
) -> dict[str, Any]:
    """Update the youtube-source plugin config at runtime and persist it in the DB."""
    _require_superadmin(user)

    admin = LavalinkAdmin(config)
    stored = await db.get_system_setting(YT_TOKEN_KEY) or {}

    if body.refresh_token:
        stored["refresh_token"] = body.refresh_token.strip()
    if body.po_token and not body.visitor_data:
        raise HTTPException(status_code=400, detail="visitor_data is required together with po_token")
    if body.visitor_data and not body.po_token:
        raise HTTPException(status_code=400, detail="po_token is required together with visitor_data")
    if body.po_token and body.visitor_data:
        stored["po_token"] = body.po_token.strip()
        stored["visitor_data"] = body.visitor_data.strip()

    try:
        await admin.update_youtube_config(
            refresh_token=stored.get("refresh_token", "x"),
            skip_initialization=False,
            po_token=stored.get("po_token", ""),
            visitor_data=stored.get("visitor_data", ""),
        )
    except LavalinkAdminError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    await db.set_system_setting(YT_TOKEN_KEY, stored)
    await db.audit("admin.update_youtube_config", actor_id=user.discord_id, actor_kind="web")

    raw = await admin.get_youtube_config()
    return {
        "oauth_configured": bool(raw.get("refreshToken")),
        "refresh_token_masked": LavalinkAdmin.mask_token(raw.get("refreshToken")),
        "pot_saved": bool(stored.get("po_token")),
    }


@router.delete("/youtube/pot")
async def clear_pot(
    user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
    config: Config = Depends(get_config),
) -> dict[str, Any]:
    """Remove the stored POT values. They stay active until Lavalink restarts."""
    _require_superadmin(user)
    stored = await db.get_system_setting(YT_TOKEN_KEY) or {}
    stored.pop("po_token", None)
    stored.pop("visitor_data", None)
    await db.set_system_setting(YT_TOKEN_KEY, stored)
    return {"cleared": True}


@router.delete("/youtube/last-error")
async def clear_last_error(
    user: CurrentUser = Depends(get_current_user),
    music: MusicService = Depends(get_music),
) -> dict[str, Any]:
    _require_superadmin(user)
    music.last_error = None
    return {"cleared": True}
