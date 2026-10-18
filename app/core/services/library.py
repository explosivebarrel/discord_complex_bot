from __future__ import annotations

import hashlib
import hmac
import mimetypes
import re
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any, BinaryIO

if TYPE_CHECKING:
    from app.core.config import Config

AUDIO_EXTENSIONS = {".mp3", ".ogg", ".oga", ".flac", ".m4a", ".wav", ".opus"}
STREAM_TOKEN_TTL = 6 * 3600  # a queue item may sit for hours before it plays
UPLOADS_DIRNAME = "uploads"
# Stored upload names look like "<discord_id>-<unix_ts>-<title>"; the display
# name drops the prefix.
UPLOAD_NAME_PREFIX = re.compile(r"^\d+-\d{10}-")
_CHUNK = 1024 * 1024


class FileTooLargeError(Exception):
    """The uploaded file exceeds the configured size limit."""


def _library_root(config: Config) -> Path:
    return config.music_library_dir


def uploads_dir(config: Config, guild_id: int) -> Path:
    return _library_root(config) / UPLOADS_DIRNAME / str(guild_id)


def display_name(stored_name: str) -> str:
    """Strip the "<discord_id>-<unix_ts>-" prefix from a stored upload name."""
    return UPLOAD_NAME_PREFIX.sub("", stored_name)


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


def sanitize_filename(name: str) -> str:
    """Flatten a client-supplied name to a safe single path component."""
    flat = name.replace("\\", "/").split("/")[-1].strip()
    flat = re.sub(r'[^\w .\-\(\)\[\]]', "", flat, flags=re.UNICODE)
    flat = re.sub(r"\s+", " ", flat).strip(". ")
    if len(flat) > 80:
        # Keep the extension: the audio-type check runs on the result.
        suffix = Path(flat).suffix
        flat = Path(flat).stem[: 80 - len(suffix)] + suffix if suffix else flat[:80]
    return flat or "track"


def save_upload(
    config: Config,
    guild_id: int,
    discord_id: int,
    filename: str,
    fileobj: BinaryIO,
) -> dict[str, Any]:
    """Stream an uploaded audio file into the guild's uploads folder.

    Ownership travels with the name ("<discord_id>-<unix_ts>-<title>") so
    "my uploads" and delete rights need no database table. Raises
    ValueError on a bad extension and FileTooLargeError over the limit.
    """
    safe = sanitize_filename(filename)
    suffix = Path(safe).suffix.lower()
    if suffix not in AUDIO_EXTENSIONS:
        raise ValueError(f"Unsupported file type: {suffix or '(none)'}")
    limit = config.max_upload_mb * 1024 * 1024
    target_dir = uploads_dir(config, guild_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    stored = f"{discord_id}-{int(time.time())}-{safe}"
    target = target_dir / stored
    written = 0
    overflow = False
    with target.open("wb") as out:
        while chunk := fileobj.read(_CHUNK):
            written += len(chunk)
            if written > limit:
                overflow = True
                break
            out.write(chunk)
    if overflow:
        target.unlink(missing_ok=True)
        raise FileTooLargeError(f"The file is larger than {config.max_upload_mb} MB")
    if written == 0:
        target.unlink(missing_ok=True)
        raise ValueError("The file is empty")
    rel = target.relative_to(_library_root(config)).as_posix()
    return {
        "path": rel,
        "name": display_name(stored).rsplit(".", 1)[0],
        "size_mb": round(written / (1024 * 1024), 1),
        "uploader": str(discord_id),
    }


def _row(path: Path, root: Path) -> dict[str, Any]:
    return {
        "path": path.relative_to(root).as_posix(),
        "name": path.stem,
        "size_mb": round(path.stat().st_size / (1024 * 1024), 1),
    }


def search_local_for_guild(
    config: Config, guild_id: int, query: str = "", limit: int = 50
) -> list[dict[str, Any]]:
    """Files visible to one guild: the shared library root plus this
    guild's uploads — never another guild's uploads folder."""
    root = _library_root(config)
    if not root.is_dir():
        return []
    needle = query.strip().lower()
    own_prefix = f"{UPLOADS_DIRNAME}/{guild_id}/"
    found: list[dict[str, Any]] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in AUDIO_EXTENSIONS:
            continue
        rel = path.relative_to(root).as_posix()
        # Other guilds' uploads stay invisible.
        if rel.startswith(f"{UPLOADS_DIRNAME}/") and not rel.startswith(own_prefix):
            continue
        if needle and needle not in rel.lower():
            continue
        row = _row(path, root)
        row["name"] = display_name(path.stem)
        found.append(row)
        if len(found) >= limit:
            break
    return found


def list_guild_uploads(config: Config, guild_id: int) -> list[dict[str, Any]]:
    """The guild's uploads, newest first, with the uploader from the name."""
    directory = uploads_dir(config, guild_id)
    if not directory.is_dir():
        return []
    root = _library_root(config)
    rows = []
    for path in directory.iterdir():
        if not path.is_file() or path.suffix.lower() not in AUDIO_EXTENSIONS:
            continue
        row = _row(path, root)
        row["uploader"] = path.name.split("-", 1)[0]
        row["name"] = display_name(path.stem)
        rows.append(row)
    rows.sort(key=lambda r: r["path"], reverse=True)
    return rows


def delete_upload_path(config: Config, guild_id: int, rel_path: str) -> Path | None:
    """Resolve an upload path inside this guild's uploads folder only."""
    if not rel_path.startswith(f"{UPLOADS_DIRNAME}/{guild_id}/"):
        return None
    target = safe_library_path(config, rel_path)
    return target


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
