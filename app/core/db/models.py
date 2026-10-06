from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import BigInteger, Boolean, DateTime, Integer, String, Text
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
