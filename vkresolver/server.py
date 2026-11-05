"""VK stream resolver: a logged-in headless browser opens the track page,
presses play and returns the signed CDN URL that the web player fetched.

No VK API is touched — this is exactly the web surface a human user
generates. The session comes from cookies exported on the admin's machine
(SESSION_FILE); URLs are bound to this machine's IP and expire in hours,
so Lavalink on the same host streams them fine.

Endpoints:
    POST /resolve {"owner_id": int, "audio_id": int} -> {"url", "ms", "via"}
    GET  /health -> {"session": bool, "last_error": str | None, ...}
"""
import asyncio
import json
import os
import random
import re
import time
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException
from playwright.async_api import async_playwright

PROFILE_DIR = os.environ.get("PROFILE_DIR", "/data/vk_profile")
SESSION_FILE = os.environ.get("SESSION_FILE", "/data/vk_session.json")
# Human pacing: at most one resolve at a time, at least this many seconds
# apart. The browser is indistinguishable from a user only while it
# behaves like one.
MIN_INTERVAL = float(os.environ.get("MIN_INTERVAL", "3.0"))
RESOLVE_TIMEOUT = float(os.environ.get("RESOLVE_TIMEOUT", "20"))

CDN_HOST_RE = re.compile(r"(?:vkuseraudio|vkuser)\.net$|okcdn\.ru$", re.I)
METHOD_RE = re.compile(r"method/audio\.(?:getById|get)\b|al_audio\.php", re.I)
PLAY_SELECTORS = (
    '[data-testid="audiorow-tappable"]',
    ".audio_row__play",
    "[data-audio]",
    '[data-testid="audiorow-play"]',
)


class _State:
    playwright_cm = None
    browser_ctx = None
    lock = asyncio.Lock()
    last_resolved = 0.0
    cache: dict[tuple[int, int], tuple[str, float]] = {}
    last_error: str | None = None
    logged_in = False


state = _State()
app = FastAPI()


def _looks_like_stream(url: str) -> bool:
    host = urlsplit(url).netloc.rsplit(".", 2)[-2] + "." + urlsplit(url).netloc.rsplit(".", 1)[-1]
    # okcdn.ru / *.vkuser.net / *.vkuseraudio.net with signed query
    if not ("okcdn.ru" in host or "vkuser" in host):
        return False
    q = urlsplit(url).query
    return "expires=" in q and "sig=" in q


def _stream_from_json(body: str, owner_id: int, audio_id: int) -> str | None:
    """audio.getById answers {"response": [{...,"url": "https://..."}]}."""
    try:
        data = json.loads(body.replace("\\/", "/").replace("\\u0026", "&"))
    except Exception:  # noqa: BLE001 - non-JSON bodies
        return None
    rows = data.get("response") if isinstance(data, dict) else None
    if not isinstance(rows, list):
        return None
    match = fallback = None
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("url"), str):
            continue
        url = row["url"]
        if not _looks_like_stream(url):
            continue
        if row.get("owner_id") == owner_id and row.get("id") == audio_id:
            match = url
            break
        fallback = fallback or url
    return match or fallback


def _cache_ttl(url: str) -> float:
    q = urlsplit(url).query
    m = re.search(r"expires=(\d+)", q)
    if m:
        return max(60.0, int(m.group(1)) / 1000 - time.time() - 600)
    return 1800.0


async def _ride_redirects(page, owner_id: int, audio_id: int) -> None:
    url = f"https://vk.ru/audio{owner_id}_{audio_id}"
    deadline = time.time() + 25
    while time.time() < deadline:
        try:
            await page.goto(url, wait_until="commit", timeout=15000)
            await page.wait_for_load_state("load", timeout=15000)
            return
        except Exception as exc:  # noqa: BLE001 - functional redirects abort goto
            if "interrupted by another navigation" not in str(exc):
                raise
            await page.wait_for_timeout(1000)
            if f"audio{owner_id}_{audio_id}" in page.url or "/audio" in page.url:
                return
    raise RuntimeError(f"navigation never settled: {page.url[:120]}")


