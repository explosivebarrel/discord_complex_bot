"""Voice-call recording with per-speaker transcription.

Discord gives every speaker their own opus stream (SSRC), so no ML
diarization is needed: the sink writes one wav per user, faster-whisper
transcribes each stream separately, and every transcript line is
attributed to the exact Discord user.

Exclusive mode by design — one voice connection per guild belongs to
Lavalink while music plays, so recording and playback never coexist:
starting a recording refuses while a track is playing, and
MusicService.connect refuses while a recording is live.
"""

from __future__ import annotations

import asyncio
import logging
import time
import wave
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

try:
    import discord
    from discord.ext import voice_recv
except ImportError:  # pragma: no cover - allows unit tests without discord
    discord = None  # type: ignore[assignment]
    voice_recv = None  # type: ignore[assignment]

from app.core.config import Config
from app.core.db.database import Database

logger = logging.getLogger(__name__)

PCM_RATE = 48000
WHISPER_RATE = 16000


class RecordingError(Exception):
    """User-facing recording failure."""


def wav_to_whisper_array(path: Path) -> np.ndarray:
    """Load a per-speaker wav (48kHz stereo s16le) as mono 16kHz float32."""
    with wave.open(str(path), "rb") as wf:
        raw = wf.readframes(wf.getnframes())
    samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    # Stereo -> mono, then linear resampling 48k -> 16k (exactly 1/3).
    samples = samples.reshape(-1, 2).mean(axis=1)
    target_len = int(len(samples) * WHISPER_RATE / PCM_RATE)
    if target_len == 0:
        return np.zeros(0, dtype=np.float32)
    x_new = np.linspace(0, len(samples) - 1, target_len)
    return np.interp(x_new, np.arange(len(samples)), samples).astype(np.float32)


def format_transcript_txt(segments: list[dict], usernames: dict[int, str]) -> str:
    lines = []
    for seg in segments:
        name = seg.get("username") or usernames.get(seg["user_id"], f"user {seg['user_id']}")
        ts = int(seg["offset_s"])
        lines.append(f"[{ts // 3600:02d}:{ts // 60 % 60:02d}:{ts % 60:02d}] {name}: {seg['text']}")
    return "\n".join(lines)


def format_transcript_srt(segments: list[dict], usernames: dict[int, str]) -> str:
    def _stamp(seconds: float) -> str:
        ms = int(round(seconds * 1000))
        h, ms = divmod(ms, 3600000)
        m, ms = divmod(ms, 60000)
        s, ms = divmod(ms, 1000)
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

    blocks = []
    for i, seg in enumerate(segments, 1):
        name = seg.get("username") or usernames.get(seg["user_id"], f"user {seg['user_id']}")
        start = _stamp(seg["offset_s"])
        end = _stamp(seg["offset_s"] + max(seg.get("duration_s", 0.0), 1.0))
        blocks.append(f"{i}\n{start} --> {end}\n{name}: {seg['text']}")
    return "\n\n".join(blocks) + "\n"


if voice_recv is not None:  # the sink needs the discord.py extension at runtime

    class SpeakerSink(voice_recv.AudioSink):
        """Writes one wav per speaking user (bots are skipped)."""

        def __init__(self, session_dir: Path):
            super().__init__()
            self._dir = session_dir
            self._files: dict[int, wave.Wave_write] = {}
            self._users: dict[int, str] = {}
            self._first_offset: dict[int, float] = {}
            self._t0 = time.monotonic()
            self._frames = 0

        def wants_opus(self) -> bool:
            return False

        def write(self, user, data) -> None:  # types: discord User | VoiceData
            if user is None or getattr(user, "bot", False):
                return
            offset = time.monotonic() - self._t0
            if user.id not in self._files:
                self._users[user.id] = user.display_name
                self._first_offset[user.id] = offset
                wf = wave.open(str(self._dir / f"{user.id}.wav"), "wb")
                wf.setnchannels(2)
                wf.setsampwidth(2)  # s16le
                wf.setframerate(PCM_RATE)
                self._files[user.id] = wf
            try:
                self._files[user.id].writeframes(data.pcm)
                self._frames += 1
            except Exception:  # a broken stream must not kill the reader thread
                logger.exception("Failed to write voice frames for user %s", user.id)

        def cleanup(self) -> None:
            for wf in self._files.values():
                try:
                    wf.close()
                except Exception:
                    pass
            self._files.clear()


