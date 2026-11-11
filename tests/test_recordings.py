"""Voice recording feature: sink, guards, transcription helpers, DB and API."""

from __future__ import annotations

import asyncio
import wave
from collections.abc import AsyncIterator
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI

from app.api import deps
from app.api.routers import auth
from app.api.routers import recordings as recordings_router_module
from app.core.services.music import MusicService, MusicServiceError
from app.core.services.recorder import (
    PCM_RATE,
    RecorderService,
    RecordingError,
    RecordingSession,
    format_transcript_srt,
    format_transcript_txt,
    wav_to_whisper_array,
)
from tests.test_api_integration import GUILD_ID, USER_ID, StubBot, StubGuild, StubPlayer

# --- wav -> whisper array ---

def _write_test_wav(path: Path, frames: int) -> None:
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(PCM_RATE)
        wf.writeframes(b"\x00\x01\x00\x00" * frames)


async def test_wav_to_whisper_array_downmixes_to_mono_16k(tmp_path: Path) -> None:
    path = tmp_path / "speaker.wav"
    _write_test_wav(path, PCM_RATE)  # one second of stereo s16le
    audio = wav_to_whisper_array(path)
    assert audio.dtype.name == "float32"
    # 1 second of 48kHz stereo becomes 1 second of 16kHz mono.
    assert len(audio) == pytest.approx(16000, rel=0.01)


async def test_wav_to_whisper_array_of_empty_file(tmp_path: Path) -> None:
    path = tmp_path / "empty.wav"
    _write_test_wav(path, 0)
    assert len(wav_to_whisper_array(path)) == 0


# --- transcript formatters ---

def test_format_transcript_txt_orders_and_labels() -> None:
    segments = [
        {"user_id": 1, "username": "Alice", "offset_s": 65.0, "duration_s": 2.0, "text": "hi"},
        {"user_id": 2, "username": "", "offset_s": 3700.5, "duration_s": 1.0, "text": "hey"},
    ]
    text = format_transcript_txt(segments, {})
    assert "[00:01:05] Alice: hi" in text
    assert "[01:01:40] user 2: hey" in text


def test_format_transcript_srt_blocks() -> None:
    segments = [
        {"user_id": 1, "username": "Alice", "offset_s": 1.0, "duration_s": 2.0, "text": "hi"},
        {"user_id": 1, "username": "Alice", "offset_s": 4.0, "duration_s": 2.0, "text": "bye"},
    ]
    srt = format_transcript_srt(segments, {})
    assert srt.splitlines()[0] == "1"
    assert "00:00:01,000 --> 00:00:03,000" in srt
    assert "Alice: hi" in srt and "Alice: bye" in srt
    assert srt.rstrip().endswith("Alice: bye")


# --- DAVE (E2EE) frame unwrap ---

class _FakeDAVE:
    def __init__(self, *, ready=True, fail=False, active=True):
        import davey

        self.ready = ready
        self.status = davey.SessionStatus.active if active else davey.SessionStatus.pending
        self.calls = []
        self._fail = fail

    def decrypt(self, user_id, media_type, packet):
        self.calls.append((user_id, media_type, packet))
        if self._fail:
            raise RuntimeError("boom")
        return b"PLAIN"


def _fake_decoder(session, version, cached_id=None, ssrc_map=None):
    from types import SimpleNamespace as NS

    sink = NS(voice_client=NS(
        _connection=NS(dave_session=session, dave_protocol_version=version),
        _get_id_from_ssrc=lambda s: (ssrc_map or {}).get(s),
    ))
    return NS(sink=sink, _cached_id=cached_id, ssrc=2967)


def test_dave_decrypt_unwraps_frame_with_resolved_sender() -> None:
    import davey
    import app.core.services.recorder as rec

    session = _FakeDAVE()
    dec = _fake_decoder(session, version=1, ssrc_map={2967: 42})
    packet = SimpleNamespace(decrypted_data=b"CIPHER")

    rec._dave_decrypt_frame(dec, packet)
    assert packet.decrypted_data == b"PLAIN"
    assert session.calls == [(42, davey.MediaType.audio, b"CIPHER")]
    assert dec._cached_id == 42


