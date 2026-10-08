from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.deps import CurrentUser, get_current_user, get_db
from app.core.db import Database

router = APIRouter(prefix="/api/playlists", tags=["playlists"])


class CreatePlaylistBody(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class PlaylistTrackBody(BaseModel):
    title: str = ""
    author: str = ""
    uri: str
    source: str = ""
    length_ms: int = 0
    artwork: str | None = None


class AddTracksBody(BaseModel):
    tracks: list[PlaylistTrackBody] = Field(min_length=1, max_length=1000)


@router.get("")
async def list_playlists(
    user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> list[dict[str, Any]]:
    return await db.list_user_playlists(user.discord_id)


@router.post("")
async def create_playlist(
    body: CreatePlaylistBody,
    user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    playlist_id = await db.create_user_playlist(user.discord_id, body.name.strip())
    if playlist_id is None:
        raise HTTPException(status_code=409, detail="You already have a playlist with this name")
    return {"id": playlist_id}


@router.get("/{playlist_id}")
async def get_playlist(
    playlist_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    playlist = await db.get_user_playlist(user.discord_id, playlist_id)
    if playlist is None:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return playlist


@router.delete("/{playlist_id}")
async def delete_playlist(
    playlist_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    removed = await db.delete_user_playlist(user.discord_id, playlist_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return {"removed": True}


@router.post("/{playlist_id}/tracks")
async def add_tracks(
    playlist_id: int,
    body: AddTracksBody,
    user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    added = await db.add_user_playlist_tracks(
        user.discord_id,
        playlist_id,
        [t.model_dump() for t in body.tracks],
    )
    if added == 0:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return {"added": added}


@router.delete("/{playlist_id}/tracks/{track_id}")
async def remove_track(
    playlist_id: int,
    track_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    removed = await db.remove_user_playlist_track(user.discord_id, playlist_id, track_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Track not found in the playlist")
    return {"removed": True}
