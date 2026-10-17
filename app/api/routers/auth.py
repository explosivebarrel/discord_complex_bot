from __future__ import annotations

import secrets
from typing import TYPE_CHECKING, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.api.deps import (
    MOCK_TIERS,
    SESSION_COOKIE,
    STATE_COOKIE,
    CurrentUser,
    bot_section_available,
    create_session,
    get_access_mock,
    get_access_mock_all,
    get_bot,
    get_config,
    get_current_user,
    get_db,
    get_oauth,
    revoke_session,
    section_allows,
    set_access_mock,
)
from app.api.discord_oauth import DiscordAPIError, DiscordOAuthClient
from app.api.sessions import SessionExpiredError, fetch_guilds_with_retry
from app.core.config import Config
from app.core.db import Database

if TYPE_CHECKING:
    from app.bot.client import ComplexBot

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _session_cookie_kwargs(config: Config) -> dict[str, Any]:
    secure = config.base_url.startswith("https")
    return {"httponly": True, "samesite": "lax", "secure": secure, "path": "/"}


@router.get("/meta")
async def meta(config: Config = Depends(get_config)) -> dict[str, str]:
    """Public panel metadata. The display name is needed before login."""
    return {"bot_name": config.bot_name}


@router.get("/login")
async def login(request: Request, oauth: DiscordOAuthClient = Depends(get_oauth)) -> RedirectResponse:
    config = request.app.state.config
    if not config.discord_client_id or not config.discord_client_secret:
        # Do not send the user to Discord with an empty client_id.
        raise HTTPException(
            status_code=503,
            detail="OAuth2 is not configured. Set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET in .env.",
        )
    state = secrets.token_urlsafe(24)
    response = RedirectResponse(oauth.authorize_url(state), status_code=302)
    response.set_cookie(
        STATE_COOKIE,
        state,
        max_age=600,
        httponly=True,
        samesite="lax",
        secure=config.base_url.startswith("https"),
    )
    return response


@router.get("/callback")
async def callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: Database = Depends(get_db),
    oauth: DiscordOAuthClient = Depends(get_oauth),
) -> Response:
    if error:
        raise HTTPException(status_code=400, detail=f"Discord OAuth error: {error}")
    expected_state = request.cookies.get(STATE_COOKIE)
    if not code or not state or not expected_state or not secrets.compare_digest(state, expected_state):
        raise HTTPException(status_code=400, detail="Invalid OAuth state")
    try:
        token_payload = await oauth.exchange_code(code)
        user = await oauth.fetch_user(token_payload["access_token"])
    except DiscordAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    token = await create_session(db, token_payload, user)
    response = RedirectResponse(request.app.state.config.base_url + "/", status_code=302)
    response.set_cookie(
        SESSION_COOKIE, token, max_age=30 * 24 * 3600, **_session_cookie_kwargs(request.app.state.config)
    )
    response.delete_cookie(STATE_COOKIE, path="/")
    return response


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    db: Database = Depends(get_db),
) -> dict[str, str]:
    await revoke_session(db, request)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"status": "ok"}


@router.get("/me")
async def me(user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    avatar_url = (
        f"https://cdn.discordapp.com/avatars/{user.discord_id}/{user.avatar}.png"
        if user.avatar
        else f"https://cdn.discordapp.com/embed/avatars/{int(user.discord_id) % 6}.png"
    )
    return {
        "discord_id": str(user.discord_id),
        "username": user.username,
        "global_name": user.global_name,
        "avatar_url": avatar_url,
        "is_superadmin": user.is_superadmin,
        "access_mock": {str(gid): tier for gid, tier in get_access_mock_all(user.session_id).items()},
    }


@router.get("/guilds")
async def my_guilds(
    user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
    oauth: DiscordOAuthClient = Depends(get_oauth),
    bot: ComplexBot = Depends(get_bot),
) -> list[dict[str, Any]]:
    """Return the guilds that have the user and the bot. Mark the guilds that the user can manage."""
    try:
        user_guilds = await fetch_guilds_with_retry(oauth, db, user)
    except SessionExpiredError as exc:
        # The SPA starts a new login when it sees 401.
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    bot_guild_ids = {g.id for g in bot.guilds}
    result = []
    for g in user_guilds:
        gid = int(g["id"])
        if gid not in bot_guild_ids:
            continue
        permissions = int(g.get("permissions", "0"))
        is_owner = bool(g.get("owner"))
        is_discord_admin = is_owner or bool(permissions & 0x20)
        is_admin = is_discord_admin or gid in await db.list_guild_admins(gid)
        tier = is_admin or user.is_superadmin
        # A mock overrides the real Discord tier for this session. An owner
        # mock is the full owner tier: admin trust plus owner-level controls,
        # but without the super-admin shortcuts.
        mock = get_access_mock(user.session_id, gid)
        if mock is not None:
            tier = mock in ("admin", "owner")
            is_admin = tier
        settings = await db.get_guild_settings(gid)
        # The super-admin passes every gate on the backend, so the flags the
        # panel shows must say the same (a mock wins over the shortcut).
        # "player" mirrors require_guild_member: any member may listen.
        if mock == "guest":
            access = {"player": False, "manage": False, "stats": False, "posts": False, "moderation": False}
        elif user.is_superadmin and mock is None:
            access = {"player": True, "manage": True, "stats": True, "posts": True, "moderation": True}
        else:
            access = {
                "player": True,
                "manage": tier,
                "stats": section_allows(settings.stats_access, tier),
                "posts": section_allows(settings.posts_access, tier),
                "moderation": section_allows(settings.moderation_access, tier),
            }
        # The bot's own permissions are a hard limit no user tier can lift:
        # an invited-without-permissions bot makes sections useless.
        bot_access = {s: bot_section_available(bot, gid, s) for s in access}
        for key, ok in bot_access.items():
            access[key] = access[key] and ok
        # Owner-level controls (section access matrix, panel admin list).
        # The Discord owner or a super-admin keeps them; an "owner" mock
        # grants them, any other mock removes them — matching
        # deps.is_guild_owner, so the preview shows what that tier sees.
        effective_owner = (is_owner or user.is_superadmin) if mock is None else mock == "owner"
        result.append(
            {
                "id": str(gid),
                "name": g["name"],
                "icon": g.get("icon"),
                "is_admin": is_admin,
                "is_owner": effective_owner,
                "is_superadmin": user.is_superadmin,
                "access": access,
                "bot_access": bot_access,
            }
        )
    result.sort(key=lambda item: item["name"].lower())
    return result


class AccessMockBody(BaseModel):
    guild_id: str
    tier: Literal["owner", "admin", "member", "guest"] | None = None


@router.get("/access-mock")
async def access_mock_list(user: CurrentUser = Depends(get_current_user)) -> dict[str, dict[str, str]]:
    if not user.is_superadmin:
        raise HTTPException(status_code=403, detail="Super-admin only")
    return {"mocks": {str(gid): tier for gid, tier in get_access_mock_all(user.session_id).items()}}


@router.put("/access-mock")
async def access_mock_put(
    body: AccessMockBody,
    user: CurrentUser = Depends(get_current_user),
) -> dict[str, str]:
    """Pretend a tier in one guild for this session: the panel and the API
    gates both evaluate permissions as if the user had it."""
    if not user.is_superadmin:
        raise HTTPException(status_code=403, detail="Super-admin only")
    if body.tier is not None and body.tier not in MOCK_TIERS:
        raise HTTPException(status_code=400, detail=f"tier must be one of {MOCK_TIERS} or null")
    set_access_mock(user.session_id, int(body.guild_id), body.tier)
    return {"status": "ok"}
