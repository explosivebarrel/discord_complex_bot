from __future__ import annotations

import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine

from app.core.config import Config
from app.core.db.models import AuditLog, Base, GuildAdmin, GuildSettings


class Database:
    def __init__(self, config: Config) -> None:
        self.engine: AsyncEngine = create_async_engine(config.database_url, echo=False)
        self.session_factory = async_sessionmaker(self.engine, expire_on_commit=False)

    async def create_all(self) -> None:
        # dev convenience; production uses alembic migrations
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
