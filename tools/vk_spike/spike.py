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
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

PROFILE = Path(__file__).parent / "vk_profile"
STREAM_RE = re.compile(r"\.(m3u8|mp3|mp4|aac)(\?|$)", re.I)
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


def capture_one(page: Page, captured: list[tuple[float, str]], owner: str, aid: str,
                wait_s: float) -> None:
    before = len(captured)
    t0 = time.time()
    goto_track(page, owner, aid)
    print(f"    страница: {page.url[:80]}")
    got = None
    while time.time() - t0 < wait_s:
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

    if got:
        print(f"    ПОЙМАНО за {got[0] - t0:.1f} с: {got[1][:160]}")
        if ".m3u8" in got[1].lower():
            print("    (HLS-манифест — lavaplayer играет его нативно)")
    else:
        print(f"    НЕ ПЕРЕХВАЧЕНО за {wait_s} с (CDN-запросов всего: {len(captured)})")
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

        # Context-level listener: every request of every frame is visible.
        captured: list[tuple[float, str]] = []
        ctx.on("request", lambda req: captured.append((time.time(), req.url))
               if is_stream_url(req.url) else None)

        print("\n--- первый проход (холодная страница):")
        for owner, aid in targets:
            capture_one(page, captured, owner, aid, wait_s=20)

        if len(targets) > 1:
            print("\n--- повторный проход (тёплый браузер):")
            for owner, aid in targets:
                capture_one(page, captured, owner, aid, wait_s=15)

        input("\n>>> Готово. Enter — закрыть браузер... ")
        ctx.close()


if __name__ == "__main__":
    main()
