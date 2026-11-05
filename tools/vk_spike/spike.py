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

from playwright.sync_api import sync_playwright

PROFILE = Path(__file__).parent / "vk_profile"
STREAM_RE = re.compile(r"\.(m3u8|mp3|mp4|aac)(\?|$)", re.I)


def is_stream_url(url: str) -> bool:
    return ("vkuseraudio.net" in url or "vkuser.net" in url) and bool(STREAM_RE.search(url))


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    targets = sys.argv[1:]

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

        def on_request(req) -> None:
            if is_stream_url(req.url):
                captured.append((time.time(), req.url))

        ctx.on("request", on_request)

        for target in targets:
            owner, _, aid = target.partition("_")
            before = len(captured)
            t0 = time.time()
            page.goto(f"https://vk.ru/audio{owner}_{aid}", wait_until="domcontentloaded")
            print(f"\n--- {target}: страница открыта, жду запрос потока (до 20 с)...")

            got = None
            while time.time() - t0 < 20:
                fresh = [c for c in captured[before:] if time.time() - c[0] >= 0]
                if fresh:
                    got = fresh[0]
                    break
                # The deep link may not auto-play: poke the row's play button.
                for sel in ('[data-testid="audiorow-tappable"]', ".audio_row__play", "[data-audio]"):
                    el = page.query_selector(sel)
                    if el:
                        try:
                            el.click(timeout=1000)
                        except Exception:  # noqa: BLE001 - best effort only
                            pass
                        break
                page.wait_for_timeout(500)

            if got:
                dt = got[0] - t0
                print(f"!!! ПОЙМАНО за {dt:.1f} с: {got[1][:160]}")
                if got[1].lower().endswith((".m3u8",)) or ".m3u8" in got[1]:
                    print("    (HLS-манифест — lavaplayer играет его нативно)")
            else:
                print(f"!!! ссылка не прилетела. Всего запросов на CDN: {len(captured)}")
                shot = Path(__file__).parent / "spike_fail.png"
                page.screenshot(path=str(shot), full_page=False)
                print(f"    скриншот состояния: {shot}")

        # Warm-up second pass: the first resolve pays page-load costs.
        if len(targets) > 1:
            print("\n--- повторный проход (тёплый браузер):")
            for target in targets:
                owner, _, aid = target.partition("_")
                before = len(captured)
                t0 = time.time()
                page.goto(f"https://vk.ru/audio{owner}_{aid}", wait_until="domcontentloaded")
                got = None
                while time.time() - t0 < 15:
                    fresh = captured[before:]
                    if fresh:
                        got = fresh[0]
                        break
                    page.wait_for_timeout(300)
                print(f"    {target}: {'за %.1f с' % (got[0] - t0) if got else 'НЕ ПЕРЕХВАЧЕНО'}")

        input("\n>>> Готово. Enter — закрыть браузер... ")
        ctx.close()


if __name__ == "__main__":
    main()