@dataclass
class RecordingSession:
    recording_id: int
    guild_id: int
    channel_id: int
    started_by: int
    vc: object = None  # voice_recv.VoiceRecvClient at runtime
    sink: object = None  # SpeakerSink at runtime
    watch_task: asyncio.Task | None = None
    # Populated on stop, before the transcription runs.
    speaker_files: dict[int, Path] = field(default_factory=dict)
    usernames: dict[int, str] = field(default_factory=dict)
    first_offsets: dict[int, float] = field(default_factory=dict)


class RecorderService:
    """Per-guild recording sessions; one live session per guild."""

    def __init__(self, bot, db: Database, config: Config) -> None:
        self.bot = bot
        self.db = db
        self.config = config
        self.hub = None  # set from main.py, like music.hub
        self.sessions: dict[int, RecordingSession] = {}
        self._transcribe_tasks: set[asyncio.Task] = set()
        self._model = None
        self._model_lock = asyncio.Lock()

    # --- status ---

    def is_recording(self, guild_id: int) -> bool:
        return guild_id in self.sessions

    def session(self, guild_id: int) -> RecordingSession | None:
        return self.sessions.get(guild_id)

    # --- lifecycle ---

    async def start(self, guild_id: int, channel_id: int, requester_id: int) -> dict:
        if self.is_recording(guild_id):
            raise RecordingError("A recording is already running in this server.")
        guild = self.bot.get_guild(guild_id)
        if guild is None:
            raise RecordingError("Bot is not on this server.")
        channel = guild.get_channel(channel_id)
        if channel is None or not isinstance(channel, (discord.VoiceChannel, discord.StageChannel)):
            raise RecordingError("Voice channel not found.")
        # Exclusive mode: refuse while music plays, evict an idle connection.

        music = getattr(self.bot, "music", None)
        player = music.get_player(guild_id) if music is not None else None
        if player is not None and player.playing:
            raise RecordingError("Stop playback first — recording and music cannot run together.")
        if player is not None:
            await music.disconnect(guild_id)

        row = await self.db.add_voice_recording(guild_id, channel.id, requester_id, channel.name)
        session_dir = Path(self.config.recordings_dir) / str(guild_id) / str(row["id"])
        session_dir.mkdir(parents=True, exist_ok=True)

        sink = SpeakerSink(session_dir)
        try:
            vc = await channel.connect(cls=voice_recv.VoiceRecvClient, self_deaf=False)
        except discord.ClientException as exc:
            await self.db.update_recording_status(row["id"], "failed", error=str(exc)[:500])
            raise RecordingError(f"Failed to connect: {exc}") from exc
        vc.listen(sink)

        session = RecordingSession(
            recording_id=row["id"],
            guild_id=guild_id,
            channel_id=channel.id,
            started_by=requester_id,
            vc=vc,
            sink=sink,
        )
        self.sessions[guild_id] = session
        session.watch_task = asyncio.create_task(self._watch(session), name=f"recording-watch-{guild_id}")
        await self.db.audit("record.start", guild_id=guild_id, actor_id=requester_id,
                            details={"channel_id": channel.id, "recording_id": row["id"]})
        await self.notify(guild_id, "Recording started", f"{channel.name} — the call is being recorded.")
        logger.info("Recording #%s started in guild %s / %s", row["id"], guild_id, channel.name)
        return row

    async def stop(self, guild_id: int, requester_id: int | None = None) -> dict:
        session = self.sessions.get(guild_id)
        if session is None:
            raise RecordingError("No recording is running in this server.")
        self.sessions.pop(guild_id, None)
        if session.watch_task is not None:
            session.watch_task.cancel()
        vc, sink = session.vc, session.sink
        session.vc = None
        try:
            await vc.disconnect()
        except Exception:
            logger.exception("Recording voice client disconnect failed")
        sink.cleanup()  # closes the wav files
        session.speaker_files = {
            uid: Path(self.config.recordings_dir) / str(guild_id) / str(session.recording_id) / f"{uid}.wav"
            for uid in sink._users
        }
        session.usernames = dict(sink._users)
        session.first_offsets = dict(sink._first_offset)

        total_bytes = sum(p.stat().st_size for p in session.speaker_files.values() if p.exists())
        if total_bytes <= 44:  # a bare wav header = nothing was captured
            await self.db.update_recording_status(
                session.recording_id, "failed",
                error="No speech was captured (nobody talked or the voice stream was silent).",
            )
            await self.notify(guild_id, "Recording failed", "No speech was captured.")
            return await self.db.get_recording(session.recording_id, guild_id)

        await self.db.update_recording_status(session.recording_id, "transcribing")
        await self.db.audit("record.stop", guild_id=guild_id, actor_id=requester_id,
                            details={"recording_id": session.recording_id})
        await self.notify(guild_id, "Recording stopped", "Transcribing the call…")
        task = asyncio.create_task(self._transcribe(session), name=f"transcribe-{session.recording_id}")
        self._transcribe_tasks.add(task)
        task.add_done_callback(self._transcribe_tasks.discard)
        return await self.db.get_recording(session.recording_id, guild_id)

    async def _watch(self, session: RecordingSession) -> None:
        """Auto-stop when the voice client dies (kick, channel delete, crash)."""
        while True:
            await asyncio.sleep(30)
            vc = session.vc
            if vc is None or not vc.is_connected():
                logger.warning("Recording #%s lost its voice client; auto-stopping", session.recording_id)
                try:
                    await self.stop(session.guild_id)
                except RecordingError:
                    pass
                return

    # --- transcription ---

    async def _get_model(self):
        async with self._model_lock:
            if self._model is None:
                from faster_whisper import WhisperModel

                size = self.config.transcribe_model
                logger.info("Loading faster-whisper model %r (first use may download it)", size)
                self._model = await asyncio.to_thread(
                    WhisperModel,
                    size,
                    device="cpu",
                    compute_type="int8",
                    download_root=str(Path(self.config.recordings_dir) / "models"),
                )
            return self._model

    async def _transcribe(self, session: RecordingSession) -> None:
        segments_out: list[dict] = []
        try:
            model = await self._get_model()
            for uid, path in session.speaker_files.items():
                if not path.exists() or path.stat().st_size <= 44:
                    continue
                audio = await asyncio.to_thread(wav_to_whisper_array, path)
                if len(audio) < WHISPER_RATE // 2:  # shorter than 0.5s
                    continue
                raw_segments, _info = await asyncio.to_thread(
                    model.transcribe,
                    audio,
                    language=self.config.transcribe_language or None,
                    vad_filter=True,
                )
                base = session.first_offsets.get(uid, 0.0)
                for seg in raw_segments:
                    segments_out.append({
                        "user_id": uid,
                        "username": session.usernames.get(uid, ""),
                        "offset_s": round(base + seg.start, 2),
                        "duration_s": round(seg.end - seg.start, 2),
                        "text": seg.text.strip(),
                    })
            segments_out.sort(key=lambda s: s["offset_s"])
            await self.db.add_recording_segments(session.recording_id, segments_out)
            await self.db.update_recording_status(session.recording_id, "done")
            await self.notify(
                session.guild_id, "Transcript ready",
                f"Recording #{session.recording_id}: {len(segments_out)} lines.",
            )
            logger.info("Recording #%s transcribed: %s lines", session.recording_id, len(segments_out))
        except Exception as exc:
            logger.exception("Transcription of recording #%s failed", session.recording_id)
            await self.db.update_recording_status(session.recording_id, "failed", error=str(exc)[:500])
            await self.notify(session.guild_id, "Transcription failed", str(exc)[:200])

    # --- plumbing ---

    async def notify(self, guild_id: int, title: str, body: str) -> None:
        try:
            row = await self.db.add_notification(guild_id, "recording", title, body)
            if self.hub is not None:
                await self.hub.broadcast({"type": "notification", "notification": row}, guild_id=guild_id)
        except Exception:
            logger.exception("Recording notification failed")

    def close_all(self) -> None:
        """App shutdown: drop live sessions (the files stay on disk)."""
        for guild_id in list(self.sessions):
            session = self.sessions.pop(guild_id)
            if session.watch_task is not None:
                session.watch_task.cancel()
            if session.vc is not None:
                try:
                    asyncio.get_running_loop().create_task(session.vc.disconnect())
                except Exception:
                    pass
            session.sink.cleanup()