async def _resolve_once(owner_id: int, audio_id: int) -> str:
    page = await state.browser_ctx.new_page()
    responses: list = []
    streams: list[tuple[float, str]] = []
    stop = asyncio.Event()

    def on_response(resp) -> None:
        if METHOD_RE.search(resp.url):
            responses.append(resp)

    def on_request(req) -> None:
        if _looks_like_stream(req.url) and not stop.is_set():
            streams.append((time.time(), req.url))

    page.on("response", on_response)
    page.on("request", on_request)
    t0 = time.time()
    try:
        await _ride_redirects(page, owner_id, audio_id)
        if "login" in page.url:
            raise RuntimeError("login_required")
        deadline = time.time() + RESOLVE_TIMEOUT
        while time.time() < deadline:
            while responses:
                resp = responses.pop(0)
                try:
                    body = await resp.text()
                except Exception:  # noqa: BLE001 - navigated away / streamed
                    continue
                url = _stream_from_json(body, owner_id, audio_id)
                if url:
                    return url
            if streams:
                return streams[0][1]
            for sel in PLAY_SELECTORS:
                el = await page.query_selector(sel)
                if el:
                    try:
                        await el.click(timeout=1000)
                    except Exception:  # noqa: BLE001 - best effort
                        pass
                    break
            await page.wait_for_timeout(500)
        raise RuntimeError("no_stream")
    finally:
        stop.set()
        # Let the "listener" keep streaming a little: a 2s listen looks
        # more like a skip than like scraping, and costs nothing here.
        asyncio.get_event_loop().call_later(
            random.uniform(12, 20), lambda: asyncio.ensure_future(page.close())
        )


async def resolve(owner_id: int, audio_id: int) -> dict:
    key = (owner_id, audio_id)
    hit = state.cache.get(key)
    now = time.time()
    if hit and hit[1] > now:
        return {"url": hit[0], "ms": 0, "via": "cache"}
    async with state.lock:
        hit = state.cache.get(key)
        if hit and hit[1] > time.time():
            return {"url": hit[0], "ms": 0, "via": "cache"}
        # Human pacing between resolves.
        wait = state.last_resolved + MIN_INTERVAL - time.time()
        if wait > 0:
            await asyncio.sleep(wait)
        t0 = time.time()
        try:
            url = await _resolve_once(owner_id, audio_id)
        except Exception as exc:  # noqa: BLE001 - reported to the caller
            state.last_error = str(exc)
            raise
        state.last_resolved = time.time()
        state.last_error = None
        ttl = _cache_ttl(url)
        state.cache[key] = (url, time.time() + ttl)
        if len(state.cache) > 500:
            state.cache.pop(next(iter(state.cache)))
        return {"url": url, "ms": int((time.time() - t0) * 1000), "via": "page"}


@app.on_event("startup")
async def startup() -> None:
    state.playwright_cm = async_playwright()
    pw = await state.playwright_cm.__aenter__()
    # channel="chromium" = the new headless mode (full browser, not the
    # detectable headless shell).
    state.browser_ctx = await pw.chromium.launch_persistent_context(
        PROFILE_DIR,
        headless=True,
        channel="chromium",
        args=["--mute-audio", "--no-sandbox"],
        user_agent=(
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36"
        ),
    )
    if os.path.isfile(SESSION_FILE):
        st = json.load(open(SESSION_FILE, encoding="utf-8"))
        await state.browser_ctx.add_cookies(st.get("cookies", []))
        state.logged_in = True
    # Warm the session; also validates the cookies early.
    page = await state.browser_ctx.new_page()
    try:
        await page.goto("https://vk.ru/audio", wait_until="domcontentloaded", timeout=20000)
        content = await page.content()
        state.logged_in = "login" not in page.url and "vkontakte" not in content.lower()[:0]
    except Exception as exc:  # noqa: BLE001
        state.last_error = f"warmup: {exc}"
    await page.close()


@app.on_event("shutdown")
async def shutdown() -> None:
    if state.browser_ctx:
        await state.browser_ctx.close()
    if state.playwright_cm:
        await state.playwright_cm.__aexit__(None, None, None)


@app.post("/resolve")
async def resolve_ep(body: dict) -> dict:
    try:
        owner_id = int(body["owner_id"])
        audio_id = int(body["audio_id"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(status_code=422, detail="owner_id and audio_id required")
    try:
        return await asyncio.wait_for(resolve(owner_id, audio_id), timeout=90)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="resolve timed out")
    except RuntimeError as exc:
        code = 503 if "login" in str(exc) else 502
        raise HTTPException(status_code=code, detail=str(exc))


@app.get("/health")
async def health() -> dict:
    fresh = sum(1 for _, exp in state.cache.values() if exp > time.time())
    return {
        "session": state.logged_in,
        "last_error": state.last_error,
        "cached_urls": fresh,
        "cooldown_left": max(0.0, state.last_resolved + MIN_INTERVAL - time.time()),
    }
