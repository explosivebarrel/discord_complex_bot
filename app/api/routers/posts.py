from __future__ import annotations

from typing import TYPE_CHECKING, Any

import discord
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import CurrentUser, get_bot, get_db, require_guild_admin
from app.bot.cogs.posts import PostsError, publish_post
from app.core.db import Database

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
    channels = [
        {"id": str(ch.id), "name": ch.name, "type": "text"} for ch in guild.text_channels
    ]
    channels += [
        {"id": str(ch.id), "name": ch.name, "type": "forum"} for ch in guild.forum_channels
    ]
    return channels


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
