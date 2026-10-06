from __future__ import annotations

import logging
from typing import TYPE_CHECKING

import discord
from discord import app_commands
from discord.ext import commands

if TYPE_CHECKING:
    from app.bot.client import ComplexBot

logger = logging.getLogger(__name__)


class ModerationCog(commands.Cog):
    """Basic moderation stub; extended per-guild management arrives in later iterations."""

    def __init__(self, bot: ComplexBot) -> None:
        self.bot = bot

    @app_commands.command(name="clear", description="Delete the last N messages in this channel (max 100)")
    @app_commands.guild_only()
    @app_commands.default_permissions(manage_messages=True)
    async def clear(self, interaction: discord.Interaction, amount: app_commands.Range[int, 1, 100]) -> None:
        assert isinstance(interaction.channel, discord.TextChannel)
        await interaction.response.defer(ephemeral=True)
        deleted = await interaction.channel.purge(limit=amount, bulk=True)
        await interaction.followup.send(f"🧹 Deleted {len(deleted)} messages.", ephemeral=True)
        await self.bot.db.audit(
            "moderation.clear",
            guild_id=interaction.guild_id,
            actor_id=interaction.user.id,
            details={"amount": len(deleted), "channel_id": interaction.channel_id},
        )


async def setup(bot: ComplexBot) -> None:
    await bot.add_cog(ModerationCog(bot))
