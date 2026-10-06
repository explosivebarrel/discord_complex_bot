from __future__ import annotations

import logging
import urllib.parse
from typing import Any

import httpx

logger = logging.getLogger(__name__)

RADIO_BROWSER_HOST = "de1.api.radio-browser.info"
# Radio Browser requires an app-identifying User-Agent.
_HEADERS = {"User-Agent": "discord_complex_bot/0.1 (web panel search)"}


class ExternalSearchError(Exception):
    pass


async def _get_json(url: str, params: dict[str, Any] | None = None) -> Any:
    async with httpx.AsyncClient(timeout=12.0, headers=_HEADERS, follow_redirects=True) as client:
        resp = await client.get(url, params=params)
    if resp.status_code != 200:
        raise ExternalSearchError(f"{url.split('/')[2]} returned {resp.status_code}")
    return resp.json()


def _is_direct_stream(url: str) -> bool:
    low = url.lower()
    # HLS and playlist containers do not play through the plain http source.
    return not any(low.endswith(ext) or f"{ext}?" in low for ext in (".m3u8", ".m3u", ".pls"))


async def radio_search(query: str, limit: int = 15) -> list[dict[str, Any]]:
    """Search radio stations on radio-browser.info. Returns direct stream URLs."""
    data = await _get_json(
        f"https://{RADIO_BROWSER_HOST}/json/stations/search",
        params={
            "name": query,
            "limit": limit * 2,
            "hidebroken": "true",
            "order": "votes",
            "reverse": "true",
        },
    )
    results = []
    for station in data:
        url = station.get("url_resolved") or station.get("url") or ""
        if not url or not _is_direct_stream(url):
            continue
        tags = station.get("tags") or ""
        author_parts = [part for part in (station.get("country"), tags.split(",")[0] if tags else "") if part]
        results.append(
            {
                "title": (station.get("name") or "?").strip(),
                "author": " · ".join(author_parts[:2]) or "radio",
                "uri": url,
                "length": 0,
                "artwork": station.get("favicon") or None,
                "source": "radio",
                "requested_by": "",
                "encoded": None,
            }
        )
        if len(results) >= limit:
            break
    return results


def _parse_archive_length(raw: Any) -> int:
    """Archive lengths are seconds ('212.5') or 'mm:ss'. Return milliseconds, 0 for unknown."""
    try:
        text = str(raw or "").strip()
        if not text:
            return 0
        if ":" in text:
            parts = [int(p) for p in text.split(":")]
            seconds = 0
            for part in parts:
                seconds = seconds * 60 + part
            return seconds * 1000
        return int(float(text) * 1000)
    except (ValueError, TypeError):
        return 0


async def _archive_item_file(identifier: str) -> dict[str, Any] | None:
    """Pick the first playable audio file of an Archive.org item."""
    try:
        meta = await _get_json(f"https://archive.org/metadata/{identifier}")
    except ExternalSearchError:
        return None
    # Skip login-only items: their download URLs answer 401.
    if meta.get("metadata", {}).get("access-restricted-item"):
        return None
    files = meta.get("files") or []
    audio_formats = ("mp3", "ogg")
    best: dict[str, Any] | None = None
    for f in files:
        name = f.get("name") or ""
        fmt = (f.get("format") or "").lower()
        low = name.lower()
        if "_sample" in low or not any(a in fmt for a in audio_formats) and not low.endswith(audio_formats):
            continue
        if best is None:
            best = f
        if "vbr" in fmt:  # prefer the highest quality mp3
            best = f
            break
    if best is None:
        return None
    name = best["name"]
    return {
        "uri": f"https://archive.org/download/{urllib.parse.quote(identifier)}/{urllib.parse.quote(name)}",
        "length": _parse_archive_length(best.get("length")),
    }


async def archive_search(query: str, limit: int = 8) -> list[dict[str, Any]]:
    """Search audio items on Archive.org and resolve a direct file URL for each."""
    data = await _get_json(
        "https://archive.org/advancedsearch.php",
        params={
            "q": f"mediatype:audio AND ({query})",
            "fl[]": ["identifier", "title", "creator"],
            "rows": str(limit),
            "output": "json",
        },
    )
    docs = (data.get("response") or {}).get("docs") or []

    async def to_track(doc: dict[str, Any]) -> dict[str, Any] | None:
        identifier = doc.get("identifier")
        if not identifier:
            return None
        file_info = await _archive_item_file(identifier)
        if file_info is None:
            return None
        creator = doc.get("creator")
        if isinstance(creator, list):
            creator = ", ".join(creator[:2])
        return {
            "title": doc.get("title") or identifier,
            "author": creator or "archive.org",
            "uri": file_info["uri"],
            "length": file_info["length"],
            "artwork": f"https://archive.org/services/img/{identifier}",
            "source": "archive",
            "requested_by": "",
            "encoded": None,
        }

    import asyncio

    tracks = await asyncio.gather(*(to_track(doc) for doc in docs))
    return [t for t in tracks if t is not None]
