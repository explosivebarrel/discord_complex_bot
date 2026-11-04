from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections.abc import AsyncIterator
from datetime import timedelta
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.deps import cleanup_expired_sessions
from app.api.discord_oauth import DiscordOAuthClient
from app.api.routers import (
    admin,
    auth,
    favorites,
    library,
    moderation,
    player,
    posts,
    system,
    user_playlists,
)
from app.bot.client import ComplexBot
from app.core.config import load_config, setup_logging, validate_config
from app.core.db import Database
from app.core.db.models import utcnow
from app.core.services.ws_hub import get_hub
from app.core.services import availability
from app.core.services.music import MusicService

logger = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).resolve().parent / "static"


def create_app() -> FastAPI:
    config = load_config()
    setup_logging(config.log_level)
    validate_config(config)

    db = Database(config)
    music = MusicService(None, db, config)  # The code below sets music.bot to the bot object.
    bot = ComplexBot(config, db, music)
    music.bot = bot

    async def _run_bot() -> None:
        # A flaky network kills the first connect (gateway 5xx, TLS resets);
        # retry with backoff instead of staying down until a manual restart.
        delay = 5
        while True:
            started = time.monotonic()
            try:
                await bot.start(config.discord_bot_token)
                return  # Clean close (logout).
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("The Discord bot stopped with an error")
            # A connect that lived for a while means the network recovered
            # at least once — start the backoff over.
            delay = 5 if time.monotonic() - started > 60 else min(delay * 2, 120)
            logger.warning("Restarting the Discord bot in %ss", delay)
            await asyncio.sleep(delay)

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.config = config
        app.state.db = db
        app.state.music = music
        app.state.bot = bot
        app.state.oauth = DiscordOAuthClient(config)
        # Queues saved by the previous run come back before the bot goes online.
        await music.restore_state()
        persist_task = asyncio.create_task(music.periodic_persist(), name="music-persist")
        bot_task = asyncio.create_task(_run_bot(), name="discord-bot")
        cleanup_task = asyncio.create_task(_session_cleanup_loop(db), name="session-cleanup")
        search_cache_task = asyncio.create_task(_search_cache_cleanup_loop(db), name="search-cache-prune")
        hub = get_hub(app)
        music.hub = hub
        state_task = asyncio.create_task(_player_state_loop(app, hub), name="player-state-push")
        availability_task = asyncio.create_task(
            availability.loop(config, db, bot, music), name="availability"
        )
        try:
            yield
        finally:
            persist_task.cancel()
            cleanup_task.cancel()
            search_cache_task.cancel()
            state_task.cancel()
            availability_task.cancel()
            await bot.close()
            bot_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await bot_task
            await db.dispose()

    app = FastAPI(title=config.bot_name, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[config.base_url, "http://localhost:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def cache_headers(request, call_next):
        # The SPA shell must always revalidate (otherwise phones keep an old
        # index.html and never see new bundles); hashed assets and the
        # versioned font subset are safe to cache forever.
        response = await call_next(request)
        path = request.url.path
        if path.startswith(("/assets/", "/fonts/")):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        elif not path.startswith(("/api/",)) and path != "/api/health":
            response.headers["Cache-Control"] = "no-cache"
        return response

    app.include_router(auth.router)
    app.include_router(player.router)
    app.include_router(player.root_router)
    app.include_router(admin.router)
    app.include_router(system.router)
    app.include_router(system.public_router)
    app.include_router(favorites.router)
    app.include_router(library.router)
    app.include_router(posts.router)
    app.include_router(moderation.router)
    app.include_router(user_playlists.router)

    @app.get("/api/health")
    async def health() -> dict[str, object]:
        return {"status": "ok", "bot_ready": bot.is_ready(), "guilds": len(bot.guilds)}

    if STATIC_DIR.is_dir():
        _mount_spa(app)
    return app


def _mount_spa(app: FastAPI) -> None:
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str) -> FileResponse:
        file = STATIC_DIR / full_path
        if full_path and file.is_file():
            return FileResponse(file)
        return FileResponse(STATIC_DIR / "index.html")


async def _session_cleanup_loop(db: Database) -> None:
    while True:
        await asyncio.sleep(3600)
        try:
            await cleanup_expired_sessions(db)
        except Exception:  # noqa: BLE001 - an error here must not stop the loop
            logger.exception("Session cleanup failed")


async def _search_cache_cleanup_loop(db: Database) -> None:
    # Search results live at most a day (stale-while-revalidate window),
    # notifications a week.
    while True:
        await asyncio.sleep(600)
        try:
            await db.prune_search_cache(utcnow() - timedelta(hours=24))
            await db.prune_notifications(utcnow() - timedelta(days=7))
        except Exception:  # noqa: BLE001 - an error here must not stop the loop
            logger.exception("Cache cleanup failed")


async def _player_state_loop(app: FastAPI, hub: Any) -> None:
    """Push a player state snapshot to a guild's sockets when it changes.

    The playhead is excluded from the change signature: the panel
    interpolates the position locally between pushes.
    """
    from app.api.routers.player import _hash_state

    last_hashes: dict[int, str] = {}
    while True:
        await asyncio.sleep(1.0)
        music = app.state.music
        for guild_id in list(hub._conns.keys()):
            try:
                state = await music.get_state(guild_id)
            except Exception:  # noqa: BLE001
                continue
            digest = _hash_state(state)
            if digest == last_hashes.get(guild_id):
                continue
            last_hashes[guild_id] = digest
            await hub.broadcast({"type": "state", "state": state}, guild_id=guild_id)


def main() -> None:
    import uvicorn

    config = load_config()
    uvicorn.run(
        "app.main:create_app",
        factory=True,
        host="0.0.0.0",
        port=8000,
        log_level=config.log_level.lower(),
    )


if __name__ == "__main__":
    main()
