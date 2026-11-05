from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.api.deps import CurrentUser, get_bot, get_config, get_current_user, get_db, get_music
from app.core.config import Config
from app.core.db import Database
from app.core.services.lavalink_admin import LavalinkAdmin, LavalinkAdminError
from app.core.services.music import MusicService

if TYPE_CHECKING:
    from app.bot.client import ComplexBot

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/system", tags=["system"])
# Panel-wide status for every logged-in user: the player page disables
# search tabs from it. The admin router above stays super-admin only.
public_router = APIRouter(prefix="/api/system", tags=["system"])

YT_TOKEN_KEY = "youtube_oauth"
YM_TOKEN_KEY = "yandex_music"
VK_TOKEN_KEY = "vkmusic_token"


class YoutubeConfigBody(BaseModel):
    refresh_token: str | None = None
    po_token: str | None = None
    visitor_data: str | None = None


class YandexConfigBody(BaseModel):
    access_token: str


class VkConfigBody(BaseModel):
    access_token: str


class VkAuthBody(BaseModel):
    """VK account credentials for the direct auth (official Android client).
    The password is used once for the token exchange and never stored."""

    login: str
    password: str
    code: str = ""


def _write_env_line(env_path: Any, key: str, value: str) -> bool:
    """Update one KEY= line in the .env file. False when the file is not writable."""
    import re

    try:
        text = env_path.read_text(encoding="utf-8")
    except OSError:
        return False
    line = f"{key}={value}"
    if re.search(rf"(?m)^{key}=", text):
        text = re.sub(rf"(?m)^{key}=.*$", line, text)
    else:
        text = text.rstrip() + f"\n{line}\n"
    try:
        env_path.write_text(text, encoding="utf-8")
    except OSError:
        return False
    return True


def _require_superadmin(user: CurrentUser) -> None:
    if not user.is_superadmin:
        raise HTTPException(status_code=403, detail="Super-admin only")


@router.get("/integrations")
async def integrations(
    user: CurrentUser = Depends(get_current_user),
    bot: ComplexBot = Depends(get_bot),
    db: Database = Depends(get_db),
    music: MusicService = Depends(get_music),
    config: Config = Depends(get_config),
) -> dict[str, Any]:
    """Live status of every external integration. Super-admin only."""
    _require_superadmin(user)

    admin = LavalinkAdmin(config)
    youtube: dict[str, Any] = {"reachable": False}
    try:
        raw = await admin.get_youtube_config()
        youtube = {
            "reachable": True,
            "oauth_configured": bool(raw.get("refreshToken")),
            "refresh_token_masked": LavalinkAdmin.mask_token(raw.get("refreshToken")),
        }
    except LavalinkAdminError as exc:
        youtube["error"] = str(exc)

    stored = await db.get_system_setting(YT_TOKEN_KEY)
    youtube["token_saved_in_db"] = bool(stored and stored.get("refresh_token"))
    youtube["pot_saved_in_db"] = bool(stored and (stored.get("po_token") and stored.get("visitor_data")))
    youtube["last_error"] = music.last_error

    ym_stored = await db.get_system_setting(YM_TOKEN_KEY)
    yandex = {
        # The LavaSrc source has no runtime REST route. A new token applies
        # after the Lavalink container is recreated.
        "configured": bool(ym_stored and ym_stored.get("access_token")) or bool(config.yandex_music_token),
        "token_masked": LavalinkAdmin.mask_token(
            (ym_stored or {}).get("access_token") or config.yandex_music_token
        ),
        "token_saved_in_db": bool(ym_stored and ym_stored.get("access_token")),
    }

    vk_stored = await db.get_system_setting(VK_TOKEN_KEY)
    vkmusic = {
        # The bot reads this token from the DB before every VK call, so a
        # new token applies at once.
        "configured": bool(vk_stored and vk_stored.get("access_token")) or bool(config.vk_music_token),
        "token_masked": LavalinkAdmin.mask_token(
            (vk_stored or {}).get("access_token") or config.vk_music_token
        ),
        "token_saved_in_db": bool(vk_stored and vk_stored.get("access_token")),
    }

    nodes = list(__import__("wavelink").Pool.nodes.values())

    return {
        "discord": {
            "ready": bot.is_ready(),
            "user": str(bot.user) if bot.user else None,
            "guilds": len(bot.guilds),
        },
        "lavalink": {
            "host": f"{config.lavalink_host}:{config.lavalink_port}",
            "connected": len(nodes) > 0,
            "players": sum(len(getattr(n, "players", {}) or {}) for n in nodes),
        },
        "youtube": youtube,
        "yandexmusic": yandex,
        "vkmusic": vkmusic,
        "superadmin_hint": "IDs in SUPERADMIN_IDS (.env) get this page",
    }


