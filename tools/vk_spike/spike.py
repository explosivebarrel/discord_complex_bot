"""VK browser capture spike.

One-time interactive login in a visible Chrome window (captcha/2FA solved
by hand), then measure whether a real browser can play a track and yield
its stream URL — the thing the userscript's synthetic click could not do.

Run:
    .venv/Scripts/python.exe tools/vk_spike/spike.py -2001636042_74636042

Pass one or more id pairs (as in the deep link vk.ru/audio<owner>_<id>).
The login profile is stored next to this script (vk_profile/) — it is the
session the future server sidecar will reuse; never commit it.
"""
import re
import sys
import time
from collections import Counter
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import Page, sync_playwright

PROFILE = Path(__file__).parent / "vk_profile"
STREAM_RE = re.compile(r"\.(m3u8|mp3|mp4|aac)(\?|$)", re.I)
# Any audio-CDN URL, extension or not (HLS segments carry none).
VK_CDN_RE = re.compile(r"https://[a-z0-9.-]*(?:vkuseraudio|vkuser)\.net/[^\"'\\\s<>]+", re.I)
PLAY_SELECTORS = (
    '[data-testid="audiorow-tappable"]',
    ".audio_row__play",
    "[data-audio]",
    '[data-testid="audiorow-play"]',
)


def is_stream_url(url: str) -> bool:
    return ("vkuseraudio.net" in url or "vkuser.net" in url) and bool(STREAM_RE.search(url))


def goto_track(page: Page, owner: str, aid: str, timeout_s: float = 30.0) -> None:
    """VK bounces audio deep links through functional redirects
    (?to=...), which Playwright reports as an interrupted navigation —
    ride the redirect chain out instead of dying on it."""
    url = f"https://vk.ru/audio{owner}_{aid}"
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        try:
            page.goto(url, wait_until="commit", timeout=15000)
            page.wait_for_load_state("load", timeout=15000)
            return
        except Exception as exc:  # noqa: BLE001 - the interruption is benign
            if "interrupted by another navigation" not in str(exc):
                raise
            page.wait_for_timeout(1000)
            if f"audio{owner}_{aid}" in page.url or "/audio" in page.url:
                return
    print(f"    (навигация не устоялась, текущий URL: {page.url})")


def scan_response(resp, captured: list, via: dict, stats: dict) -> None:
    """The web API hands out stream URLs in JSON bodies (the userscript
    proves it on user pages) — scan every method response for them.
    Bodies are read OUTSIDE event handlers (sync-API reentrancy)."""
    name = urlsplit(resp.url).path.rsplit("/", 1)[-1].split("?")[0]
    try:
        body = resp.text()
    except Exception as exc:  # noqa: BLE001 - bodies of streamed/failed responses
        stats["unreadable"] = stats.get("unreadable", 0) + 1
        print(f"      [тело {name} нечитаемо: {exc}]")
        return
    if not body or len(body) > 3_000_000:
        return
    stats["scanned"] = stats.get("scanned", 0) + 1
    # JSON may escape slashes: https:\/\/... breaks naive URL regexes.
    clean = body.replace("\\/", "/")
    found = 0
    for m in VK_CDN_RE.finditer(clean):
        url = m.group(0)
        found += 1
        if url not in {c[1] for c in captured}:
            captured.append((time.time(), url))
            via[url] = name
    stats["urls"] = stats.get("urls", 0) + found
    if name.startswith("audio") and not found:
        print(f"      [ответ {name} без CDN-ссылок] {clean[:500]}")


def dump_traffic(all_reqs: list[tuple[float, str]]) -> None:
    hosts = Counter(urlsplit(u).netloc for _, u in all_reqs)
    print(f"    всего запросов за окно: {len(all_reqs)}")
    for host, n in hosts.most_common(10):
        print(f"      {n:4d}  {host}")
    cdn = [u for _, u in all_reqs if "vkuser" in u]
    print(f"    аудио-CDN запросов: {len(cdn)}")
    for u in cdn[:5]:
        print(f"      CDN >>> {u[:170]}")
    methods = Counter(
        urlsplit(u).path.rsplit("/", 1)[-1].split("?")[0]
        for _, u in all_reqs if "web.api.vk.ru/method/" in u
    )
    print("    web.api методы: " + (", ".join(f"{m}×{n}" for m, n in methods.most_common(15)) or "нет"))


