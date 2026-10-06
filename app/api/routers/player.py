from __future__ import annotations

from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import CurrentUser, get_bot, get_db, get_music, require_guild_member
from app.core.db import Database
from app.core.services.music import MusicService, MusicServiceError

if TYPE_CHECKING:
    from app.bot.client import ComplexBot

router = APIRouter(prefix="/api/guilds/{guild_id}/player", tags=["player"])


class JoinBody(BaseModel):
    channel_id: int


class EnqueueBody(BaseModel):
    query: str


class VolumeBody(BaseModel):
    volume: int


class SeekBody(BaseModel):
    position: int  # milliseconds


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
    return [{"id": ch.id, "name": ch.name, "user_limit": ch.user_limit} for ch in guild.voice_channels]


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
    user: CurrentUser = Depends(require_guild_member),
    music: MusicService = Depends(get_music),
) -> list[dict[str, Any]]:
    return await music.search(q)


@router.post("/enqueue")
async def enqueue(
    guild_id: int,
    body: EnqueueBody,
    user: CurrentUser = Depends(require_guild_member),
    music: MusicService = Depends(get_music),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    try:
        result = await music.enqueue(guild_id, body.query, user.discord_id, user.global_name)
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
