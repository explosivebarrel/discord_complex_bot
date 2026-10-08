from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.deps import cleanup_expired_sessions
from app.api.discord_oauth import DiscordOAuthClient
from app.api.routers import admin, auth, favorites, library, moderation, player, posts, system
from app.bot.client import ComplexBot
from app.core.config import load_config, setup_logging, validate_config
from app.core.db import Database
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
        try:
            await bot.start(config.discord_bot_token)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("The Discord bot stopped with an error")

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.config = config
        app.state.db = db
        app.state.music = music
        app.state.bot = bot
        app.state.oauth = DiscordOAuthClient(config)
        bot_task = asyncio.create_task(_run_bot(), name="discord-bot")
        cleanup_task = asyncio.create_task(_session_cleanup_loop(db), name="session-cleanup")
        try:
            yield
        finally:
            cleanup_task.cancel()
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
    app.include_router(auth.router)
    app.include_router(player.router)
    app.include_router(admin.router)
    app.include_router(system.router)
    app.include_router(favorites.router)
    app.include_router(library.router)
    app.include_router(posts.router)
    app.include_router(moderation.router)

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
