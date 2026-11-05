"""The "add tracks from platform pages" userscript: distribution endpoint
and its API-key-authenticated helpers.

The script is served with placeholder substitution so it always points at
this very deployment (install + auto-update in one click from the panel).
Tampermonkey polls @updateURL and reinstalls on version bumps.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import TYPE_CHECKING, Any

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
EXTENSION_VERSION = "1.1.9"

router = APIRouter(tags=["extension"])


@router.get("/extension/queue.user.js", include_in_schema=False)
async def userscript(config: Config = Depends(get_config)) -> Response:
    try:
        template = SCRIPT_PATH.read_text(encoding="utf-8")
    except OSError:
        raise HTTPException(status_code=404, detail="Userscript template is missing") from None
    # The script's @connect is a wildcard: the user may reach the bot under
    # any name (IP, DDNS host, reverse proxy), so per-base_url matching
    # would only cause Tampermonkey-side blocks.
    script = template.replace("@@VERSION@@", EXTENSION_VERSION).replace(
        "@@SERVER@@", config.base_url.rstrip("/")
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


logger = logging.getLogger(__name__)


async def _skip_autoplay_radio(guild_id: int, music: MusicService) -> None:
    """When the autoplay radio occupies the queue, everything queued behind
    its endless stream waits for hours. The userscript has no visible queue,
    so a queued playlist would look lost — skip the radio instead. A plain
    single track already replaces the radio on its own (idle start)."""
    current = music.current_items.get(guild_id)
    if current is None or not current.is_autoplay:
        return
    try:
        await music.play_next(guild_id, reason="extension-queued")
    except Exception:  # noqa: BLE001 - the skip is cosmetic, never fail the enqueue
        logger.exception("Failed to skip the autoplay radio for guild %s", guild_id)


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
    the panel one, except playlists: the script has no preview UI, so a
    playlist URL queues the whole thing right away (the panel's "Add all")."""
    # One log line per attempt: the userscript's requests decide whether a
    # failure is client-side (the line is absent) or server-side (present).
    logger.info(
        "EXT queue: guild=%s source=%s q=%r stream=%s user=%s",
        guild_id, body.source, body.query[:80], bool(body.stream_url), user.discord_id,
    )
    await _ensure_voice(guild_id, user, music, db, bot)
    if not body.encoded and music.looks_like_playlist(body.query, body.source):
        try:
            session = await music.open_playlist(body.query, body.source)
        except MusicServiceError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        try:
            result = await music.queue_entire_playlist(
                guild_id, session.id, user.discord_id, user.global_name
            )
        except MusicServiceError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        await db.audit(
            "music.enqueue",
            guild_id=guild_id,
            actor_id=user.discord_id,
            actor_kind="web",
            details={"query": body.query, "via": "extension", "add_all": True},
        )
        await _skip_autoplay_radio(guild_id, music)
        return result
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
    await _skip_autoplay_radio(guild_id, music)
    return result
