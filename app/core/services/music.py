from __future__ import annotations

import asyncio
import json
import logging
from collections import deque
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any
from urllib.parse import urlparse

import discord
import wavelink

from app.core.db import Database

if TYPE_CHECKING:
    from app.core.config import Config

logger = logging.getLogger(__name__)

VOLUME_MIN, VOLUME_MAX = 0, 1000
PLAYLIST_LIMIT = 100


@dataclass
class QueueItem:
    """One queued entry.

    A pending item has no track yet: it keeps the page URL and metadata
    and resolves the direct stream right before playback (playlists can
    add a hundred of these in an instant). A resolved item carries the
    ready Playable.
    """

    track: Any | None
    requested_by_id: int
    requested_by_name: str = field(default="")
    source: str = ""
    pending_url: str = ""
    title: str = ""
    author: str = ""
    length: int = 0
    artwork: str | None = None

    @property
    def display_title(self) -> str:
        return self.title if self.track is None else self.track.title

    def to_dict(self) -> dict[str, Any]:
        if self.track is not None:
            return {
                "title": self.track.title,
                "author": self.track.author,
                "uri": self.track.uri,
                "length": self.track.length,
                "artwork": self.track.artwork,
                "source": self.source or self.track.source,
                "requested_by": self.requested_by_name,
            }
        return {
            "title": self.title or self.pending_url,
            "author": self.author,
            "uri": self.pending_url,
            "length": self.length,
            "artwork": self.artwork,
            "source": self.source,
            "requested_by": self.requested_by_name,
        }


class MusicServiceError(Exception):
    """Error in music control. Show the message text to the user."""


