from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING, Literal

import discord
import wavelink
from discord import app_commands
from discord.ext import commands

from app.core.services.music import MusicServiceError

if TYPE_CHECKING:
    from app.bot.client import ComplexBot

logger = logging.getLogger(__name__)


class MusicCog(commands.Cog):
    """Slash commands for music. The web panel uses MusicService directly."""

    def __init__(self, bot: ComplexBot) -> None:
        self.bot = bot
        # Dedup of track-end events: a skip near a track's natural end makes
        # Lavalink fire both "stopped" (from player.stop()) and "finished"
        # (the natural end) for the SAME track. Two play_next calls race and
        # eat extra queue entries, so the second event is dropped.
        self._last_track_end: dict[int, tuple[str, float]] = {}

    async def _join_requester(self, interaction: discord.Interaction) -> wavelink.Player:
        assert interaction.guild is not None
        if interaction.user.voice is None or interaction.user.voice.channel is None:
            raise MusicServiceError("Join a voice channel first.")
        return await self.bot.music.connect(
            interaction.guild.id, interaction.user.voice.channel.id, interaction.user.id
        )

    @app_commands.command(name="play", description="Play a track or playlist (URL or search query)")
    @app_commands.describe(query="Track title or URL (YouTube, SoundCloud, ...)")
    @app_commands.guild_only()
    async def play(self, interaction: discord.Interaction, query: str) -> None:
        await interaction.response.defer()
        try:
            await self._join_requester(interaction)
            result = await self.bot.music.enqueue(
                interaction.guild_id or 0, query, interaction.user.id, interaction.user.display_name
            )
        except MusicServiceError as exc:
            await interaction.followup.send(f"❌ {exc}", ephemeral=True)
            return
        if result["now_playing"]:
            await interaction.followup.send(f"▶️ Now playing: **{result['title']}**")
        else:
            await interaction.followup.send(f"➕ Queued **{result['title']}** ({result['queued']} track(s))")

    @app_commands.command(name="skip", description="Skip the current track")
    @app_commands.guild_only()
    async def skip(self, interaction: discord.Interaction) -> None:
        try:
            result = await self.bot.music.request_skip(interaction.guild_id or 0, interaction.user.id)
        except MusicServiceError as exc:
            await interaction.response.send_message(f"❌ {exc}", ephemeral=True)
            return
        if result.get("skipped"):
            await interaction.response.send_message("⏭️ Skipped.")
        else:
            await interaction.response.send_message(
                f"🗳️ Skip vote: {result.get('votes')}/{result.get('needed')}.", ephemeral=True
            )

    @app_commands.command(name="stop", description="Stop playback and clear the queue")
    @app_commands.guild_only()
    async def stop(self, interaction: discord.Interaction) -> None:
        try:
            await self.bot.music.stop(interaction.guild_id or 0, interaction.user.id)
        except MusicServiceError as exc:
            await interaction.response.send_message(f"❌ {exc}", ephemeral=True)
            return
        await interaction.response.send_message("⏹️ Stopped, queue cleared.")

    @app_commands.command(name="pause", description="Pause playback")
    @app_commands.guild_only()
    async def pause(self, interaction: discord.Interaction) -> None:
        try:
            await self.bot.music.set_paused(interaction.guild_id or 0, True)
        except MusicServiceError as exc:
            await interaction.response.send_message(f"❌ {exc}", ephemeral=True)
            return
        await interaction.response.send_message("⏸️ Paused.")

    @app_commands.command(name="resume", description="Resume playback")
    @app_commands.guild_only()
    async def resume(self, interaction: discord.Interaction) -> None:
        try:
            await self.bot.music.set_paused(interaction.guild_id or 0, False)
        except MusicServiceError as exc:
            await interaction.response.send_message(f"❌ {exc}", ephemeral=True)
            return
        await interaction.response.send_message("▶️ Resumed.")

    @app_commands.command(name="queue", description="Show the current queue")
    @app_commands.guild_only()
    async def queue(self, interaction: discord.Interaction) -> None:
        state = await self.bot.music.get_state(interaction.guild_id or 0)
        lines = []
        current = state["current"]
        if current:
            lines.append(f"▶️ **{current['title']}** — `{current['requested_by'] or 'unknown'}`")
        for i, item in enumerate(state["queue"], start=1):
            lines.append(f"`{i}.` **{item['title']}** — `{item['requested_by']}`")
        if not lines:
            await interaction.response.send_message("Queue is empty.")
            return
        await interaction.response.send_message("\n".join(lines[:25]))

    @app_commands.command(name="nowplaying", description="Show the currently playing track")
    @app_commands.guild_only()
    async def nowplaying(self, interaction: discord.Interaction) -> None:
        state = await self.bot.music.get_state(interaction.guild_id or 0)
        current = state["current"]
        if not current:
            await interaction.response.send_message("Nothing is playing.")
            return
        from app.bot.np import NowPlayingView

        queue = state.get("queue") or []
        total = sum((t.get("length") or 0) for t in queue)
        minutes, seconds = divmod(total // 1000, 60)
        total_str = f"{minutes // 60}:{minutes % 60:02d}:{seconds:02d}" if minutes >= 60 else f"{minutes}:{seconds:02d}"
        embed = discord.Embed(title=current["title"][:256], color=discord.Color.from_str("#D0BCFF"))
        if current.get("author"):
            embed.set_author(name=current["author"][:256])
        if current.get("artwork"):
            embed.set_thumbnail(url=current["artwork"])
        embed.add_field(
            name="Up next",
            value=(queue[0]["title"][:200] if queue else "*Queue is empty — add tracks from the panel*"),
            inline=False,
        )
        src = {"yt": "YouTube", "sc": "SoundCloud", "vk": "VK", "ym": "Yandex Music",
               "local": "Local library", "direct": "VK (userscript)", "radio": "Radio", "archive": "Archive.org"}
        embed.add_field(name="Queue", value=f"{len(queue)} track(s) · {total_str}", inline=True)
        embed.add_field(name="Source", value=src.get(current.get("source"), "Unknown") or "Unknown", inline=True)
        pos, length = current["position"] // 1000, current["length"] // 1000
        embed.set_footer(text=f"{pos // 60}:{pos % 60:02d} / {length // 60}:{length % 60:02d}")
        paused = bool(current.get("paused"))
        await interaction.response.send_message(embed=embed, view=NowPlayingView(paused=paused))

    @app_commands.command(name="sleep", description="Fade the music out and pause after N minutes")
    @app_commands.describe(minutes="Minutes until the fade-out; omit to cancel the timer")
    @app_commands.guild_only()
    async def sleep(
        self,
        interaction: discord.Interaction,
        minutes: app_commands.Range[float, 0.5, 480.0] | None = None,
    ) -> None:
        is_admin = interaction.user.guild_permissions.manage_guild
        is_super = interaction.user.id in self.bot.music.config.superadmin_ids
        if not (is_admin or is_super):
            await interaction.response.send_message("❌ Only server admins can set the sleep timer.", ephemeral=True)
            return
        deadline = self.bot.music.set_sleep(interaction.guild_id or 0, minutes * 60 if minutes else None)
        if deadline is None:
            await interaction.response.send_message("⏰ Sleep timer cancelled.")
        else:
            import time as _time

            left = max(0, round(deadline - _time.monotonic()))
            await interaction.response.send_message(
                f"🌙 Sleep timer set: the music fades out in {left // 60} min {left % 60} s."
            )

    @app_commands.command(name="leave", description="Disconnect the bot from voice")
    @app_commands.guild_only()
    async def leave(self, interaction: discord.Interaction) -> None:
        await self.bot.music.disconnect(interaction.guild_id or 0)
        await interaction.response.send_message("👋 Disconnected.")

    @app_commands.command(name="repeat", description="Repeat the current track or the whole queue")
    @app_commands.describe(mode="off, one (current track) or all (whole queue)")
    @app_commands.guild_only()
    async def repeat(self, interaction: discord.Interaction, mode: Literal["off", "one", "all"]) -> None:
        self.bot.music.set_repeat(interaction.guild_id or 0, mode)
        await interaction.response.send_message(f"🔁 Repeat: {mode}.")

    # --- auto-advance ---

    @commands.Cog.listener()
    async def on_wavelink_track_exception(self, payload: wavelink.TrackExceptionEventPayload) -> None:
        guild_id = payload.player.guild.id if payload.player is not None and payload.player.guild else None
        self.bot.music.record_error(payload.exception or "Track exception", {"guild_id": guild_id})
        await self.bot.music.notify(
            guild_id,
            "player",
            "Track failed to play",
            str(payload.exception or "The source raised an error")[:300],
        )

    @commands.Cog.listener()
    async def on_wavelink_track_stuck(self, payload: wavelink.TrackStuckEventPayload) -> None:
        guild_id = payload.player.guild.id if payload.player is not None and payload.player.guild else None
        self.bot.music.record_error("Track stuck during playback", {"guild_id": guild_id})
        await self.bot.music.notify(
            guild_id,
            "player",
            "Track stuck",
            "The source stalled mid-playback. Skip it if it does not recover.",
        )

    @commands.Cog.listener()
    async def on_wavelink_track_end(self, payload: wavelink.TrackEndEventPayload) -> None:
        if payload.player is None or payload.player.guild is None:
            return
        guild_id = payload.player.guild.id
        if payload.reason in ("replaced", "cleanup"):
            return
        # The same track ending twice within a couple of seconds is the
        # stop()+natural-end race, not two real track ends.
        track_key = str(getattr(payload.track, "identifier", "") or "")
        now = time.monotonic()
        last = self._last_track_end.get(guild_id)
        if track_key and last is not None and last[0] == track_key and now - last[1] < 2.0:
            logger.info("Dropping duplicate track-end (%s) for guild %s", payload.reason, guild_id)
            return
        if track_key:
            self._last_track_end[guild_id] = (track_key, now)
        # A source that dies early (expired CDN link, connection reset,
        # rate-limited CDN) reports a plain "finished": Lavalink sees the
        # stream EOF and the queue moves on with no exception anywhere.
        # player.position is already 0 at this event, so the wall clock
        # since the track started is the reliable measure.
        try:
            track = payload.track
            length = int(track.length or 0)
            is_stream = bool(getattr(track, "is_stream", False)) or length >= 9_223_372_036_854_775_807
            started = self.bot.music.play_started_at.get(guild_id)
            played_ms = int((time.monotonic() - started) * 1000) if started else 0
            if payload.reason == "finished" and not is_stream and length > 30_000 and 0 < played_ms < length - 10_000:
                logger.info(
                    "Track ended early for guild %s: %r after %s/%sms",
                    guild_id, track.title[:48], played_ms, length,
                )
                self.bot.music.record_error(
                    "Track ended early",
                    {"guild_id": guild_id, "played_ms": played_ms, "length": length},
                )
                await self.bot.music.notify(
                    guild_id,
                    "player",
                    "Track ended early",
                    f'"{track.title}" stopped after {played_ms // 1000}/{length // 1000}s — '
                    "the source stream died before the end.",
                )
        except Exception:  # noqa: BLE001 - telemetry must never break playback
            logger.exception("Premature-end check failed for guild %s", guild_id)
        try:
            await self.bot.music.play_next(guild_id, payload.reason)
        except Exception:  # noqa: BLE001 - never crash the event loop on bad tracks
            logger.exception("Failed to play next track for guild %s", guild_id)

    @commands.Cog.listener()
    async def on_wavelink_inactive_player(self, player: wavelink.Player) -> None:
        # The node dispatches this event after 300 seconds without activity. Leave the voice channel.
        if player.guild is not None:
            await self.bot.music.disconnect(player.guild.id)
        else:
            await player.disconnect()

    @commands.Cog.listener()
    async def on_wavelink_node_ready(self, payload: wavelink.NodeReadyEventPayload) -> None:
        # A Lavalink (re)connect wipes the node's players: the bot may even
        # keep audibly playing through a resumed session while the panel
        # reads "not connected". Without a resume every player object is
        # stale — force a re-handshake for every guild that still has a
        # voice state and an in-memory current track.
        try:
            await self.bot.music.resync_players(force=not payload.resumed)
        except Exception:  # noqa: BLE001 - never crash on the node event
            logger.exception("Player resync after node ready failed")


async def setup(bot: ComplexBot) -> None:
    await bot.add_cog(MusicCog(bot))
