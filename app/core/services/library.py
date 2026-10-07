from __future__ import annotations

import hashlib
import hmac
import mimetypes
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from app.core.config import Config

AUDIO_EXTENSIONS = {".mp3", ".ogg", ".oga", ".flac", ".m4a", ".wav", ".opus"}
STREAM_TOKEN_TTL = 6 * 3600  # a queue item may sit for hours before it plays


def _library_root(config: Config) -> Path:
    return config.music_library_dir


def search_library(config: Config, query: str = "", limit: int = 50) -> list[dict[str, Any]]:
    """List audio files in the library folder, newest path match first."""
    root = _library_root(config)
    if not root.is_dir():
        return []
    needle = query.strip().lower()
    found: list[dict[str, Any]] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in AUDIO_EXTENSIONS:
            continue
        rel = path.relative_to(root).as_posix()
        if needle and needle not in rel.lower():
            continue
        found.append(
            {
                "path": rel,
                "name": path.stem,
                "size_mb": round(path.stat().st_size / (1024 * 1024), 1),
            }
        )
        if len(found) >= limit:
            break
    return found


def safe_library_path(config: Config, rel_path: str) -> Path | None:
    """Resolve a relative library path; reject anything outside the folder."""
    root = _library_root(config).resolve()
    candidate = (root / rel_path).resolve()
    if root not in candidate.parents and candidate != root:
        return None
    return candidate if candidate.is_file() else None


def _signature(config: Config, payload: str) -> str:
    digest = hmac.new(config.session_secret.encode(), payload.encode(), hashlib.sha256)
    return digest.hexdigest()[:32]


def library_stream_url(config: Config, rel_path: str) -> str:
    """Build a signed stream URL that Lavalink can fetch without cookies."""
    expires = int(time.time()) + STREAM_TOKEN_TTL
    token = _signature(config, f"{rel_path}:{expires}")
    from urllib.parse import quote

    base = config.internal_base_url.rstrip("/")
    return f"{base}/api/library/stream/{quote(rel_path)}?expires={expires}&token={token}"


def verify_stream_token(config: Config, rel_path: str, expires: int | None, token: str | None) -> bool:
    if expires is None or not token:
        return False
    if expires < int(time.time()):
        return False
    expected = _signature(config, f"{rel_path}:{expires}")
    return hmac.compare_digest(expected, token)


def media_type(rel_path: str) -> str:
    return mimetypes.guess_type(rel_path)[0] or "application/octet-stream"
