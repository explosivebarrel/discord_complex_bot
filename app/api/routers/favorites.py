from __future__ import annotations

from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import CurrentUser, get_current_user, get_db
from app.core.db import Database

if TYPE_CHECKING:
    pass

router = APIRouter(prefix="/api/favorites", tags=["favorites"])


class FavoriteBody(BaseModel):
    title: str
    author: str = ""
    uri: str
    source: str = ""
    length_ms: int = 0
    artwork: str | None = None


@router.get("")
async def list_favorites(
    user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> list[dict[str, Any]]:
    return await db.list_favorites(user.discord_id)


@router.post("")
async def add_favorite(
    body: FavoriteBody,
    user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    favorite_id = await db.add_favorite(
        user.discord_id,
        title=body.title,
        author=body.author,
        uri=body.uri,
        source=body.source,
        length_ms=body.length_ms,
        artwork=body.artwork,
    )
    return {"id": favorite_id}


@router.delete("/{favorite_id}")
async def remove_favorite(
    favorite_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    removed = await db.remove_favorite(user.discord_id, favorite_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Favorite not found")
    return {"removed": True}
