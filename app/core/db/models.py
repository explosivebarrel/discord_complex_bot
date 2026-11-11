from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow() -> datetime:
    # SQLite stores datetimes without a timezone. Use naive UTC everywhere,
    # so reads and writes stay comparable.
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Base(DeclarativeBase):
    pass


class GuildSettings(Base):
    __tablename__ = "guild_settings"

    guild_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), default="")
    default_voice_channel_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    admin_role_ids: Mapped[str] = mapped_column(Text, default="[]")  # JSON list of role ids
    # When the queue drains, the bot can start a radio station by query.
    autoplay_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    autoplay_query: Mapped[str] = mapped_column(String(128), default="")
    # When set (and the playlist still exists), autoplay picks shuffled
    # tracks from this user playlist instead of the radio query.
    autoplay_playlist_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # Panel section visibility: admins | everyone | off.
    stats_access: Mapped[str] = mapped_column(String(16), default="admins")
    posts_access: Mapped[str] = mapped_column(String(16), default="admins")
    moderation_access: Mapped[str] = mapped_column(String(16), default="admins")
    # Moderation actions are mirrored to this channel as embeds.
    mod_log_channel_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # Vote-skip: a skip counts only when half the voice channel agrees.
    vote_skip: Mapped[bool] = mapped_column(Boolean, default=False)
    # Now-playing announcements go to this text channel (None = off); the
    # np_message_id is the single embed the bot keeps editing.
    np_channel_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    np_message_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # Player action permissions: admins | members | off (off = owner only).
    volume_access: Mapped[str] = mapped_column(String(16), default="members")
    effects_access: Mapped[str] = mapped_column(String(16), default="members")
    queue_clear_access: Mapped[str] = mapped_column(String(16), default="members")
    seek_access: Mapped[str] = mapped_column(String(16), default="members")
    # Who can start/stop voice-call recordings: admins | members | off.
    recordings_access: Mapped[str] = mapped_column(String(16), default="admins")
    created_at: Mapped[datetime] = mapped_column(DateTime(), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(), default=utcnow, onupdate=utcnow)


class GuildAdmin(Base):
    __tablename__ = "guild_admins"

    guild_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    discord_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    added_by: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    added_at: Mapped[datetime] = mapped_column(DateTime(), default=utcnow)


class WebSession(Base):
    __tablename__ = "web_sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # SHA-256 hash of the cookie token
    discord_id: Mapped[int] = mapped_column(BigInteger, index=True)
    username: Mapped[str] = mapped_column(String(128), default="")
    global_name: Mapped[str] = mapped_column(String(128), default="")
    avatar: Mapped[str | None] = mapped_column(String(256), nullable=True)
    access_token: Mapped[str] = mapped_column(String(256))
    refresh_token: Mapped[str] = mapped_column(String(256))
    expires_at: Mapped[datetime] = mapped_column(DateTime())
    created_at: Mapped[datetime] = mapped_column(DateTime(), default=utcnow)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)


class UserApiToken(Base):
    """Long-lived personal API key of a panel user (the browser userscript
    authenticates with it). Same shape as WebSession: only the SHA-256
    hash is stored, the raw token is shown to the user exactly once."""

    __tablename__ = "user_api_tokens"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # SHA-256 hash of the key
    discord_id: Mapped[int] = mapped_column(BigInteger, index=True)
    username: Mapped[str] = mapped_column(String(128), default="")
    global_name: Mapped[str] = mapped_column(String(128), default="")
    label: Mapped[str] = mapped_column(String(128), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(), default=utcnow)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    guild_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    actor_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)  # Discord user ID
    actor_kind: Mapped[str] = mapped_column(String(16), default="user")  # user | web | system
    action: Mapped[str] = mapped_column(String(64))
    details: Mapped[str] = mapped_column(Text, default="{}")  # JSON
    created_at: Mapped[datetime] = mapped_column(DateTime(), default=utcnow, index=True)


class SystemSetting(Base):
    __tablename__ = "system_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="{}")  # JSON
    updated_at: Mapped[datetime] = mapped_column(DateTime(), default=utcnow, onupdate=utcnow)