@public_router.get("/sources")
async def sources(
    user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
    config: Config = Depends(get_config),
) -> dict[str, Any]:
    """Which search sources can do their job right now (panel tab gating).

    Keys match the panel's source ids. yt is the network+plugin verdict
    from the availability monitor; ym/vk additionally need a token; the
    rest run on Lavalink built-ins and are always up.
    """
    import os

    from app.core.services.availability import UP, state

    ym_stored = await db.get_system_setting(YM_TOKEN_KEY)
    ym_configured = bool((ym_stored and ym_stored.get("access_token")) or config.yandex_music_token)
    # LavaSrc only mounts the yandex source when the flag is on (.env).
    ym_enabled = os.getenv("YANDEX_MUSIC_ENABLED", "false").strip().lower() in ("1", "true", "yes")
    vk_stored = await db.get_system_setting(VK_TOKEN_KEY)
    vk_configured = bool((vk_stored and vk_stored.get("access_token")) or config.vk_music_token)

    return {
        "all": True,
        "yt": state["statuses"].get("youtube") == UP,
        "sc": True,
        "ym": ym_configured and ym_enabled,
        "vk": vk_configured,
        "radio": True,
        "archive": True,
        "local": True,
        "checked_at": state["ts"],
    }


@public_router.get("/status")
async def system_status(
    user: CurrentUser = Depends(get_current_user),
    bot: ComplexBot = Depends(get_bot),
) -> dict[str, Any]:
    """Latest availability pass — the shell status chip reads this."""
    from app.core.services.availability import state

    return {
        "ts": state["ts"],
        "bot_ready": bot.is_ready(),
        "statuses": state["statuses"],
    }


