"""Periodic availability of the search sources shown in the panel.

YouTube is special: its Lavalink plugin makes a network call while the
server starts and crashes the whole process when youtube.com is
unreachable, so a supervisor inside the Lavalink container gates the
plugin on the same probe and reloads it when the verdict flips. This
module mirrors that verdict for the panel: youtube counts as available
only when the network answers AND the plugin's REST route is up — i.e.
a search actually has a chance to work.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from typing import Any

import httpx

from app.core.config import Config
from app.core.services.lavalink_admin import LavalinkAdmin, LavalinkAdminError

logger = logging.getLogger(__name__)

CHECK_INTERVAL = 300
PROBE_TIMEOUT = 8.0

# The yt source needs the youtube.com network path AND the plugin loaded.
state: dict[str, Any] = {"youtube": False, "checked_at": None}


async def _youtube_reachable() -> bool:
    """TLS-level probe: only a real HTTP answer counts as reachable."""
    try:
        async with httpx.AsyncClient(timeout=PROBE_TIMEOUT, follow_redirects=False) as client:
            resp = await client.get("https://www.youtube.com")
    except httpx.HTTPError:
        return False
    return resp.status_code < 500


async def refresh(config: Config) -> None:
    net = await _youtube_reachable()
    plugin = False
    if net:
        try:
            await LavalinkAdmin(config).get_youtube_config()
            plugin = True
        except LavalinkAdminError:
            # The supervisor has not (re)loaded the plugin yet — soon, if the
            # network verdict is stable.
            plugin = False
    state["youtube"] = net and plugin
    state["checked_at"] = datetime.now(UTC).isoformat()


async def loop(config: Config) -> None:
    """Refresh the availability cache forever; an error never stops it."""
    while True:
        try:
            await refresh(config)
        except Exception:  # noqa: BLE001 - the probe must never kill the app
            logger.exception("Source availability check failed")
        await asyncio.sleep(CHECK_INTERVAL)
