"""Availability monitor: probes every dependency once a minute and stores
one row per pass (see AvailabilitySample) plus hourly rollups, so the
About page can draw uptime strips and percentages. Gaps between samples
mean the whole app was down — the panel renders them hatched.

Status codes per service: 2=up, 1=degraded (slow answer, or a recent
track failure for YouTube), 0=down, NULL=not applicable (a source
without a configured token is excluded from percentages, not counted
as an outage).

This module also absorbs source_gate: the YouTube verdict (network AND
the Lavalink plugin route) lives in `state` and feeds /api/system/sources.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any

import httpx

from app.core.config import Config
from app.core.db import Database
from app.core.services.lavalink_admin import LavalinkAdmin, LavalinkAdminError

if TYPE_CHECKING:
    from app.bot.client import ComplexBot
    from app.core.services.music import MusicService

logger = logging.getLogger(__name__)

INTERVAL = 60
PROBE_TIMEOUT = 8.0
# A slower answer still works but the service is not "pulling it off".
SLOW_MS = 3500
# A fresh track failure marks the player source as troubled for this long.
LAST_ERROR_WINDOW = timedelta(minutes=10)

UP, DEGRADED, DOWN = 2, 1, 0

SERVICES = (
    "discord_api", "discord_gateway", "lavalink", "youtube",
    "yandex", "vk", "radio", "archive",
)

YM_TOKEN_KEY = "yandex_music"
VK_TOKEN_KEY = "vkmusic_token"

# Latest pass, read by /api/system/status and /api/system/sources.
state: dict[str, Any] = {"ts": None, "statuses": {s: None for s in SERVICES}, "details": {}}
_roll_next: datetime | None = None


async def _http_probe(url: str) -> tuple[int, int]:
    """GET a URL: (http_code, latency_ms). Transport errors raise."""
    started = time.monotonic()
    async with httpx.AsyncClient(timeout=PROBE_TIMEOUT, follow_redirects=False) as client:
        resp = await client.get(url)
    return resp.status_code, int((time.monotonic() - started) * 1000)


def _from_latency(code: int | None, latency_ms: int | None) -> tuple[int, int | None]:
    """Any real HTTP answer is a reachability pass; 5xx or timeout is down."""
    if code is None or code >= 500:
        return DOWN, latency_ms
    return (DEGRADED if (latency_ms or 0) >= SLOW_MS else UP), latency_ms


async def _net_status(url: str) -> tuple[int, int | None]:
    try:
        code, latency = await _http_probe(url)
    except httpx.HTTPError:
        return DOWN, None
    return _from_latency(code, latency)


async def _gateway_status(bot: ComplexBot) -> tuple[int, int | None]:
    return (UP if bot.is_ready() else DOWN), None


async def _lavalink_status(config: Config) -> tuple[int, int | None]:
    import wavelink

    if not wavelink.Pool.nodes:
        return DOWN, None
    scheme = "https" if config.lavalink_secure else "http"
    try:
        code, latency = await _http_probe(f"{scheme}://{config.lavalink_host}:{config.lavalink_port}/version")
    except httpx.HTTPError:
        return DOWN, None
    # The node answers but the password rejected us: the node is up.
    if code == 401:
        return UP, latency
    return _from_latency(code, latency)


def _last_error_fresh(music: MusicService) -> bool:
    err = music.last_error
    if not err or not err.get("at"):
        return False
    try:
        at = datetime.fromisoformat(str(err["at"]))
    except ValueError:
        return False
    return datetime.now(timezone.utc) - at <= LAST_ERROR_WINDOW


async def _youtube_status(config: Config, music: MusicService) -> tuple[int, int | None]:
    """Network to youtube.com AND the Lavalink plugin answering."""
    try:
        code, latency = await _http_probe("https://www.youtube.com")
    except httpx.HTTPError:
        return DOWN, None
    net = _from_latency(code, latency)
    if net[0] == DOWN:
        return net
    try:
        await LavalinkAdmin(config).get_youtube_config()
    except LavalinkAdminError:
        # The supervisor has not reloaded the plugin yet.
        return DOWN, latency
    if net[0] == DEGRADED or _last_error_fresh(music):
        return DEGRADED, latency
    return UP, latency


async def _token_gated_status(config: Config, db: Database, key: str, env_token: str, url: str) -> tuple[int, int | None]:
    """A source behind an optional token: NULL when not configured."""
    stored = await db.get_system_setting(key)
    if not ((stored and stored.get("access_token")) or env_token):
        return None, None
    return await _net_status(url)


def _hour_floor(dt: datetime) -> datetime:
    return dt.replace(minute=0, second=0, microsecond=0)


async def _catch_up_rollups(db: Database, now: datetime) -> None:
    """Close out every fully elapsed hour into AvailabilityRollup rows."""
    global _roll_next
    if _roll_next is None:
        last = await db.availability_last_rollup_hour()
        if last is not None:
            _roll_next = last + timedelta(hours=1)
        else:
            samples = await db.availability_samples_between(now - timedelta(days=2), now)
            first = samples[0].ts if samples else now
            _roll_next = _hour_floor(first)
    current = _hour_floor(now)
    while _roll_next < current:
        rows = await db.availability_samples_between(_roll_next, _roll_next + timedelta(hours=1))
        for service in SERVICES:
            counts = {"up": 0, "degraded": 0, "down": 0, "na": 0}
            for row in rows:
                value = getattr(row, service)
                if value is None:
                    counts["na"] += 1
                elif value == UP:
                    counts["up"] += 1
                elif value == DEGRADED:
                    counts["degraded"] += 1
                else:
                    counts["down"] += 1
            await db.upsert_availability_rollup(_roll_next, service, counts)
        _roll_next += timedelta(hours=1)


async def tick(config: Config, db: Database, bot: ComplexBot, music: MusicService) -> None:
    from app.core.db.models import utcnow

    results = await asyncio.gather(
        _net_status("https://discord.com/api/v10/gateway"),
        _gateway_status(bot),
        _lavalink_status(config),
        _youtube_status(config, music),
        _token_gated_status(config, db, YM_TOKEN_KEY, config.yandex_music_token, "https://api.music.yandex.net"),
        _token_gated_status(config, db, VK_TOKEN_KEY, config.vk_music_token, "https://api.vk.com"),
        _net_status("https://de1.api.radio-browser.info"),
        _net_status("https://archive.org"),
    )
    statuses = {service: status for service, (status, _) in zip(SERVICES, results)}
    details = {service: latency for service, (_, latency) in zip(SERVICES, results) if latency is not None}
    await db.add_availability_sample(statuses, details)
    state["ts"] = utcnow().isoformat()
    state["statuses"] = statuses
    state["details"] = details
    await _catch_up_rollups(db, utcnow())
    await db.prune_availability(utcnow() - timedelta(days=2), utcnow() - timedelta(days=90))


async def loop(config: Config, db: Database, bot: ComplexBot, music: MusicService) -> None:
    """Never dies: a failed probe pass is logged and retried next minute."""
    while True:
        try:
            await tick(config, db, bot, music)
        except Exception:  # noqa: BLE001 - monitoring must never kill the app
            logger.exception("Availability tick failed")
        await asyncio.sleep(INTERVAL)
