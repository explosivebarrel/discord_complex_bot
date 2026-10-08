from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from app.bot.client import ComplexBot
    from app.core.db import Database


async def collect_known_users(
    bot: ComplexBot, db: Database, guild_id: int, limit: int = 200
) -> list[dict[str, Any]]:
    """Best-effort list of known users of one guild, for pickers.

    The bot runs without the privileged members intent, so the sources are:
    cached members of this guild, voice-connected members and accounts that
    logged into the panel. Deduplicated by Discord id, sorted by name.
    """
    guild = bot.get_guild(guild_id)
    if guild is None:
        return []
    users: dict[str, dict[str, Any]] = {}
    for member in guild.members:
        users[str(member.id)] = {
            "id": str(member.id),
            "name": member.display_name,
            "avatar": member.display_avatar.url,
        }
    for voice_channel in guild.voice_channels:
        for member in voice_channel.members:
            users[str(member.id)] = {
                "id": str(member.id),
                "name": member.display_name,
                "avatar": member.display_avatar.url,
            }
    for panel_user in await db.list_panel_users(limit):
        users.setdefault(
            panel_user["id"],
            {
                "id": panel_user["id"],
                "name": panel_user["global_name"] or panel_user["username"],
                "avatar": (
                    f"https://cdn.discordapp.com/avatars/{panel_user['id']}/{panel_user['avatar']}.png"
                    if panel_user["avatar"]
                    else None
                ),
            },
        )
    known = sorted(users.values(), key=lambda u: u["name"].lower())
    return known[:limit]