def test_dave_decrypt_noops_without_session() -> None:
    import app.core.services.recorder as rec

    dec = _fake_decoder(None, version=0)
    packet = SimpleNamespace(decrypted_data=b"CIPHER")
    rec._dave_decrypt_frame(dec, packet)
    assert packet.decrypted_data == b"CIPHER"

    dec = _fake_decoder(_FakeDAVE(ready=False), version=1)
    rec._dave_decrypt_frame(dec, packet)
    assert packet.decrypted_data == b"CIPHER"

    # davey 0.1.6 keeps ready=False on active sessions: the gate is status.
    dec = _fake_decoder(_FakeDAVE(ready=False), version=1, ssrc_map={2967: 42})
    packet = SimpleNamespace(decrypted_data=b"CIPHER")
    rec._dave_decrypt_frame(dec, packet)
    assert packet.decrypted_data == b"PLAIN"

    dec = _fake_decoder(_FakeDAVE(active=False), version=1)
    packet = SimpleNamespace(decrypted_data=b"CIPHER")
    rec._dave_decrypt_frame(dec, packet)
    assert packet.decrypted_data == b"CIPHER"


def test_dave_decrypt_noops_for_unmapped_ssrc() -> None:
    import app.core.services.recorder as rec

    session = _FakeDAVE()
    dec = _fake_decoder(session, version=1, ssrc_map={})
    packet = SimpleNamespace(decrypted_data=b"CIPHER")
    rec._dave_decrypt_frame(dec, packet)
    assert packet.decrypted_data == b"CIPHER"
    assert session.calls == []


# --- SpeakerSink ---

def _fake_voice_data(pcm: bytes) -> SimpleNamespace:
    return SimpleNamespace(pcm=pcm)


def _fake_user(user_id: int, *, bot: bool = False) -> SimpleNamespace:
    return SimpleNamespace(id=user_id, bot=bot, display_name=f"u{user_id}")


def _make_sink(tmp_path: Path):
    # voice_recv is only importable with discord installed; the sink class
    # itself is defined conditionally.
    from app.core.services.recorder import SpeakerSink

    return SpeakerSink(tmp_path)


def test_speaker_sink_writes_per_user_wav_and_skips_bots(tmp_path: Path) -> None:
    sink = _make_sink(tmp_path)
    # One stereo s16le frame is 4 bytes.
    sink.write(_fake_user(1), _fake_voice_data(b"\x00\x00\x00\x00" * 100))
    sink.write(_fake_user(2), _fake_voice_data(b"\x00\x00\x00\x00" * 50))
    sink.write(_fake_user(3, bot=True), _fake_voice_data(b"\x00\x00\x00\x00" * 999))
    sink.write(_fake_user(1), _fake_voice_data(b"\x00\x00\x00\x00" * 70))
    sink.cleanup()
    files = sorted(tmp_path.glob("*.wav"))
    assert [f.name for f in files] == ["1.wav", "2.wav"]
    with wave.open(str(tmp_path / "1.wav"), "rb") as wf:
        assert wf.getnchannels() == 2 and wf.getframerate() == PCM_RATE
        assert wf.getnframes() == 170
    assert sink._users == {1: "u1", 2: "u2"}
    # The bot never enters the roster or the offsets.
    assert 3 not in sink._first_offset


def test_speaker_sink_records_first_packet_offset(tmp_path: Path) -> None:
    import time

    sink = _make_sink(tmp_path)
    sink.write(_fake_user(1), _fake_voice_data(b""))
    time.sleep(0.05)
    sink.write(_fake_user(2), _fake_voice_data(b""))
    sink.cleanup()
    assert sink._first_offset[2] >= sink._first_offset[1] + 0.04


# --- RecorderService guards ---

def _service(db, config) -> RecorderService:
    bot = SimpleNamespace(get_guild=lambda gid: None, music=None)
    return RecorderService(bot, db, config)


async def test_recorder_start_refuses_double_session(db, config) -> None:
    recorder = _service(db, config)
    recorder.sessions[GUILD_ID] = SimpleNamespace(recording_id=1)
    with pytest.raises(RecordingError):
        await recorder.start(GUILD_ID, 123, USER_ID)


