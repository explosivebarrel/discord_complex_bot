"""VK Music access through the VK audio API.

Regular OAuth tokens lost the audio scope years ago; the tokens that still
work are the implicit-flow ones of mobile clients (Kate Mobile). The token
belongs to a real VK account and is configured in the panel Settings or in
.env (VK_MUSIC_TOKEN). It is read from the DB before every call, so a new
token applies without a restart.
"""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Any

import httpx

logger = logging.getLogger(__name__)

VK_API_URL = "https://api.vk.com/method/"
VK_API_VERSION = "5.199"
# One serialized call per second: bursts of audio.search look bot-like and
# are exactly what trips VK antifraud into freezing the token's account.
_VK_MIN_INTERVAL = 1.0
_vk_lock = asyncio.Lock()
_vk_last_call = 0.0
# Kate Mobile Android client id: its implicit-flow tokens still carry the
# audio scope that web OAuth tokens no longer get.
KATE_CLIENT_ID = "2685278"
VK_OAUTH_URL = (
    "https://oauth.vk.com/authorize?client_id=" + KATE_CLIENT_ID
    + "&display=mobile&response_type=token&scope=audio"
    + "&redirect_uri=https://oauth.vk.com/blank.html&v=" + VK_API_VERSION
)
# Signed CDN URLs have a limited lifetime, so only the track deep link is
# stored; the stream URL is fetched fresh right before every play.
PLAYLIST_CAP = 1000
_PAGE_SIZE = 100

VK_HOSTS = ("vk.com", "vk.ru", "vkontakte.ru", "m.vk.com", "music.vk.com", "music.vk.ru")

_TRACK_RE = re.compile(
    r"(?:vk\.com|vk\.ru|vkontakte\.ru|music\.vk\.com|music\.vk\.ru)/audio(\d+)_(\d+)", re.IGNORECASE
)
_PLAYLIST_RE = re.compile(
    r"(?:vk\.com|vk\.ru|vkontakte\.ru|music\.vk\.com|music\.vk\.ru)/(?:playlist|album)/(-?\d+)_(\d+)",
    re.IGNORECASE,
)
_AUDIOS_RE = re.compile(
    r"(?:vk\.com|vk\.ru|vkontakte\.ru|music\.vk\.com|music\.vk\.ru)/audios(-?\d+)", re.IGNORECASE
)


class VkMusicError(Exception):
    pass


def parse_track_url(url: str) -> tuple[int, int] | None:
    match = _TRACK_RE.search(url)
    return (int(match[1]), int(match[2])) if match else None


def parse_playlist_url(url: str) -> tuple[int, int] | None:
    match = _PLAYLIST_RE.search(url)
    return (int(match[1]), int(match[2])) if match else None


def parse_audios_url(url: str) -> int | None:
    """Owner id of an `/audios<id>` link; None means the token account itself."""
    match = _AUDIOS_RE.search(url)
    return int(match[1]) if match else None


def is_vk_host(url: str) -> bool:
    from urllib.parse import urlparse

    host = (urlparse(url).hostname or "").removeprefix("www.").removeprefix("m.")
    return host in ("vk.com", "vk.ru", "vkontakte.ru", "music.vk.com", "music.vk.ru")


async def vk_call(token: str, method: str, **params: Any) -> Any:
    global _vk_last_call
    params["access_token"] = token
    params["v"] = VK_API_VERSION
    async with _vk_lock:
        wait = _VK_MIN_INTERVAL - (asyncio.get_running_loop().time() - _vk_last_call)
        if wait > 0:
            await asyncio.sleep(wait)
        _vk_last_call = asyncio.get_running_loop().time()
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.get(VK_API_URL + method, params=params)
    except httpx.HTTPError as exc:
        raise VkMusicError(f"VK is unreachable: {exc}") from exc
    if resp.status_code != 200:
        raise VkMusicError(f"VK API returned {resp.status_code}")
    data = resp.json()
    if "error" in data:
        err = data["error"]
        msg = err.get("error_msg") or "unknown error"
        if err.get("error_code") in (5, 7, 15, 28):
            # 5 has three distinct real-world causes; the hint names the fix.
            low = msg.lower()
            if "blocked" in low:
                hint = (
                    " The VK account that issued this token is blocked/frozen:"
                    " open vk.com with it to see the unblock steps (usually a"
                    " phone confirmation), then issue a fresh token."
                )
            elif "invalid access_token" in low:
                hint = (
                    " The token is expired or was copied incompletely:"
                    " issue a fresh one via the OAuth link in Settings."
                )
            else:
                hint = " The token may be expired or lacks the audio scope."
            raise VkMusicError(f"VK rejected the request: {msg}.{hint}")
        raise VkMusicError(f"VK API: {msg}")
    return data.get("response")


