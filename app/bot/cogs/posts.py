from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Union

import discord
from discord import app_commands
from discord.ext import commands

if TYPE_CHECKING:
    from app.bot.client import ComplexBot

logger = logging.getLogger(__name__)


class PostsError(Exception):
    """A post could not be published. Show the message text to the user."""


async def publish_post(bot: ComplexBot, channel_id: int, title: str | None, text: str) -> str:
    """Create a thread post in a forum channel or send a message to a text
    channel. Returns a short human-readable result."""
    channel = bot.get_channel(channel_id)
    if channel is None:
        raise PostsError("Channel not found. Is the bot on this server?")
    if isinstance(channel, discord.ForumChannel):
        if not (title or "").strip():
            raise PostsError("A forum post needs a title.")
        try:
            thread = await channel.create_post(name=title.strip()[:100], content=text)
        except discord.Forbidden as exc:
            raise PostsError("I lack the permissions to create posts in that channel.") from exc
        return f"post created: {thread.mention}"
    if isinstance(channel, discord.TextChannel):
        try:
            await channel.send(text)
        except discord.Forbidden as exc:
            raise PostsError("I lack the permissions to send messages in that channel.") from exc
        return f"message sent to {channel.mention}"
    raise PostsError("That channel type is not supported.")


class PostsCog(commands.Cog):
    """Publishing: forum posts, threads and announcements."""

    def __init__(self, bot: ComplexBot) -> None:
        self.bot = bot

    @app_commands.command(
        name="post", description="Create a post: a thread in forum channels or a message in text channels"
    )
    @app_commands.describe(
        channel="Target channel (forum channels create a thread with a title)",
        text="Post text",
        title="Post title (required for forum channels)",
    )
    @app_commands.guild_only()
    @app_commands.default_permissions(manage_guild=True)
    async def post(
        self,
        interaction: discord.Interaction,
        channel: Union[discord.TextChannel, discord.ForumChannel],
        text: str,
        title: str | None = None,
    ) -> None:
        await interaction.response.defer(ephemeral=True)
        try:
            result = await publish_post(self.bot, channel.id, title, text)
        except PostsError as exc:
            await interaction.followup.send(f"❌ {exc}", ephemeral=True)
            return
        await interaction.followup.send(f"✅ {result}", ephemeral=True)
        await self.bot.db.audit(
            "posts.publish",
            guild_id=interaction.guild_id,
            actor_id=interaction.user.id,
            details={"channel_id": channel.id, "kind": type(channel).__name__},
        )

    @app_commands.command(name="announce", description="Post an announcement embed in this channel")
    @app_commands.describe(text="Announcement text", title="Announcement title")
    @app_commands.guild_only()
    @app_commands.default_permissions(manage_guild=True)
    async def announce(
        self, interaction: discord.Interaction, text: str, title: str = "Announcement"
    ) -> None:
        embed = discord.Embed(title=title, description=text, color=discord.Color.from_str("#D0BCFF"))
        embed.set_author(name=interaction.user.display_name, icon_url=interaction.user.display_avatar.url)
        await interaction.response.send_message(embed=embed)
        await self.bot.db.audit(
            "posts.announce",
            guild_id=interaction.guild_id,
            actor_id=interaction.user.id,
            details={"channel_id": interaction.channel_id},
        )


async def setup(bot: ComplexBot) -> None:
    await bot.add_cog(PostsCog(bot))
