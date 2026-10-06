from __future__ import annotations

import logging
from typing import TYPE_CHECKING

import discord
from discord import app_commands
from discord.ext import commands

if TYPE_CHECKING:
    from app.bot.client import ComplexBot

logger = logging.getLogger(__name__)


def is_superadmin(bot: ComplexBot, user_id: int) -> bool:
    return user_id in bot.config.superadmin_ids


class OwnerCog(commands.Cog):
    """Commands for super-admins. These commands work in Discord, not in the web panel."""

    def __init__(self, bot: ComplexBot) -> None:
        self.bot = bot

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if is_superadmin(self.bot, interaction.user.id):
            return True
        await interaction.response.send_message("Super-admin only.", ephemeral=True)
        return False

    @app_commands.command(name="sync", description="Super-admin only: re-sync slash commands")
    @app_commands.guild_only()
    async def sync(self, interaction: discord.Interaction) -> None:
        await interaction.response.defer(ephemeral=True)
        synced = await self.bot.tree.sync()
        await interaction.followup.send(f"Synced {len(synced)} commands.", ephemeral=True)


async def setup(bot: ComplexBot) -> None:
    await bot.add_cog(OwnerCog(bot))
