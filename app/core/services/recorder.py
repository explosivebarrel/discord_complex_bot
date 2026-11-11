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
            user_ids = session.get_user_ids()
            if user_ids and int(user_id) not in user_ids:
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
            if "UnencryptedWhenPassthroughDisabled" in err_msg:
                # Normal: Discord client sent unencrypted trailing silence/comfort frames
                pass
            else:
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
        """Writes one wav per speaking user (or audio stream)."""

        def __init__(self, session_dir: Path, dump_dave: bool = False, record_bots: bool = False):
            super().__init__()
            self._dir = session_dir
            self._files: dict[int, wave.Wave_write] = {}
            self._users: dict[int, str] = {}
            self._first_offset: dict[int, float] = {}
            self._t0 = time.monotonic()
            self._frames = 0
            self._dump_dave = dump_dave
            self._record_bots = record_bots
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

            offset = time.monotonic() - self._t0
            if uid not in self._files:
                self._users[uid] = name
                self._first_offset[uid] = offset
                wf = wave.open(str(self._dir / f"{uid}.wav"), "wb")
                wf.setnchannels(2)
                wf.setsampwidth(2)  # s16le
                wf.setframerate(PCM_RATE)
                self._files[uid] = wf
            try:
                self._files[uid].writeframes(data.pcm)
                self._frames += 1
            except Exception:  # a broken stream must not kill the reader thread
                logger.exception("Failed to write voice frames for user %s", uid)

        def cleanup(self) -> None:
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

    async def start(self, guild_id: int, channel_id: int, requester_id: int) -> dict:
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

        row = await self.db.add_voice_recording(guild_id, channel.id, requester_id, channel.name)
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

        await self.db.update_recording_status(session.recording_id, "queued")
        await self.db.audit("record.stop", guild_id=guild_id, actor_id=requester_id,
                            details={"recording_id": session.recording_id})
        await self.notify(guild_id, "Recording stopped",
                          f"Queued for transcription (position {self._queue.qsize() + 1}).")
        self._enqueue(session)
        return await self.db.get_recording(session.recording_id, guild_id)

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
            pinned = self.config.transcribe_language or None

            def _run(audio: np.ndarray) -> list[tuple[float, float, str, list[dict]]]:
                # Whisper's own multilingual mode detects language per 30s
                # window — useless when the speaker switches every few
                # seconds. Split the audio into per-utterance chunks with
                # VAD and detect the language for each chunk separately.
                from faster_whisper.vad import VadOptions, get_speech_timestamps

                chunks = get_speech_timestamps(
                    audio,
                    VadOptions(min_silence_duration_ms=400, speech_pad_ms=200),
                    sampling_rate=WHISPER_RATE,
                )
                out: list[tuple[float, float, str, list[dict]]] = []
                for t in chunks:
                    chunk = audio[t["start"] : t["end"]]
                    if len(chunk) < WHISPER_RATE // 2:  # shorter than 0.5s
                        continue
                    start_s = t["start"] / WHISPER_RATE
                    segs, _info = model.transcribe(
                        chunk, language=pinned, vad_filter=False, word_timestamps=True
                    )
                    for seg in segs:
                        words = [
                            {
                                "w": w.word.strip(),
                                "start": round(start_s + w.start, 2),
                                "end": round(start_s + w.end, 2),
                            }
                            for w in (seg.words or [])
                        ]
                        out.append((start_s + seg.start, seg.end - seg.start, seg.text.strip(), words))
                return out

            for uid, path in session.speaker_files.items():
                if not path.exists() or path.stat().st_size <= 44:
                    continue
                audio = await asyncio.to_thread(wav_to_whisper_array, path)
                if len(audio) < WHISPER_RATE // 2:  # shorter than 0.5s
                    continue
                raw_segments = await asyncio.to_thread(_run, audio)
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
                        "words": json.dumps(
                            [
                                {**w, "start": round(base + w["start"], 2), "end": round(base + w["end"], 2)}
                                for w in words
                            ],
                            ensure_ascii=False,
                        ),
                    })
            segments_out.sort(key=lambda s: s["offset_s"])
            await self.db.add_recording_segments(session.recording_id, segments_out)
            await self.db.update_recording_status(session.recording_id, "done")
            # Prune temporary debug dumps to free disk space once transcription succeeded
            session_dir = Path(self.config.recordings_dir) / str(session.guild_id) / str(session.recording_id)
            if session_dir.exists():
                for bin_file in session_dir.glob("dave_*.bin"):
                    with contextlib.suppress(OSError):
                        bin_file.unlink(missing_ok=True)
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
