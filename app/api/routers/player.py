from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator

from app.api.deps import CurrentUser, get_bot, get_db, get_music, require_guild_member
from app.core.db import Database
from app.core.services.extern_search import ExternalSearchError, archive_search, radio_search
from app.core.services.music import MusicService, MusicServiceError

if TYPE_CHECKING:
    from app.bot.client import ComplexBot

router = APIRouter(prefix="/api/guilds/{guild_id}/player", tags=["player"])


class JoinBody(BaseModel):
    channel_id: int


class EnqueueBody(BaseModel):
    # Either a search query or the encoded track from a previous search result.
    query: str = ""
    encoded: str | None = None
    source: str = "yt"
    # Page metadata for pending (lazy) queue items; optional.
    title: str | None = None
    author: str | None = None
    length_ms: int | None = None
    artwork: str | None = None

    @model_validator(mode="after")
    def check_query_or_encoded(self) -> EnqueueBody:
        if not self.query and not self.encoded:
            raise ValueError("Provide a query or an encoded track")
        return self


class VolumeBody(BaseModel):
    volume: int


class SeekBody(BaseModel):
    position: int  # milliseconds


class RepeatBody(BaseModel):
    mode: str  # off | one | all


class MoveBody(BaseModel):
    from_index: int = Field(alias="from")
    to_index: int = Field(alias="to")


@router.get("/state")
async def player_state(
    guild_id: int,
    user: CurrentUser = Depends(require_guild_member),
    music: MusicService = Depends(get_music),
) -> dict[str, Any]:
    return music.get_state(guild_id)


@router.get("/channels")
async def voice_channels(
    guild_id: int,
    user: CurrentUser = Depends(require_guild_member),
    bot: ComplexBot = Depends(get_bot),
) -> list[dict[str, Any]]:
    guild = bot.get_guild(guild_id)
    if guild is None:
        raise HTTPException(status_code=404, detail="Bot is not on this server")
    return [{"id": str(ch.id), "name": ch.name, "user_limit": ch.user_limit} for ch in guild.voice_channels]


@router.post("/join")
async def join(
    guild_id: int,
    body: JoinBody,
    user: CurrentUser = Depends(require_guild_member),
    music: MusicService = Depends(get_music),
) -> dict[str, Any]:
    try:
        player = await music.connect(guild_id, body.channel_id, user.discord_id)
    except MusicServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"connected": True, "channel_id": player.channel.id if player.channel else None}


@router.post("/leave")
async def leave(
    guild_id: int,
    user: CurrentUser = Depends(require_guild_member),
    music: MusicService = Depends(get_music),
) -> dict[str, Any]:
    await music.disconnect(guild_id)
    return {"connected": False}


@router.get("/search")
async def search(
    guild_id: int,
    q: str,
    source: str = "yt",
    user: CurrentUser = Depends(require_guild_member),
    music: MusicService = Depends(get_music),
) -> list[dict[str, Any]]:
    if source == "radio":
        try:
            return await radio_search(q)
        except ExternalSearchError as exc:
            raise HTTPException(status_code=502, detail=f"Radio search failed: {exc}") from exc
    if source == "archive":
        try:
            return await archive_search(q)
        except ExternalSearchError as exc:
            raise HTTPException(status_code=502, detail=f"Archive search failed: {exc}") from exc
    if source == "all":
        # One broken source must not fail the whole search.
        found = await asyncio.gather(
            music.search(q, limit=5, source="yt"),
            music.search(q, limit=4, source="sc"),
            music.search(q, limit=4, source="ym"),
            radio_search(q, limit=3),
            archive_search(q, limit=3),
            return_exceptions=True,
        )
        yt_res, sc_res, ym_res, radio_res, arch_res = (r if isinstance(r, list) else [] for r in found)
        # Only yt/sc go through yt-dlp at play time; probe them so the panel
        # can mark HLS-only and DRM tracks before the user queues them.
        to_probe = [r for r in (*yt_res, *sc_res) if r.get("uri")]
        probes = await asyncio.gather(*(music.probe_stream(r["uri"]) for r in to_probe))
        for row, verdict in zip(to_probe, probes):
            if verdict in ("hls", "drm"):
                row["issue"] = verdict
        merged = [*yt_res, *sc_res, *ym_res, *radio_res, *arch_res]
        if not merged:
            raise HTTPException(status_code=502, detail="All sources failed. Try again in a moment.")
        return merged
    return await music.search(q, source=source)