async def test_recorder_stop_without_session(db, config) -> None:
    recorder = _service(db, config)
    with pytest.raises(RecordingError):
        await recorder.stop(GUILD_ID)


async def test_music_connect_refuses_while_recording(db, config) -> None:
    service = MusicService(None, db, config)
    service.get_guild = lambda gid: SimpleNamespace(get_channel=lambda cid: None)  # type: ignore[method-assign]
    service.recorder = SimpleNamespace(is_recording=lambda gid: True, exclusive=lambda: True)
    with pytest.raises(MusicServiceError, match="recording"):
        await service.connect(GUILD_ID, 1, USER_ID)


async def test_music_connect_allowed_with_dedicated_recorder(db, config) -> None:
    """A dedicated recorder bot owns its voice session: music joins freely."""
    service = MusicService(None, db, config)
    service.get_guild = lambda gid: SimpleNamespace(get_channel=lambda cid: None)  # type: ignore[method-assign]
    service.recorder = SimpleNamespace(is_recording=lambda gid: True, exclusive=lambda: False)
    # Reaches the "Voice channel not found." check — i.e. past the guard.
    with pytest.raises(MusicServiceError, match="channel"):
        await service.connect(GUILD_ID, 1, USER_ID)


def test_recorder_exclusive_depends_on_token(config) -> None:
    from dataclasses import replace

    assert RecorderService(None, None, config).exclusive()
    dedicated = replace(config, recorder_bot_token="second-token")
    assert not RecorderService(None, None, dedicated).exclusive()


# --- transcription queue ---

async def test_transcription_queue_processes_fifo(db, config) -> None:
    """Concurrent stops must not run whisper concurrently: one worker, FIFO."""
    recorder = _service(db, config)
    order: list[int] = []

    async def fake_transcribe(session) -> None:
        order.append(session.recording_id)
        await db.update_recording_status(session.recording_id, "done")

    recorder._transcribe = fake_transcribe  # type: ignore[method-assign]
    sessions = []
    for _ in range(3):
        row = await db.add_voice_recording(GUILD_ID, 999, USER_ID, "tavern")
        await db.update_recording_status(row["id"], "queued")
        session = RecordingSession(
            recording_id=row["id"], guild_id=GUILD_ID, channel_id=999, started_by=USER_ID
        )
        sessions.append(session)
        recorder._enqueue(session)
    await asyncio.wait_for(recorder._queue.join(), timeout=5)
    recorder._worker_task.cancel()
    assert order == [s.recording_id for s in sessions]
    statuses = [(await db.get_recording(s.recording_id, GUILD_ID))["status"] for s in sessions]
    assert statuses == ["done", "done", "done"]


async def test_fail_stale_recordings_cleans_after_restart(db, config) -> None:
    live = await db.add_voice_recording(GUILD_ID, 999, USER_ID, "tavern")
    queued = await db.add_voice_recording(GUILD_ID, 999, USER_ID, "tavern")
    await db.update_recording_status(queued["id"], "queued")
    done = await db.add_voice_recording(GUILD_ID, 999, USER_ID, "tavern")
    await db.update_recording_status(done["id"], "done")
    n = await db.fail_stale_recordings()
    assert n == 2
    assert (await db.get_recording(live["id"], GUILD_ID))["status"] == "failed"
    assert (await db.get_recording(queued["id"], GUILD_ID))["status"] == "failed"
    assert (await db.get_recording(done["id"], GUILD_ID))["status"] == "done"


# --- DB roundtrip ---

async def test_recording_db_roundtrip(db, config) -> None:
    row = await db.add_voice_recording(GUILD_ID, 999, USER_ID, "tavern")
    rid = row["id"]
    assert row["status"] == "recording" and row["ended_at"] is None
    await db.update_recording_status(rid, "transcribing")
    got = await db.get_recording(rid, GUILD_ID)
    assert got["status"] == "transcribing" and got["ended_at"] is not None
    await db.add_recording_segments(rid, [
        {"user_id": 1, "username": "Alice", "offset_s": 3.2, "duration_s": 1.0, "text": "hello"},
        {"user_id": 2, "username": "Bob", "offset_s": 1.0, "duration_s": 0.5, "text": "ey"},
    ])
    segments = await db.get_segments(rid)
    # Ordered by offset, not insertion order.
    assert [s["username"] for s in segments] == ["Bob", "Alice"]
    assert rid in [r["id"] for r in await db.list_voice_recordings(GUILD_ID)]
    assert await db.delete_recording(rid, GUILD_ID)
    assert await db.get_recording(rid, GUILD_ID) is None
    assert await db.get_segments(rid) == []


