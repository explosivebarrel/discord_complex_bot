from __future__ import annotations

import asyncio
import json
import logging
import random
from collections import deque
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import urlparse

import discord
import wavelink

from app.core.db import Database
from app.core.services.library import library_stream_url

if TYPE_CHECKING:
    from app.core.config import Config

logger = logging.getLogger(__name__)

VOLUME_MIN, VOLUME_MAX = 0, 1000
PLAYLIST_LIMIT = 100
PLAYED_LIMIT = 20
# Playlist browser: server-side pagination and the lazy "add all" window.
PLAYLIST_PAGE_SIZE = 50
PLAYLIST_WINDOW = 100
PLAYLIST_SESSION_TTL = 900.0
PLAYLIST_SESSIONS_MAX = 24


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
    # Autoplay radio items never enter the session history and never block
    # the queue: they are placeholders the real tracks replace at once.
    is_autoplay: bool = False
    # A lazy "load more" marker for a big playlist: (session id, next index).
    # Popping it pulls the next window of the playlist into the queue. The
    # link and source let the panel reopen the playlist after the session
    # expires.
    more_from_playlist: tuple[int, int] | None = None
    playlist_url: str = ""
    playlist_source: str = ""

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
        base = {
            "title": self.title or self.pending_url,
            "author": self.author,
            "uri": self.pending_url,
            "length": self.length,
            "artwork": self.artwork,
            "source": self.source,
            "requested_by": self.requested_by_name,
            "requested_by_id": self.requested_by_id,
        }
        if self.more_from_playlist is not None:
            base["source"] = "playlist"
            base["playlist_id"] = self.more_from_playlist[0]
            base["playlist_next"] = self.more_from_playlist[1]
            base["playlist_url"] = self.playlist_url
            base["playlist_source"] = self.playlist_source
        return base


class MusicServiceError(Exception):
    """Error in music control. Show the message text to the user."""


@dataclass
class PlaylistSession:
    """A cached flat playlist for the panel browser.

    Entries are raw dicts for yt/sc (page URLs, resolved lazily at play time)
    or ready Playables for ym. The session lives in memory for a short while:
    the panel pages through it and bulk-adds from it.
    """

    id: int
    title: str
    source: str
    url: str
    entries: list[Any]
    created: float

    def expired(self) -> bool:
        import time

        return (time.monotonic() - self.created) > PLAYLIST_SESSION_TTL


