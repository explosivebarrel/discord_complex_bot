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
from collections import deque
from urllib.parse import quote, urlsplit

from fastapi import FastAPI, HTTPException
from playwright.async_api import async_playwright

PROFILE_DIR = os.environ.get("PROFILE_DIR", "/data/vk_profile")
SESSION_FILE = os.environ.get("SESSION_FILE", "/data/vk_session.json")
# Human pacing: at most one resolve at a time, at least this many seconds
# apart. The browser is indistinguishable from a user only while it
# behaves like one.
MIN_INTERVAL = float(os.environ.get("MIN_INTERVAL", "3.0"))
# A human does not "listen" to 1200 tracks an hour; the ceiling keeps a
# runaway queue from painting a bot-shaped pattern in VK's logs.
HOURLY_LIMIT = int(os.environ.get("HOURLY_LIMIT", "40"))
# Phase budgets: the deep link answers (or fast-fails) in ~2s; a foreign
# library track the sidecar account cannot see returns {"response":[]},
# and the search-by-name phase finds the same song in the open catalog.
DEEP_LINK_TIMEOUT = float(os.environ.get("DEEP_LINK_TIMEOUT", "8"))
SEARCH_TIMEOUT = float(os.environ.get("SEARCH_TIMEOUT", "0"))
NO_STREAM_TTL = float(os.environ.get("NO_STREAM_TTL", "600"))

CDN_HOST_RE = re.compile(r"(?:vkuseraudio|vkuser)\.net$|okcdn\.ru$", re.I)
METHOD_RE = re.compile(r"method/audio\.(?:getById|get)\b|al_audio\.php", re.I)
# Any signed stream URL inside JSON bodies (search results carry them).
VK_CDN_URL_RE = re.compile(
    r"https://[a-z0-9.-]*(?:vkuseraudio|vkuser)\.net/\?[^\"'\\\s<>]+"
    r"|https://[a-z0-9.-]*okcdn\.ru/\?[^\"'\\\s<>]+",
    re.I,
)
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
    hourly: deque[float] = deque()


state = _State()
app = FastAPI()


def _looks_like_stream(url: str) -> bool:
    host = urlsplit(url).netloc.lower()
    # okcdn.ru / *.vkuser.net / *.vkuseraudio.net with signed query
    if "okcdn.ru" not in host and "vkuser" not in host:
        return False
    q = urlsplit(url).query
    if "expires=" not in q or "sig=" not in q:
        return False
    # Ad streams share the shape (pct/ct=0/clientType=28) but lavaplayer
    # cannot play them; real track streams carry ct=2/12, clientType=58.
    if "pct=" in q:
        return False
    m = re.search(r"[?&]ct=(\d+)", url)
    return (m.group(1) if m else "2") != "0"


def _stream_from_json(body: str, owner_id: int, audio_id: int) -> str | None:
    """audio.getById answers {"response": [{...,"url": "https://..."}]}.
    Only the exact requested track counts: `{"response":[]}` means the
    sidecar account has no access (foreign/private library tracks), and
    grabbing another row's URL would play the wrong song."""
    try:
        data = json.loads(body.replace("\\/", "/").replace("\\u0026", "&"))
    except Exception:  # noqa: BLE001 - non-JSON bodies
        return None
    rows = data.get("response") if isinstance(data, dict) else None
    if not isinstance(rows, list):
        return None
    for row in rows:
        if not isinstance(row, dict) or row.get("owner_id") != owner_id or row.get("id") != audio_id:
            continue
        url = row.get("url")
        if isinstance(url, str) and _looks_like_stream(url):
            return url
    return None


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