def capture_one(page: Page, captured: list, via: dict, stats: dict, pending: list,
                all_reqs: list[tuple[float, str]], owner: str, aid: str,
                wait_s: float) -> None:
    before = len(captured)
    traffic_before = len(all_reqs)
    t0 = time.time()
    goto_track(page, owner, aid)
    print(f"    страница: {page.url[:80]}")
    got = None
    while time.time() - t0 < wait_s:
        # Scan pending API response bodies outside of event handlers.
        while pending:
            scan_response(pending.pop(0), captured, via, stats)
        fresh = captured[before:]
        if fresh:
            got = fresh[0]
            break
        # The deep link may not auto-play: poke the row's play button.
        for sel in PLAY_SELECTORS:
            el = page.query_selector(sel)
            if el:
                try:
                    el.click(timeout=1000)
                except Exception:  # noqa: BLE001 - best effort only
                    pass
                break
        page.wait_for_timeout(500)
    while pending:
        scan_response(pending.pop(0), captured, via, stats)

    if got:
        print(f"    ПОЙМАНО за {got[0] - t0:.1f} с: {got[1][:180]}")
        print(f"      источник: {via.get(got[1], '?')}")
        if ".m3u8" in got[1].lower():
            print("      (HLS-манифест — lavaplayer играет его нативно)")
        return

    print(f"    НЕ ПЕРЕХВАЧЕНО за {wait_s} с — трафик за окно:")
    dump_traffic(all_reqs[traffic_before:])
    try:
        media = page.evaluate(
            """() => [...document.querySelectorAll('audio,video')].map((a) => ({
                tag: a.tagName.toLowerCase(),
                src: (a.src || a.currentSrc || '').slice(0, 140),
                t: a.currentTime, paused: a.paused,
            }))"""
        )
        print(f"    media elements: {media or 'нет'} (video с okcdn = реклама)")
    except Exception as exc:  # noqa: BLE001
        print(f"    (не удалось опросить media: {exc})")
    shot = Path(__file__).parent / "spike_fail.png"
    page.screenshot(path=str(shot), full_page=False)
    print(f"    скриншот состояния: {shot}")


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    targets = [tuple(t.partition("_")[::2]) for t in sys.argv[1:]]

    with sync_playwright() as p:
        try:
            ctx = p.chromium.launch_persistent_context(
                str(PROFILE), headless=False, args=["--mute-audio", "--start-maximized"],
            )
        except Exception as exc:  # noqa: BLE001 - explain instead of a stack dump
            print(f"Chromium launch failed: {exc}")
            print("Run: .venv/Scripts/python.exe -m playwright install chromium")
            sys.exit(1)

        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto("https://vk.ru/audio", wait_until="domcontentloaded")

        input(
            "\n>>> В окне браузера войди в аккаунт (капчу/2FA решай руками),\n"
            ">>> дождись загрузки раздела музыки и нажми Enter здесь... "
        )

        captured: list[tuple[float, str]] = []
        via: dict[str, str] = {}
        stats: dict = {}
        all_reqs: list[tuple[float, str]] = []
        pending: list = []  # API responses queued by the handler, read in-loop

        def on_request(req) -> None:
            all_reqs.append((time.time(), req.url))
            if is_stream_url(req.url):
                captured.append((time.time(), req.url))

        ctx.on("request", on_request)
        ctx.on("response", lambda r: pending.append(r)
               if ("method/" in r.url or "al_audio" in r.url) else None)
        # CDP sees the same page from the protocol side; a mismatch between
        # the two channels means the request bypasses Playwright's view.
        cdp = ctx.new_cdp_session(page)
        cdp.send("Network.enable")
        cdp.on("Network.requestWillBeSent",
               lambda ev: all_reqs.append((time.time(), ev["request"]["url"])))

        print("\n--- первый проход (холодная страница):")
        for owner, aid in targets:
            capture_one(page, captured, via, stats, pending, all_reqs, owner, aid, wait_s=35)

        if len(targets) > 1:
            print("\n--- повторный проход (тёплый браузер):")
            for owner, aid in targets:
                capture_one(page, captured, via, stats, pending, all_reqs, owner, aid, wait_s=25)

        print(f"\n--- сканер ответов: {stats}")
        input("\n>>> Готово. Enter — закрыть браузер... ")
        ctx.close()


if __name__ == "__main__":
    main()
