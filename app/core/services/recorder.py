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
import contextlib
import json
import logging
import shutil
import subprocess
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

try:
    import davey
except ImportError:  # pragma: no cover
    davey = None  # type: ignore[assignment]

if voice_recv is not None:
    # Patch discord-ext-voice-recv UDP keepalive:
    # Upstream bug sets delay=5000 (ms intention) and passes it to time.sleep(5000),
    # which sleeps for 83 minutes! Without outbound UDP keepalive, Discord voice
    # servers drop the NAT binding after ~30s of silence, halting incoming audio.
    if hasattr(voice_recv, "reader") and hasattr(voice_recv.reader, "UDPKeepAlive"):
        voice_recv.reader.UDPKeepAlive.delay = 5

    # Silence verbose RTCP SenderReport (type 200) info logs from voice_recv reader
    logging.getLogger("discord.ext.voice_recv.reader").setLevel(logging.WARNING)

    _last_drop_log = 0.0

    # Upstream treats any single decode error as fatal: PacketRouter.run()
    # dies on the first corrupt RTP packet (a routine thing on real voice
    # links — loss and reorder happen) and the capture stops after ~0.5s.
    # Make pop_data skip broken packets instead of killing the capture.
    _upstream_pop_data = voice_recv.opus.PacketDecoder.pop_data

    def _pop_data_resilient(self, *, timeout: float = 0):
        global _last_drop_log
        for _ in range(64):
            try:
                return _upstream_pop_data(self, timeout=timeout)
            except Exception as exc:
                # Rate-limited: at teardown / loss bursts this fires dozens
                # of times per second and would drown the logs.
                import time as _time

                if _time.monotonic() - _last_drop_log > 5:
                    _last_drop_log = _time.monotonic()
                    logger.warning("Dropping corrupt voice packets (ssrc %s): %s", self.ssrc, exc)
        return None

    voice_recv.opus.PacketDecoder.pop_data = _pop_data_resilient

    # DAVE (E2EE): discord.py's voice websocket runs the MLS session on
    # every voice client (VoiceConnectionState.dave_session), but voice_recv
    # never unwraps inbound frames — they reach the opus decoder as
    # ciphertext and decode into loud noise. Unwrap the DAVE layer before
    # decoding, using the per-sender ratchet of the session discord.py
    # already maintains.
    def _dave_decrypt_frame(self, packet) -> None:
        state = getattr(self.sink.voice_client, "_connection", None)
        session = getattr(state, "dave_session", None)
        if session is None or getattr(state, "dave_protocol_version", 0) == 0:
            return
        if not packet or not hasattr(packet, "decrypted_data"):
            return  # fake/silence frames carry no payload
        payload = bytes(packet.decrypted_data)
        if payload == b"\xf8\xff\xfe":
            return  # standard Opus silence packet, already unencrypted
        if not (session.ready or session.status == davey.SessionStatus.active):
            return
        user_id = self._cached_id or self.sink.voice_client._get_id_from_ssrc(self.ssrc)
        if user_id is None:
            return  # no sender yet — cannot pick the right ratchet
        self._cached_id = user_id
        if hasattr(session, "get_user_ids"):
            user_ids = {str(uid) for uid in session.get_user_ids()}
            if user_ids and str(user_id) not in user_ids:
                return  # sender not in MLS group (e.g. non-E2EE bot) — plain Opus
        sink = self.sink
        dumping = getattr(sink, "_dump_dave", False)
        if dumping:
            sink._dump_write(self.ssrc, "pre", payload)
        out = session.decrypt(int(user_id), davey.MediaType.audio, payload)
        if dumping:
            sink._dump_write(self.ssrc, "post", bytes(out))
        packet.decrypted_data = out

    _upstream_process_packet = voice_recv.opus.PacketDecoder._process_packet

    def _process_packet_dave(self, packet):
        global _last_drop_log
        try:
            _dave_decrypt_frame(self, packet)
        except Exception as exc:
            err_msg = str(exc)
            if "NoDecryptorForUser" in err_msg:
                # Sender not registered in DAVE MLS; packet is plain Opus audio
                return _upstream_process_packet(self, packet)
            if "UnencryptedWhenPassthroughDisabled" in err_msg:
                # Discord client sent unencrypted trailing silence/transition frame
                if packet and hasattr(packet, "decrypted_data"):
                    packet.decrypted_data = b"\xf8\xff\xfe"
                return _upstream_process_packet(self, packet)

            import time as _time

            if _time.monotonic() - _last_drop_log > 5:
                _last_drop_log = _time.monotonic()
                logger.warning("DAVE decrypt failed for ssrc %s: %s", self.ssrc, exc)
            # Crucial: replace failed decrypt payload with silence so opus decoder
            # never decodes raw encrypted ciphertext into full-scale noise
            if packet and hasattr(packet, "decrypted_data"):
                packet.decrypted_data = b"\xf8\xff\xfe"
        return _upstream_process_packet(self, packet)

    # discord.py swallows MLS commit/welcome failures silently (it sends
    # an invalid-commit recovery and hangs in pending forever). Surface
    # them: a failing commit is exactly why a session never turns ready.
    if davey is not None:
        for _op in ("process_commit", "process_welcome", "process_proposals"):
            _upstream_mls = getattr(davey.DaveSession, _op)

            def _mls_logged(self, *args, _op: str = _op, _up=_upstream_mls, **kwargs):
                try:
                    return _up(self, *args, **kwargs)
                except Exception as exc:
                    logger.error("DAVE MLS %s failed: %r", _op, exc)
                    raise

            setattr(davey.DaveSession, _op, _mls_logged)

        voice_recv.opus.PacketDecoder._process_packet = _process_packet_dave

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
    audio = np.interp(x_new, np.arange(len(samples)), samples).astype(np.float32)
    # Remove DC offset (eliminates low-frequency electrical/mic rumble)
    audio = audio - float(np.mean(audio))
    # Peak normalization: boost quiet microphones into Whisper's ideal dynamic range
    peak = float(np.max(np.abs(audio)))
    if peak > 1e-4:
        audio = (audio / peak * 0.90).astype(np.float32)
    return audio


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


