from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import delete, event, func, select, update
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine

from app.core.config import Config
from app.core.db.models import (
    AuditLog,
    AvailabilityRollup,
    AvailabilitySample,
    Base,
    FavoriteTrack,
    GuildAdmin,
    GuildSettings,
    LyricsCache,
    ModWarning,
    MusicSnapshot,
    Notification,
    PlayHistory,
    SearchCache,
    SystemSetting,
    TrackArtwork,
    UserApiToken,
    UserPlaylist,
    UserPlaylistTrack,
    VoiceRecording,
    VoiceRecordingSegment,
    WebSession,
    utcnow,
)


class Database:
    def __init__(self, config: Config) -> None:
        self.engine: AsyncEngine = create_async_engine(config.database_url, echo=False)
        if config.database_url.startswith("sqlite"):
            @event.listens_for(self.engine.sync_engine, "connect")
            def _set_sqlite_pragma(dbapi_connection: Any, connection_record: Any) -> None:
                cursor = dbapi_connection.cursor()
                cursor.execute("PRAGMA journal_mode=WAL")
                cursor.execute("PRAGMA synchronous=NORMAL")
                cursor.execute("PRAGMA busy_timeout=5000")
                cursor.execute("PRAGMA foreign_keys=ON")
                cursor.close()
        self.session_factory = async_sessionmaker(self.engine, expire_on_commit=False)

    async def create_all(self) -> None:
        # Helper for development. In production, use the Alembic migrations.
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

            def _migrate_columns(sync_conn):
                from sqlalchemy import text
                res = sync_conn.execute(text("PRAGMA table_info(voice_recordings)"))
                cols = {row[1] for row in res.fetchall()}
                if cols and "prompt" not in cols:
                    sync_conn.execute(text("ALTER TABLE voice_recordings ADD COLUMN prompt TEXT DEFAULT ''"))
                if cols and "language" not in cols:
                    sync_conn.execute(text("ALTER TABLE voice_recordings ADD COLUMN language VARCHAR(16) DEFAULT ''"))

            await conn.run_sync(_migrate_columns)

    async def dispose(self) -> None:
        await self.engine.dispose()

    # --- guild settings ---

    async def get_guild_settings(self, guild_id: int) -> GuildSettings:
        async with self.session_factory() as session:
            settings = await session.get(GuildSettings, guild_id)
            if settings is None:
                settings = GuildSettings(guild_id=guild_id)
                session.add(settings)
                await session.commit()
            return settings

    async def update_guild_settings(
        self,
        guild_id: int,
        name: str | None = None,
        default_voice_channel_id: int | None = None,
        admin_role_ids: list[int] | None = None,
        autoplay_enabled: bool | None = None,
        autoplay_query: str | None = None,
        autoplay_playlist_id: int | None = None,
        *,
        clear_autoplay_playlist: bool = False,
        clear_np_channel: bool = False,
        stats_access: str | None = None,
        posts_access: str | None = None,
        moderation_access: str | None = None,
        mod_log_channel_id: int | None = None,
        vote_skip: bool | None = None,
        np_channel_id: int | None = None,
        np_message_id: int | None = None,
        volume_access: str | None = None,
        effects_access: str | None = None,
        queue_clear_access: str | None = None,
        seek_access: str | None = None,
        recordings_access: str | None = None,
    ) -> GuildSettings:
        async with self.session_factory() as session:
            settings = await session.get(GuildSettings, guild_id)
            if settings is None:
                settings = GuildSettings(guild_id=guild_id)
                session.add(settings)
            if name is not None:
                settings.name = name
            if default_voice_channel_id is not None:
                settings.default_voice_channel_id = default_voice_channel_id
            if admin_role_ids is not None:
                settings.admin_role_ids = json.dumps(admin_role_ids)
            if autoplay_enabled is not None:
                settings.autoplay_enabled = autoplay_enabled
            if autoplay_query is not None:
                settings.autoplay_query = autoplay_query
            if clear_autoplay_playlist:
                settings.autoplay_playlist_id = None
            elif autoplay_playlist_id is not None:
                settings.autoplay_playlist_id = autoplay_playlist_id
            if stats_access is not None:
                settings.stats_access = stats_access
            if posts_access is not None:
                settings.posts_access = posts_access
            if moderation_access is not None:
                settings.moderation_access = moderation_access
            if mod_log_channel_id is not None:
                settings.mod_log_channel_id = mod_log_channel_id
            if vote_skip is not None:
                settings.vote_skip = vote_skip
            if clear_np_channel:
                settings.np_channel_id = None
                settings.np_message_id = None
            else:
                if np_channel_id is not None:
                    settings.np_channel_id = np_channel_id
                if np_message_id is not None:
                    settings.np_message_id = np_message_id
            for field, value in (
                ("volume_access", volume_access),
                ("effects_access", effects_access),
                ("queue_clear_access", queue_clear_access),
                ("seek_access", seek_access),
                ("recordings_access", recordings_access),
            ):
                if value is not None:
                    setattr(settings, field, value)
            await session.commit()
            return settings

    # --- guild admins ---

    async def list_guild_admins(self, guild_id: int) -> list[int]:
        async with self.session_factory() as session:
            result = await session.execute(
                select(GuildAdmin.discord_id).where(GuildAdmin.guild_id == guild_id)
            )
            return [row[0] for row in result.all()]

    async def add_guild_admin(self, guild_id: int, discord_id: int, added_by: int | None) -> None:
        async with self.session_factory() as session:
            exists = await session.get(GuildAdmin, (guild_id, discord_id))
            if exists is None:
                session.add(GuildAdmin(guild_id=guild_id, discord_id=discord_id, added_by=added_by))
                await session.commit()

    async def remove_guild_admin(self, guild_id: int, discord_id: int) -> None:
        async with self.session_factory() as session:
            admin = await session.get(GuildAdmin, (guild_id, discord_id))
            if admin is not None:
                await session.delete(admin)
                await session.commit()

    # --- audit ---

    async def audit(
        self,
        action: str,
        guild_id: int | None = None,
        actor_id: int | None = None,
        actor_kind: str = "user",
        details: dict[str, Any] | None = None,
    ) -> None:
        async with self.session_factory() as session:
            session.add(
                AuditLog(
                    guild_id=guild_id,
                    actor_id=actor_id,
                    actor_kind=actor_kind,
                    action=action,
                    details=json.dumps(details or {}, ensure_ascii=False),
                )
            )
            await session.commit()

    # --- system settings ---

    async def get_system_setting(self, key: str) -> dict[str, Any] | None:
        import json as _json

        async with self.session_factory() as session:
            row = await session.get(SystemSetting, key)
            return _json.loads(row.value) if row is not None else None

    async def set_system_setting(self, key: str, value: dict[str, Any]) -> None:
        import json as _json

        async with self.session_factory() as session:
            row = await session.get(SystemSetting, key)
            if row is None:
                row = SystemSetting(key=key, value=_json.dumps(value, ensure_ascii=False))
                session.add(row)
            else:
                row.value = _json.dumps(value, ensure_ascii=False)
            await session.commit()

    async def delete_system_setting(self, key: str) -> None:
        async with self.session_factory() as session:
            row = await session.get(SystemSetting, key)
            if row is not None:
                await session.delete(row)
                await session.commit()

    # --- user API tokens (browser userscript keys) ---

    async def create_user_api_token(
        self, token_hash: str, *, discord_id: int, username: str, global_name: str, label: str
    ) -> None:
        async with self.session_factory() as session:
            session.add(
                UserApiToken(
                    id=token_hash,
                    discord_id=discord_id,
                    username=username[:128],
                    global_name=global_name[:128],
                    label=label[:128],
                )
            )
            await session.commit()

    async def get_user_api_token(self, token_hash: str) -> UserApiToken | None:
        async with self.session_factory() as session:
            return await session.get(UserApiToken, token_hash)

    async def touch_user_api_token(self, token_hash: str) -> None:
        async with self.session_factory() as session:
            row = await session.get(UserApiToken, token_hash)
            if row is not None:
                row.last_used_at = utcnow()
                await session.commit()

    async def list_user_api_tokens(self, discord_id: int) -> list[UserApiToken]:
        async with self.session_factory() as session:
            rows = (
                await session.execute(
                    select(UserApiToken)
                    .where(UserApiToken.discord_id == discord_id, UserApiToken.revoked == False)  # noqa: E712
                    .order_by(UserApiToken.created_at.desc())
                )
            ).scalars().all()
            return list(rows)

    async def revoke_user_api_token(self, token_hash: str, discord_id: int) -> bool:
        """Revoke only if the key belongs to the caller; True when found."""
        async with self.session_factory() as session:
            row = await session.get(UserApiToken, token_hash)
            if row is None or row.discord_id != discord_id:
                return False
            row.revoked = True
            await session.commit()
            return True

    async def revoke_user_api_token_by_prefix(self, id_prefix: str, discord_id: int) -> bool:
        async with self.session_factory() as session:
            rows = (
                await session.execute(
                    select(UserApiToken).where(
                        UserApiToken.discord_id == discord_id,
                        UserApiToken.revoked == False,  # noqa: E712
                    )
                )
            ).scalars().all()
            row = next((r for r in rows if r.id.startswith(id_prefix)), None)
            if row is None:
                return False
            row.revoked = True
            await session.commit()
            return True

    # --- play history ---

    async def add_play_history(
        self,
        guild_id: int,
        *,
        title: str,
        author: str,
        uri: str,
        source: str,
        length_ms: int,
        requested_by_id: int | None,
        requested_by_name: str,
    ) -> None:
        async with self.session_factory() as session:
            session.add(
                PlayHistory(
                    guild_id=guild_id,
                    title=title[:256],
                    author=author[:256],
                    uri=uri[:2048],
                    source=source[:32],
                    length_ms=length_ms,
                    requested_by_id=requested_by_id,
                    requested_by_name=requested_by_name[:128],
                )
            )
            await session.commit()

    async def top_tracks(self, guild_id: int, days: int = 30, limit: int = 10) -> list[dict[str, Any]]:
        since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=days)
        async with self.session_factory() as session:
            result = await session.execute(
                select(
                    PlayHistory.title,
                    PlayHistory.author,
                    PlayHistory.source,
                    func.count().label("plays"),
                )
                .where(PlayHistory.guild_id == guild_id, PlayHistory.played_at >= since)
                .group_by(PlayHistory.title, PlayHistory.author, PlayHistory.source)
                .order_by(func.count().desc())
                .limit(limit)
            )
            return [
                {"title": r.title, "author": r.author, "source": r.source, "plays": r.plays}
                for r in result.all()
            ]

    async def top_requesters(self, guild_id: int, days: int = 30, limit: int = 10) -> list[dict[str, Any]]:
        since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=days)
        async with self.session_factory() as session:
            # Group by name only: old rows carry requested_by_id=0, so
            # grouping by (name, id) split every user in two.
            result = await session.execute(
                select(
                    PlayHistory.requested_by_name,
                    func.count().label("plays"),
                )
                .where(PlayHistory.guild_id == guild_id, PlayHistory.played_at >= since)
                .group_by(PlayHistory.requested_by_name)
                .order_by(func.count().desc())
                .limit(limit)
            )
            return [
                {"name": r.requested_by_name or "unknown", "id": None, "plays": r.plays}
                for r in result.all()
            ]

    async def recent_history(self, guild_id: int, limit: int = 20) -> list[dict[str, Any]]:
        async with self.session_factory() as session:
            result = await session.execute(
                select(PlayHistory)
                .where(PlayHistory.guild_id == guild_id)
                .order_by(PlayHistory.played_at.desc())
                .limit(limit)
            )
            return [
                {
                    "title": row.title,
                    "author": row.author,
                    "source": row.source,
                    "requested_by": row.requested_by_name,
                    "played_at": row.played_at.isoformat(),
                }
                for row in result.scalars()
            ]

    async def plays_by_source(self, guild_id: int, days: int = 30, limit: int = 10) -> list[dict[str, Any]]:
        since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=days)
        async with self.session_factory() as session:
            result = await session.execute(
                select(PlayHistory.source, func.count().label("plays"))
                .where(PlayHistory.guild_id == guild_id, PlayHistory.played_at >= since)
                .group_by(PlayHistory.source)
                .order_by(func.count().desc())
                .limit(limit)
            )
            return [{"source": r.source or "unknown", "plays": r.plays} for r in result.all()]

    async def top_authors(self, guild_id: int, days: int = 30, limit: int = 10) -> list[dict[str, Any]]:
        since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=days)
        async with self.session_factory() as session:
            result = await session.execute(
                select(PlayHistory.author, func.count().label("plays"))
                .where(PlayHistory.guild_id == guild_id, PlayHistory.played_at >= since, PlayHistory.author != "")
                .group_by(PlayHistory.author)
                .order_by(func.count().desc())
                .limit(limit)
            )
            return [{"author": r.author, "plays": r.plays} for r in result.all()]

    async def plays_by_day(self, guild_id: int, days: int = 30) -> list[dict[str, Any]]:
        """Per-day play counts for the activity chart, oldest day first."""
        since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=days)
        async with self.session_factory() as session:
            result = await session.execute(
                select(
                    func.date(PlayHistory.played_at).label("day"),
                    func.count().label("plays"),
                )
                .where(PlayHistory.guild_id == guild_id, PlayHistory.played_at >= since)
                .group_by(func.date(PlayHistory.played_at))
                .order_by(func.date(PlayHistory.played_at))
            )
            return [{"day": str(r.day), "plays": r.plays} for r in result.all()]

    async def history_totals(self, guild_id: int, days: int = 30) -> dict[str, int]:
        since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=days)
        async with self.session_factory() as session:
            total_all = await session.scalar(
                select(func.count()).select_from(PlayHistory).where(PlayHistory.guild_id == guild_id)
            )
            recent = await session.scalar(
                select(func.count())
                .select_from(PlayHistory)
                .where(PlayHistory.guild_id == guild_id, PlayHistory.played_at >= since)
            )
            unique = await session.scalar(
                select(func.count(func.distinct(PlayHistory.title))).where(PlayHistory.guild_id == guild_id)
            )
            # LIVE streams carry length_ms = int64max and overflow the sum;
            # anything longer than a day is a stream, exclude it.
            track_length = (PlayHistory.length_ms > 0) & (PlayHistory.length_ms < 86_400_000)
            minutes_30d = await session.scalar(
                select(func.sum(PlayHistory.length_ms)).where(
                    PlayHistory.guild_id == guild_id, PlayHistory.played_at >= since, track_length
                )
            )
            minutes_total = await session.scalar(
                select(func.sum(PlayHistory.length_ms)).where(PlayHistory.guild_id == guild_id, track_length)
            )
            return {
                "plays_total": int(total_all or 0),
                "plays_30d": int(recent or 0),
                "unique_tracks": int(unique or 0),
                "minutes_30d": int(minutes_30d or 0) // 60000,
                "minutes_total": int(minutes_total or 0) // 60000,
            }

    # --- panel users ---

    async def list_panel_users(self, limit: int = 200) -> list[dict[str, Any]]:
        """Discord accounts that logged into the panel, latest session first.

        The bot runs without the privileged members intent, so this table is
        one of the few reliable member-name sources for the post composer.
        """
        async with self.session_factory() as session:
            result = await session.execute(
                select(
                    WebSession.discord_id,
                    WebSession.username,
                    WebSession.global_name,
                    WebSession.avatar,
                    func.max(WebSession.created_at).label("last_seen"),
                )
                .group_by(
                    WebSession.discord_id, WebSession.username, WebSession.global_name, WebSession.avatar
                )
                .order_by(func.max(WebSession.created_at).desc())
                .limit(limit)
            )
            return [
                {
                    "id": str(r.discord_id),
                    "username": r.username,
                    "global_name": r.global_name,
                    "avatar": r.avatar,
                }
                for r in result.all()
            ]

    # --- moderation ---

    async def add_warning(
        self,
        guild_id: int,
        user_id: int,
        user_name: str,
        issuer_id: int | None,
        issuer_name: str,
        reason: str,
    ) -> int:
        async with self.session_factory() as session:
            row = ModWarning(
                guild_id=guild_id,
                user_id=user_id,
                user_name=user_name[:128],
                issuer_id=issuer_id,
                issuer_name=issuer_name[:128],
                reason=reason,
            )
            session.add(row)
            await session.commit()
            return row.id

    async def list_warnings(
        self, guild_id: int, user_id: int | None = None, limit: int = 50
    ) -> list[dict[str, Any]]:
        async with self.session_factory() as session:
            query = select(ModWarning).where(ModWarning.guild_id == guild_id)
            if user_id is not None:
                query = query.where(ModWarning.user_id == user_id)
            result = await session.execute(
                query.order_by(ModWarning.created_at.desc(), ModWarning.id.desc()).limit(limit)
            )
            return [
                {
                    "id": row.id,
                    "user_id": str(row.user_id),
                    "user_name": row.user_name,
                    "issuer_id": str(row.issuer_id) if row.issuer_id else None,
                    "issuer_name": row.issuer_name,
                    "reason": row.reason,
                    "created_at": row.created_at.isoformat(),
                }
                for row in result.scalars()
            ]

    async def recent_actions(
        self, guild_id: int, action_prefix: str, limit: int = 20
    ) -> list[dict[str, Any]]:
        """Latest audit entries for an action prefix, newest first."""
        async with self.session_factory() as session:
            result = await session.execute(
                select(AuditLog)
                .where(AuditLog.guild_id == guild_id, AuditLog.action.like(f"{action_prefix}%"))
                .order_by(AuditLog.created_at.desc())
                .limit(limit)
            )
            return [
                {
                    "action": row.action,
                    "actor_id": str(row.actor_id) if row.actor_id else None,
                    "details": json.loads(row.details or "{}"),
                    "created_at": row.created_at.isoformat(),
                }
                for row in result.scalars()
            ]

    # --- favorites ---

    async def list_favorites(self, user_id: int, limit: int = 100) -> list[dict[str, Any]]:
        async with self.session_factory() as session:
            result = await session.execute(
                select(FavoriteTrack)
                .where(FavoriteTrack.user_id == user_id)
                .order_by(FavoriteTrack.added_at.desc())
                .limit(limit)
            )
            favorites = [
                {
                    "id": row.id,
                    "title": row.title,
                    "author": row.author,
                    "uri": row.uri,
                    "source": row.source,
                    "length_ms": row.length_ms,
                    "artwork": row.artwork,
                    "added_at": row.added_at.isoformat(),
                }
                for row in result.scalars()
            ]
            await self.fill_track_artworks(favorites)
            return favorites

    async def add_favorite(
        self,
        user_id: int,
        *,
        title: str,
        author: str,
        uri: str,
        source: str,
        length_ms: int,
        artwork: str | None,
    ) -> int:
        async with self.session_factory() as session:
            existing = await session.execute(
                select(FavoriteTrack).where(FavoriteTrack.user_id == user_id, FavoriteTrack.uri == uri)
            )
            row = existing.scalars().first()
            if row is not None:
                # Keep one row per track; refresh the metadata.
                row.title = title[:256]
                row.author = author[:256]
                row.source = source[:32]
                row.length_ms = length_ms
                row.artwork = artwork
                await session.commit()
                return row.id
            row = FavoriteTrack(
                user_id=user_id,
                title=title[:256],
                author=author[:256],
                uri=uri[:2048],
                source=source[:32],
                length_ms=length_ms,
                artwork=artwork,
            )
            session.add(row)
            await session.commit()
            return row.id

    async def remove_favorite(self, user_id: int, favorite_id: int) -> bool:
        async with self.session_factory() as session:
            row = await session.get(FavoriteTrack, favorite_id)
            if row is None or row.user_id != user_id:
                return False
            await session.delete(row)
            await session.commit()
            return True

    async def find_favorite_by_uri(self, user_id: int, uris: list[str]) -> dict[str, int]:
        """Map uri -> favorite id for the given user (only known uris)."""
        if not uris:
            return {}
        async with self.session_factory() as session:
            result = await session.execute(
                select(FavoriteTrack.uri, FavoriteTrack.id).where(
                    FavoriteTrack.user_id == user_id, FavoriteTrack.uri.in_(uris)
                )
            )
            return {r.uri: r.id for r in result.all()}


    # --- personal playlists ---

    async def create_user_playlist(self, user_id: int, name: str) -> int | None:
        """Create a playlist; None when the user already has one with the name."""
        async with self.session_factory() as session:
            exists = await session.execute(
                select(UserPlaylist).where(UserPlaylist.user_id == user_id, UserPlaylist.name == name)
            )
            if exists.scalars().first() is not None:
                return None
            row = UserPlaylist(user_id=user_id, name=name[:100])
            session.add(row)
            await session.commit()
            return row.id

    async def list_user_playlists(self, user_id: int) -> list[dict[str, Any]]:
        async with self.session_factory() as session:
            result = await session.execute(
                select(UserPlaylist).where(UserPlaylist.user_id == user_id).order_by(UserPlaylist.created_at)
            )
            playlists = result.scalars().all()
            if not playlists:
                return []
            counts = await session.execute(
                select(UserPlaylistTrack.playlist_id, func.count(UserPlaylistTrack.id))
                .where(UserPlaylistTrack.playlist_id.in_([p.id for p in playlists]))
                .group_by(UserPlaylistTrack.playlist_id)
            )
            track_counts = dict(counts.all())
            # Covers of the first tracks with artwork, in track order: the
            # playlist card mosaic (1-4 tiles). Duplicate artwork urls are
            # skipped, so the same cover never fills two tiles.
            covers = await session.execute(
                select(UserPlaylistTrack.playlist_id, UserPlaylistTrack.position, UserPlaylistTrack.artwork)
                .where(
                    UserPlaylistTrack.playlist_id.in_([p.id for p in playlists]),
                    UserPlaylistTrack.artwork.is_not(None),
                    UserPlaylistTrack.artwork != "",
                )
                .order_by(UserPlaylistTrack.playlist_id, UserPlaylistTrack.position)
            )
            mosaic: dict[int, list[str]] = {}
            for pid, _pos, art in covers.all():
                bucket = mosaic.setdefault(pid, [])
                if art not in bucket:
                    bucket.append(art)
            return [
                {
                    "id": p.id,
                    "name": p.name,
                    "tracks": track_counts.get(p.id, 0),
                    "artworks": mosaic.get(p.id, [])[:4],
                    "artwork": (mosaic.get(p.id) or [None])[0],
                    "created_at": p.created_at.isoformat(),
                }
                for p in playlists
            ]

    async def get_user_playlist(self, user_id: int, playlist_id: int) -> dict[str, Any] | None:
        async with self.session_factory() as session:
            row = await session.get(UserPlaylist, playlist_id)
            if row is None or row.user_id != user_id:
                return None
            tracks = await session.execute(
                select(UserPlaylistTrack)
                .where(UserPlaylistTrack.playlist_id == playlist_id)
                .order_by(UserPlaylistTrack.position, UserPlaylistTrack.id)
            )
            result = {
                "id": row.id,
                "name": row.name,
                "tracks": [
                    {
                        "id": t.id,
                        "position": t.position,
                        "title": t.title,
                        "author": t.author,
                        "uri": t.uri,
                        "source": t.source,
                        "length_ms": t.length_ms,
                        "artwork": t.artwork,
                    }
                    for t in tracks.scalars().all()
                ],
            }
            await self.fill_track_artworks(result["tracks"])
            return result

    async def delete_user_playlist(self, user_id: int, playlist_id: int) -> bool:
        async with self.session_factory() as session:
            row = await session.get(UserPlaylist, playlist_id)
            if row is None or row.user_id != user_id:
                return False
            await session.execute(
                delete(UserPlaylistTrack).where(UserPlaylistTrack.playlist_id == playlist_id)
            )
            await session.delete(row)
            await session.commit()
            return True

    async def add_user_playlist_tracks(
        self, user_id: int, playlist_id: int, tracks: list[dict[str, Any]]
    ) -> tuple[int, int]:
        """Append track dicts (title/author/uri/source/length_ms/artwork).

        Tracks whose uri is already in the playlist are skipped; returns
        (added, skipped_duplicate).
        """
        async with self.session_factory() as session:
            row = await session.get(UserPlaylist, playlist_id)
            if row is None or row.user_id != user_id:
                return (0, 0)
            existing = await session.execute(
                select(UserPlaylistTrack.uri).where(UserPlaylistTrack.playlist_id == playlist_id)
            )
            known = {u for (u,) in existing.all() if u}
            last = await session.execute(
                select(func.max(UserPlaylistTrack.position)).where(
                    UserPlaylistTrack.playlist_id == playlist_id
                )
            )
            position = (last.scalar() or 0) + 1
            added = 0
            skipped = 0
            for t in tracks:
                uri = str(t.get("uri") or "")
                if uri and uri in known:
                    skipped += 1
                    continue
                if uri:
                    known.add(uri)
                session.add(
                    UserPlaylistTrack(
                        playlist_id=playlist_id,
                        position=position,
                        title=str(t.get("title") or "")[:256],
                        author=str(t.get("author") or "")[:256],
                        uri=uri,
                        source=str(t.get("source") or "")[:32],
                        length_ms=int(t.get("length_ms") or 0),
                        artwork=t.get("artwork"),
                    )
                )
                position += 1
                added += 1
            await session.commit()
            return (added, skipped)

    async def get_playlist_by_id(self, playlist_id: int) -> dict[str, Any] | None:
        """Owner-agnostic playlist read: autoplay outlives its creator."""
        async with self.session_factory() as session:
            row = await session.get(UserPlaylist, playlist_id)
            if row is None:
                return None
            tracks = await session.execute(
                select(UserPlaylistTrack)
                .where(UserPlaylistTrack.playlist_id == playlist_id)
                .order_by(UserPlaylistTrack.position, UserPlaylistTrack.id)
            )
            result = {
                "id": row.id,
                "name": row.name,
                "tracks": [
                    {
                        "id": t.id,
                        "title": t.title,
                        "author": t.author,
                        "uri": t.uri,
                        "source": t.source,
                        "length_ms": t.length_ms,
                        "artwork": t.artwork,
                    }
                    for t in tracks.scalars().all()
                ],
            }
            await self.fill_track_artworks(result["tracks"])
            return result

    async def remove_user_playlist_track(self, user_id: int, playlist_id: int, track_id: int) -> bool:
        async with self.session_factory() as session:
            playlist = await session.get(UserPlaylist, playlist_id)
            if playlist is None or playlist.user_id != user_id:
                return False
            row = await session.get(UserPlaylistTrack, track_id)
            if row is None or row.playlist_id != playlist_id:
                return False
            await session.delete(row)
            await session.commit()
            return True


    # --- music state snapshots (queue persistence) ---

    async def save_music_snapshot(self, guild_id: int, data: dict[str, Any]) -> None:
        import json as _json

        from app.core.db.models import utcnow

        async with self.session_factory() as session:
            row = await session.get(MusicSnapshot, guild_id)
            if row is None:
                row = MusicSnapshot(guild_id=guild_id)
                session.add(row)
            row.queue = _json.dumps(data.get("queue") or [], ensure_ascii=False)
            row.played = _json.dumps(data.get("played") or [], ensure_ascii=False)
            row.repeat = str(data.get("repeat") or "off")
            row.voice_channel_id = data.get("voice_channel_id")
            row.effect = data.get("effect")
            row.saved_at = utcnow()
            await session.commit()

    async def delete_music_snapshot(self, guild_id: int) -> None:
        async with self.session_factory() as session:
            row = await session.get(MusicSnapshot, guild_id)
            if row is not None:
                await session.delete(row)
                await session.commit()

    # --- lyrics cache ---

    @staticmethod
    def lyrics_key(artist: str, title: str) -> str:
        return f"{(artist or '').strip().lower()}|{(title or '').strip().lower()}"[:320]

    async def get_lyrics(self, key: str, max_age_s: float | None = None) -> dict[str, Any] | None:
        """The cached lyrics, or None when absent — or older than
        ``max_age_s`` (the rolling TTL: a stale entry re-fetches, and even
        a miss is re-saved, extending its lifetime)."""
        import json as _json

        async with self.session_factory() as session:
            row = await session.get(LyricsCache, key)
            if row is None:
                return None
            if max_age_s is not None and row.created_at is not None:
                from app.core.db.models import utcnow

                if utcnow() - row.created_at > timedelta(seconds=max_age_s):
                    return None
            return _json.loads(row.data)

    async def save_lyrics(self, key: str, data: dict[str, Any]) -> None:
        import json as _json

        from app.core.db.models import utcnow

        async with self.session_factory() as session:
            row = await session.get(LyricsCache, key)
            if row is None:
                row = LyricsCache(key=key)
                session.add(row)
            row.data = _json.dumps(data, ensure_ascii=False)
            row.created_at = utcnow()
            await session.commit()

    # --- track artwork cache ---

    @staticmethod
    def artwork_key(title: str, author: str) -> str:
        """Cache key of a track cover: lowercase "title|author"."""
        return f"{(title or '').strip().lower()}|{(author or '').strip().lower()}"[:320]

    async def upsert_track_artworks(self, pairs: list[tuple[str, str]]) -> None:
        """Store cover urls for artwork keys; skips empty artwork."""
        pairs = [(k, a) for k, a in pairs if k and a]
        if not pairs:
            return
        async with self.session_factory() as session:
            for key, artwork in pairs:
                row = await session.get(TrackArtwork, key)
                if row is None:
                    session.add(TrackArtwork(key=key, artwork=artwork))
                elif row.artwork != artwork:
                    row.artwork = artwork
            await session.commit()

    async def get_track_artworks(self, keys: list[str]) -> dict[str, str]:
        """Cover urls for the given keys; missing keys are absent."""
        keys = [k for k in keys if k]
        if not keys:
            return {}
        async with self.session_factory() as session:
            rows = await session.execute(
                select(TrackArtwork.key, TrackArtwork.artwork).where(TrackArtwork.key.in_(keys))
            )
            return dict(rows.all())

    async def fill_track_artworks(self, rows: list[dict[str, Any]]) -> None:
        """Backfill missing artwork on track dicts (title/author/uri/...)."""
        missing = [self.artwork_key(r.get("title"), r.get("author")) for r in rows if not r.get("artwork")]
        if not missing:
            return
        try:
            covers = await self.get_track_artworks(missing)
        except Exception:  # noqa: BLE001 - covers are decorative
            return
        for row in rows:
            if not row.get("artwork"):
                row["artwork"] = covers.get(self.artwork_key(row.get("title"), row.get("author")))

    # --- availability monitor ---

    async def add_availability_sample(self, statuses: dict[str, int | None], details: dict[str, Any]) -> None:
        """One probe pass: per-service 2=up / 1=degraded / 0=down / NULL=n/a."""
        from app.core.db.models import utcnow

        async with self.session_factory() as session:
            session.add(
                AvailabilitySample(ts=utcnow(), details=json.dumps(details), **statuses)
            )
            await session.commit()

    async def availability_samples_between(
        self, start: datetime, end: datetime
    ) -> list[AvailabilitySample]:
        async with self.session_factory() as session:
            rows = await session.execute(
                select(AvailabilitySample)
                .where(AvailabilitySample.ts >= start, AvailabilitySample.ts < end)
                .order_by(AvailabilitySample.ts)
            )
            return list(rows.scalars())

    async def availability_last_rollup_hour(self) -> datetime | None:
        async with self.session_factory() as session:
            row = await session.execute(select(func.max(AvailabilityRollup.hour_start)))
            return row.scalar_one_or_none()

    async def upsert_availability_rollup(
        self, hour_start: datetime, service: str, counts: dict[str, int]
    ) -> None:
        async with self.session_factory() as session:
            row = await session.get(AvailabilityRollup, (hour_start, service))
            if row is None:
                row = AvailabilityRollup(hour_start=hour_start, service=service, **counts)
                session.add(row)
            else:
                for key, value in counts.items():
                    setattr(row, key, value)
            await session.commit()

    async def availability_rollups_since(self, since: datetime) -> list[AvailabilityRollup]:
        async with self.session_factory() as session:
            rows = await session.execute(
                select(AvailabilityRollup)
                .where(AvailabilityRollup.hour_start >= since)
                .order_by(AvailabilityRollup.hour_start)
            )
            return list(rows.scalars())

    async def prune_availability(self, raw_before: datetime, rollup_before: datetime) -> None:
        async with self.session_factory() as session:
            await session.execute(delete(AvailabilitySample).where(AvailabilitySample.ts < raw_before))
            await session.execute(
                delete(AvailabilityRollup).where(AvailabilityRollup.hour_start < rollup_before)
            )
            await session.commit()

    async def get_search_cache(self, key: str) -> dict[str, Any] | None:
        async with self.session_factory() as session:
            row = await session.get(SearchCache, key)
            if row is None:
                return None
            return {"payload": json.loads(row.payload), "created_at": row.created_at}

    async def upsert_search_cache(self, key: str, payload: list[dict[str, Any]]) -> None:
        async with self.session_factory() as session:
            row = await session.get(SearchCache, key)
            if row is None:
                row = SearchCache(key=key, payload=json.dumps(payload))
                session.add(row)
            else:
                row.payload = json.dumps(payload)
                row.created_at = utcnow()
            await session.commit()

    async def prune_search_cache(self, before: datetime) -> None:
        async with self.session_factory() as session:
            await session.execute(delete(SearchCache).where(SearchCache.created_at < before))
            await session.commit()

    async def add_notification(
        self, guild_id: int | None, category: str, title: str, body: str = ""
    ) -> dict[str, Any]:
        async with self.session_factory() as session:
            row = Notification(guild_id=guild_id, category=category, title=title, body=body)
            session.add(row)
            await session.commit()
            return {
                "id": row.id,
                "guild_id": row.guild_id,
                "category": row.category,
                "title": row.title,
                "body": row.body,
                "created_at": row.created_at.isoformat(),
            }

    async def list_notifications(self, limit: int = 30) -> list[dict[str, Any]]:
        async with self.session_factory() as session:
            rows = await session.execute(
                select(Notification).order_by(Notification.created_at.desc(), Notification.id.desc()).limit(limit)
            )
            return [
                {
                    "id": r.id,
                    "guild_id": r.guild_id,
                    "category": r.category,
                    "title": r.title,
                    "body": r.body,
                    "created_at": r.created_at.isoformat(),
                }
                for r in rows.scalars()
            ]

    async def prune_notifications(self, before: datetime) -> None:
        async with self.session_factory() as session:
            await session.execute(delete(Notification).where(Notification.created_at < before))
            await session.commit()

    async def clear_notifications(self) -> None:
        async with self.session_factory() as session:
            await session.execute(delete(Notification))
            await session.commit()

    async def load_music_snapshots(self) -> dict[int, dict[str, Any]]:
        import json as _json

        async with self.session_factory() as session:
            rows = (await session.execute(select(MusicSnapshot))).scalars().all()
            return {
                row.guild_id: {
                    "queue": _json.loads(row.queue or "[]"),
                    "played": _json.loads(row.played or "[]"),
                    "repeat": row.repeat,
                    "voice_channel_id": row.voice_channel_id,
                    "effect": row.effect,
                }
                for row in rows
            }

    # --- voice recordings ---

    async def add_voice_recording(
        self,
        guild_id: int,
        channel_id: int,
        started_by: int,
        title: str,
        prompt: str = "",
        language: str = "",
    ) -> dict[str, Any]:
        async with self.session_factory() as session:
            row = VoiceRecording(
                guild_id=guild_id,
                channel_id=channel_id,
                started_by=started_by,
                title=title,
                prompt=prompt,
                language=language,
            )
            session.add(row)
            await session.commit()
            return self._recording_dict(row)

    async def update_recording_metadata(
        self,
        recording_id: int,
        guild_id: int,
        title: str | None = None,
        prompt: str | None = None,
        language: str | None = None,
    ) -> dict[str, Any] | None:
        async with self.session_factory() as session:
            row = await session.get(VoiceRecording, recording_id)
            if row is None or row.guild_id != guild_id:
                return None
            if title is not None:
                row.title = title
            if prompt is not None:
                row.prompt = prompt
            if language is not None:
                row.language = language
            await session.commit()
            return self._recording_dict(row)

    async def update_recording_status(
        self, recording_id: int, status: str, error: str = "", title: str | None = None
    ) -> None:
        async with self.session_factory() as session:
            row = await session.get(VoiceRecording, recording_id)
            if row is None:
                return
            row.status = status
            row.error = error
            if status in ("transcribing", "done", "failed"):
                row.ended_at = utcnow()
            if title is not None:
                row.title = title
            await session.commit()

    async def add_recording_segments(self, recording_id: int, segments: list[dict[str, Any]]) -> None:
        async with self.session_factory() as session:
            for seg in segments:
                words = seg.pop("words", "[]")
                if isinstance(words, list):
                    import json as _json

                    words = _json.dumps(words, ensure_ascii=False)
                session.add(
                    VoiceRecordingSegment(recording_id=recording_id, words=words, **seg)
                )
            await session.commit()

    async def list_voice_recordings(self, guild_id: int, limit: int = 50) -> list[dict[str, Any]]:
        async with self.session_factory() as session:
            rows = await session.execute(
                select(VoiceRecording)
                .where(VoiceRecording.guild_id == guild_id)
                .order_by(VoiceRecording.started_at.desc(), VoiceRecording.id.desc())
                .limit(limit)
            )
            return [self._recording_dict(r) for r in rows.scalars()]

    async def get_recording(self, recording_id: int, guild_id: int) -> dict[str, Any] | None:
        async with self.session_factory() as session:
            row = await session.get(VoiceRecording, recording_id)
            if row is None or row.guild_id != guild_id:
                return None
            return self._recording_dict(row)

    async def get_segments(self, recording_id: int) -> list[dict[str, Any]]:
        async with self.session_factory() as session:
            rows = await session.execute(
                select(VoiceRecordingSegment)
                .where(VoiceRecordingSegment.recording_id == recording_id)
                .order_by(VoiceRecordingSegment.offset_s, VoiceRecordingSegment.id)
            )
            import json as _json

            return [
                {
                    "user_id": r.user_id,
                    "username": r.username,
                    "offset_s": r.offset_s,
                    "duration_s": r.duration_s,
                    "text": r.text,
                    "words": _json.loads(r.words or "[]"),
                }
                for r in rows.scalars()
            ]

    async def delete_recording(self, recording_id: int, guild_id: int) -> bool:
        async with self.session_factory() as session:
            row = await session.get(VoiceRecording, recording_id)
            if row is None or row.guild_id != guild_id:
                return False
            await session.execute(
                delete(VoiceRecordingSegment).where(VoiceRecordingSegment.recording_id == recording_id)
            )
            await session.delete(row)
            await session.commit()
            return True

    async def fail_stale_recordings(self) -> int:
        """After a restart no session or transcription can still be live;
        rows stuck in those statuses would never resolve on their own."""
        async with self.session_factory() as session:
            try:
                from sqlalchemy import text
                res = await session.execute(text("PRAGMA table_info(voice_recordings)"))
                cols = {row[1] for row in res.fetchall()}
                if cols and "prompt" not in cols:
                    await session.execute(text("ALTER TABLE voice_recordings ADD COLUMN prompt TEXT DEFAULT ''"))
                if cols and "language" not in cols:
                    await session.execute(text("ALTER TABLE voice_recordings ADD COLUMN language VARCHAR(16) DEFAULT ''"))
                await session.commit()
            except Exception:
                pass

            result = await session.execute(
                update(VoiceRecording)
                .where(VoiceRecording.status.in_(("recording", "queued", "transcribing")))
                .values(status="failed", error="Interrupted by a bot restart.", ended_at=utcnow())
            )
            await session.commit()
            return result.rowcount

    @staticmethod
    def _recording_dict(row: VoiceRecording) -> dict[str, Any]:
        return {
            "id": row.id,
            "guild_id": row.guild_id,
            "channel_id": row.channel_id,
            "started_by": row.started_by,
            "started_at": row.started_at.isoformat(),
            "ended_at": row.ended_at.isoformat() if row.ended_at else None,
            "status": row.status,
            "error": row.error,
            "title": row.title,
            "prompt": getattr(row, "prompt", "") or "",
            "language": getattr(row, "language", "") or "",
        }