class PlayHistory(Base):
    __tablename__ = "play_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    guild_id: Mapped[int] = mapped_column(BigInteger, index=True)
    title: Mapped[str] = mapped_column(String(256), default="")
    author: Mapped[str] = mapped_column(String(256), default="")
    uri: Mapped[str] = mapped_column(Text, default="")
    source: Mapped[str] = mapped_column(String(32), default="")
    requested_by_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    requested_by_name: Mapped[str] = mapped_column(String(128), default="")
    length_ms: Mapped[int] = mapped_column(Integer, default=0)
    played_at: Mapped[datetime] = mapped_column(DateTime(), default=utcnow, index=True)


class ModWarning(Base):
    __tablename__ = "mod_warnings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    guild_id: Mapped[int] = mapped_column(BigInteger, index=True)
    user_id: Mapped[int] = mapped_column(BigInteger, index=True)
    user_name: Mapped[str] = mapped_column(String(128), default="")
    issuer_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    issuer_name: Mapped[str] = mapped_column(String(128), default="")
    reason: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(), default=utcnow)


class FavoriteTrack(Base):
    __tablename__ = "favorite_tracks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, index=True)
    title: Mapped[str] = mapped_column(String(256), default="")
    author: Mapped[str] = mapped_column(String(256), default="")
    uri: Mapped[str] = mapped_column(Text, default="")
    source: Mapped[str] = mapped_column(String(32), default="")
    length_ms: Mapped[int] = mapped_column(Integer, default=0)
    artwork: Mapped[str | None] = mapped_column(String(512), nullable=True)
    added_at: Mapped[datetime] = mapped_column(DateTime(), default=utcnow)

    __table_args__ = (UniqueConstraint("user_id", "uri", name="uq_favorite_user_uri"),)


class UserPlaylist(Base):
    __tablename__ = "user_playlists"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, index=True)
    name: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(), default=utcnow)

    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_user_playlist_name"),)


class UserPlaylistTrack(Base):
    __tablename__ = "user_playlist_tracks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    playlist_id: Mapped[int] = mapped_column(Integer, index=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    title: Mapped[str] = mapped_column(String(256), default="")
    author: Mapped[str] = mapped_column(String(256), default="")
    uri: Mapped[str] = mapped_column(Text, default="")
    source: Mapped[str] = mapped_column(String(32), default="")
    length_ms: Mapped[int] = mapped_column(Integer, default=0)
    artwork: Mapped[str | None] = mapped_column(String(512), nullable=True)


class MusicSnapshot(Base):
    """Per-guild music state saved periodically so a restart keeps the queue.

    queue/played hold JSON lists of item payloads (see MusicService);
    the interrupted current track is stored as the first queue entry.
    """

    __tablename__ = "music_snapshots"

    guild_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    queue: Mapped[str] = mapped_column(Text, default="[]")
    played: Mapped[str] = mapped_column(Text, default="[]")
    repeat: Mapped[str] = mapped_column(String(8), default="off")
    # Voice rejoin after restart: where the bot was and which effect ran.
    voice_channel_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    effect: Mapped[str | None] = mapped_column(String(32), nullable=True)
    saved_at: Mapped[datetime] = mapped_column(DateTime(), default=utcnow)


class LyricsCache(Base):
    """Cached LRCLIB lyrics, keyed by "artist|title" (like the artwork cache)."""

    __tablename__ = "lyrics_cache"

    key: Mapped[str] = mapped_column(String(320), primary_key=True)
    data: Mapped[str] = mapped_column(Text)  # JSON: {synced: [[sec, text]], plain: str|null}
    created_at: Mapped[datetime] = mapped_column(DateTime(), default=utcnow)


class TrackArtwork(Base):
    """Cached cover art for tracks, keyed by lowercase "title|author".

    Written whenever a track starts playing; read back everywhere a track
    shows without its own artwork (queue, history, playlists, favorites),
    so covers survive pending items and streaming-url churn.
    """

    __tablename__ = "track_artwork"

    key: Mapped[str] = mapped_column(String(320), primary_key=True)
    artwork: Mapped[str] = mapped_column(String(512), default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(), default=utcnow, onupdate=utcnow)