def detect_speech_language(audio: np.ndarray, model: Any, default: str = "ru") -> str:
    """VAD-guided speech language detection.

    Samples solid speech blocks across the audio timeline (avoiding silence/noise)
    and uses Whisper to detect the spoken language with high confidence.
    """
    if len(audio) < WHISPER_RATE:
        return default
    try:
        from faster_whisper.vad import VadOptions, get_speech_timestamps

        ts = get_speech_timestamps(audio, VadOptions(min_speech_duration_ms=500, min_silence_duration_ms=400))
        if not ts:
            return default
        solid = [b for b in ts if (b["end"] - b["start"]) >= WHISPER_RATE * 1.5]
        if not solid:
            solid = ts

        # Take up to 3 distributed samples across the timeline
        n_samples = min(3, len(solid))
        step = len(solid) // n_samples
        sampled_blocks = [solid[i * step] for i in range(n_samples)]

        composite_parts = []
        for b in sampled_blocks:
            c = audio[b["start"]:b["end"]]
            composite_parts.append(c[:min(len(c), int(3.5 * WHISPER_RATE))])

        sample = np.concatenate(composite_parts)
        lang, prob, _ = model.detect_language(sample)
        logger.info("VAD speech language profiling: detected '%s' (confidence %.2f)", lang, prob)
        if prob >= 0.40:
            return lang
    except Exception:
        logger.exception("VAD speech language detection failed; falling back to %r", default)
    return default