class MusicService:
    """Holds the music state for all guilds. The slash commands and the web API use this service."""

    def __init__(self, bot: discord.Client, db: Database, config: Config) -> None:
        self.bot = bot
        self.db = db
        self.config = config
        self.queues: dict[int, deque[QueueItem]] = {}
        self.current_items: dict[int, QueueItem] = {}
        # Repeat mode per guild: "off", "one" or "all".
        self.repeat_modes: dict[int, str] = {}
        # Raw Lavalink payloads of recent search results, keyed by encoded track.
        # YouTube blocks re-loading a direct video URL, so the web panel queues
        # tracks from this cache instead of asking Lavalink to load again.
        self.track_cache: dict[str, dict[str, Any]] = {}
        # Last playback failure, shown on the web panel settings page.
        self.last_error: dict[str, Any] | None = None

    # --- helpers ---

    def get_guild(self, guild_id: int) -> discord.Guild | None:
        return self.bot.get_guild(guild_id)

    def get_player(self, guild_id: int) -> wavelink.Player | None:
        guild = self.get_guild(guild_id)
        if guild is None:
            return None
        vc = guild.voice_client
        return vc if isinstance(vc, wavelink.Player) else None

    def _require_player(self, guild_id: int) -> wavelink.Player:
        player = self.get_player(guild_id)
        if player is None:
            raise MusicServiceError("Bot is not connected to a voice channel on this server.")
        return player

    def _queue(self, guild_id: int) -> deque[QueueItem]:
        if guild_id not in self.queues:
            self.queues[guild_id] = deque()
        return self.queues[guild_id]

    # --- connection ---

    async def connect(self, guild_id: int, channel_id: int, requester_id: int) -> wavelink.Player:
        guild = self.get_guild(guild_id)
        if guild is None:
            raise MusicServiceError("Bot is not on this server.")
        channel = guild.get_channel(channel_id)
        if not isinstance(channel, (discord.VoiceChannel, discord.StageChannel)):
            raise MusicServiceError("Voice channel not found.")
        existing = self.get_player(guild_id)
        if existing is not None and existing.channel and existing.channel.id == channel_id:
            return existing
        if existing is not None:
            await self.disconnect(guild_id)
        try:
            player: wavelink.Player = await channel.connect(cls=wavelink.Player, self_deaf=True)
        except discord.ClientException as exc:
            raise MusicServiceError(f"Failed to connect: {exc}") from exc
        await player.set_volume(100)
        await self.db.audit(
            "music.join", guild_id=guild_id, actor_id=requester_id, details={"channel_id": channel_id}
        )
        # The queue may hold tracks that waited for a voice connection.
        if not player.playing:
            await self.play_next(guild_id)
        return player

    async def disconnect(self, guild_id: int) -> None:
        self.queues.pop(guild_id, None)
        player = self.get_player(guild_id)
        if player is not None:
            await player.disconnect()

    # --- playback ---

    @staticmethod
    def _search_source(source: str) -> Any:
        prefixes = {"sc": wavelink.TrackSource.SoundCloud, "ym": "ymsearch"}
        return prefixes.get(source, wavelink.TrackSource.YouTubeMusic)

    async def _search_with_retry(self, query: str, source: str):
        """Run a Lavalink search and retry for the flaky Yandex API.

        api.music.yandex.net intermittently answers with a read timeout on
        pooled connections; a fresh attempt succeeds.
        """
        search_source = self._search_source(source)
        attempts = 3 if source == "ym" else 1
        last_error: Exception | None = None
        for attempt in range(attempts):
            try:
                return await wavelink.Playable.search(query, source=search_source)
            except wavelink.LavalinkLoadException as exc:
                last_error = exc
                if attempt + 1 < attempts:
                    await asyncio.sleep(0.8 * (attempt + 1))
        raise MusicServiceError(
            "The Yandex Music API timed out. Try again in a moment."
            if source == "ym"
            else "Lavalink failed to load tracks. Try again in a moment."
        ) from last_error

    # --- SoundCloud and YouTube via yt-dlp ---
    # Lavaplayer's SoundCloud client_id scraping is broken, and its YouTube
    # clients get a login wall on many networks even with OAuth. yt-dlp handles
    # both sites: the backend runs it for search and stream resolution, Lavalink
    # only plays the resolved direct URL through the plain http source. Note:
    # some ISPs cut TLS connections to soundcloud.com by SNI, so transport
    # failures get retried.

    async def _run_ytdlp(self, args: list[str], attempts: int = 3, label: str = "The site") -> str:
        last_error = ""
        for attempt in range(attempts):
            process = await asyncio.create_subprocess_exec(
                "yt-dlp",
                *args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=60)
            except asyncio.TimeoutError:
                process.kill()
                last_error = "timed out"
                continue
            if process.returncode == 0:
                return stdout.decode(errors="replace")
            last_error = (stderr or b"").decode(errors="replace")
            if "DRM" in last_error:
                raise MusicServiceError(
                    "This track is DRM-protected and cannot be played outside the official app."
                )
            if attempt + 1 < attempts:
                await asyncio.sleep(1.0)
        raise MusicServiceError(
            f"{label} is unreachable from this network right now. Try again later."
            if "SSL" in last_error or "timed out" in last_error or "Unable to download" in last_error
            else f"{label} lookup failed: {last_error.strip()[:200]}"
        )

    async def _ytdlp_search(self, query: str, limit: int, prefix: str, source: str) -> list[dict[str, Any]]:
        label = "SoundCloud" if source == "sc" else "YouTube"
        out = await self._run_ytdlp(
            ["--flat-playlist", "--print-json", "--no-warnings", f"{prefix}{limit}:{query}"], label=label
        )
        tracks: list[dict[str, Any]] = []
        for line in out.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            duration = int((entry.get("duration") or 0) * 1000)
            thumbnails = entry.get("thumbnails") or []
            tracks.append(
                {
                    "title": entry.get("title") or "?",
                    "author": entry.get("uploader") or label,
                    "uri": entry.get("webpage_url") or entry.get("url"),
                    "length": duration,
                    "artwork": thumbnails[-1].get("url") if thumbnails else None,
                    "source": source,
                    "requested_by": "",
                    "encoded": None,
                }
            )
        return tracks

    async def _resolve_stream(self, url: str, label: str) -> dict[str, Any]:
        """Resolve a page URL to a direct http audio stream."""
        out = await self._run_ytdlp(
            ["-f", "bestaudio[protocol^=http]/bestaudio", "--no-warnings", "-J", url], label=label
        )
        out = out.strip()
        try:
            info = json.loads(out)
        except json.JSONDecodeError:
            info = json.loads(out.splitlines()[-1])
        if info.get("_type") == "playlist":
            raise MusicServiceError(f"{label} playlists are not supported. Queue a single track.")
        stream_url = info.get("url")
        if not stream_url:
            raise MusicServiceError(f"No playable stream found for this {label} track.")
        if "m3u8" in str(info.get("protocol", "")) or ".m3u8" in stream_url:
            raise MusicServiceError(
                "This track only provides an HLS stream, which requires the official app."
            )
        return info

    async def probe_stream(self, url: str) -> str:
        """Check a page URL for HLS-only or DRM limits. Returns "ok", "hls",
        "drm" or "error". The resolved stream is thrown away; the queue
        resolves it again on enqueue."""
        try:
            info = await self._resolve_stream(url, "The site")
        except MusicServiceError as exc:
            text = str(exc)
            if "HLS" in text:
                return "hls"
            if "DRM" in text:
                return "drm"
            return "error"
        if "m3u8" in str(info.get("protocol", "")) or ".m3u8" in str(info.get("url", "")):
            return "hls"
        return "ok"

    async def search(self, query: str, limit: int = 10, source: str = "yt") -> list[dict[str, Any]]:
        if source == "sc":
            return await self._ytdlp_search(query, limit, "scsearch", "sc")
        if source == "yt":
            return await self._ytdlp_search(query, limit, "ytsearch", "yt")
        result = await self._search_with_retry(query, source)
        if isinstance(result, wavelink.Playlist):
            tracks = result.tracks[:limit]
        else:
            tracks = result[:limit]
        for t in tracks:
            self.track_cache[t.encoded] = t._raw_data  # noqa: SLF001 - reuse the payload Lavalink already returned
        return [self._track_dict(t) for t in tracks]

    @staticmethod
    def _track_dict(track: wavelink.Playable) -> dict[str, Any]:
        # LavaSrc names its source "yandexmusic"; the panel tag is "ym".
        source = {"yandexmusic": "ym"}.get(track.source, track.source)
        return {
            "title": track.title,
            "author": track.author,
            "uri": track.uri,
            "length": track.length,
            "artwork": track.artwork,
            "source": source,
            "identifier": track.identifier,
            "encoded": track.encoded,
        }

    @staticmethod
    def _detect_source(query: str, source: str) -> str:
        """Pick the source tag from a URL. The panel tag can be stale, for
        example a YouTube link pasted while the Yandex chip is selected."""
        host = (urlparse(query).hostname or "").removeprefix("www.")
        if host in ("youtube.com", "music.youtube.com", "youtu.be"):
            return "yt"
        if host in ("soundcloud.com", "on.soundcloud.com"):
            return "sc"
        if host in ("music.yandex.ru", "music.yandex.com"):
            return "ym"
        if host == "archive.org":
            return "archive"
        return source

    async def enqueue(
        self,
        guild_id: int,
        query: str,
        requester_id: int,
        requester_name: str = "",
        encoded: str | None = None,
        source: str = "yt",
        meta: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Add a search query, a track URL or a whole playlist to the queue.

        yt/sc tracks from the panel arrive with metadata and queue as
        pending items; the direct stream resolves right before playback.
        Start playback if the player is idle.
        """
        source = self._detect_source(query, source)
        meta = meta or {}
        items: list[QueueItem] = []
        title = ""

        cached = self.track_cache.get(encoded) if encoded else None
        if cached is not None:
            items = [QueueItem(wavelink.Playable(data=cached), requester_id, requester_name, source=source)]
            title = items[0].display_title
        elif self._is_playlist_url(query) and source in ("yt", "sc", "ym"):
            entries = await self._resolve_playlist(query)
            if not entries:
                raise MusicServiceError("The playlist is empty or cannot be read.")
            entries = entries[:PLAYLIST_LIMIT]
            items = [
                QueueItem(
                    track=None,
                    requested_by_id=requester_id,
                    requested_by_name=requester_name,
                    source=source,
                    pending_url=entry["url"],
                    title=entry["title"],
                    author=entry["author"],
                    length=entry["duration"],
                    artwork=entry["artwork"],
                )
                for entry in entries
            ]
            title = f"Playlist - {len(items)} track(s)"
        elif source in ("yt", "sc") and meta.get("title"):
            # The panel already knows the track metadata; queue lazily.
            items = [
                QueueItem(
                    track=None,
                    requested_by_id=requester_id,
                    requested_by_name=requester_name,
                    source=source,
                    pending_url=query,
                    title=str(meta.get("title") or ""),
                    author=str(meta.get("author") or ""),
                    length=int(meta.get("length_ms") or 0),
                    artwork=meta.get("artwork"),
                )
            ]
            title = items[0].display_title
        elif source in ("yt", "sc"):
            # No metadata (slash command, raw URL): read the page now, so the
            # queue shows a proper title.
            info = await self._resolve_stream(query, "SoundCloud" if source == "sc" else "YouTube")
            items = [
                QueueItem(
                    track=None,
                    requested_by_id=requester_id,
                    requested_by_name=requester_name,
                    source=source,
                    pending_url=info.get("webpage_url") or query,
                    title=str(info.get("title") or "?"),
                    author=str(info.get("uploader") or info.get("channel") or ""),
                    length=int(info.get("duration") or 0) * 1000,
                    artwork=info.get("thumbnail"),
                )
            ]
            title = items[0].display_title
        else:
            result = await self._search_with_retry(query, source)
            if isinstance(result, wavelink.Playlist):
                tracks = list(result.tracks)
                title = result.name
            elif isinstance(result, list):
                tracks = list(result[:1])
                title = tracks[0].title if tracks else ""
            else:
                raise MusicServiceError("Nothing found for this query.")
            items = [QueueItem(t, requester_id, requester_name, source=source) for t in tracks]
        if not items:
            raise MusicServiceError("Nothing found for this query.")

        queue = self._queue(guild_id)
        player = self.get_player(guild_id)
        now_playing = False
        if player is not None and not player.playing and not queue:
            first = items.pop(0)
            queue.extend(items)
            self.current_items[guild_id] = first
            await self._play_item(guild_id, first)
            now_playing = True
        else:
            queue.extend(items)
        return {
            "queued": len(items),
            "title": title,
            "now_playing": now_playing,
        }

    @staticmethod
    def _is_playlist_url(query: str) -> bool:
        q = query.lower()
        if "youtube.com/playlist" in q or "music.youtube.com/playlist" in q:
            return True
        if "youtube.com/watch" in q or "youtu.be/" in q:
            return "list=" in q
        if "soundcloud.com" in q:
            return "/sets/" in q
        if "music.yandex.ru" in q or "music.yandex.com" in q:
            return "/playlists/" in q
        return False

    async def _resolve_playlist(self, query: str) -> list[dict[str, Any]]:
        """Read a playlist page with yt-dlp and return flat track metadata."""
        out = await self._run_ytdlp(["--flat-playlist", "--no-warnings", "-J", query], label="The playlist")
        info = json.loads(out.strip())
        tracks: list[dict[str, Any]] = []
        for entry in info.get("entries") or []:
            url = entry.get("url") or entry.get("webpage_url")
            if not url:
                continue
            thumbnails = entry.get("thumbnails") or []
            tracks.append(
                {
                    "title": entry.get("title") or "?",
                    "author": entry.get("uploader") or entry.get("channel") or "",
                    "url": url,
                    "duration": int((entry.get("duration") or 0) * 1000),
                    "artwork": thumbnails[-1].get("url") if thumbnails else None,
                }
            )
        return tracks

    async def _resolve_item(self, item: QueueItem) -> wavelink.Playable:
        """Turn a pending item into a playable track right before playing."""
        if item.track is not None:
            return item.track
        if item.source in ("yt", "sc"):
            label = "SoundCloud" if item.source == "sc" else "YouTube"
            track = None
            info: dict[str, Any] = {}
            # A fresh resolve now and then fails to load; retry once.
            for attempt in range(2):
                info = await self._resolve_stream(item.pending_url, label)
                try:
                    loaded = await wavelink.Playable.search(info["url"])
                except wavelink.LavalinkLoadException:
                    loaded = None
                if loaded and not isinstance(loaded, wavelink.Playlist):
                    track = loaded[0]
                    break
                if attempt + 1 < 2:
                    await asyncio.sleep(1.0)
            if track is None:
                raise MusicServiceError(f"Could not load the {label} stream. Try again in a moment.")
            track._title = str(info.get("title") or item.title or track.title)  # noqa: SLF001 - Lavalink only sees the CDN filename
            track._author = str(info.get("uploader") or info.get("channel") or item.author or track.author)  # noqa: SLF001
            if info.get("thumbnail"):
                track._artwork = info["thumbnail"]  # noqa: SLF001
            elif item.artwork:
                track._artwork = item.artwork  # noqa: SLF001
            return track
        loaded = await wavelink.Playable.search(item.pending_url)
        if isinstance(loaded, wavelink.Playlist) or not loaded:
            raise MusicServiceError("Could not load the stream.")
        return loaded[0]

    async def _play_item(self, guild_id: int, item: QueueItem) -> None:
        player = self.get_player(guild_id)
        if player is None:
            raise MusicServiceError("Bot is not connected to a voice channel.")
        track = await self._resolve_item(item)
        item.track = track
        await player.play(track)
        await self._record_history(guild_id, item)

    def record_error(self, message: str, context: dict[str, Any] | None = None) -> None:
        import datetime as _dt

        self.last_error = {
            "message": message[:500],
            "context": context or {},
            "at": _dt.datetime.now(_dt.timezone.utc).isoformat(),
        }

    async def play_next(self, guild_id: int, reason: str = "finished") -> wavelink.Playable | None:
        queue = self._queue(guild_id)
        player = self.get_player(guild_id)
        if player is None:
            return None
        current = self.current_items.get(guild_id)
        if reason == "finished" and self.repeat_modes.get(guild_id) == "one" and current is not None:
            # Replay the same track; the queue stays as it is. An explicit
            # skip ("stopped") still moves to the next track.
            await player.play(current.track)
            await self._record_history(guild_id, current)
            return current.track
        if current is not None and self.repeat_modes.get(guild_id) == "all":
            # Cycle the finished track to the end so the queue keeps rotating.
            queue.append(current)
        if not queue:
            self.current_items.pop(guild_id, None)
            return None
        item = queue.popleft()
        self.current_items[guild_id] = item
        try:
            track = await self._resolve_item(item)
        except MusicServiceError as exc:
            # A dead entry must not stop the queue; report it and move on.
            self.record_error(str(exc), {"guild_id": guild_id, "title": item.display_title})
            return await self.play_next(guild_id, reason)
        item.track = track
        await player.play(track)
        await self._record_history(guild_id, item)
        return track

    async def _record_history(self, guild_id: int, item: QueueItem) -> None:
        # One row per play start. Stats must never break playback.
        try:
            await self.db.add_play_history(
                guild_id,
                title=item.track.title,
                author=item.track.author or "",
                uri=item.track.uri or "",
                source=item.source or item.track.source,
                length_ms=item.track.length or 0,
                requested_by_id=item.requested_by_id,
                requested_by_name=item.requested_by_name,
            )
        except Exception:  # noqa: BLE001
            logger.exception("Failed to record play history for guild %s", guild_id)

    def set_repeat(self, guild_id: int, mode: str) -> str:
        if mode not in ("off", "one", "all"):
            raise MusicServiceError("Repeat mode must be off, one or all.")
        self.repeat_modes[guild_id] = mode
        return mode

    def remove_queued(self, guild_id: int, index: int) -> str:
        queue = self._queue(guild_id)
        if index < 0 or index >= len(queue):
            raise MusicServiceError("That queue position does not exist.")
        item = queue[index]
        del queue[index]
        return item.display_title

    def move_queued(self, guild_id: int, from_index: int, to_index: int) -> str:
        queue = self._queue(guild_id)
        if not (0 <= from_index < len(queue)) or not (0 <= to_index < len(queue)):
            raise MusicServiceError("That queue position does not exist.")
        item = queue[from_index]
        del queue[from_index]
        queue.insert(to_index, item)
        return item.display_title

    async def skip(self, guild_id: int, requester_id: int) -> bool:
        player = self._require_player(guild_id)
        if not player.playing:
            return False
        await player.stop()  # The TrackEnd listener starts the next queued item.
        await self.db.audit("music.skip", guild_id=guild_id, actor_id=requester_id)
        return True

    async def stop(self, guild_id: int, requester_id: int) -> None:
        player = self._require_player(guild_id)
        self.queues.pop(guild_id, None)
        self.current_items.pop(guild_id, None)
        await player.stop()
        await self.db.audit("music.stop", guild_id=guild_id, actor_id=requester_id)

    async def set_paused(self, guild_id: int, paused: bool) -> None:
        player = self._require_player(guild_id)
        if player.playing:
            await player.pause(paused)

    async def set_volume(self, guild_id: int, volume: int) -> int:
        volume = max(VOLUME_MIN, min(VOLUME_MAX, volume))
        player = self._require_player(guild_id)
        await player.set_volume(volume)
        return volume

    async def seek(self, guild_id: int, position_ms: int) -> None:
        player = self._require_player(guild_id)
        if player.playing:
            await player.seek(max(0, position_ms))

    # --- state for web UI ---

    def get_state(self, guild_id: int) -> dict[str, Any]:
        player = self.get_player(guild_id)
        queue = self._queue(guild_id)
        guild = self.get_guild(guild_id)
        current = None
        if player is not None and player.current is not None:
            item = self.current_items.get(guild_id)
            if item is None or item.track.identifier != player.current.identifier:
                item = QueueItem(player.current, 0, "")
            current = item.to_dict()
            current["position"] = player.position
            current["paused"] = player.paused
        return {
            "guild_id": str(guild_id),
            "guild_name": guild.name if guild else None,
            "connected": player is not None,
            "channel_id": str(player.channel.id) if player is not None and player.channel else None,
            "channel_name": player.channel.name if player is not None and player.channel else None,
            "volume": player.volume if player is not None else 100,
            "playing": bool(player is not None and player.playing),
            "repeat": self.repeat_modes.get(guild_id, "off"),
            "current": current,
            "queue": [item.to_dict() for item in queue],
        }
