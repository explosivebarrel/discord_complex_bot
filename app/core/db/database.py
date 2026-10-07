from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine

from app.core.config import Config
from app.core.db.models import (
    AuditLog,
    Base,
    FavoriteTrack,
    GuildAdmin,
    GuildSettings,
    PlayHistory,
    SystemSetting,
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
            return {"plays_total": int(total_all or 0), "plays_30d": int(recent or 0), "unique_tracks": int(unique or 0)}

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
                .group_by(WebSession.discord_id, WebSession.username, WebSession.global_name, WebSession.avatar)
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

    # --- favorites ---

    async def list_favorites(self, user_id: int, limit: int = 100) -> list[dict[str, Any]]:
        async with self.session_factory() as session:
            result = await session.execute(
                select(FavoriteTrack)
                .where(FavoriteTrack.user_id == user_id)
                .order_by(FavoriteTrack.added_at.desc())
                .limit(limit)
            )
            return [
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

    async def add_favorite(self, user_id: int, *, title: str, author: str, uri: str, source: str, length_ms: int, artwork: str | None) -> int:
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
