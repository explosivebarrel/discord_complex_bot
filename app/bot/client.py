from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING

import discord
import wavelink
from discord.ext import commands

from app.core.db import Database
from app.core.services.music import MusicService

if TYPE_CHECKING:
    from app.core.config import Config

logger = logging.getLogger(__name__)


class ComplexBot(commands.Bot):
    def __init__(self, config: Config, db: Database, music: MusicService) -> None:
        intents = discord.Intents.default()
        intents.voice_states = True
        super().__init__(
            command_prefix=commands.when_mentioned,  # Slash-only bot. The prefix stays for owner debug.
            intents=intents,
            help_command=None,
        )
        self.config = config
        self.db = db
        self.music = music

    async def setup_hook(self) -> None:
        await self.db.create_all()
        for ext in ("app.bot.cogs.music", "app.bot.cogs.moderation", "app.bot.cogs.owner"):
            await self.load_extension(ext)
        await self.tree.sync()
        logger.info("Slash commands synced")
        # Pool.connect retries until Lavalink is reachable. Run it as a background
        # task, because the gateway connect waits for setup_hook to finish.
        asyncio.create_task(wavelink_connect(self), name="lavalink-connect")

    async def on_ready(self) -> None:
        logger.info(
            "Bot ready as %s (%s), guilds: %d", self.user, self.user and self.user.id, len(self.guilds)
        )

    async def close(self) -> None:
        for guild_id in list(self.music.queues.keys()):
            try:
                await self.music.disconnect(guild_id)
            except Exception:  # noqa: BLE001 - cleanup errors at shutdown are not important
                logger.exception("Failed to disconnect player for guild %s", guild_id)
        await super().close()


async def wavelink_connect(bot: ComplexBot) -> None:
    # Wavelink needs the scheme in the URI. It appends /v4/websocket on its own.
    scheme = "https" if bot.config.lavalink_secure else "http"
    node = wavelink.Node(
        uri=f"{scheme}://{bot.config.lavalink_host}:{bot.config.lavalink_port}",
        password=bot.config.lavalink_password,
        client=bot,
    )
    try:
        nodes = await wavelink.Pool.connect(client=bot, nodes=[node])
    except Exception:
        logger.exception("Failed to connect to Lavalink at %s", node.uri)
        return
    logger.info("Connected to Lavalink node(s): %s", [n.identifier for n in nodes.values()])