@router.post("/enqueue")
async def enqueue(
    guild_id: int,
    body: EnqueueBody,
    user: CurrentUser = Depends(require_guild_member),
    music: MusicService = Depends(get_music),
    db: Database = Depends(get_db),
    bot: ComplexBot = Depends(get_bot),
) -> dict[str, Any]:
    if music.get_player(guild_id) is None:
        # The bot is not in voice yet. Use the default channel from the guild
        # settings, then the voice channel of the requester.
        settings = await db.get_guild_settings(guild_id)
        channel_id = settings.default_voice_channel_id
        if channel_id is None:
            guild = bot.get_guild(guild_id)
            member = guild.get_member(user.discord_id) if guild else None
            if member is not None and member.voice is not None and member.voice.channel is not None:
                channel_id = member.voice.channel.id
        if channel_id is None:
            raise HTTPException(
                status_code=400,
                detail="Connect the bot to a voice channel first, or set the default channel in settings.",
            )
        try:
            await music.connect(guild_id, channel_id, user.discord_id)
        except MusicServiceError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    try:
        meta = {
            "title": body.title,
            "author": body.author,
            "length_ms": body.length_ms,
            "artwork": body.artwork,
        }
        result = await music.enqueue(
            guild_id,
            body.query,
            user.discord_id,
            user.global_name,
            encoded=body.encoded,
            source=body.source,
            meta=meta,
        )
    except MusicServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await db.audit(
        "music.enqueue",
        guild_id=guild_id,
        actor_id=user.discord_id,
        actor_kind="web",
        details={"query": body.query},
    )
    return result


@router.post("/pause")
async def pause(
    guild_id: int,
    user: CurrentUser = Depends(require_guild_member),
    music: MusicService = Depends(get_music),
) -> dict[str, Any]:
    try:
        await music.set_paused(guild_id, True)
    except MusicServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"paused": True}


@router.post("/resume")
async def resume(
    guild_id: int,
    user: CurrentUser = Depends(require_guild_member),
    music: MusicService = Depends(get_music),
) -> dict[str, Any]:
    try:
        await music.set_paused(guild_id, False)
    except MusicServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"paused": False}


@router.post("/skip")
async def skip(
    guild_id: int,
    user: CurrentUser = Depends(require_guild_member),
    music: MusicService = Depends(get_music),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    try:
        skipped = await music.skip(guild_id, user.discord_id)
    except MusicServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"skipped": skipped}


@router.post("/stop")
async def stop(
    guild_id: int,
    user: CurrentUser = Depends(require_guild_member),
    music: MusicService = Depends(get_music),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    try:
        await music.stop(guild_id, user.discord_id)
    except MusicServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"stopped": True}


@router.post("/volume")
async def volume(
    guild_id: int,
    body: VolumeBody,
    user: CurrentUser = Depends(require_guild_member),
    music: MusicService = Depends(get_music),
) -> dict[str, Any]:
    try:
        applied = await music.set_volume(guild_id, body.volume)
    except MusicServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"volume": applied}


@router.post("/seek")
async def seek(
    guild_id: int,
    body: SeekBody,
    user: CurrentUser = Depends(require_guild_member),
    music: MusicService = Depends(get_music),
) -> dict[str, Any]:
    try:
        await music.seek(guild_id, body.position)
    except MusicServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"position": body.position}


@router.post("/repeat")
async def repeat(
    guild_id: int,
    body: RepeatBody,
    user: CurrentUser = Depends(require_guild_member),
    music: MusicService = Depends(get_music),
) -> dict[str, Any]:
    try:
        mode = music.set_repeat(guild_id, body.mode)
    except MusicServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"repeat": mode}


@router.delete("/queue/{index}")
async def remove_queued(
    guild_id: int,
    index: int,
    user: CurrentUser = Depends(require_guild_member),
    music: MusicService = Depends(get_music),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    try:
        title = music.remove_queued(guild_id, index)
    except MusicServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await db.audit(
        "music.queue_remove", guild_id=guild_id, actor_id=user.discord_id, details={"index": index, "title": title}
    )
    return {"removed": title}


@router.post("/queue/move")
async def move_queued(
    guild_id: int,
    body: MoveBody,
    user: CurrentUser = Depends(require_guild_member),
    music: MusicService = Depends(get_music),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    try:
        title = music.move_queued(guild_id, body.from_index, body.to_index)
    except MusicServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await db.audit(
        "music.queue_move",
        guild_id=guild_id,
        actor_id=user.discord_id,
        details={"from": body.from_index, "to": body.to_index, "title": title},
    )
    return {"moved": title}
