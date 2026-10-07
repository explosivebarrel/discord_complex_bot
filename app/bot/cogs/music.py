from __future__ import annotations

import logging
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
            skipped = await self.bot.music.skip(interaction.guild_id or 0, interaction.user.id)
        except MusicServiceError as exc:
            await interaction.response.send_message(f"❌ {exc}", ephemeral=True)
            return
        await interaction.response.send_message("⏭️ Skipped." if skipped else "Nothing is playing.")

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
        state = self.bot.music.get_state(interaction.guild_id or 0)
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
        state = self.bot.music.get_state(interaction.guild_id or 0)
        current = state["current"]
        if not current:
            await interaction.response.send_message("Nothing is playing.")
            return
        pos, length = current["position"] // 1000, current["length"] // 1000
        await interaction.response.send_message(
            f"▶️ **{current['title']}**\n`{pos // 60}:{pos % 60:02d}` / `{length // 60}:{length % 60:02d}`"
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

    @commands.Cog.listener()
    async def on_wavelink_track_stuck(self, payload: wavelink.TrackStuckEventPayload) -> None:
        self.bot.music.record_error("Track stuck during playback")

    @commands.Cog.listener()
    async def on_wavelink_track_end(self, payload: wavelink.TrackEndEventPayload) -> None:
        if payload.player is None or payload.player.guild is None:
            return
        guild_id = payload.player.guild.id
        if payload.reason in ("replaced", "cleanup"):
            return
        try:
            await self.bot.music.play_next(guild_id, payload.reason)
        except Exception:  # noqa: BLE001 - never crash the event loop on bad tracks
            logger.exception("Failed to play next track for guild %s", guild_id)

    @commands.Cog.listener()
    async def on_wavelink_inactive_player(self, player: wavelink.Player) -> None:
        # The node dispatches this event after 300 seconds without activity. Leave the voice channel.
        await player.disconnect()


async def setup(bot: ComplexBot) -> None:
    await bot.add_cog(MusicCog(bot))