def _thumb(item: dict[str, Any]) -> str | None:
    thumb = item.get("album", {}).get("thumb", {}) if item.get("album") else {}
    for size in ("photo_600", "photo_300", "photo_68"):
        if thumb.get(size):
            return thumb[size]
    return None


def track_row(item: dict[str, Any]) -> dict[str, Any]:
    """One audio API item in the panel track shape (uri is the deep link)."""
    owner, audio_id = item.get("owner_id"), item.get("id")
    artist = (item.get("artist") or "").strip()
    title = (item.get("title") or "?").strip()
    return {
        "title": title,
        "author": artist or "VK",
        "uri": f"https://vk.com/audio{owner}_{audio_id}" if owner is not None and audio_id else "",
        "length": int(item.get("duration") or 0) * 1000,
        "artwork": _thumb(item),
        "source": "vk",
        "requested_by": "",
        "encoded": None,
    }


async def search(
    token: str, query: str, limit: int = 10, performer_only: bool = False
) -> list[dict[str, Any]]:
    params: dict[str, Any] = {"q": query, "count": min(max(limit, 1), 100)}
    if performer_only:
        params["performer_only"] = 1
    response = await vk_call(token, "audio.search", **params)
    items = response.get("items") if isinstance(response, dict) else (response or [])
    return [track_row(item) for item in (items or [])[:limit]]


async def track(token: str, owner_id: int, audio_id: int) -> dict[str, Any]:
    response = await vk_call(token, "audio.getById", audios=f"{owner_id}_{audio_id}")
    items = response if isinstance(response, list) else (response or {}).get("items") or []
    if not items:
        raise VkMusicError("VK does not know this track (deleted or restricted).")
    return items[0]


async def stream_url(token: str, owner_id: int, audio_id: int) -> str:
    """Fresh signed CDN URL for one track. HLS-only tracks are rejected."""
    item = await track(token, owner_id, audio_id)
    url = item.get("url") or ""
    if not url:
        raise VkMusicError("VK gave no stream URL for this track (it may be restricted).")
    if ".m3u8" in url.lower():
        raise VkMusicError("VK streams this track over HLS, which the player cannot play.")
    return url


async def _paged_audios(token: str, **params: Any) -> list[dict[str, Any]]:
    """audio.get with paging; returns at most PLAYLIST_CAP items."""
    collected: list[dict[str, Any]] = []
    offset = 0
    total: int | None = None
    while True:
        response = await vk_call(token, "audio.get", count=_PAGE_SIZE, offset=offset, **params)
        response = response if isinstance(response, dict) else {"items": response or []}
        items = response.get("items") or []
        total = total if total is not None else int(response.get("count") or 0)
        collected.extend(items)
        offset += len(items)
        if not items or offset >= min(total, PLAYLIST_CAP) or offset >= PLAYLIST_CAP:
            return collected[:PLAYLIST_CAP]


def _entry(item: dict[str, Any]) -> dict[str, Any]:
    """One audio item in the flat playlist-entry shape of the browser."""
    row = track_row(item)
    return {
        "title": row["title"],
        "author": row["author"],
        "url": row["uri"],
        "duration": row["length"],
        "artwork": row["artwork"],
    }


async def playlist(token: str, owner_id: int, playlist_id: int) -> tuple[str, list[dict[str, Any]]]:
    meta = await vk_call(token, "audio.getPlaylistById", owner_id=owner_id, playlist_id=playlist_id)
    if isinstance(meta, list):
        meta = meta[0] if meta else {}
    entries = await _paged_audios(token, owner_id=owner_id, playlist_id=playlist_id)
    return str((meta or {}).get("title") or "VK playlist"), [_entry(item) for item in entries]


async def user_audios(token: str, owner_id: int | None) -> tuple[str, list[dict[str, Any]]]:
    params: dict[str, Any] = {}
    if owner_id is not None:
        params["owner_id"] = owner_id
    entries = await _paged_audios(token, **params)
    return "VK audios", [_entry(item) for item in entries]