async def _resolve_once(owner_id: int, audio_id: int, query: str) -> tuple[str, str]:
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

    async def wait_for_url(deadline_s: float, exact: bool) -> str | None:
        """exact=True: only the deep link's own audio.getById row counts.
        exact=False (search): click result rows one by one — a free
        account's search payload carries no stream URLs until a row is
        played (and an ad plays first, ct=0, filtered out)."""
        deadline = time.time() + deadline_s
        clicked = 0
        last_click = 0.0
        empty_seen_at = 0.0  # getById answered without our track: no access
        while time.time() < deadline:
            while responses:
                resp = responses.pop(0)
                try:
                    body = await resp.text()
                except Exception:  # noqa: BLE001 - navigated away / streamed
                    continue
                if exact:
                    url = _stream_from_json(body, owner_id, audio_id)
                    if url is None and '"response":[]' in body.replace(" ", ""):
                        # The account cannot see this track; the page will
                        # never play it. A short grace covers a stream that
                        # raced the response, then bail — the bot's fallback
                        # resolves a substitute much faster than a full wait.
                        empty_seen_at = empty_seen_at or time.time()
                else:
                    url = next(
                        (u for u in VK_CDN_URL_RE.findall(body.replace("\\/", "/").replace("\\u0026", "&"))
                         if _looks_like_stream(u)),
                        None,
                    )
                if url:
                    return url
            if streams:
                return streams.pop(0)[1]
            if empty_seen_at and time.time() - empty_seen_at > 2:
                return None
            if exact:
                for sel in PLAY_SELECTORS:
                    el = await page.query_selector(sel)
                    if el:
                        try:
                            await el.click(timeout=1000)
                        except Exception:  # noqa: BLE001 - best effort
                            pass
                        break
            elif time.time() - last_click > 5:
                # Play the next result row (trusted click); re-clicking the
                # same row would pause it.
                rows = await page.query_selector_all("[data-audio], [data-audio-id]")
                if clicked < len(rows):
                    try:
                        await rows[clicked].click(timeout=2000)
                        clicked += 1
                        last_click = time.time()
                    except Exception:  # noqa: BLE001 - best effort
                        clicked += 1
            await page.wait_for_timeout(500)
        return None

    try:
        # Phase 1: the deep link (exact track; foreign/private tracks fast-
        # fail with an empty audio.getById).
        try:
            await _ride_redirects(page, owner_id, audio_id)
            if "login" in page.url:
                raise RuntimeError("login_required")
            url = await wait_for_url(DEEP_LINK_TIMEOUT, exact=True)
            if url:
                return url, "page"
        except RuntimeError as exc:
            if "login" in str(exc):
                raise
        # Phase 2: search by name — the same song from the open catalog.
        # Only useful on subscription accounts (a free account's pre-roll
        # ad never starts headless); SEARCH_TIMEOUT=0 disables it.
        if not query or SEARCH_TIMEOUT <= 0:
            raise RuntimeError("no_stream")
        await page.goto("https://vk.ru/audio?q=" + quote(query), wait_until="commit")
        await page.wait_for_load_state("load")
        url = await wait_for_url(SEARCH_TIMEOUT, exact=False)  # only reached when enabled
        if url:
            return url, "search"
        raise RuntimeError("no_stream")
    finally:
        stop.set()
        # Let the "listener" keep streaming a little: a 2s listen looks
        # more like a skip than like scraping, and costs nothing here.
        asyncio.get_event_loop().call_later(
            random.uniform(12, 20), lambda: asyncio.ensure_future(page.close())
        )


async def resolve(owner_id: int, audio_id: int, query: str) -> dict:
    key = (owner_id, audio_id)
    hit = state.cache.get(key)
    now = time.time()
    if hit and hit[1] > now:
        if hit[0] is None:
            raise RuntimeError("no_stream")  # cached negative: known unavailable
        return {"url": hit[0], "ms": 0, "via": "cache"}
    async with state.lock:
        hit = state.cache.get(key)
        if hit and hit[1] > time.time():
            if hit[0] is None:
                raise RuntimeError("no_stream")
            return {"url": hit[0], "ms": 0, "via": "cache"}
        # Sliding-hour ceiling: a cache hit does not count, a page resolve does.
        now = time.time()
        while state.hourly and state.hourly[0] < now - 3600:
            state.hourly.popleft()
        if len(state.hourly) >= HOURLY_LIMIT:
            raise RuntimeError(f"hourly_limit({HOURLY_LIMIT})")
        # Human pacing between resolves, with jitter.
        wait = state.last_resolved + MIN_INTERVAL * random.uniform(1.0, 1.6) - time.time()
        if wait > 0:
            await asyncio.sleep(wait)
        state.hourly.append(time.time())
        t0 = time.time()
        try:
            url, via = await _resolve_once(owner_id, audio_id, query)
        except RuntimeError as exc:
            state.last_error = str(exc)
            if str(exc) == "no_stream":
                # Remember the dead entry: repeats fail in ~0ms instead of
                # another page round-trip.
                state.cache[key] = (None, time.time() + NO_STREAM_TTL)
                if len(state.cache) > 500:
                    state.cache.pop(next(iter(state.cache)))
            raise
        except Exception as exc:  # noqa: BLE001 - reported to the caller
            state.last_error = str(exc)
            raise
        state.last_resolved = time.time()
        state.last_error = None
        ttl = _cache_ttl(url)
        state.cache[key] = (url, time.time() + ttl)
        if len(state.cache) > 500:
            state.cache.pop(next(iter(state.cache)))
        return {"url": url, "ms": int((time.time() - t0) * 1000), "via": via}


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
    # Warm the session; also validates the cookies early. Logged-in audio
    # pages keep the deep-link URL; anonymous ones bounce to login.
    page = await state.browser_ctx.new_page()
    try:
        await page.goto("https://vk.ru/audio", wait_until="load", timeout=25000)
        state.logged_in = "login" not in page.url
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
    # Name hints for the search phase (tracks the account cannot see).
    author = str(body.get("author") or "").strip()
    title = str(body.get("title") or "").strip()
    if author and title.startswith(author + " — "):
        query = title
    else:
        query = " - ".join(x for x in (author, title) if x)
    try:
        return await asyncio.wait_for(resolve(owner_id, audio_id, query), timeout=90)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="resolve timed out")
    except RuntimeError as exc:
        if "hourly_limit" in str(exc):
            raise HTTPException(status_code=429, detail=str(exc))
        code = 503 if "login" in str(exc) else 502
        raise HTTPException(status_code=code, detail=str(exc))


@app.get("/health")
async def health() -> dict:
    fresh = sum(1 for _, exp in state.cache.values() if exp > time.time())
    return {
        "session": state.logged_in,
        "last_error": state.last_error,
        "cached_urls": fresh,
        "resolves_last_hour": len(state.hourly),
        "hourly_limit": HOURLY_LIMIT,
        "cooldown_left": max(0.0, state.last_resolved + MIN_INTERVAL - time.time()),
    }
