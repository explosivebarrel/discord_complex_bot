from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine

from app.core.config import Config
from app.core.db.models import (
    AuditLog,
    AvailabilityRollup,
    AvailabilitySample,
    Base,
    TrackArtwork,
    utcnow,
    FavoriteTrack,
    GuildAdmin,
    GuildSettings,
    ModWarning,
    MusicSnapshot,
    PlayHistory,
    SearchCache,
    SystemSetting,
    UserPlaylist,
    UserPlaylistTrack,
    WebSession,
)


class Database:
    def __init__(self, config: Config) -> None:
        self.engine: AsyncEngine = create_async_engine(config.database_url, echo=False)
        self.session_factory = async_sessionmaker(self.engine, expire_on_commit=False)

    async def create_all(self) -> None:
        # Helper for development. In production, use the Alembic migrations.
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

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
        stats_access: str | None = None,
        posts_access: str | None = None,
        moderation_access: str | None = None,
        mod_log_channel_id: int | None = None,
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
            result = await session.execute(
                select(
                    PlayHistory.requested_by_name,
                    PlayHistory.requested_by_id,
                    func.count().label("plays"),
                )
                .where(PlayHistory.guild_id == guild_id, PlayHistory.played_at >= since)
                .group_by(PlayHistory.requested_by_name, PlayHistory.requested_by_id)
                .order_by(func.count().desc())
                .limit(limit)
            )
            return [
                {"name": r.requested_by_name or "unknown", "id": r.requested_by_id, "plays": r.plays}
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
            return {
                "plays_total": int(total_all or 0),
                "plays_30d": int(recent or 0),
                "unique_tracks": int(unique or 0),
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
            result = await session.execute(query.order_by(ModWarning.created_at.desc()).limit(limit))
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
            # Cover of the first track with one: playlist card artwork.
            covers = await session.execute(
                select(
                    UserPlaylistTrack.playlist_id,
                    func.min(UserPlaylistTrack.position),
                    UserPlaylistTrack.artwork,
                )
                .where(
                    UserPlaylistTrack.playlist_id.in_([p.id for p in playlists]),
                    UserPlaylistTrack.artwork.is_not(None),
                    UserPlaylistTrack.artwork != "",
                )
                .group_by(UserPlaylistTrack.playlist_id)
            )
            first_cover = {pid: art for pid, _pos, art in covers.all() if art}
            return [
                {
                    "id": p.id,
                    "name": p.name,
                    "tracks": track_counts.get(p.id, 0),
                    "artwork": first_cover.get(p.id),
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
            row.saved_at = utcnow()
            await session.commit()

    async def delete_music_snapshot(self, guild_id: int) -> None:
        async with self.session_factory() as session:
            row = await session.get(MusicSnapshot, guild_id)
            if row is not None:
                await session.delete(row)
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

    async def load_music_snapshots(self) -> dict[int, dict[str, Any]]:
        import json as _json

        async with self.session_factory() as session:
            rows = (await session.execute(select(MusicSnapshot))).scalars().all()
            return {
                row.guild_id: {
                    "queue": _json.loads(row.queue or "[]"),
                    "played": _json.loads(row.played or "[]"),
                    "repeat": row.repeat,
                }
                for row in rows
            }