class SearchCache(Base):
    """Cached search results, keyed by source+guild+normalized query.

    Serves stale-while-revalidate: results up to 30 minutes old come back
    instantly without a banner, results up to a day old come back at once
    while a fresh search reruns, older rows are pruned. Payload is the
    JSON array of track dicts exactly as the search endpoint returns it.
    """

    __tablename__ = "search_cache"

    key: Mapped[str] = mapped_column(String(320), primary_key=True)
    payload: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime(), index=True, default=utcnow)


class Notification(Base):
    """A panel notification (bell in the sidebar).

    guild_id=None means a global event (e.g. a source became unavailable);
    otherwise the event is scoped to one guild's panel. Delivered live over
    the guild websocket and kept here for the initial list after a reload.
    """

    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    guild_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    category: Mapped[str] = mapped_column(String(16), default="player")
    title: Mapped[str] = mapped_column(String(120))
    body: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(), index=True, default=utcnow)


class AvailabilitySample(Base):
    """One probe pass of the availability monitor (every minute).

    Service columns hold 2=up, 1=degraded (slow answer or a recent track
    failure), 0=down; NULL means "not applicable" (e.g. a source without
    a configured token — it is excluded from uptime percentages instead
    of counting as an outage). `details` keeps per-probe latencies.
    """

    __tablename__ = "availability_samples"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(DateTime(), default=utcnow, index=True)
    discord_api: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    discord_gateway: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    lavalink: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    youtube: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    yandex: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    vk: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    radio: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    archive: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    details: Mapped[str] = mapped_column(Text, default="{}")  # JSON


class AvailabilityRollup(Base):
    """Hourly per-service counts, closed out by the sampler as hours end.

    Serves the month-range view without scanning raw samples; raw samples
    are pruned after two days.
    """

    __tablename__ = "availability_rollups"

    hour_start: Mapped[datetime] = mapped_column(DateTime(), primary_key=True)
    service: Mapped[str] = mapped_column(String(24), primary_key=True)
    up: Mapped[int] = mapped_column(Integer, default=0)
    degraded: Mapped[int] = mapped_column(Integer, default=0)
    down: Mapped[int] = mapped_column(Integer, default=0)
    na: Mapped[int] = mapped_column(Integer, default=0)


class VoiceRecording(Base):
    """One voice-call recording session (exclusive mode, no music playback).

    Status flow: recording -> transcribing -> done | failed. The per-speaker
    wav files live on disk under recordings_dir/<guild_id>/<recording_id>/;
    `title` defaults to the channel name at start.
    """

    __tablename__ = "voice_recordings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    guild_id: Mapped[int] = mapped_column(BigInteger, index=True)
    channel_id: Mapped[int] = mapped_column(BigInteger)
    started_by: Mapped[int] = mapped_column(BigInteger)
    started_at: Mapped[datetime] = mapped_column(DateTime(), default=utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="recording")
    error: Mapped[str] = mapped_column(String(500), default="")
    title: Mapped[str] = mapped_column(String(200), default="")


class VoiceRecordingSegment(Base):
    """One transcript line of a recording, attributed to a speaker.

    offset_s/duration_s are relative to the recording start; speakers are
    exact (each Discord user streams their own opus source, no diarization).
    """

    __tablename__ = "voice_recording_segments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    recording_id: Mapped[int] = mapped_column(Integer, index=True)
    user_id: Mapped[int] = mapped_column(BigInteger)
    username: Mapped[str] = mapped_column(String(128), default="")
    offset_s: Mapped[float] = mapped_column(Float)
    duration_s: Mapped[float] = mapped_column(Float, default=0.0)
    text: Mapped[str] = mapped_column(Text)
    # JSON array of {w, start, end} — per-word timecodes (absolute within
    # the recording, same base as offset_s). Empty list = not word-timed.
    words: Mapped[str] = mapped_column(Text, default="[]")