class MusicService:
    """Holds the music state for all guilds. The slash commands and the web API use this service."""

    def __init__(self, bot: discord.Client, db: Database, config: Config) -> None:
        self.bot = bot
        self.db = db
        self.config = config
        self.queues: dict[int, deque[QueueItem]] = {}
        self.current_items: dict[int, QueueItem] = {}
        # Session history per guild, oldest last. The Previous button and the
        # Recent queue view read from it.
        self.played: dict[int, deque[QueueItem]] = {}
        # Repeat mode per guild: "off", "one" or "all".
        self.repeat_modes: dict[int, str] = {}
        # Raw Lavalink payloads of recent search results, keyed by encoded track.
        # YouTube blocks re-loading a direct video URL, so the web panel queues
        # tracks from this cache instead of asking Lavalink to load again.
        self.track_cache: dict[str, dict[str, Any]] = {}
        # Last playback failure, shown on the web panel settings page.
        self.last_error: dict[str, Any] | None = None
        # Cached flat playlists for the panel browser (PlaylistSession).
        self.playlist_sessions: dict[int, PlaylistSession] = {}
        self._playlist_seq = 0

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

    def _played(self, guild_id: int) -> deque[QueueItem]:
        played = self.played.get(guild_id)
        if played is None:
            played = deque(maxlen=PLAYED_LIMIT)
            self.played[guild_id] = played
        return played

    @staticmethod
    def _for_replay(item: QueueItem) -> QueueItem:
        """Prepare a history entry for another play.

        A resolved yt/sc stream URL expires after a few hours (and live
        streams refuse a second run at once). The page URL still resolves,
        so replay rebuilds the stream from it. Items without a URL (search
        results on other sources, radio) replay their stored track.
        """
        if item.track is not None:
            if not item.pending_url and item.source in ("yt", "sc") and item.track.uri:
                item.pending_url = item.track.uri
            if item.pending_url:
                item.track = None
        return item

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
        except wavelink.ChannelTimeoutException as exc:
            # The voice handshake can time out on a flaky network.
            raise MusicServiceError("The voice channel did not answer in time. Try again.") from exc
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
        self.current_items.pop(guild_id, None)
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
        elif self._is_playlist_url(query) and source == "ym":
            # LavaSrc loads Yandex playlists and albums natively with ready
            # tracks; the yt-dlp extractor only knows single track URLs. The
            # ymsearch prefix must NOT be added: it breaks URL loads.
            result = await self._lavalink_load_with_retry(query)
            tracks = list(getattr(result, "tracks", None) or [])[:PLAYLIST_LIMIT]
            if not tracks:
                raise MusicServiceError("The playlist is empty or cannot be read.")
            items = [QueueItem(t, requester_id, requester_name, source=source) for t in tracks]
            title = f"{getattr(result, 'name', None) or 'Playlist'} — {len(items)} track(s)"
        elif self._is_playlist_url(query) and source in ("yt", "sc"):
            playlist_title, entries = await self._resolve_playlist(query)
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
            title = f"{playlist_title or 'Playlist'} - {len(items)} track(s)"
        elif source == "local":
            # Pending item; the signed stream URL is built at play time.
            items = [
                QueueItem(
                    track=None,
                    requested_by_id=requester_id,
                    requested_by_name=requester_name,
                    source=source,
                    pending_url=query,
                    title=str(meta.get("title") or Path(query).name),
                    author="local",
                    length=int(meta.get("length_ms") or 0),
                    artwork=None,
                )
            ]
            title = items[0].display_title
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
        current = self.current_items.get(guild_id)
        # The autoplay radio is an endless stream: real tracks must replace
        # it at once instead of waiting behind it forever.
        radio_current = current is not None and current.is_autoplay
        # An unresolved current item means a resolve is already in flight;
        # queueing avoids the lost-track race of two overlapping starts.
        resolving = current is not None and current.track is None
        now_playing = False
        if player is not None and (not player.playing or radio_current) and not queue and not resolving:
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
            return "/playlists/" in q or "/album/" in q
        return False

    async def _resolve_playlist(self, query: str) -> tuple[str, list[dict[str, Any]]]:
        """Read a playlist page with yt-dlp; (playlist title, flat track metadata)."""
        out = await self._run_ytdlp(["--flat-playlist", "--no-warnings", "-J", query], label="The playlist")
        info = json.loads(out.strip())
        # yt-dlp can print a bare null with exit code 0 on unsupported pages.
        if not isinstance(info, dict) or info.get("_type") != "playlist":
            raise MusicServiceError("That link is not a playlist the bot can read.")
        playlist_title = str(info.get("title") or "")
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
        return playlist_title, tracks

    async def _resolve_item(self, item: QueueItem) -> wavelink.Playable:
        """Turn a pending item into a playable track right before playing."""
        if item.track is not None:
            return item.track
        if item.source == "local":
            url = library_stream_url(self.config, item.pending_url)
            loaded = await wavelink.Playable.search(url)
            if isinstance(loaded, wavelink.Playlist) or not loaded:
                raise MusicServiceError("Could not load the library file.")
            track = loaded[0]
            track._title = item.title or track.title  # noqa: SLF001 - Lavalink only sees the URL
            return track
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

    async def _load_stream(self, url: str) -> wavelink.Playable | None:
        """Load a direct URL through Lavalink; None on any load failure."""
        try:
            loaded = await wavelink.Playable.search(url)
        except wavelink.LavalinkLoadException:
            return None
        if isinstance(loaded, wavelink.Playlist) or not loaded:
            return None
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
            station = await self._autoplay_station(guild_id)
            if station is None:
                self.current_items.pop(guild_id, None)
                return None
            queue.append(station)
        if current is not None and current.track is not None and not current.is_autoplay:
            # The outgoing track enters the session history for Previous/Recent.
            # A dead pending item (track is None, recursion) and the autoplay
            # radio must not enter it.
            self._played(guild_id).append(current)
        item = queue.popleft()
        if item.more_from_playlist is not None:
            window, next_index = self._expand_marker(item)
            if not window:
                # The playlist session expired; drop the marker and move on.
                self.current_items[guild_id] = item
                return await self.play_next(guild_id, reason)
            # Splice the window where the marker stood: tracks queued after it
            # keep their order, the new marker follows its own window.
            queue.extendleft(list(reversed(window)))
            if next_index is not None:
                session = self.playlist_sessions.get(item.more_from_playlist[0])
                left = (len(session.entries) - next_index) if session else 0
                queue.insert(
                    len(window),
                    self._playlist_marker(
                        item.more_from_playlist[0], next_index, left,
                        item.requested_by_id, item.requested_by_name,
                        url=session.url if session else item.playlist_url,
                        source=session.source if session else item.playlist_source,
                    ),
                )
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

    async def _lavalink_load_with_retry(self, query: str):
        """Load a URL through Lavalink without any search prefix, with
        retries for the flaky Yandex API."""
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                return await wavelink.Playable.search(query)
            except wavelink.LavalinkLoadException as exc:
                last_error = exc
                await asyncio.sleep(0.8 * (attempt + 1))
        raise MusicServiceError(
            "Lavalink failed to load that playlist. Try again in a moment."
        ) from last_error

    async def _autoplay_station(self, guild_id: int) -> QueueItem | None:
        """The first playable radio station for the guild autoplay setting.

        Stations resolve eagerly here: a dead stream must not enter the
        queue and loop the autoplay path forever.
        """
        try:
            settings = await self.db.get_guild_settings(guild_id)
        except Exception:  # noqa: BLE001 - settings trouble must not break playback
            return None
        query = (settings.autoplay_query or "").strip()
        if not settings.autoplay_enabled or not query:
            return None
        try:
            from app.core.services.extern_search import radio_search

            stations: list[dict[str, Any]] = []
            for attempt in range(2):
                stations = await radio_search(query, limit=4)
                if stations:
                    break
                await asyncio.sleep(1.0)
        except Exception:  # noqa: BLE001
            logger.warning("Autoplay radio search failed for guild %s", guild_id)
            return None
        for station in stations:
            track = await self._load_stream(station["uri"])
            if track is None:
                continue
            track._title = station["title"]  # noqa: SLF001 - Lavalink only sees the stream name
            track._author = station.get("author") or track.author  # noqa: SLF001
            return QueueItem(
                track=track,
                requested_by_id=0,
                requested_by_name="autoplay",
                source="radio",
                title=station["title"],
                author=station.get("author") or "",
                length=station.get("length", 0),
                artwork=station.get("artwork"),
                is_autoplay=True,
            )
        return None

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

    def clear_queue(self, guild_id: int) -> int:
        queue = self._queue(guild_id)
        count = len(queue)
        queue.clear()
        return count

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

    def shuffle_queue(self, guild_id: int) -> int:
        queue = self._queue(guild_id)
        markers = [it for it in queue if it.more_from_playlist is not None]
        items = [it for it in queue if it.more_from_playlist is None]
        random.shuffle(items)
        queue.clear()
        queue.extend(items)
        queue.extend(markers)
        return len(items)

    # --- playlist browser (panel) ---

    def looks_like_playlist(self, query: str, source: str) -> bool:
        return self._is_playlist_url(query) and self._detect_source(query, source) in ("yt", "sc", "ym")

    async def open_playlist(self, query: str, source: str) -> PlaylistSession:
        """Read a playlist into a cached session for the panel browser."""
        source = self._detect_source(query, source)
        if source == "ym":
            result = await self._lavalink_load_with_retry(query)
            entries = list(getattr(result, "tracks", None) or [])
            title = str(getattr(result, "name", None) or "Playlist")
        else:
            title, entries = await self._resolve_playlist(query)
            title = title or "Playlist"
        if not entries:
            raise MusicServiceError("The playlist is empty or cannot be read.")
        self._playlist_seq += 1
        import time

        session = PlaylistSession(
            id=self._playlist_seq,
            title=title,
            source=source,
            url=query,
            entries=entries[:3000],
            created=time.monotonic(),
        )
        self._store_session(session)
        return session

    def _store_session(self, session: PlaylistSession) -> None:
        for pid in [p for p, s in self.playlist_sessions.items() if s.expired()]:
            del self.playlist_sessions[pid]
        if len(self.playlist_sessions) >= PLAYLIST_SESSIONS_MAX:
            oldest = min(self.playlist_sessions, key=lambda p: self.playlist_sessions[p].created)
            del self.playlist_sessions[oldest]
        self.playlist_sessions[session.id] = session

    def _session(self, playlist_id: int) -> PlaylistSession:
        session = self.playlist_sessions.get(playlist_id)
        if session is None or session.expired():
            raise MusicServiceError("This playlist preview has expired. Open the link again.")
        return session

    def playlist_page(self, playlist_id: int, page: int, query: str = "") -> dict[str, Any]:
        """One page of the playlist for the panel browser, with a filter."""
        session = self._session(playlist_id)
        needle = query.strip().lower()
        entries = [
            (i, e)
            for i, e in enumerate(session.entries)
            if not needle
            or needle in self._entry_title(e).lower()
            or needle in self._entry_author(e).lower()
        ]
        pages = max(1, -(-len(entries) // PLAYLIST_PAGE_SIZE))
        page = max(0, min(page, pages - 1))
        chunk = entries[page * PLAYLIST_PAGE_SIZE : (page + 1) * PLAYLIST_PAGE_SIZE]
        return {
            "id": session.id,
            "title": session.title,
            "source": session.source,
            "total": len(session.entries),
            "matched": len(entries),
            "page": page,
            "pages": pages,
            "tracks": [
                {
                    "index": i,
                    "title": self._entry_title(e),
                    "author": self._entry_author(e),
                    "length": self._entry_length(e),
                    "artwork": self._entry_artwork(e),
                    "uri": self._entry_uri(e),
                }
                for i, e in chunk
            ],
        }

    @staticmethod
    def _entry_title(entry: Any) -> str:
        return str(entry.title if isinstance(entry, wavelink.Playable) else entry.get("title") or "?")

    @staticmethod
    def _entry_author(entry: Any) -> str:
        return str(
            (entry.author or "") if isinstance(entry, wavelink.Playable) else entry.get("author") or ""
        )

    @staticmethod
    def _entry_length(entry: Any) -> int:
        return int(entry.length if isinstance(entry, wavelink.Playable) else entry.get("duration") or 0)

    @staticmethod
    def _entry_artwork(entry: Any) -> str | None:
        return entry.artwork if isinstance(entry, wavelink.Playable) else entry.get("artwork")

    @staticmethod
    def _entry_uri(entry: Any) -> str:
        return str(entry.uri if isinstance(entry, wavelink.Playable) else entry.get("url") or "")

    def _entry_to_item(
        self, entry: Any, session: PlaylistSession, requester_id: int, requester_name: str
    ) -> QueueItem:
        if isinstance(entry, wavelink.Playable):
            return QueueItem(
                track=entry,
                requested_by_id=requester_id,
                requested_by_name=requester_name,
                source=session.source,
            )
        return QueueItem(
            track=None,
            requested_by_id=requester_id,
            requested_by_name=requester_name,
            source=session.source,
            pending_url=entry.get("url") or "",
            title=self._entry_title(entry),
            author=self._entry_author(entry),
            length=self._entry_length(entry),
            artwork=self._entry_artwork(entry),
        )

    def _playlist_marker(
        self,
        playlist_id: int,
        next_index: int,
        remaining: int,
        requester_id: int,
        requester_name: str,
        url: str = "",
        source: str = "",
    ) -> QueueItem:
        return QueueItem(
            track=None,
            requested_by_id=requester_id,
            requested_by_name=requester_name,
            source="playlist",
            title=f"{remaining} more tracks",
            more_from_playlist=(playlist_id, next_index),
            playlist_url=url,
            playlist_source=source,
        )

    def _expand_marker(self, marker: QueueItem) -> tuple[list[QueueItem], int | None]:
        """The next window of a lazy playlist. None next index = the end."""
        playlist_id, next_index = marker.more_from_playlist or (0, 0)
        session = self.playlist_sessions.get(playlist_id)
        if session is None or session.expired() or next_index >= len(session.entries):
            return [], None
        window = session.entries[next_index : next_index + PLAYLIST_WINDOW]
        items = [
            self._entry_to_item(e, session, marker.requested_by_id, marker.requested_by_name) for e in window
        ]
        new_next = next_index + len(window)
        return items, (new_next if new_next < len(session.entries) else None)

    async def add_playlist_tracks(
        self, guild_id: int, playlist_id: int, indices: list[int], requester_id: int, requester_name: str
    ) -> int:
        """Queue selected playlist tracks (the panel caps the list size)."""
        session = self._session(playlist_id)
        picked = sorted({i for i in indices if 0 <= i < len(session.entries)})[:200]
        if not picked:
            raise MusicServiceError("No tracks selected.")
        player = self.get_player(guild_id)
        queue = self._queue(guild_id)
        was_idle = not queue and (player is None or not player.playing)
        items = [
            self._entry_to_item(session.entries[i], session, requester_id, requester_name) for i in picked
        ]
        queue.extend(items)
        if was_idle and player is not None and items:
            first = queue.popleft()
            self.current_items[guild_id] = first
            await self._play_item(guild_id, first)
        await self.db.audit(
            "music.playlist_add",
            guild_id=guild_id,
            actor_id=requester_id,
            details={"playlist": session.title, "added": len(items)},
        )
        return len(items)

    async def queue_entire_playlist(
        self, guild_id: int, playlist_id: int, requester_id: int, requester_name: str
    ) -> dict[str, Any]:
        """Lazy "add all": the first window now, a marker pulls the rest.

        The marker at the end of the queue expands when the auto-advance
        reaches it, so a 1500-track playlist never resolves at once.
        """
        session = self._session(playlist_id)
        player = self.get_player(guild_id)
        queue = self._queue(guild_id)
        was_idle = not queue and (player is None or not player.playing)
        window, next_index = self._expand_marker(
            self._playlist_marker(session.id, 0, len(session.entries), requester_id, requester_name)
        )
        if not window:
            raise MusicServiceError("The playlist is empty or cannot be read.")
        queue.extend(window)
        remaining = len(session.entries) - len(window)
        if next_index is not None:
            queue.append(
                self._playlist_marker(
                    session.id, next_index, remaining, requester_id, requester_name,
                    url=session.url, source=session.source,
                )
            )
        if was_idle and player is not None:
            first = queue.popleft()
            self.current_items[guild_id] = first
            await self._play_item(guild_id, first)
        await self.db.audit(
            "music.playlist_add_all",
            guild_id=guild_id,
            actor_id=requester_id,
            details={"playlist": session.title, "total": len(session.entries)},
        )
        return {"queued": len(window), "remaining": remaining, "total": len(session.entries)}

    async def play_pending_now(
        self, guild_id: int, item: QueueItem, requester_id: int, details: dict[str, Any] | None = None
    ) -> str:
        """Start one deferred item right now with the usual history rules.

        The interrupted track enters the session history; an autoplay radio
        is replaced without a trace.
        """
        self._require_player(guild_id)
        current = self.current_items.get(guild_id)
        if current is not None and current.track is not None and not current.is_autoplay:
            self._played(guild_id).append(current)
        self.current_items[guild_id] = item
        await self._play_item(guild_id, item)
        await self.db.audit("music.play_pending", guild_id=guild_id, actor_id=requester_id, details=details)
        return item.display_title

    async def queue_pending_items(self, guild_id: int, items: list[QueueItem], requester_id: int) -> int:
        """Append deferred items; start the first one when the player is idle."""
        if not items:
            raise MusicServiceError("Nothing to queue.")
        player = self.get_player(guild_id)
        queue = self._queue(guild_id)
        was_idle = not queue and (player is None or not player.playing)
        queue.extend(items)
        if was_idle and player is not None:
            first = queue.popleft()
            self.current_items[guild_id] = first
            await self._play_item(guild_id, first)
        await self.db.audit(
            "music.queue_pending", guild_id=guild_id, actor_id=requester_id, details={"queued": len(items)}
        )
        return len(items)

    async def play_playlist_track(
        self, guild_id: int, playlist_id: int, index: int, requester_id: int, requester_name: str
    ) -> str:
        """Play one playlist track right now; the current track keeps its
        place in the session history (the interrupted-radio rules apply)."""
        self._require_player(guild_id)
        session = self._session(playlist_id)
        if index < 0 or index >= len(session.entries):
            raise MusicServiceError("That playlist position does not exist.")
        item = self._entry_to_item(session.entries[index], session, requester_id, requester_name)
        current = self.current_items.get(guild_id)
        if current is not None and current.track is not None and not current.is_autoplay:
            self._played(guild_id).append(current)
        self.current_items[guild_id] = item
        await self._play_item(guild_id, item)
        await self.db.audit(
            "music.playlist_play",
            guild_id=guild_id,
            actor_id=requester_id,
            details={"playlist": session.title, "index": index, "title": item.display_title},
        )
        return item.display_title


    async def skip(self, guild_id: int, requester_id: int) -> bool:
        player = self._require_player(guild_id)
        if not player.playing:
            return False
        await player.stop()  # The TrackEnd listener starts the next queued item.
        await self.db.audit("music.skip", guild_id=guild_id, actor_id=requester_id)
        return True

    async def previous(self, guild_id: int, requester_id: int) -> str:
        """Replay the last history entry; the current track returns to the queue front."""
        self._require_player(guild_id)
        played = self._played(guild_id)
        if not played:
            raise MusicServiceError("Nothing was played yet.")
        item = self._for_replay(played.pop())
        current = self.current_items.get(guild_id)
        if current is not None and current.track is not None and not current.is_autoplay:
            self._queue(guild_id).appendleft(current)
        self.current_items[guild_id] = item
        # A direct play: the old track ends with reason "replaced" and the
        # auto-advance listener ignores it.
        await self._play_item(guild_id, item)
        await self.db.audit("music.previous", guild_id=guild_id, actor_id=requester_id)
        return item.display_title

    async def replay_played(self, guild_id: int, position: int, requester_id: int) -> str:
        """Play a session history entry. Position 0 is the most recent track."""
        self._require_player(guild_id)
        played = self._played(guild_id)
        if position < 0 or position >= len(played):
            raise MusicServiceError("That history entry does not exist.")
        # Take the target out first: the interrupted current track joins the
        # history afterwards and must not shift the position.
        item = self._for_replay(played[len(played) - 1 - position])
        del played[len(played) - 1 - position]
        current = self.current_items.get(guild_id)
        if current is not None and current.track is not None and not current.is_autoplay:
            self._played(guild_id).append(current)
        self.current_items[guild_id] = item
        await self._play_item(guild_id, item)
        await self.db.audit(
            "music.replay", guild_id=guild_id, actor_id=requester_id, details={"position": position}
        )
        return item.display_title

    async def requeue_played(self, guild_id: int, position: int, requester_id: int) -> str:
        """Append a session history entry back to the queue; playback keeps
        going and the entry stays in the history (re-add works repeatedly)."""
        self._require_player(guild_id)
        played = self._played(guild_id)
        if position < 0 or position >= len(played):
            raise MusicServiceError("That history entry does not exist.")
        # Work on a copy: the history entry itself must keep its resolved track.
        item = self._for_replay(replace(played[len(played) - 1 - position]))
        self._queue(guild_id).append(item)
        await self.db.audit(
            "music.requeue", guild_id=guild_id, actor_id=requester_id, details={"position": position}
        )
        return item.display_title

    async def jump_to(self, guild_id: int, index: int, requester_id: int) -> str:
        """Start a queued track now. The chosen track leaves the queue, the
        rest of the queue keeps its order; only the interrupted current track
        enters the session history."""
        self._require_player(guild_id)
        queue = self._queue(guild_id)
        if index < 0 or index >= len(queue):
            raise MusicServiceError("That queue position does not exist.")
        item = queue[index]
        if item.more_from_playlist is not None:
            raise MusicServiceError("Open the playlist browser to pick a track from it.")
        del queue[index]
        current = self.current_items.get(guild_id)
        if current is not None and current.track is not None and not current.is_autoplay:
            self._played(guild_id).append(current)
        self.current_items[guild_id] = item
        await self._play_item(guild_id, item)
        await self.db.audit(
            "music.jump", guild_id=guild_id, actor_id=requester_id, details={"index": index}
        )
        return item.display_title

    async def expand_queue_playlist(self, guild_id: int, index: int, requester_id: int) -> dict[str, Any]:
        """The marker row click: splice the next page of the playlist into the
        queue right above the marker. Tracks queued after the marker keep
        their order. An expired session is re-read from the stored link."""
        queue = self._queue(guild_id)
        if index < 0 or index >= len(queue):
            raise MusicServiceError("That queue position does not exist.")
        marker = queue[index]
        if marker.more_from_playlist is None:
            raise MusicServiceError("That entry is not a playlist marker.")
        session = self.playlist_sessions.get(marker.more_from_playlist[0])
        if session is None or session.expired():
            if not marker.playlist_url:
                raise MusicServiceError("This playlist preview has expired. Open the link again.")
            session = await self.open_playlist(marker.playlist_url, marker.playlist_source or "yt")
        next_index = marker.more_from_playlist[1]
        chunk = session.entries[next_index : next_index + PLAYLIST_PAGE_SIZE]
        if not chunk:
            # Everything the session holds is queued already.
            del queue[index]
            return {"expanded": 0, "remaining": 0, "total": len(session.entries)}
        items = [
            self._entry_to_item(e, session, marker.requested_by_id, marker.requested_by_name)
            for e in chunk
        ]
        del queue[index]
        for offset, it in enumerate(items):
            queue.insert(index + offset, it)
        new_next = next_index + len(chunk)
        remaining = max(0, len(session.entries) - new_next)
        if remaining > 0:
            queue.insert(
                index + len(items),
                self._playlist_marker(
                    session.id,
                    new_next,
                    remaining,
                    marker.requested_by_id,
                    marker.requested_by_name,
                    url=session.url,
                    source=session.source,
                ),
            )
        await self.db.audit(
            "music.playlist_expand",
            guild_id=guild_id,
            actor_id=requester_id,
            details={"playlist": session.title, "expanded": len(items), "remaining": remaining},
        )
        return {"expanded": len(items), "remaining": remaining, "total": len(session.entries)}

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
            if item is None or item.track is None or item.track.identifier != player.current.identifier:
                item = QueueItem(player.current, 0, "")
            current = item.to_dict()
            current["position"] = player.position
            current["paused"] = player.paused
        elif player is not None and self.current_items.get(guild_id) is not None:
            # The item left the queue and is resolving its stream right now;
            # show it in the bar with a loading flag instead of a blind spot.
            current = self.current_items[guild_id].to_dict()
            current["position"] = 0
            current["paused"] = False
            current["loading"] = True
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
            # Newest first, for the Recent view of the queue panel.
            "played": [item.to_dict() for item in reversed(self._played(guild_id))],
        }

    # --- state persistence across restarts ---

    @staticmethod
    def _item_from_payload(d: dict[str, Any]) -> QueueItem:
        if d.get("source") == "playlist" and d.get("playlist_id") is not None:
            return QueueItem(
                track=None,
                requested_by_id=int(d.get("requested_by_id") or 0),
                requested_by_name=str(d.get("requested_by") or ""),
                source="playlist",
                title=str(d.get("title") or ""),
                more_from_playlist=(int(d["playlist_id"]), int(d.get("playlist_next") or 0)),
                playlist_url=str(d.get("playlist_url") or ""),
                playlist_source=str(d.get("playlist_source") or ""),
            )
        return QueueItem(
            track=None,
            requested_by_id=int(d.get("requested_by_id") or 0),
            requested_by_name=str(d.get("requested_by") or ""),
            source=str(d.get("source") or ""),
            pending_url=str(d.get("uri") or ""),
            title=str(d.get("title") or ""),
            author=str(d.get("author") or ""),
            length=int(d.get("length") or 0),
            artwork=d.get("artwork"),
        )

    def _guild_state_payload(self, guild_id: int) -> dict[str, Any] | None:
        """The snapshot to save, or None when the guild has nothing worth keeping."""
        queue_items = list(self.queues.get(guild_id) or [])
        current = self.current_items.get(guild_id)
        if (
            current is not None
            and current.track is not None
            and not current.is_autoplay
            and current.more_from_playlist is None
        ):
            # The interrupted track returns as the queue head on restore.
            queue_items = [current] + queue_items
        history = list(self.played.get(guild_id) or [])
        repeat = self.repeat_modes.get(guild_id, "off")
        if not queue_items and not history and repeat == "off":
            return None
        return {
            "queue": [i.to_dict() for i in queue_items],
            # Newest first, matching the panel view.
            "played": [i.to_dict() for i in reversed(history)],
            "repeat": repeat,
        }

    async def persist_state(self) -> None:
        """Write the music state of every guild into the database."""
        guilds = set(self.queues) | set(self.current_items) | set(self.played) | {
            g for g, m in self.repeat_modes.items() if m != "off"
        }
        saved: set[int] = set()
        for gid in guilds:
            payload = self._guild_state_payload(gid)
            if payload is None:
                continue
            await self.db.save_music_snapshot(gid, payload)
            saved.add(gid)
        for gid in await self.db.load_music_snapshots():
            if gid not in saved:
                await self.db.delete_music_snapshot(gid)

    async def restore_state(self) -> None:
        """Rebuild queues, history and repeat modes saved before a restart."""
        snapshots = await self.db.load_music_snapshots()
        markers: list[tuple[int, QueueItem]] = []
        for raw_gid, data in snapshots.items():
            gid = int(raw_gid)
            queue_items = [self._item_from_payload(d) for d in data.get("queue") or []]
            if queue_items:
                self.queues[gid] = deque(queue_items)
                markers.extend((gid, it) for it in queue_items if it.more_from_playlist is not None)
            history = [self._item_from_payload(d) for d in reversed(data.get("played") or [])]
            if history:
                self.played[gid] = deque(history[-PLAYED_LIMIT:], maxlen=PLAYED_LIMIT)
            repeat = data.get("repeat")
            if repeat in ("off", "one", "all") and repeat != "off":
                self.repeat_modes[gid] = repeat
        if markers:
            # Lazy markers point at in-memory sessions that a restart wiped;
            # re-read their playlists to hand the markers fresh sessions.
            task = asyncio.create_task(self._rebind_markers(markers))
            task.add_done_callback(lambda t: t.exception() and logger.exception("Marker rebind failed"))

    async def _rebind_markers(self, pairs: list[tuple[int, QueueItem]]) -> None:
        changed = False
        for gid, marker in pairs:
            try:
                fresh = await self.open_playlist(marker.playlist_url, marker.playlist_source or "yt")
            except Exception:  # noqa: BLE001 - a dead link drops the marker, not the queue
                logger.warning("Could not re-read playlist %s for a marker", marker.playlist_url)
                continue
            queue = self.queues.get(gid)
            if not queue:
                continue
            next_index = marker.more_from_playlist[1]
            for i, it in enumerate(queue):
                if (
                    it.more_from_playlist is not None
                    and it.playlist_url == marker.playlist_url
                    and it.more_from_playlist[1] == next_index
                ):
                    queue[i] = self._playlist_marker(
                        fresh.id,
                        next_index,
                        max(0, len(fresh.entries) - next_index),
                        it.requested_by_id,
                        it.requested_by_name,
                        url=fresh.url,
                        source=fresh.source,
                    )
                    changed = True
                    break
        if changed:
            await self.persist_state()

    async def periodic_persist(self, interval: float = 15.0) -> None:
        while True:
            await asyncio.sleep(interval)
            try:
                await self.persist_state()
            except Exception:  # noqa: BLE001 - persistence must never crash the loop
                logger.exception("Failed to persist the music state")
