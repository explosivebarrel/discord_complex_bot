from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse, Response
from pydantic import BaseModel

from app.api.deps import CurrentUser, get_config, get_db, get_recorder, require_section_access
from app.core.db import Database
from app.core.services.recorder import RecordingError, format_transcript_srt, format_transcript_txt

if TYPE_CHECKING:
    from app.core.config import Config

router = APIRouter(prefix="/api/guilds/{guild_id}/recordings", tags=["recordings"])
section = require_section_access("recordings")


class StartRecordingPayload(BaseModel):
    channel_id: int
    title: str | None = None
    prompt: str | None = None
    language: str | None = None


class UpdateRecordingPayload(BaseModel):
    title: str | None = None
    prompt: str | None = None
    language: str | None = None


class RetranscribePayload(BaseModel):
    prompt: str | None = None
    language: str | None = None


def _recording_dir(config: Config, guild_id: int, recording_id: int) -> Path:
    return Path(config.recordings_dir) / str(guild_id) / str(recording_id)


def _load_file_segments(config: Config, guild_id: int, recording_id: int) -> list[dict[str, Any]] | None:
    path = _recording_dir(config, guild_id, recording_id) / "transcript.json"
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data.get("segments", [])
        if isinstance(data, list):
            return data
    except Exception:
        return None
    return None


@router.get("")
async def list_recordings(
    guild_id: int,
    user: CurrentUser = Depends(section),
    db: Database = Depends(get_db),
) -> list[dict[str, Any]]:
    return await db.list_voice_recordings(guild_id)


@router.post("/start")
async def start_recording(
    guild_id: int,
    payload: StartRecordingPayload,
    user: CurrentUser = Depends(section),
    recorder: Any = Depends(get_recorder),
) -> dict[str, Any]:
    if recorder is None:
        raise HTTPException(status_code=503, detail="Recorder service is not available")
    try:
        return await recorder.start(
            guild_id=guild_id,
            channel_id=payload.channel_id,
            requester_id=user.discord_id,
            title=payload.title,
            prompt=payload.prompt,
            language=payload.language,
        )
    except RecordingError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/stop")
async def stop_recording(
    guild_id: int,
    user: CurrentUser = Depends(section),
    recorder: Any = Depends(get_recorder),
) -> dict[str, Any]:
    if recorder is None:
        raise HTTPException(status_code=503, detail="Recorder service is not available")
    try:
        return await recorder.stop(guild_id=guild_id, requester_id=user.discord_id)
    except RecordingError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/active")
async def active_recording(
    guild_id: int,
    user: CurrentUser = Depends(section),
    recorder: Any = Depends(get_recorder),
) -> dict[str, Any] | None:
    if recorder is None:
        return None
    session = recorder.session(guild_id)
    if session is None:
        return None
    return {
        "recording_id": session.recording_id,
        "guild_id": session.guild_id,
        "channel_id": session.channel_id,
        "started_by": session.started_by,
        "prompt": getattr(session, "prompt", ""),
        "language": getattr(session, "language", ""),
        "speakers": list(session.usernames.keys()) if getattr(session, "usernames", None) else [],
    }


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
    segments = _load_file_segments(config, guild_id, recording_id)
    if segments is None:
        segments = await db.get_segments(recording_id)
    speakers: dict[int, str] = {}
    for seg in segments:
        speakers.setdefault(seg["user_id"], seg.get("username") or f"user {seg['user_id']}")
    directory = _recording_dir(config, guild_id, recording_id)
    # Speakers with wav audio on disk (the transcript may lag the files).
    for wav in sorted(directory.glob("*.wav")):
        try:
            uid = int(wav.stem)
            speakers.setdefault(uid, f"user {uid}")
        except ValueError:
            pass
    recording["speakers"] = [{"user_id": uid, "username": name} for uid, name in speakers.items()]
    return recording


