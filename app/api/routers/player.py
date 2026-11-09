from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import random
from datetime import timedelta
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, WebSocket
from pydantic import BaseModel, Field, model_validator

from app.api.deps import (
    SESSION_COOKIE,
    CurrentUser,
    get_current_user,
    get_bot,
    get_config,
    get_db,
    get_music,
    get_oauth,
    ensure_player_access,
    is_admin_tier,
    require_guild_member,
)
from app.core.config import Config
from app.core.db import Database
from app.core.db.models import utcnow
from app.core.services.extern_search import ExternalSearchError, archive_search, radio_search
from app.core.services.library import (
    FileTooLargeError,
    delete_upload_path,
    list_guild_uploads,
    save_upload,
    search_local_for_guild,
)
from app.core.services.music import MusicService, MusicServiceError, QueueItem

if TYPE_CHECKING:
    from app.api.discord_oauth import DiscordOAuthClient
    from app.bot.client import ComplexBot

router = APIRouter(prefix="/api/guilds/{guild_id}/player", tags=["player"])

# App-level routes (no guild prefix) served from the same module.
root_router = APIRouter(tags=["player"])


@root_router.get("/api/notifications")
async def list_notifications(
    limit: int = 30,
    user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> list[dict[str, Any]]:
    """Recent panel notifications for the initial bell list after a reload."""
    return await db.list_notifications(min(max(limit, 1), 100))


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
    # VK userscript capture: the signed CDN stream URL taken off the page;
    # plays without any server-side VK token.
    stream_url: str | None = None
    # "Play next": insert at the queue head instead of the tail.
    play_next: bool = False

    @model_validator(mode="after")
    def check_query_or_encoded(self) -> EnqueueBody:
        if not self.query and not self.encoded and not self.stream_url:
            raise ValueError("Provide a query, a stream URL or an encoded track")
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


class JumpBody(BaseModel):
    index: int


class ReplayBody(BaseModel):
    position: int


class PlaylistAddBody(BaseModel):
    indices: list[int]


class PlaylistPlayBody(BaseModel):
    index: int


class UserPlaylistPlayBody(BaseModel):
    index: int


@router.get("/state")
async def player_state(
    guild_id: int,
    user: CurrentUser = Depends(require_guild_member),
    music: MusicService = Depends(get_music),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    state = await music.get_state(guild_id)
    # The panel preselects this channel while the bot is not in voice.
    settings = await db.get_guild_settings(guild_id)
    state["default_voice_channel_id"] = (
        str(settings.default_voice_channel_id) if settings.default_voice_channel_id is not None else None
    )
    return state


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


def _hash_state(state: dict[str, Any]) -> str:
    """A change signature that ignores the playhead: the client interpolates
    the position locally, so it must not force a push every tick."""
    trimmed = {**state, "current": {**state["current"], "position": 0} if state.get("current") else None}
    return hashlib.sha1(json.dumps(trimmed, sort_keys=True, default=str).encode()).hexdigest()


@router.websocket("/ws")
async def player_ws(websocket: WebSocket, guild_id: int) -> None:
    """Live player state + notifications for the panel.

    Auth: the session cookie from the handshake; membership via the bot's
    own member cache (no Discord API calls per connection). State snapshots
    are pushed by the background broadcaster only when something besides
    the playhead changes.
    """
    import json as _json

    from app.api.deps import hash_token
    from app.core.db.models import WebSession
    from app.core.db.models import utcnow as _utcnow
    from app.core.services.ws_hub import get_hub

    app = websocket.app
    db: Database = app.state.db
    music = app.state.music
    bot = app.state.bot
    token = websocket.cookies.get(SESSION_COOKIE)
    user_id: int | None = None
    is_superadmin = False
    if token:
        async with db.session_factory() as session:
            row = await session.get(WebSession, hash_token(token))
        if row is not None and not row.revoked and (row.expires_at is None or row.expires_at >= _utcnow()):
            user_id = row.discord_id
            is_superadmin = user_id in app.state.config.superadmin_ids
    if user_id is None:
        await websocket.close(code=4401)
        return
    guild = bot.get_guild(guild_id)
    if guild is not None and guild.get_member(user_id) is None and not is_superadmin:
        await websocket.close(code=4403)
        return

    await websocket.accept()
    hub = get_hub(app)
    await hub.connect(guild_id, websocket)
    try:
        await websocket.send_json({"type": "state", "state": await music.get_state(guild_id)})
        while True:
            # The client only pings; any text keeps the socket alive.
            await websocket.receive_text()
    except Exception:  # noqa: BLE001 - disconnects are the normal exit
        pass
    finally:
        await hub.disconnect(guild_id, websocket)


async def _run_search(
    q: str, source: str, guild_id: int, music: MusicService, config: Config, performer: bool = False
) -> list[dict[str, Any]]:
    """The uncached search dispatch shared by the panel endpoint."""
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
    if source == "local":
        # TrackInfo-compatible rows: the panel Queue button enqueues
        # {query: uri, source: "local"} against MusicService.enqueue.
        rows = search_local_for_guild(config, guild_id, q, performer=performer)
        for row in rows:
            row.update({
                "title": row["name"],
                "author": row.get("artist") or "local",
                "uri": row["path"],
                "source": "local",
            })
        return rows
    if source == "all":
        # One broken source must not fail the whole search.
        found = await asyncio.gather(
            music.search(q, limit=5, source="yt", performer=performer),
            music.search(q, limit=4, source="sc", performer=performer),
            music.search(q, limit=4, source="ym", performer=performer),
            music.search(q, limit=4, source="vk", performer=performer),
            radio_search(q, limit=3),
            archive_search(q, limit=3),
            return_exceptions=True,
        )
        rows = (r if isinstance(r, list) else [] for r in found)
        yt_res, sc_res, ym_res, vk_res, radio_res, arch_res = rows
        if performer:
            # The archive rows come unfiltered from their own search.
            needle = q.strip().casefold()
            arch_res = [r for r in arch_res if music._author_matches(r, needle)]  # noqa: SLF001
        # Only yt/sc go through yt-dlp at play time; probe them so the panel
        # can mark HLS-only and DRM tracks before the user queues them.
        to_probe = [r for r in (*yt_res, *sc_res) if r.get("uri")]
        probes = await asyncio.gather(*(music.probe_stream(r["uri"]) for r in to_probe))
        for row, verdict in zip(to_probe, probes):
            if verdict in ("hls", "drm"):
                row["issue"] = verdict
        merged = [*yt_res, *sc_res, *ym_res, *vk_res, *arch_res]
        if not performer:
            merged = [*merged, *radio_res]
        if not merged:
            raise HTTPException(status_code=502, detail="All sources failed. Try again in a moment.")
        return merged
    try:
        return await music.search(q, source=source, performer=performer)
    except MusicServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _search_cache_key(source: str, guild_id: int, q: str, performer: bool = False) -> str:
    norm = " ".join(q.split()).casefold()
    mode = "artist" if performer else "title"
    return hashlib.sha1(f"{source}|{mode}|{guild_id}|{norm}".encode()).hexdigest()


SEARCH_FRESH_TTL = timedelta(minutes=30)
SEARCH_STALE_TTL = timedelta(hours=24)

logger = logging.getLogger(__name__)


@router.get("/search")
async def search(
    guild_id: int,
    q: str,
    source: str = "yt",
    fresh: bool = False,
    performer: bool = False,
    user: CurrentUser = Depends(require_guild_member),
    music: MusicService = Depends(get_music),
    config: Config = Depends(get_config),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    """Search with a stale-while-revalidate cache: results up to 30 minutes
    old come back instantly, older ones (up to a day) come back at once
    with cache="stale" while the client re-requests with fresh=true.
    performer=True is the artist mode: only rows whose author matches."""
    key = _search_cache_key(source, guild_id, q, performer)
    if not fresh:
        cached = await db.get_search_cache(key)
        if cached is not None:
            age = utcnow() - cached["created_at"]
            if age <= SEARCH_FRESH_TTL:
                return {"results": cached["payload"], "cache": "fresh"}
            if age <= SEARCH_STALE_TTL:
                return {"results": cached["payload"], "cache": "stale"}
    results = await _run_search(q, source, guild_id, music, config, performer)
    try:
        await db.upsert_search_cache(key, results)
        await db.prune_search_cache(utcnow() - SEARCH_STALE_TTL)
    except Exception:  # noqa: BLE001
        logger.exception("Failed to store search cache for guild %s", guild_id)
    return {"results": results, "cache": "miss"}


@router.post("/uploads")
async def create_upload(
    guild_id: int,
    request: Request,
    file: UploadFile = File(...),
    user: CurrentUser = Depends(require_guild_member),
    config: Config = Depends(get_config),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    """Any member may upload audio for this guild (<= max_upload_mb each)."""
    # Cheap rejection before the multipart body is even read.
    content_length = request.headers.get("content-length")
    limit_bytes = (config.max_upload_mb + 1) * 1024 * 1024
    if content_length and content_length.isdigit() and int(content_length) > limit_bytes:
        raise HTTPException(status_code=413, detail=f"The file is larger than {config.max_upload_mb} MB")
    try:
        row = save_upload(config, guild_id, user.discord_id, file.filename or "", file.file)
    except FileTooLargeError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        await file.close()
    await db.audit(
        "library.upload",
        guild_id=guild_id,
        actor_id=user.discord_id,
        actor_kind="web",
        details={"path": row["path"], "size_mb": row["size_mb"]},
    )
    return row


@router.get("/uploads")
async def get_uploads(
    guild_id: int,
    user: CurrentUser = Depends(require_guild_member),
    config: Config = Depends(get_config),
) -> list[dict[str, Any]]:
    """This guild's uploads, newest first; the uploader id marks own files."""
    return list_guild_uploads(config, guild_id)


@router.delete("/uploads/{rel_path:path}")
async def remove_upload(
    guild_id: int,
    rel_path: str,
    user: CurrentUser = Depends(require_guild_member),
    config: Config = Depends(get_config),
    bot: ComplexBot = Depends(get_bot),
    db: Database = Depends(get_db),
    oauth: DiscordOAuthClient = Depends(get_oauth),
) -> dict[str, Any]:
    """The uploader may remove the file; the server's admin tier — any of them."""
    target = delete_upload_path(config, guild_id, rel_path)
    if target is None:
        raise HTTPException(status_code=404, detail="Upload not found")
    uploader = target.name.split("-", 1)[0]
    # is_admin_tier is mock-aware: an unmocked super-admin passes it, a
    # mocked one gets exactly the pretended tier.
    if not (uploader == str(user.discord_id) or await is_admin_tier(guild_id, user, oauth, bot, db)):
        raise HTTPException(status_code=403, detail="You can delete only your own uploads")
    target.unlink()
    await db.audit(
        "library.delete",
        guild_id=guild_id,
        actor_id=user.discord_id,
        actor_kind="web",
        details={"path": rel_path},
    )
    return {"deleted": rel_path}


async def _ensure_voice(
    guild_id: int, user: CurrentUser, music: MusicService, db: Database, bot: ComplexBot
) -> None:
    """Connect the bot to voice before an enqueue if it is not in one yet."""
    if music.get_player(guild_id) is not None:
        return
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


@router.post("/enqueue")
async def enqueue(
    guild_id: int,
    body: EnqueueBody,
    user: CurrentUser = Depends(require_guild_member),
    music: MusicService = Depends(get_music),
    db: Database = Depends(get_db),
    bot: ComplexBot = Depends(get_bot),
) -> dict[str, Any]:
    await _ensure_voice(guild_id, user, music, db, bot)
    if not body.encoded and music.looks_like_playlist(body.query, body.source):
        # The panel opens a playlist preview instead of dumping the tracks
        # into the queue; the Discord slash command keeps the old behavior.
        try:
            session = await music.open_playlist(body.query, body.source)
        except MusicServiceError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        await db.audit(
            "music.enqueue",
            guild_id=guild_id,
            actor_id=user.discord_id,
            actor_kind="web",
            details={"query": body.query, "preview": True},
        )
        return {
            "preview": music.playlist_page(session.id, 0),
            "queued": 0,
            "title": session.title,
            "now_playing": False,
        }
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
            stream_url=body.stream_url,
            play_next=body.play_next,
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
        result = await music.request_skip(guild_id, user.discord_id)
    except MusicServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return result


@router.post("/stop")
async def stop(
    guild_id: int,
    user: CurrentUser = Depends(require_guild_member),
    music: MusicService = Depends(get_music),
    db: Database = Depends(get_db),
    oauth: DiscordOAuthClient = Depends(get_oauth),
    bot: ComplexBot = Depends(get_bot),
) -> dict[str, Any]:
    await ensure_player_access(guild_id, user, "queue_clear_access", db=db, oauth=oauth, bot=bot)
    try:
        await music.stop(guild_id, user.discord_id)
    except MusicServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"stopped": True}


@router.post("/previous")
async def previous(
    guild_id: int,
    user: CurrentUser = Depends(require_guild_member),
    music: MusicService = Depends(get_music),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    try:
        title = await music.previous(guild_id, user.discord_id, user.global_name)
    except MusicServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"previous": title}


@router.post("/volume")
async def volume(
    guild_id: int,
    body: VolumeBody,
    user: CurrentUser = Depends(require_guild_member),
    music: MusicService = Depends(get_music),
    db: Database = Depends(get_db),
    oauth: DiscordOAuthClient = Depends(get_oauth),
    bot: ComplexBot = Depends(get_bot),
) -> dict[str, Any]:
    await ensure_player_access(guild_id, user, "volume_access", db=db, oauth=oauth, bot=bot)
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
    db: Database = Depends(get_db),
    oauth: DiscordOAuthClient = Depends(get_oauth),
    bot: ComplexBot = Depends(get_bot),
) -> dict[str, Any]:
    await ensure_player_access(guild_id, user, "seek_access", db=db, oauth=oauth, bot=bot)
    try:
        await music.seek(guild_id, body.position)
    except MusicServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"position": body.position}


class SleepBody(BaseModel):
    # null/absent = cancel; 0 = after the current track; otherwise minutes.
    minutes: float | None = None


@router.post("/sleep")
async def sleep(
    guild_id: int,
    body: SleepBody,
    user: CurrentUser = Depends(require_guild_member),
    music: MusicService = Depends(get_music),
    db: Database = Depends(get_db),
    oauth: DiscordOAuthClient = Depends(get_oauth),
    bot: ComplexBot = Depends(get_bot),
) -> dict[str, Any]:
    await ensure_player_access(guild_id, user, "volume_access", db=db, oauth=oauth, bot=bot)
    state = await music.get_state(guild_id)
    if body.minutes is None or body.minutes == 0:
        seconds = None
        if body.minutes == 0 and state.get("current"):
            remaining = (state["current"].get("length") or 0) - (state["current"].get("position") or 0)
            seconds = max(remaining / 1000, 0.0)
    else:
        seconds = body.minutes * 60
    deadline = music.set_sleep(guild_id, seconds)
    return {"sleep_remaining": music.sleep_remaining(guild_id), "deadline": deadline}


@router.get("/lyrics")
async def lyrics(
    guild_id: int,
    user: CurrentUser = Depends(require_guild_member),
    music: MusicService = Depends(get_music),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    state = await music.get_state(guild_id)
    current = state.get("current") or {}
    if not current.get("title"):
        raise HTTPException(status_code=404, detail="Nothing is playing right now")
    from app.core.services.lyrics import fetch_lyrics

    result = await fetch_lyrics(
        db,
        str(current.get("author") or ""),
        str(current.get("title") or ""),
        int((current.get("length") or 0) / 1000),
    )
    if result is None:
        raise HTTPException(status_code=404, detail="No lyrics found for this track")
    return result


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


@router.post("/queue/clear")
async def clear_queue(
    guild_id: int,
    user: CurrentUser = Depends(require_guild_member),
    music: MusicService = Depends(get_music),
    db: Database = Depends(get_db),
    oauth: DiscordOAuthClient = Depends(get_oauth),
    bot: ComplexBot = Depends(get_bot),
) -> dict[str, Any]:
    await ensure_player_access(guild_id, user, "queue_clear_access", db=db, oauth=oauth, bot=bot)
    cleared = music.clear_queue(guild_id)
    await db.audit(
        "music.queue_clear", guild_id=guild_id, actor_id=user.discord_id, details={"cleared": cleared}
    )
    return {"cleared": cleared}


@router.post("/queue/shuffle")
async def shuffle_queue(
    guild_id: int,
    user: CurrentUser = Depends(require_guild_member),
    music: MusicService = Depends(get_music),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    shuffled = music.shuffle_queue(guild_id)
    await db.audit(
        "music.queue_shuffle", guild_id=guild_id, actor_id=user.discord_id, details={"shuffled": shuffled}
    )
    return {"shuffled": shuffled}


class EffectBody(BaseModel):
    name: str


@router.post("/effects")
async def set_effect(
    guild_id: int,
    body: EffectBody,
    user: CurrentUser = Depends(require_guild_member),
    music: MusicService = Depends(get_music),
    db: Database = Depends(get_db),
    oauth: DiscordOAuthClient = Depends(get_oauth),
    bot: ComplexBot = Depends(get_bot),
) -> dict[str, Any]:
    await ensure_player_access(guild_id, user, "effects_access", db=db, oauth=oauth, bot=bot)
    try:
        await music.set_effect(guild_id, body.name)
    except MusicServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"effect": body.name}


@router.post("/queue/jump")
async def jump_queued(
    guild_id: int,
    body: JumpBody,
    user: CurrentUser = Depends(require_guild_member),
    music: MusicService = Depends(get_music),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    try:
        title = await music.jump_to(guild_id, body.index, user.discord_id)
    except MusicServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"jumped": title}


@router.post("/playlist/preview")
async def playlist_preview(
    guild_id: int,
    body: EnqueueBody,
    user: CurrentUser = Depends(require_guild_member),
    music: MusicService = Depends(get_music),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    if not music.looks_like_playlist(body.query, body.source):
        raise HTTPException(status_code=400, detail="That link is not a supported playlist.")
    try:
        session = await music.open_playlist(body.query, body.source)
    except MusicServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        # A dead Lavalink node (e.g. the bot cannot reach Discord) must read
        # as a temporary outage, not a 500.
        raise HTTPException(status_code=503, detail="Lavalink is offline right now. Try again in a moment.") from exc
    await db.audit(
        "music.playlist_preview",
        guild_id=guild_id,
        actor_id=user.discord_id,
        actor_kind="web",
        details={"query": body.query, "total": len(session.entries)},
    )
    return music.playlist_page(session.id, 0)


@router.get("/playlist/{playlist_id}")
async def playlist_page(
    guild_id: int,
    playlist_id: int,
    page: int = 0,
    q: str = "",
    user: CurrentUser = Depends(require_guild_member),
    music: MusicService = Depends(get_music),
) -> dict[str, Any]:
    try:
        return music.playlist_page(playlist_id, page, q)
    except MusicServiceError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/playlist/{playlist_id}/add")
async def playlist_add(
    guild_id: int,
    playlist_id: int,
    body: PlaylistAddBody,
    user: CurrentUser = Depends(require_guild_member),
    music: MusicService = Depends(get_music),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    try:
        added = await music.add_playlist_tracks(
            guild_id, playlist_id, body.indices, user.discord_id, user.global_name
        )
    except MusicServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"added": added}


@router.post("/playlist/{playlist_id}/add_all")
async def playlist_add_all(
    guild_id: int,
    playlist_id: int,
    user: CurrentUser = Depends(require_guild_member),
    music: MusicService = Depends(get_music),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    try:
        result = await music.queue_entire_playlist(guild_id, playlist_id, user.discord_id, user.global_name)
    except MusicServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return result


@router.post("/playlist/{playlist_id}/play")
async def playlist_play(
    guild_id: int,
    playlist_id: int,
    body: PlaylistPlayBody,
    user: CurrentUser = Depends(require_guild_member),
    music: MusicService = Depends(get_music),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    try:
        title = await music.play_playlist_track(
            guild_id, playlist_id, body.index, user.discord_id, user.global_name
        )
    except MusicServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"playing": title}


@router.post("/myplaylist/{playlist_id}/play")
async def play_user_playlist_track(
    guild_id: int,
    playlist_id: int,
    body: UserPlaylistPlayBody,
    user: CurrentUser = Depends(require_guild_member),
    music: MusicService = Depends(get_music),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    playlist = await db.get_user_playlist(user.discord_id, playlist_id)
    if playlist is None:
        raise HTTPException(status_code=404, detail="Playlist not found")
    tracks = playlist["tracks"]
    if body.index < 0 or body.index >= len(tracks):
        raise HTTPException(status_code=400, detail="That playlist position does not exist.")
    row = tracks[body.index]
    item = QueueItem(
        track=None,
        requested_by_id=user.discord_id,
        requested_by_name=user.global_name,
        source=row["source"],
        pending_url=row["uri"],
        title=row["title"],
        author=row["author"],
        length=row["length_ms"],
        artwork=row["artwork"],
    )
    try:
        title = await music.play_pending_now(
            guild_id, item, user.discord_id, {"playlist": playlist["name"], "title": row["title"]}
        )
    except MusicServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"playing": title}


@router.post("/favorites/queue")
async def queue_favorites(
    guild_id: int,
    user: CurrentUser = Depends(require_guild_member),
    music: MusicService = Depends(get_music),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    """Queue every favorite of the user, oldest first; the first track
    starts at once when the bot is connected and idle."""
    favorites = await db.list_favorites(user.discord_id, limit=1000)
    if not favorites:
        raise HTTPException(status_code=400, detail="No favorites yet.")
    items = [
        QueueItem(
            track=None,
            requested_by_id=user.discord_id,
            requested_by_name=user.global_name,
            source=row["source"],
            pending_url=row["uri"],
            title=row["title"],
            author=row["author"],
            length=row["length_ms"],
            artwork=row["artwork"],
        )
        for row in favorites
    ]
    try:
        queued = await music.queue_pending_items(guild_id, items, user.discord_id)
    except MusicServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"queued": queued}


@router.post("/myplaylist/{playlist_id}/queue")
async def queue_user_playlist(
    guild_id: int,
    playlist_id: int,
    shuffle: bool = False,
    user: CurrentUser = Depends(require_guild_member),
    music: MusicService = Depends(get_music),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    playlist = await db.get_user_playlist(user.discord_id, playlist_id)
    if playlist is None:
        raise HTTPException(status_code=404, detail="Playlist not found")
    items = [
        QueueItem(
            track=None,
            requested_by_id=user.discord_id,
            requested_by_name=user.global_name,
            source=row["source"],
            pending_url=row["uri"],
            title=row["title"],
            author=row["author"],
            length=row["length_ms"],
            artwork=row["artwork"],
        )
        for row in playlist["tracks"][:1000]
    ]
    if shuffle:
        random.shuffle(items)
    try:
        queued = await music.queue_pending_items(guild_id, items, user.discord_id)
    except MusicServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"queued": queued}


@router.post("/myplaylist/{playlist_id}/queue/{index}")
async def queue_user_playlist_track(
    guild_id: int,
    playlist_id: int,
    index: int,
    user: CurrentUser = Depends(require_guild_member),
    music: MusicService = Depends(get_music),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    """Queue one track of the user's playlist by its position."""
    playlist = await db.get_user_playlist(user.discord_id, playlist_id)
    if playlist is None:
        raise HTTPException(status_code=404, detail="Playlist not found")
    tracks = playlist["tracks"]
    if index < 0 or index >= len(tracks):
        raise HTTPException(status_code=400, detail="That playlist position does not exist.")
    row = tracks[index]
    item = QueueItem(
        track=None,
        requested_by_id=user.discord_id,
        requested_by_name=user.global_name,
        source=row["source"],
        pending_url=row["uri"],
        title=row["title"],
        author=row["author"],
        length=row["length_ms"],
        artwork=row["artwork"],
    )
    try:
        queued = await music.queue_pending_items(guild_id, [item], user.discord_id)
    except MusicServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"queued": queued}


@router.post("/played/replay")
async def replay_played(
    guild_id: int,
    body: ReplayBody,
    user: CurrentUser = Depends(require_guild_member),
    music: MusicService = Depends(get_music),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    try:
        title = await music.replay_played(guild_id, body.position, user.discord_id, user.global_name)
    except MusicServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"playing": title}


@router.post("/played/requeue")
async def requeue_played(
    guild_id: int,
    body: ReplayBody,
    user: CurrentUser = Depends(require_guild_member),
    music: MusicService = Depends(get_music),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    try:
        title = await music.requeue_played(guild_id, body.position, user.discord_id, user.global_name)
    except MusicServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"queued": title}


@router.post("/queue/{index}/expand")
async def expand_queued_playlist(
    guild_id: int,
    index: int,
    user: CurrentUser = Depends(require_guild_member),
    music: MusicService = Depends(get_music),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    """Splice the next page of a lazy playlist into the queue above the marker."""
    try:
        return await music.expand_queue_playlist(guild_id, index, user.discord_id)
    except MusicServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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
        "music.queue_remove",
        guild_id=guild_id,
        actor_id=user.discord_id,
        details={"index": index, "title": title},
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
