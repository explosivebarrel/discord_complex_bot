"""The "add tracks from platform pages" userscript: distribution endpoint
and its API-key-authenticated helpers.

The script is served with placeholder substitution so it always points at
this very deployment (install + auto-update in one click from the panel).
Tampermonkey polls @updateURL and reinstalls on version bumps.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from app.api.deps import (
    CurrentUser,
    get_api_user,
    get_bot,
    get_config,
    get_db,
    get_music,
    require_guild_member_key,
)
from app.api.routers.player import EnqueueBody, _ensure_voice
from app.core.config import Config
from app.core.services.music import MusicServiceError

if TYPE_CHECKING:
    from app.bot.client import ComplexBot
    from app.core.db import Database
    from app.core.services.music import MusicService

SCRIPT_PATH = Path(__file__).resolve().parents[2] / "extension" / "queue.user.js"
EXTENSION_VERSION = "1.0.0"

router = APIRouter(tags=["extension"])


@router.get("/extension/queue.user.js", include_in_schema=False)
async def userscript(config: Config = Depends(get_config)) -> Response:
    try:
        template = SCRIPT_PATH.read_text(encoding="utf-8")
    except OSError:
        raise HTTPException(status_code=404, detail="Userscript template is missing") from None
    host = urlparse(config.base_url).netloc
    script = (
        template.replace("@@VERSION@@", EXTENSION_VERSION)
        .replace("@@SERVER@@", config.base_url.rstrip("/"))
        .replace("@@CONNECT@@", host)
    )
    return Response(
        content=script,
        media_type="text/javascript; charset=utf-8",
        headers={"Cache-Control": "no-cache"},
    )


@router.get("/api/my/guilds")
async def my_guilds_keyed(
    user: CurrentUser = Depends(get_api_user),
    bot: ComplexBot = Depends(get_bot),
) -> list[dict[str, Any]]:
    """Guilds where both the user and the bot are, for the userscript's
    guild picker. Bot-side membership only — an API key has no Discord
    OAuth tokens for the @me/guilds lookup."""
    items = []
    for guild in sorted(bot.guilds, key=lambda g: g.name.lower()):
        if guild.get_member(user.discord_id) is None:
            continue
        items.append({
            "id": str(guild.id),
            "name": guild.name,
            "icon": guild.icon.key if guild.icon else None,
        })
    return items


@router.post("/api/extension/queue/{guild_id}")
async def extension_queue(
    guild_id: int,
    body: EnqueueBody,
    user: CurrentUser = Depends(require_guild_member_key),
    music: MusicService = Depends(get_music),
    db: Database = Depends(get_db),
    bot: ComplexBot = Depends(get_bot),
) -> dict[str, Any]:
    """The userscript's enqueue endpoint (API key auth). Same semantics as
    the panel one: playlist URLs open a preview session, tracks queue."""
    await _ensure_voice(guild_id, user, music, db, bot)
    if not body.encoded and music.looks_like_playlist(body.query, body.source):
        try:
            session = await music.open_playlist(body.query, body.source)
        except MusicServiceError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        await db.audit(
            "music.enqueue",
            guild_id=guild_id,
            actor_id=user.discord_id,
            actor_kind="web",
            details={"query": body.query, "via": "extension", "preview": True},
        )
        return {
            "preview": music.playlist_page(session.id, 0),
            "queued": 0,
            "title": session.title,
            "now_playing": False,
        }
    try:
        result = await music.enqueue(
            guild_id,
            body.query,
            user.discord_id,
            user.global_name,
            encoded=body.encoded,
            source=body.source,
            meta={
                "title": body.title,
                "author": body.author,
                "length_ms": body.length_ms,
                "artwork": body.artwork,
            },
            stream_url=body.stream_url,
        )
    except MusicServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await db.audit(
        "music.enqueue",
        guild_id=guild_id,
        actor_id=user.discord_id,
        actor_kind="web",
        details={"query": body.query, "via": "extension"},
    )
    return result
