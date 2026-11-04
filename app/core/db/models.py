from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import BigInteger, Boolean, DateTime, Integer, SmallInteger, String, Text, UniqueConstraint
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
    saved_at: Mapped[datetime] = mapped_column(DateTime(), default=utcnow)


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
