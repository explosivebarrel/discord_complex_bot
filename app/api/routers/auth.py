from __future__ import annotations

import secrets
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse

from app.api.deps import (
    SESSION_COOKIE,
    STATE_COOKIE,
    CurrentUser,
    create_session,
    get_bot,
    get_config,
    get_current_user,
    get_db,
    get_oauth,
    revoke_session,
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
        is_admin = is_owner or bool(permissions & 0x20) or gid in await db.list_guild_admins(gid)
        result.append(
            {
                "id": str(gid),
                "name": g["name"],
                "icon": g.get("icon"),
                "is_admin": is_admin,
                "is_superadmin": user.is_superadmin,
            }
        )
    result.sort(key=lambda item: item["name"].lower())
    return result
