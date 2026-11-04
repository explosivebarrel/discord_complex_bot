from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class WsHub:
    """Fan-out for the panel's websocket connections, grouped by guild.

    Guild-scoped payloads go only to that guild's sockets; guild_id=None
    broadcasts to everyone (global notifications).
    """

    def __init__(self) -> None:
        self._conns: dict[int, set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, guild_id: int, ws: WebSocket) -> None:
        async with self._lock:
            self._conns.setdefault(guild_id, set()).add(ws)

    async def disconnect(self, guild_id: int, ws: WebSocket) -> None:
        async with self._lock:
            sockets = self._conns.get(guild_id)
            if sockets is not None:
                sockets.discard(ws)
                if not sockets:
                    self._conns.pop(guild_id, None)

    def has_connections(self, guild_id: int) -> bool:
        return bool(self._conns.get(guild_id))

    async def broadcast(self, payload: dict[str, Any], guild_id: int | None = None) -> None:
        targets = set(self._conns.values()).union() if guild_id is None else set(self._conns.get(guild_id) or ())
        if not targets:
            return
        dead: list[WebSocket] = []
        for ws in targets:
            try:
                await ws.send_json(payload)
            except Exception:  # noqa: BLE001 - a dead socket must not break the fan-out
                dead.append(ws)
        for ws in dead:
            for sockets in self._conns.values():
                sockets.discard(ws)


_default_hub: WsHub | None = None


def get_hub(app: Any) -> WsHub:
    """The process-wide hub, created on first use (create_app wires it onto
    app.state too, so tests can swap it)."""
    global _default_hub
    if _default_hub is None:
        _default_hub = WsHub()
    return _default_hub
