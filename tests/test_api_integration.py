"""API-level integration tests: the exact JSON contract the web panel uses.

The real routers run on a FastAPI app whose state points at a test
database, a real MusicService and a stubbed Discord bot, with a genuine
session cookie. A front/back mismatch therefore fails a status-code
assertion here instead of surfacing as a 500 in production (the
trailing-comma tuple default on EnqueueBody.stream_url, which 500'd
every panel enqueue, is the regression this file exists to catch).
"""
from __future__ import annotations

from collections import deque
from types import SimpleNamespace
from typing import Any, AsyncIterator

import httpx
import pytest
from fastapi import FastAPI

from app.api import deps
from app.api.routers import admin, auth, favorites, user_playlists
from app.api.routers import player as player_router_module
from app.api.discord_oauth import DiscordAPIError, DiscordUnreachableError
from app.core.services.music import MusicService, MusicServiceError, QueueItem

from tests.conftest import make_track

GUILD_ID = 100
USER_ID = 555
PANEL_BASE = f"/api/guilds/{GUILD_ID}/player"


class StubVoiceChannel:
    name = "Voice"

    def __init__(self) -> None:
        self.id = 5555
        # request_skip counts non-bot members of the voice channel.
        self.members = [SimpleNamespace(bot=False, id=USER_ID)]


class StubPlayer:
    """Enough of wavelink.Player for the service methods the panel calls."""

    def __init__(self) -> None:
        self.playing = True
        self.paused = False
        self.volume = 80
        self.position = 5000
        self.current = SimpleNamespace(
            title="Now playing", length=100_000, uri="https://example.com/now",
            author="artist", artwork=None, source="http", identifier="now",
        )
        self.channel = StubVoiceChannel()
        self.filters: Any = None

    async def play(self, track: Any, **kwargs: Any) -> None:
        self.current = track
        self.playing = True

    async def stop(self) -> None:
        self.playing = False

    async def pause(self, value: bool = True) -> None:
        self.paused = value

    async def set_volume(self, volume: int) -> None:
        self.volume = volume

    async def seek(self, position: int) -> None:
        self.position = position

    async def disconnect(self) -> None:
        self.playing = False

    async def set_filters(self, filters: Any, *, seek: bool = False) -> None:
        self.filters = filters


class StubGuild:
    name = "Test Guild"
    member_count = 7

    def __init__(self, player: StubPlayer) -> None:
        self.id = GUILD_ID
        self.voice_client = player
        self.owner_id = USER_ID

    def get_member(self, _discord_id: int) -> None:
        return None


class StubBot:
    def __init__(self, guild: StubGuild) -> None:
        self._guild = guild

    def get_guild(self, guild_id: int) -> StubGuild | None:
        return self._guild if guild_id == GUILD_ID else None


@pytest.fixture
async def api(config, db) -> AsyncIterator[tuple[httpx.AsyncClient, MusicService, StubPlayer]]:
    service = MusicService(None, db, config)
    player = StubPlayer()
    service.bot = StubBot(StubGuild(player))
    # MusicService.get_player isinstance-checks against wavelink.Player;
    # route the stub through instead.
    service.get_player = lambda guild_id: player if guild_id == GUILD_ID else None  # type: ignore[method-assign]

    app = FastAPI()
    app.state.config = config
    app.state.db = db
    app.state.music = service
    app.state.bot = service.bot
    app.state.oauth = SimpleNamespace()  # the access mock bypasses Discord lookups
    app.include_router(player_router_module.router)
    app.include_router(player_router_module.root_router)
    app.include_router(auth.router)
    app.include_router(admin.router)
    app.include_router(favorites.router)
    app.include_router(user_playlists.router)

    token = await deps.create_session(
        db, {"access_token": "at", "refresh_token": "rt"},
        {"id": str(USER_ID), "username": "tester", "global_name": "Tester"},
    )
    session_id = deps.hash_token(token)
    deps.set_access_mock(session_id, GUILD_ID, "owner")

    transport = httpx.ASGITransport(app=app)
    client = httpx.AsyncClient(transport=transport, base_url="http://test", cookies={deps.SESSION_COOKIE: token})
    try:
        yield client, service, player
    finally:
        await client.aclose()
        deps.set_access_mock(session_id, GUILD_ID, None)
        deps._member_cache.clear()


async def test_unauthenticated_requests_get_401(api) -> None:
    client, _, _ = api
    async with httpx.AsyncClient(transport=client._transport, base_url="http://test") as anon:
        resp = await anon.get("/api/notifications")
    assert resp.status_code == 401


