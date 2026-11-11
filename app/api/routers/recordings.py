from __future__ import annotations

import shutil
from pathlib import Path
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse, Response

from app.api.deps import CurrentUser, get_config, get_db, require_section_access
from app.core.db import Database
from app.core.services.recorder import format_transcript_srt, format_transcript_txt

if TYPE_CHECKING:
    from app.core.config import Config

router = APIRouter(prefix="/api/guilds/{guild_id}/recordings", tags=["recordings"])
section = require_section_access("recordings")


def _recording_dir(config: Config, guild_id: int, recording_id: int) -> Path:
    return Path(config.recordings_dir) / str(guild_id) / str(recording_id)


@router.get("")
async def list_recordings(
    guild_id: int,
    user: CurrentUser = Depends(section),
    db: Database = Depends(get_db),
) -> list[dict[str, Any]]:
    return await db.list_voice_recordings(guild_id)


@router.get("/{recording_id}")
async def recording_details(
    guild_id: int,
    recording_id: int,
    user: CurrentUser = Depends(section),
    db: Database = Depends(get_db),
    config: Config = Depends(get_config),
) -> dict[str, Any]:
    recording = await db.get_recording(recording_id, guild_id)
    if recording is None:
        raise HTTPException(status_code=404, detail="Recording not found")
    segments = await db.get_segments(recording_id)
    speakers: dict[int, str] = {}
    for seg in segments:
        speakers.setdefault(seg["user_id"], seg["username"] or f"user {seg['user_id']}")
    directory = _recording_dir(config, guild_id, recording_id)
    # Speakers with wav audio on disk (the transcript may lag the files).
    for wav in sorted(directory.glob("*.wav")):
        speakers.setdefault(int(wav.stem), f"user {wav.stem}")
    recording["speakers"] = [{"user_id": uid, "username": name} for uid, name in speakers.items()]
    return recording


@router.get("/{recording_id}/transcript")
async def recording_transcript(
    guild_id: int,
    recording_id: int,
    fmt: str = "segments",  # segments (phrases with nested words) | words (flat timeline)
    user: CurrentUser = Depends(section),
    db: Database = Depends(get_db),
) -> list[dict[str, Any]]:
    recording = await db.get_recording(recording_id, guild_id)
    if recording is None:
        raise HTTPException(status_code=404, detail="Recording not found")
    segments = await db.get_segments(recording_id)
    if fmt == "words":
        # Flat per-word timeline across all speakers — for karaoke-style
        # UIs, seeking and word-level analytics.
        words: list[dict[str, Any]] = []
        for seg in segments:
            for w in seg.get("words", []):
                words.append({
                    "w": w["w"],
                    "start": w["start"],
                    "end": w["end"],
                    "user_id": seg["user_id"],
                    "username": seg["username"],
                })
        words.sort(key=lambda w: w["start"])
        return words
    return segments


@router.get("/{recording_id}/download")
async def recording_download(
    guild_id: int,
    recording_id: int,
    fmt: str = "txt",
    user: CurrentUser = Depends(section),
    db: Database = Depends(get_db),
) -> Response:
    recording = await db.get_recording(recording_id, guild_id)
    if recording is None:
        raise HTTPException(status_code=404, detail="Recording not found")
    segments = await db.get_segments(recording_id)
    usernames = {s["user_id"]: s["username"] for s in segments}
    if fmt == "srt":
        return PlainTextResponse(
            format_transcript_srt(segments, usernames),
            media_type="application/x-subrip",
            headers={"Content-Disposition": f'attachment; filename="recording-{recording_id}.srt"'},
        )
    return PlainTextResponse(
        format_transcript_txt(segments, usernames),
        media_type="text/plain",
        headers={"Content-Disposition": f'attachment; filename="recording-{recording_id}.txt"'},
    )


@router.get("/{recording_id}/audio/{user_id}")
async def recording_audio(
    guild_id: int,
    recording_id: int,
    user_id: int,
    user: CurrentUser = Depends(section),
    db: Database = Depends(get_db),
    config: Config = Depends(get_config),
) -> Response:
    recording = await db.get_recording(recording_id, guild_id)
    if recording is None:
        raise HTTPException(status_code=404, detail="Recording not found")
    path = _recording_dir(config, guild_id, recording_id) / f"{user_id}.wav"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Audio not found")
    return Response(
        content=path.read_bytes(),
        media_type="audio/wav",
        headers={
            "Content-Disposition": (
                f'attachment; filename="recording-{recording_id}-{user_id}.wav"'
            )
        },
    )


@router.delete("/{recording_id}")
async def delete_recording(
    guild_id: int,
    recording_id: int,
    user: CurrentUser = Depends(section),
    db: Database = Depends(get_db),
    config: Config = Depends(get_config),
) -> dict[str, str]:
    recording = await db.get_recording(recording_id, guild_id)
    if recording is None:
        raise HTTPException(status_code=404, detail="Recording not found")
    # The person who started it may clean up after themselves; otherwise
    # only a bot super-admin (the section itself is already admin-gated).
    if recording["started_by"] != user.discord_id and not user.is_superadmin:
        raise HTTPException(
            status_code=403, detail="Only the starter or a super-admin can delete a recording"
        )
    if not await db.delete_recording(recording_id, guild_id):
        raise HTTPException(status_code=404, detail="Recording not found")
    shutil.rmtree(_recording_dir(config, guild_id, recording_id), ignore_errors=True)
    return {"status": "ok"}
