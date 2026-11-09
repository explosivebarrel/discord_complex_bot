"""Synced lyrics via LRCLIB (lrclib.net): free, no tokens.

The lookup is cached in the lyrics_cache table (lyrics never change).
syncedLyrics comes in LRC format "[mm:ss.xx] text" and is parsed into
[seconds, text] pairs for the panel's karaoke-style view.
"""
from __future__ import annotations

import asyncio
import re
import time
from typing import Any

import httpx

from app.core.db.database import Database

_LRC_LINE = re.compile(r"\[(\d+):(\d+(?:[.:]\d+)?)\](.*)")
_API = "https://lrclib.net/api/get"


def parse_lrc(raw: str) -> list[list[Any]]:
    """Parse LRC text into [[seconds, text], ...] sorted by time."""
    lines: list[list[Any]] = []
    for line in raw.splitlines():
        m = _LRC_LINE.fullmatch(line.strip())
        if not m:
            continue
        minutes, seconds, text = int(m[1]), float(m[2].replace(":", ".")), m[3].strip()
        if not text:
            continue
        lines.append([minutes * 60 + seconds, text])
    lines.sort(key=lambda pair: pair[0])
    return lines


def _cache_key(artist: str, title: str) -> str:
    return Database.lyrics_key(artist, title)


async def fetch_lyrics(db: Database, artist: str, title: str, duration_s: int) -> dict[str, Any] | None:
    """Cached lyrics for a track, or None when LRCLIB has nothing."""
    if not artist.strip() or not title.strip():
        return None
    key = _cache_key(artist, title)
    cached = await db.get_lyrics(key)
    if cached is not None:
        return cached
    params = {
        "artist_name": artist.strip(),
        "track_name": title.strip(),
        "album_name": "",
        "duration": max(duration_s, 1),
    }
    try:
        async with httpx.AsyncClient(timeout=15.0, headers={"User-Agent": "discord-complex-bot/1.0"}) as client:
            resp = await client.get(_API, params=params)
    except Exception:  # noqa: BLE001 - lyrics are decorative
        return None
    if resp.status_code != 200:
        return None
    data = resp.json()
    synced_raw = data.get("syncedLyrics")
    plain = data.get("plainLyrics")
    result: dict[str, Any] | None = None
    if synced_raw:
        synced = parse_lrc(synced_raw)
        if synced:
            result = {"synced": synced, "plain": plain}
    elif plain:
        result = {"synced": [], "plain": plain}
    if result is not None:
        await db.save_lyrics(key, result)
    return result
