from __future__ import annotations

import datetime as dt
import logging
from typing import TYPE_CHECKING

import discord
from discord import app_commands
from discord.ext import commands

if TYPE_CHECKING:
    from app.bot.client import ComplexBot

logger = logging.getLogger(__name__)

TIMEOUT_MAX_MINUTES = 28 * 24 * 60  # Discord caps timeouts at 28 days

COLOR_ACTION = discord.Color.orange()
COLOR_STRICT = discord.Color.red()


class ModerationCog(commands.Cog):
    """Moderation commands: kick, ban, timeouts, warnings and message purge."""

    def __init__(self, bot: ComplexBot) -> None:
        self.bot = bot

    # --- helpers ---

    async def _mod_log(
        self, guild: discord.Guild, title: str, description: str, color: discord.Color
    ) -> None:
        """Mirror a moderation action into the configured log channel, if any."""
        settings = await self.bot.db.get_guild_settings(guild.id)
        if settings.mod_log_channel_id is None:
            return
        channel = guild.get_channel(settings.mod_log_channel_id)
        if not isinstance(channel, discord.TextChannel):
            return
        try:
            await channel.send(embed=discord.Embed(title=title, description=description, color=color))
        except discord.Forbidden:
            pass  # the log channel lost permissions; the action itself still happened

    @staticmethod
    def _reason_text(reason: str | None) -> str:
        return reason if (reason and reason.strip()) else "no reason"

    # --- commands ---

    @app_commands.command(name="kick", description="Kick a member from the server")
    @app_commands.describe(member="Member to kick", reason="Why the member is kicked")
    @app_commands.guild_only()
    @app_commands.default_permissions(kick_members=True)
    async def kick(
        self, interaction: discord.Interaction, member: discord.Member, reason: str | None = None
    ) -> None:
        await interaction.response.defer(ephemeral=True)
        try:
            await member.kick(reason=self._reason_text(reason))
        except discord.Forbidden:
            await interaction.followup.send(
            "❌ I cannot kick this member (role hierarchy or missing rights).", ephemeral=True
        )
            return
        text = self._reason_text(reason)
        await interaction.followup.send(f"👢 Kicked **{member.display_name}** ({text}).", ephemeral=True)
        await self._mod_log(interaction.guild, "Member kicked", f"{member.mention} — {text}", COLOR_STRICT)
        await self.bot.db.audit(
            "moderation.kick",
            guild_id=interaction.guild_id,
            actor_id=interaction.user.id,
            details={"user_id": member.id, "reason": text},
        )

    @app_commands.command(name="ban", description="Ban a member from the server")
    @app_commands.describe(
        member="Member to ban",
        delete_days="Also delete their messages from the last N days",
        reason="Why the member is banned",
    )
    @app_commands.guild_only()
    @app_commands.default_permissions(ban_members=True)
    async def ban(
        self,
        interaction: discord.Interaction,
        member: discord.Member,
        delete_days: app_commands.Range[int, 0, 7] = 0,
        reason: str | None = None,
    ) -> None:
        await interaction.response.defer(ephemeral=True)
        try:
            await interaction.guild.ban(
                member, delete_message_seconds=delete_days * 86400, reason=self._reason_text(reason)
            )
        except discord.Forbidden:
            await interaction.followup.send("❌ I cannot ban this member (missing rights).", ephemeral=True)
            return
        text = self._reason_text(reason)
        await interaction.followup.send(f"🔨 Banned **{member.display_name}** ({text}).", ephemeral=True)
        await self._mod_log(interaction.guild, "Member banned", f"{member.mention} — {text}", COLOR_STRICT)
        await self.bot.db.audit(
            "moderation.ban",
            guild_id=interaction.guild_id,
            actor_id=interaction.user.id,
            details={"user_id": member.id, "delete_days": delete_days, "reason": text},
        )

    @app_commands.command(name="unban", description="Lift a ban by user id")
    @app_commands.describe(user_id="Discord id of the banned user")
    @app_commands.guild_only()
    @app_commands.default_permissions(ban_members=True)
    async def unban(self, interaction: discord.Interaction, user_id: str) -> None:
        await interaction.response.defer(ephemeral=True)
        if not user_id.isdigit():
            await interaction.followup.send("❌ The user id must be digits only.", ephemeral=True)
            return
        try:
            user = await self.bot.fetch_user(int(user_id))
            await interaction.guild.unban(user)
        except discord.NotFound:
            await interaction.followup.send("❌ This user is not banned.", ephemeral=True)
            return
        except discord.Forbidden:
            await interaction.followup.send("❌ I cannot lift bans (missing rights).", ephemeral=True)
            return
        await interaction.followup.send(f"✅ Unbanned **{user}**.", ephemeral=True)
        await self._mod_log(interaction.guild, "Ban lifted", f"<@{user_id}>", COLOR_ACTION)
        await self.bot.db.audit(
            "moderation.unban",
            guild_id=interaction.guild_id,
            actor_id=interaction.user.id,
            details={"user_id": user_id},
        )

    @app_commands.command(name="timeout", description="Timeout a member (native Discord mute)")
    @app_commands.describe(
        member="Member to timeout",
        minutes="Duration in minutes (max 28 days)",
        reason="Why the member is timed out",
    )
    @app_commands.guild_only()
    @app_commands.default_permissions(moderate_members=True)
    async def timeout(
        self,
        interaction: discord.Interaction,
        member: discord.Member,
        minutes: app_commands.Range[int, 1, TIMEOUT_MAX_MINUTES],
        reason: str | None = None,
    ) -> None:
        await interaction.response.defer(ephemeral=True)
        until = discord.utils.utcnow() + dt.timedelta(minutes=minutes)
        try:
            await member.timeout(until, reason=self._reason_text(reason))
        except discord.Forbidden:
            await interaction.followup.send(
            "❌ I cannot timeout this member (role hierarchy or missing rights).", ephemeral=True
        )
            return
        text = self._reason_text(reason)
        await interaction.followup.send(
            f"🔇 **{member.display_name}** timed out for {minutes} min ({text}).", ephemeral=True
        )
        await self._mod_log(
            interaction.guild,
            "Member timed out",
            f"{member.mention} for {minutes} min — {text}",
            COLOR_ACTION,
        )
        await self.bot.db.audit(
            "moderation.timeout",
            guild_id=interaction.guild_id,
            actor_id=interaction.user.id,
            details={"user_id": member.id, "minutes": minutes, "reason": text},
        )

    @app_commands.command(name="untimeout", description="Remove the timeout from a member")
    @app_commands.guild_only()
    @app_commands.default_permissions(moderate_members=True)
    async def untimeout(self, interaction: discord.Interaction, member: discord.Member) -> None:
        await interaction.response.defer(ephemeral=True)
        try:
            await member.timeout(None)
        except discord.Forbidden:
            await interaction.followup.send("❌ I cannot remove timeouts (missing rights).", ephemeral=True)
            return
        await interaction.followup.send(f"🔊 Timeout removed for **{member.display_name}**.", ephemeral=True)
        await self._mod_log(interaction.guild, "Timeout removed", member.mention, COLOR_ACTION)
        await self.bot.db.audit(
            "moderation.untimeout",
            guild_id=interaction.guild_id,
            actor_id=interaction.user.id,
            details={"user_id": member.id},
        )

    @app_commands.command(name="warn", description="Give a member a warning (stored in the bot database)")
    @app_commands.describe(member="Member to warn", reason="What the warning is for")
    @app_commands.guild_only()
    @app_commands.default_permissions(manage_messages=True)
    async def warn(self, interaction: discord.Interaction, member: discord.Member, reason: str) -> None:
        await self.bot.db.add_warning(
            interaction.guild_id,
            member.id,
            user_name=member.display_name,
            issuer_id=interaction.user.id,
            issuer_name=interaction.user.display_name,
            reason=reason,
        )
        count = len(await self.bot.db.list_warnings(interaction.guild_id, user_id=member.id))
        await interaction.response.send_message(
            f"⚠️ Warned **{member.display_name}** ({reason}). They now have {count} warning(s).",
            ephemeral=True,
        )
        await self._mod_log(
            interaction.guild,
            "Member warned",
            f"{member.mention} — {reason} ({count} total)",
            COLOR_ACTION,
        )
        await self.bot.db.audit(
            "moderation.warn",
            guild_id=interaction.guild_id,
            actor_id=interaction.user.id,
            details={"user_id": member.id, "reason": reason, "count": count},
        )

    @app_commands.command(name="warnings", description="Show warnings of a member")
    @app_commands.describe(member="Member to look up")
    @app_commands.guild_only()
    @app_commands.default_permissions(manage_messages=True)
    async def warnings(self, interaction: discord.Interaction, member: discord.Member) -> None:
        rows = await self.bot.db.list_warnings(interaction.guild_id, user_id=member.id, limit=25)
        if not rows:
            await interaction.response.send_message(
                f"**{member.display_name}** has no warnings.", ephemeral=True
            )
            return
        lines = [f"• {row['created_at'][:10]} — {row['reason']} (by {row['issuer_name']})" for row in rows]
        await interaction.response.send_message(
            f"⚠️ **{member.display_name}** — {len(rows)} warning(s):\n" + "\n".join(lines[:25]),
            ephemeral=True,
        )

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
