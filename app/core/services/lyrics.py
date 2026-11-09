"""Synced lyrics via LRCLIB (lrclib.net): free, no tokens.

The lookup is cached in the lyrics_cache table with a rolling TTL: a
fresh re-request refreshes the entry, a miss just extends it for
another cycle (a track that has no lyrics today rarely grows them
tomorrow). syncedLyrics comes in LRC format "[mm:ss.xx] text" and is
parsed into [seconds, text] pairs for the panel's karaoke-style view.
"""
from __future__ import annotations

import asyncio
import re
import time
from typing import Any

import httpx

from app.core.db.database import Database

_LRC_LINE = re.compile(r"\[(\d+):(\d+(?:[.:]\d+)?)\](.*)")
_API_GET = "https://lrclib.net/api/get"
_API_SEARCH = "https://lrclib.net/api/search"


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


def _pick_record(records: list[dict[str, Any]], duration_s: int) -> dict[str, Any] | None:
    """Best record from /api/search: synced beats plain, then the closest
    duration wins (different releases of the same track carry their own
    synced LRC files)."""
    if not records:
        return None
    return min(
        records,
        key=lambda r: (
            0 if r.get("syncedLyrics") else 1,
            abs((r.get("duration") or 0) - duration_s),
        ),
    )


# A rolling cache TTL: live results refresh on re-request, misses are
# re-saved (extending for another cycle) so a lyrics-less track does not
# hit LRCLIB on every play, yet a later community upload gets picked up.
LYRICS_TTL_S = 7 * 24 * 3600


async def fetch_lyrics(db: Database, artist: str, title: str, duration_s: int) -> dict[str, Any] | None:
    """Cached lyrics for a track, or None when LRCLIB has nothing."""
    if not artist.strip() or not title.strip():
        return None
    key = _cache_key(artist, title)
    cached = await db.get_lyrics(key, max_age_s=LYRICS_TTL_S)
    if cached is not None:
        return cached
    headers = {"User-Agent": "discord-complex-bot/1.0"}
    try:
        async with httpx.AsyncClient(timeout=15.0, headers=headers) as client:
            get_resp = await client.get(
                _API_GET,
                params={
                    "artist_name": artist.strip(),
                    "track_name": title.strip(),
                    "album_name": "",
                    "duration": max(duration_s, 1),
                },
            )
            synced_raw = plain = None
            if get_resp.status_code == 200:
                data = get_resp.json()
                synced_raw, plain = data.get("syncedLyrics"), data.get("plainLyrics")
            if not synced_raw:
                # The exact lookup misses far too often (duration mismatches,
                # differently spelled releases): the fuzzy search also finds
                # records WITH synced lyrics for tracks /api/get returned
                # plain-only or nothing for.
                search_resp = await client.get(
                    _API_SEARCH,
                    params={"track_name": title.strip(), "artist_name": artist.strip()},
                )
                if search_resp.status_code == 200:
                    best = _pick_record(search_resp.json(), duration_s)
                    if best is not None:
                        synced_raw = synced_raw or best.get("syncedLyrics")
                        plain = plain or best.get("plainLyrics")
    except Exception:  # noqa: BLE001 - lyrics are decorative
        return None
    result: dict[str, Any] | None = None
    if synced_raw:
        synced = parse_lrc(synced_raw)
        if synced:
            result = {"synced": synced, "plain": plain}
    elif plain:
        result = {"synced": [], "plain": plain}
    else:
        # Cache the miss too: a track without lyrics would otherwise hit
        # LRCLIB on every single play.
        result = {"synced": [], "plain": ""}
    await db.save_lyrics(key, result)
    return result