def compress_recording_audio(session_dir: Path) -> dict[str, str]:
    """Compresses speaker WAV files to Opus and creates a mixed call track.

    Uses ffmpeg when available. Returns a mapping of created opus files.
    """
    if not shutil.which("ffmpeg"):
        return {}
    results: dict[str, str] = {}
    try:
        wavs = sorted(p for p in session_dir.glob("*.wav") if p.is_file() and p.stat().st_size > 44)
        if not wavs:
            return {}

        for w in wavs:
            out_opus = w.with_suffix(".opus")
            cmd = ["ffmpeg", "-y", "-i", str(w), "-c:a", "libopus", "-b:a", "64k", str(out_opus)]
            res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if res.returncode == 0 and out_opus.is_file():
                results[w.stem] = out_opus.name

        # Create mixed call audio if 1 or more speakers
        out_mix = session_dir / "mixed.opus"
        inputs: list[str] = []
        for w in wavs:
            inputs.extend(["-i", str(w)])

        if len(wavs) == 1:
            cmd = ["ffmpeg", "-y", "-i", str(wavs[0]), "-c:a", "libopus", "-b:a", "96k", str(out_mix)]
        else:
            filter_complex = f"amix=inputs={len(wavs)}:duration=longest:dropout_transition=2"
            cmd = ["ffmpeg", "-y", *inputs, "-filter_complex", filter_complex, "-c:a", "libopus", "-b:a", "96k", str(out_mix)]

        res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if res.returncode == 0 and out_mix.is_file():
            results["mixed"] = out_mix.name
            logger.info("Compressed call audio into %s (%d KB)", out_mix.name, out_mix.stat().st_size // 1024)
    except Exception:
        logger.exception("Failed to compress recording audio in %s", session_dir)
    return results


if voice_recv is not None:  # the sink needs the discord.py extension at runtime

    class SpeakerSink(voice_recv.AudioSink):
        """Writes per-speaker audio in speech activity chunks with exact timecodes."""

        def __init__(
            self,
            session_dir: Path,
            dump_dave: bool = False,
            record_bots: bool = False,
            gap_threshold: float = 1.8,
        ):
            super().__init__()
            self._dir = session_dir
            self._chunks_dir = session_dir / "chunks"
            self._chunks_dir.mkdir(parents=True, exist_ok=True)
            self._dump_dave = dump_dave
            self._record_bots = record_bots
            self._gap_threshold = gap_threshold

            self._t0 = time.monotonic()
            self._frames = 0
            self._users: dict[int, str] = {}
            self._first_offset: dict[int, float] = {}

            # Chunk tracking per user:
            self._active_chunks: dict[int, wave.Wave_write | None] = {}
            self._chunk_idx: dict[int, int] = {}
            self._chunk_start: dict[int, float] = {}
            self._last_time: dict[int, float] = {}
            self._chunks_meta: list[dict[str, Any]] = []

            # Master concatenated wave files per user (for backward compatibility)
            self._files: dict[int, wave.Wave_write] = {}
            self._dumps: dict[tuple[int, str], object] = {}

        def _dump_write(self, ssrc: int, kind: str, payload: bytes) -> None:
            """Append one length-prefixed frame to a debug dump file."""
            import struct

            key = (ssrc, kind)
            f = self._dumps.get(key)
            if f is None:
                f = open(self._dir / f"dave_{kind}_{ssrc}.bin", "wb")
                self._dumps[key] = f
            f.write(struct.pack(">H", len(payload)) + payload)

        def wants_opus(self) -> bool:
            return False

        def write(self, user, data) -> None:  # types: discord User | VoiceData
            vc = getattr(self, "voice_client", None)
            bot_id = getattr(getattr(vc, "user", None), "id", None)
            # Never record the recorder bot itself (prevents echo)
            if user is not None and bot_id is not None and user.id == bot_id:
                return

            if user is not None and getattr(user, "bot", False) and not self._record_bots:
                return

            uid: int
            name: str
            if user is not None:
                uid = user.id
                name = getattr(user, "display_name", None) or getattr(user, "name", str(user.id))
            else:
                # If member is not cached (e.g. without Member Intent), resolve via SSRC
                ssrc = getattr(getattr(data, "packet", None), "ssrc", None)
                if ssrc is not None and vc is not None:
                    resolved_id = vc._get_id_from_ssrc(ssrc)
                    if resolved_id:
                        uid = resolved_id
                        member = vc.guild.get_member(uid) if vc.guild else None
                        name = member.display_name if member else f"user_{uid}"
                    else:
                        uid = -int(ssrc)
                        name = f"Speaker #{ssrc}"
                else:
                    return

            now = time.monotonic() - self._t0
            if uid not in self._files:
                self._users[uid] = name
                self._first_offset[uid] = now
                wf = wave.open(str(self._dir / f"{uid}.wav"), "wb")
                wf.setnchannels(2)
                wf.setsampwidth(2)  # s16le
                wf.setframerate(PCM_RATE)
                self._files[uid] = wf
                self._chunk_idx[uid] = 0
                self._active_chunks[uid] = None
                self._last_time[uid] = now

            # Check if previous chunk timed out (speech gap > threshold)
            last_t = self._last_time.get(uid, now)
            active_chunk = self._active_chunks.get(uid)
            if active_chunk is None or (now - last_t) > self._gap_threshold:
                if active_chunk is not None:
                    try:
                        active_chunk.close()
                    except Exception:
                        pass
                    start_t = self._chunk_start.get(uid, last_t)
                    self._chunks_meta.append({
                        "user_id": uid,
                        "username": name,
                        "chunk_index": self._chunk_idx[uid],
                        "offset_start": round(start_t, 3),
                        "offset_end": round(last_t + 0.02, 3),
                        "duration_s": round(max(0.02, (last_t + 0.02) - start_t), 3),
                        "filename": f"chunks/{uid}_{self._chunk_idx[uid]}.wav",
                    })
                    self._chunk_idx[uid] += 1

                # Start new chunk
                idx = self._chunk_idx[uid]
                chunk_path = self._chunks_dir / f"{uid}_{idx}.wav"
                cwf = wave.open(str(chunk_path), "wb")
                cwf.setnchannels(2)
                cwf.setsampwidth(2)
                cwf.setframerate(PCM_RATE)
                self._active_chunks[uid] = cwf
                self._chunk_start[uid] = now

            try:
                if data.pcm:
                    self._active_chunks[uid].writeframes(data.pcm)
                    self._files[uid].writeframes(data.pcm)
                    self._frames += 1
                    self._last_time[uid] = now
            except Exception:
                logger.exception("Failed to write voice frames for user %s", uid)

        def cleanup(self) -> None:
            # Finalize active chunks
            for uid, cwf in list(self._active_chunks.items()):
                if cwf is not None:
                    try:
                        cwf.close()
                    except Exception:
                        pass
                    last_t = self._last_time.get(uid, self._chunk_start.get(uid, 0.0))
                    start_t = self._chunk_start.get(uid, last_t)
                    self._chunks_meta.append({
                        "user_id": uid,
                        "username": self._users.get(uid, f"user {uid}"),
                        "chunk_index": self._chunk_idx.get(uid, 0),
                        "offset_start": round(start_t, 3),
                        "offset_end": round(last_t + 0.02, 3),
                        "duration_s": round(max(0.02, (last_t + 0.02) - start_t), 3),
                        "filename": f"chunks/{uid}_{self._chunk_idx.get(uid, 0)}.wav",
                    })
            self._active_chunks.clear()

            # Save chunks.json
            if self._chunks_meta:
                try:
                    self._chunks_meta.sort(key=lambda c: (c["offset_start"], c["user_id"]))
                    (self._dir / "chunks.json").write_text(
                        json.dumps(self._chunks_meta, ensure_ascii=False, indent=2),
                        encoding="utf-8",
                    )
                except Exception:
                    logger.exception("Failed to write chunks.json")

            for wf in self._files.values():
                try:
                    wf.close()
                except Exception:
                    pass
            self._files.clear()
            for f in self._dumps.values():
                try:
                    f.close()
                except Exception:
                    pass
            self._dumps.clear()


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
    prompt: str = ""
    language: str = ""
    chunks: list[dict[str, Any]] = field(default_factory=list)


class RecorderService:
    """Per-guild recording sessions; one live session per guild.

    Transcription runs through a single-worker FIFO queue: whisper on CPU
    is the heaviest thing this process does, and concurrent runs would
    starve the voice/websocket loops (and each other) on a small VPS.
    """

    def __init__(self, bot, db: Database, config: Config) -> None:
        self.bot = bot
        self.db = db
        self.config = config
        self.hub = None  # set from main.py, like music.hub
        self.sessions: dict[int, RecordingSession] = {}
        self._queue: asyncio.Queue[RecordingSession] = asyncio.Queue()
        self._worker_task: asyncio.Task | None = None
        # Dedicated recorder bot (only when RECORDER_BOT_TOKEN is set);
        # started lazily on the first recording and stays online after.
        self._client = None
        self._client_task: asyncio.Task | None = None
        self._model = None
        self._model_lock = asyncio.Lock()

    # --- status ---

    def is_recording(self, guild_id: int) -> bool:
        return guild_id in self.sessions

    def session(self, guild_id: int) -> RecordingSession | None:
        return self.sessions.get(guild_id)

    def exclusive(self) -> bool:
        """True when recordings share the main bot's voice connection and
        cannot run while music plays (no dedicated recorder token set)."""
        return not self.config.recorder_bot_token

    async def _ensure_client(self):
        """Lazily start the dedicated recorder bot; it stays online after.

        A second Discord user owns its own voice session, so recordings do
        not touch the main bot's Lavalink connection at all — music and
        recording run in parallel, and the main bot's playback never
        reaches the sink (bot users are skipped there anyway).
        """
        if self._client is not None:
            return self._client
        client = discord.Client(intents=discord.Intents.default())
        self._client = client
        self._client_task = asyncio.create_task(
            client.start(self.config.recorder_bot_token), name="recorder-client"
        )

        def _dropped(task: asyncio.Task) -> None:
            if self._client is client:
                self._client = None
                self._client_task = None

        self._client_task.add_done_callback(_dropped)
        for _ in range(240):  # up to 2 minutes for the first login
            await asyncio.sleep(0.5)
            if client.is_ready():
                logger.info("Recorder bot ready as %s#%s", client.user.name, client.user.discriminator)
                return client
            if self._client_task.done():
                exc = self._client_task.exception()
                raise RecordingError(f"The recorder bot failed to start: {exc}")
        raise RecordingError("The recorder bot did not come online in time.")

    # --- lifecycle ---

    async def start(
        self,
        guild_id: int,
        channel_id: int,
        requester_id: int,
        title: str | None = None,
        prompt: str | None = None,
        language: str | None = None,
    ) -> dict:
        if self.is_recording(guild_id):
            raise RecordingError("A recording is already running in this server.")
        # voice receive decodes opus locally (the music path leaves it to
        # Lavalink), so the shared libopus must be loaded once per process.
        # discord.py 2.7's load_opus demands an explicit library name.
        try:
            import ctypes.util

            lib = ctypes.util.find_library("opus")
            if lib is None:
                raise RecordingError(
                    "libopus is not installed in the container — recordings cannot decode audio."
                )
            discord.opus.load_opus(lib)
        except RecordingError:
            raise
        except Exception:
            logger.exception("Failed to load libopus — recording will not capture audio")

        if self.exclusive():
            # One voice connection for everything: refuse while music
            # plays, evict an idle player connection.
            music = getattr(self.bot, "music", None)
            player = music.get_player(guild_id) if music is not None else None
            if player is not None and player.playing:
                raise RecordingError("Stop playback first — recording and music cannot run together.")
            if player is not None:
                await music.disconnect(guild_id)
            client = self.bot
        else:
            client = await self._ensure_client()

        guild = client.get_guild(guild_id)
        if guild is None:
            if self.exclusive():
                raise RecordingError("Bot is not on this server.")
            raise RecordingError("The recorder bot is not on this server — invite it first.")
        channel = guild.get_channel(channel_id)
        if channel is None or not isinstance(channel, (discord.VoiceChannel, discord.StageChannel)):
            raise RecordingError("Voice channel not found.")

        prompt_val = (prompt or "").strip()
        lang_val = (language or "").strip()
        row = await self.db.add_voice_recording(
            guild_id,
            channel.id,
            requester_id,
            title or channel.name,
            prompt=prompt_val,
            language=lang_val,
        )
        session_dir = Path(self.config.recordings_dir) / str(guild_id) / str(row["id"])
        session_dir.mkdir(parents=True, exist_ok=True)

        sink = SpeakerSink(session_dir, dump_dave=self.config.record_debug, record_bots=True)
        try:
            vc = await channel.connect(cls=voice_recv.VoiceRecvClient, self_deaf=False)
        except discord.ClientException as exc:
            await self.db.update_recording_status(row["id"], "failed", error=str(exc)[:500])
            raise RecordingError(f"Failed to connect: {exc}") from exc
        vc.listen(sink)
        state = getattr(vc, "_connection", None)
        logger.info(
            "Recording #%s voice recv: dave_protocol_version=%s session_ready=%s",
            row["id"],
            getattr(state, "dave_protocol_version", 0),
            bool(getattr(getattr(state, "dave_session", None), "ready", False)),
        )

        session = RecordingSession(
            recording_id=row["id"],
            guild_id=guild_id,
            channel_id=channel.id,
            started_by=requester_id,
            vc=vc,
            sink=sink,
            prompt=prompt_val,
            language=lang_val,
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
        session.chunks = list(getattr(sink, "_chunks_meta", []))

        total_bytes = sum(p.stat().st_size for p in session.speaker_files.values() if p.exists())
        if total_bytes <= 44:  # a bare wav header = nothing was captured
            await self.db.update_recording_status(
                session.recording_id, "failed",
                error="No speech was captured (nobody talked or the voice stream was silent).",
            )
            await self.notify(guild_id, "Recording failed", "No speech was captured.")
            return await self.db.get_recording(session.recording_id, guild_id)

        await self.db.update_recording_status(session.recording_id, "queued")
        await self.db.audit("record.stop", guild_id=guild_id, actor_id=requester_id,
                            details={"recording_id": session.recording_id})
        await self.notify(guild_id, "Recording stopped",
                          f"Queued for transcription (position {self._queue.qsize() + 1}).")
        self._enqueue(session)
        return await self.db.get_recording(session.recording_id, guild_id)

    async def retranscribe(
        self,
        recording_id: int,
        guild_id: int,
        prompt: str | None = None,
        language: str | None = None,
    ) -> dict[str, Any]:
        row = await self.db.get_recording(recording_id, guild_id)
        if row is None:
            raise RecordingError("Recording not found.")
        if row["status"] in ("recording", "transcribing", "queued"):
            raise RecordingError("Recording is currently active or being transcribed.")

        session_dir = Path(self.config.recordings_dir) / str(guild_id) / str(recording_id)
        if not session_dir.exists():
            raise RecordingError("Recording audio files not found on disk.")

        if prompt is not None or language is not None:
            await self.db.update_recording_metadata(
                recording_id,
                guild_id,
                prompt=prompt if prompt is not None else row.get("prompt", ""),
                language=language if language is not None else row.get("language", ""),
            )
            row = await self.db.get_recording(recording_id, guild_id)

        speaker_files = {}
        for wav in session_dir.glob("*.wav"):
            try:
                uid = int(wav.stem)
                speaker_files[uid] = wav
            except ValueError:
                pass

        session = RecordingSession(
            recording_id=recording_id,
            guild_id=guild_id,
            channel_id=row["channel_id"],
            started_by=row["started_by"],
            speaker_files=speaker_files,
            usernames={uid: f"user {uid}" for uid in speaker_files},
            prompt=row.get("prompt", "") or "",
            language=row.get("language", "") or "",
        )

        await self.db.update_recording_status(recording_id, "queued")
        self._enqueue(session)
        return await self.db.get_recording(recording_id, guild_id)

    async def _watch(self, session: RecordingSession) -> None:
        """Auto-stop when the voice client dies (kick, channel delete, crash).

        Also catches a dead audio reader: voice_recv stops the reader thread
        on a packet-processing error (e.g. missing libopus) while the voice
        connection itself stays alive — without this the session would run
        on capturing nothing.
        """
        while True:
            await asyncio.sleep(30)
            vc = session.vc
            reader_error = getattr(getattr(vc, "_reader", None), "error", None)
            if reader_error is not None:
                logger.error("Recording #%s reader crashed: %s", session.recording_id, reader_error)
                try:
                    await self.stop(session.guild_id)
                except RecordingError:
                    pass
                return
            # Periodic DAVE health: the session becomes ready seconds after
            # connect (MLS commit processed); if it never flips, frames stay
            # ciphertext and the transcript is noise.
            state = getattr(vc, "_connection", None)
            dave_session = getattr(state, "dave_session", None)
            try:
                if dave_session is None:
                    logger.info(
                        "Recording #%s DAVE: session is None (protocol version %s)",
                        session.recording_id,
                        getattr(state, "dave_protocol_version", "?"),
                    )
                else:
                    line = (
                        f"Recording #{session.recording_id} DAVE: ready={dave_session.ready} "
                        f"epoch={dave_session.epoch} status={dave_session.status}"
                    )
                    try:
                        stats = dave_session.get_decryption_stats(state.user.id)
                        line += (
                            f" decrypted={getattr(stats, 'successes', '?')}"
                            f" failed={getattr(stats, 'failures', '?')}"
                            f" passthrough={getattr(stats, 'passthroughs', '?')}"
                        )
                    except Exception:
                        pass
                    logger.info(line)
            except Exception:
                logger.exception("Recording #%s DAVE health check failed", session.recording_id)
            if vc is None or not vc.is_connected():
                logger.warning("Recording #%s lost its voice client; auto-stopping", session.recording_id)
                try:
                    await self.stop(session.guild_id)
                except RecordingError:
                    pass
                return

    # --- transcription queue ---

    def _enqueue(self, session: RecordingSession) -> None:
        self._queue.put_nowait(session)
        if self._worker_task is None or self._worker_task.done():
            self._worker_task = asyncio.create_task(
                self._transcribe_worker(), name="transcribe-worker"
            )

    async def _transcribe_worker(self) -> None:
        while True:
            session = await self._queue.get()
            try:
                await self.db.update_recording_status(session.recording_id, "transcribing")
                await self._transcribe(session)
            except Exception:
                # _transcribe handles its own failures; this is a safety net
                # so the worker never dies with the queue still full.
                logger.exception("Transcription worker error on recording #%s", session.recording_id)
            finally:
                self._queue.task_done()

    async def fail_stale_recordings(self) -> None:
        """Mark in-flight work dead after a restart: no session or worker
        survives the process, so those rows would sit queued forever."""
        try:
            n = await self.db.fail_stale_recordings()
            if n:
                logger.warning("Marked %s stale recording(s) as failed after restart", n)
        except Exception:
            logger.exception("Stale-recording cleanup failed")

    async def _get_model(self):
        async with self._model_lock:
            if self._model is None:
                from faster_whisper import WhisperModel

                size = self.config.transcribe_model
                threads = max(1, getattr(self.config, "transcribe_threads", 2))
                logger.info(
                    "Loading faster-whisper model %r with %d CPU thread(s) (first use may download it)",
                    size,
                    threads,
                )
                self._model = await asyncio.to_thread(
                    WhisperModel,
                    size,
                    device="cpu",
                    compute_type="int8",
                    cpu_threads=threads,
                    download_root=str(Path(self.config.recordings_dir) / "models"),
                )
            return self._model

    async def _transcribe(self, session: RecordingSession) -> None:
        segments_out: list[dict] = []
        try:
            model = await self._get_model()
            session_dir = Path(self.config.recordings_dir) / str(session.guild_id) / str(session.recording_id)
            session_dir.mkdir(parents=True, exist_ok=True)

            # Extract chunks archive if needed
            chunks_tar = session_dir / "chunks.tar.gz"
            chunks_dir = session_dir / "chunks"
            if chunks_tar.is_file() and not chunks_dir.exists():
                try:
                    import tarfile
                    with tarfile.open(chunks_tar, "r:gz") as tar:
                        tar.extractall(session_dir)
                except Exception:
                    logger.exception("Failed to extract chunks.tar.gz for recording #%s", session.recording_id)

            rec_row = await self.db.get_recording(session.recording_id, session.guild_id)
            initial_prompt = (session.prompt or (rec_row.get("prompt") if rec_row else "") or "").strip()
            session_lang = (session.language or (rec_row.get("language") if rec_row else "") or "").strip()

            cfg_lang = (self.config.transcribe_language or "").strip().lower()
            if session_lang and session_lang != "auto":
                target_lang = session_lang
            elif cfg_lang and cfg_lang != "auto":
                target_lang = cfg_lang
            else:
                target_lang = ""

            def _run(audio: np.ndarray, lang: str | None = None) -> list[tuple[float, float, str, list[dict]]]:
                # Batched VAD-filtered transcription:
                # 1. Uses explicit language or VAD-detected speech language.
                # 2. Batched VAD pass: uses CTranslate2 C++ Silero VAD to process the track
                #    in a single optimized batch instead of dozens of padded individual calls.
                # 3. Soft repetition penalty (1.15) to prevent runaway hallucination loops
                #    on long pauses while fully preserving intentional repeated words.
                chosen_lang = lang or target_lang or detect_speech_language(audio, model, default="ru")

                segs, _info = model.transcribe(
                    audio,
                    language=chosen_lang,
                    vad_filter=True,
                    vad_parameters=dict(min_silence_duration_ms=400, speech_pad_ms=150),
                    word_timestamps=True,
                    condition_on_previous_text=False,
                    repetition_penalty=1.15,
                    initial_prompt=initial_prompt if initial_prompt else None,
                )

                out: list[tuple[float, float, str, list[dict]]] = []
                for seg in segs:
                    if getattr(seg, "no_speech_prob", 0.0) > 0.65:
                        continue
                    txt = seg.text.strip()
                    if not txt:
                        continue
                    low = txt.lower()
                    if "субтитр" in low or "dimatext" in low:
                        continue

                    dur = seg.end - seg.start
                    words = [
                        {
                            "w": w.word.strip(),
                            "start": round(w.start, 2),
                            "end": round(w.end, 2),
                        }
                        for w in (seg.words or [])
                    ]
                    out.append((round(seg.start, 2), round(dur, 2), txt, words))
                return out

            # Speaker language profiling: pre-detect language per speaker across whole timeline
            speaker_langs: dict[int, str] = {}
            if target_lang:
                speaker_langs = {uid: target_lang for uid in (session.usernames.keys() or session.speaker_files.keys())}
            else:
                for uid, path in session.speaker_files.items():
                    if path.is_file() and path.stat().st_size > 44:
                        try:
                            spk_audio = await asyncio.to_thread(wav_to_whisper_array, path)
                            spk_l = await asyncio.to_thread(detect_speech_language, spk_audio, model, "ru")
                            speaker_langs[uid] = spk_l
                        except Exception:
                            speaker_langs[uid] = "ru"

            chunks_json_path = session_dir / "chunks.json"
            chunks = []
            if chunks_json_path.is_file():
                try:
                    chunks = json.loads(chunks_json_path.read_text(encoding="utf-8"))
                except Exception:
                    chunks = []

            if chunks:
                for chunk in chunks:
                    c_path = session_dir / chunk["filename"]
                    if not c_path.is_file() or c_path.stat().st_size <= 44:
                        continue
                    audio = await asyncio.to_thread(wav_to_whisper_array, c_path)
                    if len(audio) < WHISPER_RATE // 4:  # shorter than 0.25s
                        continue
                    uid = int(chunk["user_id"])
                    raw_segments = await asyncio.to_thread(_run, audio, speaker_langs.get(uid))
                    base_offset = float(chunk["offset_start"])
                    uname = chunk.get("username") or session.usernames.get(uid, "")
                    for start, duration, text, words in raw_segments:
                        if not text:
                            continue
                        segments_out.append({
                            "user_id": uid,
                            "username": uname,
                            "offset_s": round(base_offset + start, 2),
                            "duration_s": round(duration, 2),
                            "text": text,
                            "words": [
                                {**w, "start": round(base_offset + w["start"], 2), "end": round(base_offset + w["end"], 2)}
                                for w in words
                            ],
                        })
            else:
                for uid, path in session.speaker_files.items():
                    if not path.exists() or path.stat().st_size <= 44:
                        continue
                    audio = await asyncio.to_thread(wav_to_whisper_array, path)
                    if len(audio) < WHISPER_RATE // 2:  # shorter than 0.5s
                        continue
                    raw_segments = await asyncio.to_thread(_run, audio, speaker_langs.get(uid))
                    base = session.first_offsets.get(uid, 0.0)
                    for start, duration, text, words in raw_segments:
                        if not text:
                            continue
                        segments_out.append({
                            "user_id": uid,
                            "username": session.usernames.get(uid, ""),
                            "offset_s": round(base + start, 2),
                            "duration_s": round(duration, 2),
                            "text": text,
                            "words": [
                                {**w, "start": round(base + w["start"], 2), "end": round(base + w["end"], 2)}
                                for w in words
                            ],
                        })
            segments_out.sort(key=lambda s: s["offset_s"])

            # 1. transcript.json: structured format with per-word timestamps
            transcript_data = {
                "recording_id": session.recording_id,
                "guild_id": session.guild_id,
                "segments": segments_out,
            }
            try:
                (session_dir / "transcript.json").write_text(
                    json.dumps(transcript_data, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
            except Exception:
                logger.exception("Failed to write transcript.json for recording #%s", session.recording_id)

            # 2. transcript.txt: human-readable timestamped text
            try:
                (session_dir / "transcript.txt").write_text(
                    format_transcript_txt(segments_out, session.usernames),
                    encoding="utf-8",
                )
            except Exception:
                logger.exception("Failed to write transcript.txt for recording #%s", session.recording_id)

            # 3. transcript.srt: standard subtitle format
            try:
                (session_dir / "transcript.srt").write_text(
                    format_transcript_srt(segments_out, session.usernames),
                    encoding="utf-8",
                )
            except Exception:
                logger.exception("Failed to write transcript.srt for recording #%s", session.recording_id)

            # Archive chunks into chunks.tar.gz to save disk space and file descriptors
            if chunks_dir.exists() and any(chunks_dir.iterdir()):
                try:
                    import tarfile
                    with tarfile.open(session_dir / "chunks.tar.gz", "w:gz") as tar:
                        tar.add(chunks_dir, arcname="chunks")
                    import shutil as _shutil
                    _shutil.rmtree(chunks_dir, ignore_errors=True)
                except Exception:
                    logger.exception("Failed to archive chunks for recording #%s", session.recording_id)

            # Backwards compatibility: keep database write
            db_segments = [
                {
                    **seg,
                    "words": json.dumps(seg["words"], ensure_ascii=False) if not isinstance(seg["words"], str) else seg["words"],
                }
                for seg in segments_out
            ]
            await self.db.add_recording_segments(session.recording_id, db_segments)
            await self.db.update_recording_status(session.recording_id, "done")
            # Prune temporary debug dumps to free disk space once transcription succeeded
            if session_dir.exists():
                for bin_file in session_dir.glob("dave_*.bin"):
                    with contextlib.suppress(OSError):
                        bin_file.unlink(missing_ok=True)
            # Compress speaker WAVs to Opus and generate mixed track
            await asyncio.to_thread(compress_recording_audio, session_dir)

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
        if self._worker_task is not None:
            self._worker_task.cancel()
        if self._client is not None:
            client, self._client = self._client, None
            if self._client_task is not None:
                self._client_task.cancel()
            try:
                asyncio.get_running_loop().create_task(client.close())
            except Exception:
                pass
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
