from __future__ import annotations

from collections import deque
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.core.config import Config
from app.core.db import Database
from app.core.services.music import MusicService, QueueItem

GUILD_ID = 100


class FakeTrack:
    """Stand-in for wavelink.Playable. Only the fields MusicService uses."""

    def __init__(self, title: str, author: str = "artist") -> None:
        self.title = title
        self.identifier = title
        self.author = author
        self.uri = f"https://example.com/{title.replace(' ', '-')}"
        self.length = 100_000
        self.artwork = None
        self.source = "http"


class FakePlayer:
    """Records play() calls instead of talking to Lavalink."""

    def __init__(self) -> None:
        self.played: list[str] = []
        self.playing = False
        self.current = None  # nothing loaded yet
        self.channel = None  # not connected to any voice channel
        self.volume = 100

    async def play(self, track: Any) -> None:
        self.played.append(track.title)
        self.playing = True

    async def stop(self) -> None:
        self.playing = False


def make_track(title: str) -> FakeTrack:
    return FakeTrack(title)


def fill_queue(music: MusicService, titles: list[str], guild_id: int = GUILD_ID) -> None:
    music.queues[guild_id] = deque(QueueItem(make_track(t), 1, "tester") for t in titles)


@pytest.fixture
def config(tmp_path: Path) -> Config:
    return Config(
        discord_bot_token="test-token",
        discord_client_id="test-client",
        discord_client_secret="test-secret",
        discord_redirect_uri="http://localhost:8000/api/auth/callback",
        superadmin_ids=[1],
        session_secret="test-session-secret",
        base_url="http://localhost:8000",
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'test.db'}",
        lavalink_host="localhost",
        lavalink_port=2333,
        lavalink_password="pw",
        lavalink_secure=False,
        yandex_music_token="",
        log_level="INFO",
        data_dir=tmp_path,
        music_library_dir=tmp_path / "music",
        internal_base_url="http://localhost:8000",
    )


@pytest.fixture
async def db(config: Config):
    database = Database(config)
    await database.create_all()
    yield database
    await database.dispose()


@pytest.fixture
async def music(db: Database, config: Config) -> MusicService:
    service = MusicService(None, db, config)
    # Minimal bot stub: get_guild answers None so the service behaves as if
    # the bot is not connected to any guild.
    service.bot = SimpleNamespace(get_guild=lambda _guild_id: None)
    return service
