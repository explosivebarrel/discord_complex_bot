"""Persistent control buttons for the now-playing embed.

The view has timeout=None and a fixed custom_id set, so Discord keeps the
buttons clickable for the message's whole lifetime; the bot re-registers
it in setup_hook after every restart. Callbacks reach MusicService through
interaction.client (the ComplexBot instance) — no imports from the service
layer, so nothing circular.
"""
from __future__ import annotations

import logging

import discord

logger = logging.getLogger(__name__)


class NowPlayingView(discord.ui.View):
    def __init__(self, paused: bool = False) -> None:
        super().__init__(timeout=None)
        self.paused = paused
        for child in self.children:
            if getattr(child, "custom_id", None) == "np:pause":
                child.label = "Resume" if paused else "Pause"

    @discord.ui.button(emoji="⏯", label="Pause", style=discord.ButtonStyle.secondary, custom_id="np:pause")
    async def pause_toggle(self, interaction: discord.Interaction, _button: discord.ui.Button) -> None:
        # Acknowledge first: the toggle itself (a state round-trip) can
        # outlive Discord's 3-second interaction window.
        await interaction.response.defer_update()
        try:
            music = interaction.client.music
            state = await music.get_state(interaction.guild_id)
            paused = bool((state.get("current") or {}).get("paused"))
            await music.set_paused(interaction.guild_id, not paused)
            await interaction.edit_original_response(view=NowPlayingView(paused=not paused))
        except Exception:  # noqa: BLE001 - the button must never sit on an error
            logger.exception("NP pause toggle failed")
            await interaction.followup.send("Playback control failed — try again.", ephemeral=True)

    @discord.ui.button(emoji="⏭", label="Skip", style=discord.ButtonStyle.secondary, custom_id="np:skip")
    async def skip(self, interaction: discord.Interaction, _button: discord.ui.Button) -> None:
        await interaction.response.defer_update()
        try:
            result = await interaction.client.music.request_skip(interaction.guild_id, interaction.user.id)
            if not result.get("skipped"):
                await interaction.followup.send(
                    f"Skip vote: {result.get('votes')}/{result.get('needed')}", ephemeral=True
                )
        except Exception:  # noqa: BLE001
            logger.exception("NP skip failed")
            await interaction.followup.send("Skip failed — try again.", ephemeral=True)
