"""Slash commands for voice-call recording (exclusive mode, no music)."""

from __future__ import annotations

import json

import discord
from discord import app_commands
from discord.ext import commands

from app.core.services.recorder import RecordingError


class RecordCog(commands.GroupCog, group_name="record"):
    """/record start|stop|status; the GroupCog makes them subcommands."""

    def __init__(self, bot) -> None:
        super().__init__()
        self.bot = bot

    async def _can_record(self, interaction: discord.Interaction) -> bool:
        """recordings_access semantics: owner/superadmin always, admins/members/off."""
        guild, user = interaction.guild, interaction.user
        if guild is None or not isinstance(user, discord.Member):
            return False
        if user.id in (guild.owner_id, *self.bot.config.superadmin_ids):
            return True
        settings = await self.bot.db.get_guild_settings(guild.id)
        level = getattr(settings, "recordings_access", "admins")
        if level == "everyone":
            return True
        if level != "admins":
            return False
        if user.guild_permissions.administrator:
            return True
        if any(role.id in json.loads(settings.admin_role_ids or "[]") for role in user.roles):
            return True
        return user.id in await self.bot.db.list_guild_admins(guild.id)

    @app_commands.command(name="start", description="Start recording the current voice call")
    @app_commands.describe(
        channel="Voice channel (defaults to the one you are in)",
        title="Custom title for this recording (defaults to channel name)",
        prompt="Initial prompt / topic keywords / vocabulary for Whisper transcription",
    )
    async def start(
        self,
        interaction: discord.Interaction,
        channel: discord.VoiceChannel | discord.StageChannel | None = None,
        title: str | None = None,
        prompt: str | None = None,
    ) -> None:
        await interaction.response.defer(ephemeral=True)
        if not await self._can_record(interaction):
            await interaction.followup.send("❌ Recording is restricted on this server.", ephemeral=True)
            return
        target = channel or (interaction.user.voice.channel if interaction.user.voice else None)
        if target is None:
            await interaction.followup.send(
                "Join a voice channel first or pass the `channel` option.", ephemeral=True
            )
            return
        try:
            row = await self.bot.music.recorder.start(
                interaction.guild_id,
                target.id,
                interaction.user.id,
                title=title,
                prompt=prompt,
            )
        except RecordingError as exc:
            await interaction.followup.send(f"❌ {exc}", ephemeral=True)
            return
        await interaction.followup.send(
            f"🔴 Recording **#{row['id']}** in **{target.name}**. Use `/record stop` to finish.",
            ephemeral=True,
        )

    @app_commands.command(name="stop", description="Stop the recording and transcribe it")
    async def stop(self, interaction: discord.Interaction) -> None:
        await interaction.response.defer(ephemeral=True)
        if not await self._can_record(interaction):
            await interaction.followup.send("❌ Recording is restricted on this server.", ephemeral=True)
            return
        try:
            row = await self.bot.music.recorder.stop(interaction.guild_id, interaction.user.id)
        except RecordingError as exc:
            await interaction.followup.send(f"❌ {exc}", ephemeral=True)
            return
        if row["status"] == "failed":
            await interaction.followup.send(f"⚠️ Recording stopped: {row['error']}", ephemeral=True)
            return
        await interaction.followup.send(
            f"⏹️ Recording **#{row['id']}** saved. Transcription runs in the background — "
            "watch the notifications bell or the Recordings page.",
            ephemeral=True,
        )

    @app_commands.command(name="status", description="Show the current recording status")
    async def status(self, interaction: discord.Interaction) -> None:
        await interaction.response.defer(ephemeral=True)
        recorder = self.bot.music.recorder
        session = recorder.session(interaction.guild_id)
        if session is None:
            await interaction.followup.send("Not recording.", ephemeral=True)
            return
        channel = session.vc.channel if session.vc is not None else None
        speakers = len(getattr(session.sink, "_users", {}))
        await interaction.followup.send(
            f"🔴 Recording **#{session.recording_id}** in {channel.mention if channel else 'voice'} — "
            f"{speakers} speaker(s) so far.",
            ephemeral=True,
        )


async def setup(bot) -> None:
    await bot.add_cog(RecordCog(bot))
