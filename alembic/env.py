from __future__ import annotations

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.ext.asyncio import async_engine_from_config

from app.core.config import load_config
from app.core.db.models import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _database_url() -> str:
    return load_config().database_url


def run_migrations_offline() -> None:
    context.configure(
        url=_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()


def _run_migrations(engine: Engine) -> None:
    with engine.connect() as connection:
        connection.run_sync(do_run_migrations)
    engine.dispose()


async def _run_async_migrations() -> None:
    config_section = config.get_section(config.config_ini_section, {})
    config_section["sqlalchemy.url"] = _database_url()
    connectable = async_engine_from_config(config_section, prefix="sqlalchemy.", poolclass=pool.NullPool)
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    url = _database_url()
    if url.startswith("sqlite+aiosqlite"):
        asyncio.run(_run_async_migrations())
    else:
        from sqlalchemy import create_engine

        _run_migrations(create_engine(url, poolclass=pool.NullPool))


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