@public_router.get("/availability")
async def availability_view(
    # "range" would shadow the builtin inside this function.
    range_name: str = Query(default="hour", alias="range"),
    user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> dict[str, Any]:
    """Uptime buckets for the About page: hour = raw samples per minute,
    day = raw per 15 min, month = hourly rollups per day. An all-zero
    bucket is a gap (the whole app was down) — the panel hatches it."""
    from datetime import timedelta

    from app.core.db.models import utcnow
    from app.core.services.availability import SERVICES

    specs = {
        "hour": (60, 60, timedelta(minutes=60)),
        "day": (96, 900, timedelta(hours=24)),
        "month": (30, 86400, timedelta(days=30)),
    }
    if range_name not in specs:
        raise HTTPException(status_code=400, detail="range must be hour, day or month")
    bucket_count, bucket_seconds, span = specs[range_name]
    # Align the window to bucket boundaries: a sliding start would reshuffle
    # samples into different buckets on every request, and the strips would
    # repaint differently between reloads.
    now_epoch = int(utcnow().replace(tzinfo=timezone.utc).timestamp())
    start_epoch = (now_epoch - int(span.total_seconds())) // bucket_seconds * bucket_seconds
    # The aligned window can span one more bucket than the nominal count
    # (e.g. the month view starts at UTC midnight and today is a 31st slot).
    bucket_count = now_epoch // bucket_seconds - start_epoch // bucket_seconds + 1
    start = datetime.fromtimestamp(start_epoch, tz=timezone.utc).replace(tzinfo=None)
    now = datetime.fromtimestamp(start_epoch + bucket_count * bucket_seconds, tz=timezone.utc).replace(tzinfo=None)

    def epoch(dt: datetime) -> int:
        return int(dt.replace(tzinfo=timezone.utc).timestamp())

    counts: dict[str, list[list[int]]] = {
        service: [[0, 0, 0, 0] for _ in range(bucket_count)] for service in SERVICES
    }
    if range_name == "month":
        for r in await db.availability_rollups_since(start):
            idx = int((r.hour_start - start).total_seconds() // bucket_seconds)
            if 0 <= idx < bucket_count:
                cell = counts[r.service][idx]
                cell[0] += r.up
                cell[1] += r.degraded
                cell[2] += r.down
                cell[3] += r.na
    else:
        for row in await db.availability_samples_between(start, now):
            idx = int((row.ts - start).total_seconds() // bucket_seconds)
            if 0 <= idx < bucket_count:
                for service in SERVICES:
                    value = getattr(row, service)
                    if value is None:
                        counts[service][idx][3] += 1
                    elif value == 2:
                        counts[service][idx][0] += 1
                    elif value == 1:
                        counts[service][idx][1] += 1
                    else:
                        counts[service][idx][2] += 1

    series: dict[str, Any] = {}
    per_service: dict[str, Any] = {}
    for service in SERVICES:
        values = []
        sums = [0, 0, 0]
        for index, (up, degraded, down, na) in enumerate(counts[service]):
            values.append([epoch(start) + index * bucket_seconds, up, degraded, down, na])
            if up + degraded + down > 0:
                sums[0] += up
                sums[1] += degraded
                sums[2] += down
        series[service] = {"bucket_seconds": bucket_seconds, "values": values}
        total = sum(sums)
        per_service[service] = {
            "up_pct": round(sums[0] * 100 / total, 1) if total else None,
            "degraded_pct": round(sums[1] * 100 / total, 1) if total else None,
            "down_pct": round(sums[2] * 100 / total, 1) if total else None,
        }

    overall = []
    for index in range(bucket_count):
        applicable = 0
        worked = 0
        for service in SERVICES:
            up, degraded, down, _na = counts[service][index]
            if up + degraded + down > 0:
                applicable += 1
                # A bucket holds many samples per service: the overall line
                # is the share of applicable services that worked at all.
                if up + degraded > 0:
                    worked += 1
        overall.append(
            [epoch(start) + index * bucket_seconds, round(worked * 100 / applicable, 1) if applicable else None]
        )

    return {
        "range": range_name,
        "from": epoch(start),
        "to": epoch(now),
        "series": series,
        "overall": {"bucket_seconds": bucket_seconds, "values": overall},
        "per_service": per_service,
    }


@router.put("/youtube")
async def update_youtube(
    body: YoutubeConfigBody,
    user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
    config: Config = Depends(get_config),
) -> dict[str, Any]:
    """Update the youtube-source plugin config at runtime and persist it in the DB."""
    _require_superadmin(user)

    admin = LavalinkAdmin(config)
    stored = await db.get_system_setting(YT_TOKEN_KEY) or {}

    if body.refresh_token:
        stored["refresh_token"] = body.refresh_token.strip()
    if body.po_token and not body.visitor_data:
        raise HTTPException(status_code=400, detail="visitor_data is required together with po_token")
    if body.visitor_data and not body.po_token:
        raise HTTPException(status_code=400, detail="po_token is required together with visitor_data")
    if body.po_token and body.visitor_data:
        stored["po_token"] = body.po_token.strip()
        stored["visitor_data"] = body.visitor_data.strip()

    try:
        await admin.update_youtube_config(
            refresh_token=stored.get("refresh_token", "x"),
            skip_initialization=False,
            po_token=stored.get("po_token", ""),
            visitor_data=stored.get("visitor_data", ""),
        )
    except LavalinkAdminError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    await db.set_system_setting(YT_TOKEN_KEY, stored)
    await db.audit("admin.update_youtube_config", actor_id=user.discord_id, actor_kind="web")

    raw = await admin.get_youtube_config()
    return {
        "oauth_configured": bool(raw.get("refreshToken")),
        "refresh_token_masked": LavalinkAdmin.mask_token(raw.get("refreshToken")),
        "pot_saved": bool(stored.get("po_token")),
    }


@router.delete("/youtube/pot")
async def clear_pot(
    user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
    config: Config = Depends(get_config),
) -> dict[str, Any]:
    """Remove the stored POT values. They stay active until Lavalink restarts."""
    _require_superadmin(user)
    stored = await db.get_system_setting(YT_TOKEN_KEY) or {}
    stored.pop("po_token", None)
    stored.pop("visitor_data", None)
    await db.set_system_setting(YT_TOKEN_KEY, stored)
    return {"cleared": True}


@router.delete("/youtube/last-error")
async def clear_last_error(
    user: CurrentUser = Depends(get_current_user),
    music: MusicService = Depends(get_music),
) -> dict[str, Any]:
    _require_superadmin(user)
    music.last_error = None
    return {"cleared": True}


@router.put("/yandexmusic")
async def update_yandex(
    body: YandexConfigBody,
    user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
    config: Config = Depends(get_config),
) -> dict[str, Any]:
    """Save the Yandex Music access token in the DB and in .env.

    LavaSrc reads the token on startup, so the Lavalink container must be
    recreated to apply a new token.
    """
    _require_superadmin(user)
    token = body.access_token.strip()
    if not token:
        raise HTTPException(status_code=400, detail="access_token must not be empty")

    await db.set_system_setting(YM_TOKEN_KEY, {"access_token": token})
    env_path = config.data_dir.parent / ".env"
    env_written = _write_env_line(env_path, "YANDEX_MUSIC_TOKEN", token)
    env_written = _write_env_line(env_path, "YANDEX_MUSIC_ENABLED", "true") and env_written
    await db.audit("admin.update_yandexmusic", actor_id=user.discord_id, actor_kind="web")

    return {
        "token_masked": LavalinkAdmin.mask_token(token),
        "env_updated": env_written,
        "note": "Saved. Run `docker compose up -d --force-recreate lavalink` to apply.",
    }


@router.post("/vkmusic/auth")
async def auth_vkmusic(
    body: VkAuthBody,
    user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
    config: Config = Depends(get_config),
) -> dict[str, Any]:
    """Sign in with the VK account (direct auth as the official Android
    client) and store the audio-capable token. The password is used once
    for the exchange and never persisted; only the token is saved. A 2FA
    challenge comes back as 428 with needs_code=true — resend with code."""
    _require_superadmin(user)
    from app.core.services import vk_music

    try:
        token = await vk_music.direct_auth(body.login.strip(), body.password, body.code.strip() or None)
    except vk_music.VkAuthError as exc:
        raise HTTPException(
            status_code=428 if exc.needs_code else 400,
            detail=str(exc),
            headers={"X-Needs-Code": "1"} if exc.needs_code else None,
        ) from exc
    try:
        await vk_music.vk_call(token, "audio.search", ua=vk_music.VK_OFFICIAL_UA, q="test", count=1)
    except vk_music.VkMusicError as exc:
        raise HTTPException(status_code=400, detail=f"The token VK issued does not work: {exc}") from exc

    await db.set_system_setting(
        VK_TOKEN_KEY, {"access_token": token, "user_agent": vk_music.VK_OFFICIAL_UA}
    )
    env_path = config.data_dir.parent / ".env"
    env_written = _write_env_line(env_path, "VK_MUSIC_TOKEN", token)
    await db.audit("admin.update_vkmusic", actor_id=user.discord_id, actor_kind="web")
    return {
        "token_masked": LavalinkAdmin.mask_token(token),
        "env_updated": env_written,
        "note": "Signed in and verified. VK search and playback use the new token right away.",
    }


@router.put("/vkmusic")
async def update_vkmusic(
    body: VkConfigBody,
    user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
    config: Config = Depends(get_config),
) -> dict[str, Any]:
    """Save the VK audio access token in the DB and in .env.

    The bot re-reads the DB value before every VK call, so it applies
    without a restart. The token is validated against the audio API first:
    a bad one used to save fine and every VK search then failed with a
    cryptic error in the panel.
    """
    _require_superadmin(user)
    token = body.access_token.strip()
    if not token:
        raise HTTPException(status_code=400, detail="access_token must not be empty")

    from app.core.services import vk_music

    try:
        await vk_music.vk_call(token, "audio.search", q="test", count=1)
    except vk_music.VkMusicError as exc:
        raise HTTPException(status_code=400, detail=f"VK rejected this token: {exc}") from exc

    await db.set_system_setting(VK_TOKEN_KEY, {"access_token": token})
    env_path = config.data_dir.parent / ".env"
    env_written = _write_env_line(env_path, "VK_MUSIC_TOKEN", token)
    await db.audit("admin.update_vkmusic", actor_id=user.discord_id, actor_kind="web")

    return {
        "token_masked": LavalinkAdmin.mask_token(token),
        "env_updated": env_written,
        "note": "Saved and verified. VK search and playback use the new token right away.",
    }