async def test_enqueue_with_panel_metadata_matches_contract(api) -> None:
    """The exact payload PlayerPage sends when queueing a search result:
    query + page metadata, no encoded track, no stream_url."""
    client, service, _ = api
    resp = await client.post(
        f"{PANEL_BASE}/enqueue",
        json={
            "query": "https://www.youtube.com/watch?v=abc123",
            "source": "yt",
            "title": "Зайка Дхуди Хопс",
            "author": "rafo420",
            "length_ms": 180_000,
            "artwork": "https://example.com/cover.jpg",
            "play_next": False,
        },
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["queued"] == 1
    assert data["now_playing"] is False
    item = service.queues[GUILD_ID][0]
    assert item.display_title == "Зайка Дхуди Хопс"
    assert item.source == "yt"
    assert item.length == 180_000


async def test_enqueue_play_next_inserts_at_queue_head(api) -> None:
    client, service, _ = api
    service.queues[GUILD_ID] = deque([QueueItem(make_track("Existing"), 1, "tester")])
    resp = await client.post(
        f"{PANEL_BASE}/enqueue",
        json={
            "query": "https://www.youtube.com/watch?v=next",
            "source": "yt",
            "title": "Next please",
            "author": "artist",
            "length_ms": 60_000,
            "play_next": True,
        },
    )
    assert resp.status_code == 200, resp.text
    titles = [item.display_title for item in service.queues[GUILD_ID]]
    assert titles == ["Next please", "Existing"]


async def test_enqueue_still_accepts_stream_url(api) -> None:
    """The userscript capture path: stream_url queues a direct pending item."""
    client, service, _ = api
    resp = await client.post(
        f"{PANEL_BASE}/enqueue",
        json={
            "query": "",
            "stream_url": "https://vk-cdn.example/stream.mp3?sig=x",
            "source": "vk",
            "title": "Captured",
            "author": "artist",
            "length_ms": 90_000,
        },
    )
    assert resp.status_code == 200, resp.text
    item = service.queues[GUILD_ID][0]
    assert item.source == "direct"
    assert item.pending_url == "https://vk-cdn.example/stream.mp3?sig=x"


async def test_enqueue_rejects_empty_body(api) -> None:
    client, _, _ = api
    resp = await client.post(f"{PANEL_BASE}/enqueue", json={})
    assert resp.status_code == 422


async def test_enqueue_never_returns_500_for_valid_bodies(api) -> None:
    """Every metadata shape the panel can send must answer 200/400, not 500.
    The resolvers raise MusicServiceError (as on a dead network), so no
    test depends on yt-dlp being installed."""
    client, service, _ = api

    async def _boom(*_args: Any, **_kwargs: Any) -> Any:
        raise MusicServiceError("resolve failed (stub)")

    service._resolve_stream = _boom  # type: ignore[method-assign]
    service._search_with_retry = _boom  # type: ignore[method-assign]
    bodies: list[dict[str, Any]] = [
        {"query": "just a text query", "source": "yt", "title": "T", "author": "A", "length_ms": 1},
        {"query": "https://www.youtube.com/watch?v=x", "source": "yt"},
        {"query": "", "stream_url": "https://cdn.example/s.mp3", "source": "vk", "title": "T"},
        {"query": "", "encoded": "unknown-encoded-token"},
    ]
    for body in bodies:
        resp = await client.post(f"{PANEL_BASE}/enqueue", json=body)
        assert resp.status_code != 500, f"500 for {body}: {resp.text}"


async def test_player_actions_smoke(api) -> None:
    """The dock/player controls round-trip: 200 and the stub observes the
    change. 500 anywhere here means a route/service contract broke."""
    client, service, player = api

    resp = await client.post(f"{PANEL_BASE}/volume", json={"volume": 42})
    assert resp.status_code == 200, resp.text
    assert player.volume == 42

    resp = await client.post(f"{PANEL_BASE}/pause")
    assert resp.status_code == 200, resp.text
    resp = await client.post(f"{PANEL_BASE}/resume")
    assert resp.status_code == 200, resp.text

    resp = await client.post(f"{PANEL_BASE}/seek", json={"position": 12_345})
    assert resp.status_code == 200, resp.text
    assert player.position == 12_345

    resp = await client.post(f"{PANEL_BASE}/effects", json={"name": "nightcore"})
    assert resp.status_code == 200, resp.text
    assert service.effects[GUILD_ID] == "nightcore"
    resp = await client.post(f"{PANEL_BASE}/effects", json={"name": "no-such-effect"})
    assert resp.status_code == 400

    resp = await client.post(f"{PANEL_BASE}/sleep", json={"minutes": 30})
    assert resp.status_code == 200, resp.text
    resp = await client.post(f"{PANEL_BASE}/sleep", json={"minutes": None})
    assert resp.status_code == 200, resp.text

    resp = await client.post(f"{PANEL_BASE}/repeat", json={"mode": "one"})
    assert resp.status_code == 200, resp.text

    resp = await client.post(f"{PANEL_BASE}/skip")
    assert resp.status_code == 200, resp.text

    resp = await client.post(f"{PANEL_BASE}/queue/clear")
    assert resp.status_code == 200, resp.text

    resp = await client.post(f"{PANEL_BASE}/stop")
    assert resp.status_code == 200, resp.text


async def test_player_state_has_channel_and_effect(api) -> None:
    """The panel reads channel_id/effect/sleep_remaining from /state; a
    missing key breaks the dock and its restore after a restart."""
    client, service, _ = api
    service.effects[GUILD_ID] = "bass"
    resp = await client.get(f"{PANEL_BASE}/state")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["channel_id"] == "5555"
    assert data["effect"] == "bass"
    assert data["sleep_remaining"] is None
    assert data["default_voice_channel_id"] is None


async def test_admin_settings_roundtrip(api) -> None:
    """The Manage page saves the vote-skip toggle, the now-playing channel
    and the player permission levels — and reads them back (the earlier
    regression: PUT accepted but dropped the new kwargs, GET never
    serialized them, so the selects came up empty)."""
    client, _, _ = api
    body = {
        "vote_skip": True,
        "np_channel_id": "999",
        "volume_access": "admins",
        "effects_access": "off",
        "queue_clear_access": "admins",
        "seek_access": "members",
    }
    resp = await client.put(f"/api/admin/guilds/{GUILD_ID}/settings", json=body)
    assert resp.status_code == 200, resp.text
    saved = resp.json()
    assert saved["vote_skip"] is True
    assert saved["np_channel_id"] == "999"
    assert saved["volume_access"] == "admins"
    assert saved["effects_access"] == "off"
    assert saved["queue_clear_access"] == "admins"
    assert saved["seek_access"] == "members"

    resp = await client.get(f"/api/admin/guilds/{GUILD_ID}/settings")
    assert resp.status_code == 200, resp.text
    loaded = resp.json()
    for key, value in body.items():
        assert loaded[key] == value, key


async def test_admin_settings_requires_admin(api) -> None:
    client, _, _ = api
    session_id = next(iter(deps._access_mock), None)
    assert session_id is not None
    deps.set_access_mock(session_id, GUILD_ID, "member")
    try:
        resp = await client.put(f"/api/admin/guilds/{GUILD_ID}/settings", json={"vote_skip": True})
        assert resp.status_code in (401, 403)
    finally:
        deps.set_access_mock(session_id, GUILD_ID, "owner")


async def test_skip_respects_vote_threshold(api) -> None:
    """Vote-skip on: a lone human still skips instantly, but the response
    carries the vote bookkeeping the panel and /skip render."""
    client, service, player = api
    await client.put(f"/api/admin/guilds/{GUILD_ID}/settings", json={"vote_skip": True})
    resp = await client.post(f"{PANEL_BASE}/skip")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["skipped"] is True
    assert data["needed"] >= 1


async def test_guilds_503_when_discord_unreachable(api) -> None:
    """A network outage to Discord must answer 503 (the panel shows a
    retry banner), never 500 — and must not kill the session."""
    client, _, _ = api

    async def _unreachable(*_args: Any, **_kwargs: Any) -> Any:
        raise DiscordUnreachableError("Discord is unreachable right now.")

    client._transport.app.state.oauth.fetch_guilds = _unreachable  # type: ignore[attr-defined]
    client._transport.app.state.oauth.refresh_token = _unreachable  # type: ignore[attr-defined]
    resp = await client.get("/api/auth/guilds")
    assert resp.status_code == 503, resp.text
    assert "unreachable" in resp.json()["detail"].lower()


async def test_guilds_401_when_discord_rejects_token(api) -> None:
    """A genuine token rejection still expires the session: the SPA starts
    a new login (the historic behavior, kept)."""
    client, _, _ = api

    async def _rejected(*_args: Any, **_kwargs: Any) -> Any:
        raise DiscordAPIError("Discord API error")

    client._transport.app.state.oauth.fetch_guilds = _rejected  # type: ignore[attr-defined]
    client._transport.app.state.oauth.refresh_token = _rejected  # type: ignore[attr-defined]
    resp = await client.get("/api/auth/guilds")
    assert resp.status_code == 401, resp.text
