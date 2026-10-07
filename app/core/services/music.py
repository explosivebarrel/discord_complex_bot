from __future__ import annotations

import asyncio
import json
import logging
from collections import deque
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

import discord
import wavelink

from app.core.db import Database

if TYPE_CHECKING:
    from app.core.config import Config

logger = logging.getLogger(__name__)

VOLUME_MIN, VOLUME_MAX = 0, 1000


@dataclass
class QueueItem:
    track: wavelink.Playable
    requested_by_id: int
    requested_by_name: str = field(default="")

    def to_dict(self) -> dict[str, Any]:
        return {
            "title": self.track.title,
            "author": self.track.author,
            "uri": self.track.uri,
            "length": self.track.length,
            "artwork": self.track.artwork,
            "source": self.track.source,
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

    # --- SoundCloud via yt-dlp ---
    # Lavaplayer's SoundCloud client_id scraping is broken, so Lavalink search
    # returns empty results. yt-dlp handles SoundCloud fine: the backend runs
    # it for search and stream resolution, Lavalink only plays the resolved
    # direct mp3 URL through the plain http source. Note: some ISPs cut TLS
    # connections to soundcloud.com by SNI, so transport failures get retried.

    async def _run_ytdlp(self, args: list[str], attempts: int = 3) -> str:
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
                    "This SoundCloud track is DRM-protected and cannot be played outside the official app."
                )
            if attempt + 1 < attempts:
                await asyncio.sleep(1.0)
        raise MusicServiceError(
            "SoundCloud is unreachable from this network right now. Try again later."
            if "SSL" in last_error or "timed out" in last_error or "Unable to download" in last_error
            else f"SoundCloud lookup failed: {last_error.strip()[:200]}"
        )

    async def _sc_search(self, query: str, limit: int) -> list[dict[str, Any]]:
        out = await self._run_ytdlp(
            ["--flat-playlist", "--print-json", "--no-warnings", f"scsearch{limit}:{query}"]
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
                    "author": entry.get("uploader") or "SoundCloud",
                    "uri": entry.get("webpage_url"),
                    "length": duration,
                    "artwork": thumbnails[-1].get("url") if thumbnails else None,
                    "source": "sc",
                    "requested_by": "",
                    "encoded": None,
                }
            )
        return tracks

    async def _sc_resolve(self, url: str) -> dict[str, Any]:
        """Resolve a SoundCloud page URL to a direct progressive stream."""
        out = await self._run_ytdlp(["-f", "bestaudio[protocol^=http]/bestaudio", "--no-warnings", "-J", url])
        info = json.loads(out.strip().splitlines()[-1])
        stream_url = info.get("url")
        if not stream_url:
            raise MusicServiceError("No playable stream found for this SoundCloud track.")
        if "m3u8" in str(info.get("protocol", "")) or ".m3u8" in stream_url:
            raise MusicServiceError(
                "This track only provides an HLS stream, which requires the official SoundCloud app."
            )
        return info

    async def search(self, query: str, limit: int = 10, source: str = "yt") -> list[dict[str, Any]]:
        if source == "sc":
            return await self._sc_search(query, limit)
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
        return {
            "title": track.title,
            "author": track.author,
            "uri": track.uri,
            "length": track.length,
            "artwork": track.artwork,
            "source": track.source,
            "identifier": track.identifier,
            "encoded": track.encoded,
        }

    async def enqueue(
        self,
        guild_id: int,
        query: str,
        requester_id: int,
        requester_name: str = "",
        encoded: str | None = None,
        source: str = "yt",
    ) -> dict[str, Any]:
        """Search for `query`. Add the first track or a full playlist to the queue.

        Start playback if the player is idle. With `encoded`, take the track
        from the search cache and skip the Lavalink load request.
        """
        cached = self.track_cache.get(encoded) if encoded else None
        if cached is not None:
            tracks = [wavelink.Playable(data=cached)]
            title = tracks[0].title
        elif source == "sc":
            # Resolve a direct progressive stream with yt-dlp; Lavalink plays
            # it through the plain http source.
            info = await self._sc_resolve(query)
            loaded = await wavelink.Playable.search(info["url"])
            if isinstance(loaded, wavelink.Playlist) or not loaded:
                raise MusicServiceError("Could not load the SoundCloud stream.")
            track = loaded[0]
            track._title = info.get("title") or track.title  # noqa: SLF001 - Lavalink only sees the CDN filename
            track._author = info.get("uploader") or track.author  # noqa: SLF001
            if info.get("thumbnail"):
                track._artwork = info["thumbnail"]  # noqa: SLF001
            tracks = [track]
            title = str(track)
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
        if not tracks:
            raise MusicServiceError("Nothing found for this query.")

        queue = self._queue(guild_id)
        items = [QueueItem(t, requester_id, requester_name) for t in tracks]
        player = self.get_player(guild_id)
        now_playing = False
        if player is not None and not player.playing and not queue:
            first = items.pop(0)
            queue.extend(items)
            self.current_items[guild_id] = first
            await player.play(first.track)
            now_playing = True
        else:
            queue.extend(items)
        return {
            "queued": len(items),
            "title": title,
            "now_playing": now_playing,
        }

    def record_error(self, message: str, context: dict[str, Any] | None = None) -> None:
        import datetime as _dt

        self.last_error = {
            "message": message[:500],
            "context": context or {},
            "at": _dt.datetime.now(_dt.timezone.utc).isoformat(),
        }

    async def play_next(self, guild_id: int) -> wavelink.Playable | None:
        queue = self._queue(guild_id)
        if not queue:
            self.current_items.pop(guild_id, None)
            return None
        player = self.get_player(guild_id)
        if player is None:
            return None
        item = queue.popleft()
        self.current_items[guild_id] = item
        await player.play(item.track)
        return item.track

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
            "current": current,
            "queue": [item.to_dict() for item in queue],
        }
