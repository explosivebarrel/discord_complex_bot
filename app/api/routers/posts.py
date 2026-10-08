from __future__ import annotations

from typing import TYPE_CHECKING, Any, Union

import discord
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import CurrentUser, get_bot, get_db, require_guild_admin
from app.bot.cogs.posts import PostsError, publish_post
from app.core.db import Database
from app.core.services.directory import collect_known_users

Snowflake = Union[str, int]

if TYPE_CHECKING:
    from app.bot.client import ComplexBot

router = APIRouter(prefix="/api/guilds/{guild_id}/posts", tags=["posts"])


class PostBody(BaseModel):
    channel_id: int
    text: str
    title: str | None = None


@router.get("/channels")
async def post_channels(
    guild_id: int,
    user: CurrentUser = Depends(require_guild_admin),
    bot: ComplexBot = Depends(get_bot),
) -> list[dict[str, Any]]:
    guild = bot.get_guild(guild_id)
    if guild is None:
        raise HTTPException(status_code=404, detail="Bot is not on this server")
    channels = []
    for ch in guild.channels:
        if isinstance(ch, discord.TextChannel):
            channels.append({"id": str(ch.id), "name": ch.name, "type": "text"})
        elif isinstance(ch, discord.ForumChannel):
            channels.append({"id": str(ch.id), "name": ch.name, "type": "forum"})
    return channels


@router.get("/composer")
async def composer_data(
    guild_id: int,
    user: CurrentUser = Depends(require_guild_admin),
    bot: ComplexBot = Depends(get_bot),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    """Everything the post composer needs: channels, roles, known users
    and custom emojis. The bot has no members intent, so the user list is
    a best effort: cached members, voice-connected members and panel users."""
    guild = bot.get_guild(guild_id)
    if guild is None:
        raise HTTPException(status_code=404, detail="Bot is not on this server")

    channels: list[dict[str, Any]] = []
    for ch in guild.channels:
        if isinstance(ch, discord.TextChannel):
            channels.append({"id": str(ch.id), "name": ch.name, "type": "text"})
        elif isinstance(ch, discord.ForumChannel):
            channels.append({"id": str(ch.id), "name": ch.name, "type": "forum"})

    roles = [
        {
            "id": str(role.id),
            "name": role.name,
            "color": str(role.colour) if role.colour.value else None,
            "mentionable": role.mentionable,
        }
        for role in sorted(
            (r for r in guild.roles if not r.is_default()),
            key=lambda r: r.position,
            reverse=True,
        )
    ]

    user_list = await collect_known_users(bot, db, guild_id)

    emojis = [
        {"name": emoji.name, "id": str(emoji.id), "animated": emoji.animated} for emoji in guild.emojis
    ]

    return {"channels": channels, "roles": roles, "users": user_list, "emojis": emojis}


@router.post("")
async def create_post(
    guild_id: int,
    body: PostBody,
    user: CurrentUser = Depends(require_guild_admin),
    bot: ComplexBot = Depends(get_bot),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    if not body.text.strip():
        raise HTTPException(status_code=400, detail="The post text is empty")
    try:
        result = await publish_post(bot, body.channel_id, body.title, body.text.strip())
    except PostsError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await db.audit(
        "posts.publish",
        guild_id=guild_id,
        actor_id=user.discord_id,
        actor_kind="web",
        details={"channel_id": body.channel_id, "title": body.title},
    )
    return {"result": result}