async def test_get_recording_is_scoped_to_guild(db, config) -> None:
    row = await db.add_voice_recording(GUILD_ID, 999, USER_ID, "tavern")
    assert await db.get_recording(row["id"], GUILD_ID + 1) is None
    assert not await db.delete_recording(row["id"], GUILD_ID + 1)


# --- API contract ---

@pytest.fixture
async def recordings_api(config, db) -> AsyncIterator[httpx.AsyncClient]:
    service = MusicService(None, db, config)
    guild = StubGuild(StubPlayer())
    # bot_section_available inspects the bot's guild permissions.
    guild.me = SimpleNamespace(
        guild_permissions=SimpleNamespace(
            connect=True, speak=True, view_channel=True, send_messages=True,
            moderate_members=False, kick_members=False, ban_members=False,
        )
    )
    bot = StubBot(guild)
    service.bot = bot

    app = FastAPI()
    app.state.config = config
    app.state.db = db
    app.state.music = service
    app.state.bot = bot
    app.state.oauth = SimpleNamespace()
    app.include_router(recordings_router_module.router)
    app.include_router(auth.router)

    token = await deps.create_session(
        db, {"access_token": "at", "refresh_token": "rt"},
        {"id": str(USER_ID), "username": "tester", "global_name": "Tester"},
    )
    session_id = deps.hash_token(token)
    deps.set_access_mock(session_id, GUILD_ID, "owner")
    transport = httpx.ASGITransport(app=app)
    client = httpx.AsyncClient(transport=transport, base_url="http://test",
                               cookies={deps.SESSION_COOKIE: token})
    try:
        yield client
    finally:
        await client.aclose()
        deps.set_access_mock(session_id, GUILD_ID, None)
        deps._member_cache.clear()


async def test_recordings_list_and_404_contract(recordings_api, db) -> None:
    client = recordings_api
    assert (await client.get(f"/api/guilds/{GUILD_ID}/recordings")).json() == []
    row = await db.add_voice_recording(GUILD_ID, 999, USER_ID, "tavern")
    listing = (await client.get(f"/api/guilds/{GUILD_ID}/recordings")).json()
    assert listing[0]["id"] == row["id"] and listing[0]["status"] == "recording"
    # Other-guild and unknown ids answer 404, never leak.
    r = await client.get(f"/api/guilds/{GUILD_ID}/recordings/{row['id'] + 1}")
    assert r.status_code == 404
    r = await client.get(f"/api/guilds/{GUILD_ID}/recordings/{row['id']}/transcript")
    assert r.status_code == 200 and r.json() == []
    r = await client.delete(f"/api/guilds/{GUILD_ID}/recordings/{row['id'] + 5}")
    assert r.status_code == 404


async def test_recording_download_formats(recordings_api, db) -> None:
    row = await db.add_voice_recording(GUILD_ID, 999, USER_ID, "tavern")
    await db.add_recording_segments(row["id"], [
        {"user_id": 1, "username": "Alice", "offset_s": 2.0, "duration_s": 1.0, "text": "hello"},
    ])
    txt = await recordings_api.get(f"/api/guilds/{GUILD_ID}/recordings/{row['id']}/download")
    assert txt.status_code == 200 and "Alice: hello" in txt.text
    srt = await recordings_api.get(f"/api/guilds/{GUILD_ID}/recordings/{row['id']}/download?fmt=srt")
    assert "00:00:02,000" in srt.text


async def test_recording_delete_by_non_starter_is_403(recordings_api, db) -> None:
    row = await db.add_voice_recording(GUILD_ID, 999, started_by=USER_ID + 7, title="tavern")
    r = await recordings_api.delete(f"/api/guilds/{GUILD_ID}/recordings/{row['id']}")
    assert r.status_code == 403
