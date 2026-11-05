"""Export VK cookies from the local spike profile for the server sidecar.

Run after logging in via spike.py:
    .venv/Scripts/python.exe tools/vk_spike/export_session.py

Writes data/vk_session.json (gitignored); the vk-resolver container picks
it up on restart.
"""
from pathlib import Path

from playwright.sync_api import sync_playwright

PROFILE = Path(__file__).parent / "vk_profile"
OUT = Path(__file__).parents[2] / "data" / "vk_session.json"


def main() -> None:
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(str(PROFILE), headless=True)
        if not ctx.pages:
            ctx.new_page()
        page = ctx.pages[0]
        page.goto("https://vk.ru/audio", wait_until="domcontentloaded", timeout=30000)
        if "login" in page.url:
            print("!!! профиль не залогинен — сначала прогони spike.py и войди в аккаунт")
            ctx.close()
            raise SystemExit(1)
        ctx.storage_state(path=str(OUT))
        ctx.close()
    print(f"сессия сохранена: {OUT}")


if __name__ == "__main__":
    main()