@router.patch("/{recording_id}")
async def update_recording_metadata(
    guild_id: int,
    recording_id: int,
    payload: UpdateRecordingPayload,
    user: CurrentUser = Depends(section),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    recording = await db.get_recording(recording_id, guild_id)
    if recording is None:
        raise HTTPException(status_code=404, detail="Recording not found")
    if recording["started_by"] != user.discord_id and not user.is_superadmin:
        raise HTTPException(status_code=403, detail="Forbidden")
    updated = await db.update_recording_metadata(
        recording_id,
        guild_id,
        title=payload.title,
        prompt=payload.prompt,
        language=payload.language,
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="Recording not found")
    return updated


@router.post("/{recording_id}/retranscribe")
async def retranscribe_recording(
    guild_id: int,
    recording_id: int,
    payload: RetranscribePayload = RetranscribePayload(),
    user: CurrentUser = Depends(section),
    recorder: Any = Depends(get_recorder),
) -> dict[str, Any]:
    if recorder is None:
        raise HTTPException(status_code=503, detail="Recorder service is not available")
    try:
        return await recorder.retranscribe(
            recording_id=recording_id,
            guild_id=guild_id,
            prompt=payload.prompt,
            language=payload.language,
        )
    except RecordingError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/{recording_id}/transcript")
async def recording_transcript(
    guild_id: int,
    recording_id: int,
    fmt: str = "segments",  # segments (phrases with nested words) | words (flat timeline)
    user: CurrentUser = Depends(section),
    db: Database = Depends(get_db),
    config: Config = Depends(get_config),
) -> list[dict[str, Any]]:
    recording = await db.get_recording(recording_id, guild_id)
    if recording is None:
        raise HTTPException(status_code=404, detail="Recording not found")
    segments = _load_file_segments(config, guild_id, recording_id)
    if segments is None:
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
                    "username": seg.get("username", ""),
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
    config: Config = Depends(get_config),
) -> Response:
    recording = await db.get_recording(recording_id, guild_id)
    if recording is None:
        raise HTTPException(status_code=404, detail="Recording not found")
    directory = _recording_dir(config, guild_id, recording_id)
    if fmt == "srt":
        srt_file = directory / "transcript.srt"
        if srt_file.is_file():
            return PlainTextResponse(
                srt_file.read_text(encoding="utf-8"),
                media_type="application/x-subrip",
                headers={"Content-Disposition": f'attachment; filename="recording-{recording_id}.srt"'},
            )
        segments = _load_file_segments(config, guild_id, recording_id)
        if segments is None:
            segments = await db.get_segments(recording_id)
        usernames = {s["user_id"]: s.get("username", "") for s in segments}
        return PlainTextResponse(
            format_transcript_srt(segments, usernames),
            media_type="application/x-subrip",
            headers={"Content-Disposition": f'attachment; filename="recording-{recording_id}.srt"'},
        )
    if fmt == "json":
        json_file = directory / "transcript.json"
        if json_file.is_file():
            return PlainTextResponse(
                json_file.read_text(encoding="utf-8"),
                media_type="application/json",
                headers={"Content-Disposition": f'attachment; filename="recording-{recording_id}.json"'},
            )
        segments = _load_file_segments(config, guild_id, recording_id)
        if segments is None:
            segments = await db.get_segments(recording_id)
        return PlainTextResponse(
            json.dumps({"recording_id": recording_id, "guild_id": guild_id, "segments": segments}, ensure_ascii=False, indent=2),
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="recording-{recording_id}.json"'},
        )
    txt_file = directory / "transcript.txt"
    if txt_file.is_file():
        return PlainTextResponse(
            txt_file.read_text(encoding="utf-8"),
            media_type="text/plain",
            headers={"Content-Disposition": f'attachment; filename="recording-{recording_id}.txt"'},
        )
    segments = _load_file_segments(config, guild_id, recording_id)
    if segments is None:
        segments = await db.get_segments(recording_id)
    usernames = {s["user_id"]: s.get("username", "") for s in segments}
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
