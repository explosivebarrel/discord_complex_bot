import logging
import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

logger = logging.getLogger(__name__)

# Project root: app/core/config.py -> app/core -> app -> root
BASE_DIR = Path(__file__).resolve().parents[2]


def _split_ids(raw: str) -> list[int]:
    return [int(part) for part in raw.replace(",", " ").split() if part.strip()]


@dataclass(frozen=True)
class Config:
    discord_bot_token: str
    discord_client_id: str
    discord_client_secret: str
    discord_redirect_uri: str
    superadmin_ids: list[int]
    session_secret: str
    base_url: str
    database_url: str
    lavalink_host: str
    lavalink_port: int
    lavalink_password: str
    lavalink_secure: bool
    yandex_music_token: str
    log_level: str
    data_dir: Path = field(default_factory=lambda: BASE_DIR / "data")
    music_library_dir: Path = field(default_factory=lambda: BASE_DIR / "data" / "music")
    internal_base_url: str = "http://localhost:8000"


def load_config() -> Config:
    load_dotenv(BASE_DIR / ".env")
    base_url_value = os.getenv("BASE_URL", "http://localhost:8000")
    data_dir_value = Path(os.getenv("DATA_DIR", str(BASE_DIR / "data")))
    db_url = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./data/bot.db")
    if "sqlite" in db_url and ":memory:" not in db_url:
        # A relative sqlite path must not depend on the working directory.
        db_path = Path(db_url.split("///", 1)[-1])
        if not db_path.is_absolute():
            db_path = BASE_DIR / db_path
            scheme = db_url.split("://", 1)[0]
            db_url = f"{scheme}:///{db_path.as_posix()}"
        db_path.parent.mkdir(parents=True, exist_ok=True)
    return Config(
        discord_bot_token=os.getenv("DISCORD_BOT_TOKEN", ""),
        discord_client_id=os.getenv("DISCORD_CLIENT_ID", ""),
        discord_client_secret=os.getenv("DISCORD_CLIENT_SECRET", ""),
        discord_redirect_uri=os.getenv("DISCORD_REDIRECT_URI", "http://localhost:8000/api/auth/callback"),
        superadmin_ids=_split_ids(os.getenv("SUPERADMIN_IDS", "")),
        session_secret=os.getenv("SESSION_SECRET", "change-me"),
        base_url=base_url_value,
        database_url=db_url,
        lavalink_host=os.getenv("LAVALINK_HOST", "localhost"),
        lavalink_port=int(os.getenv("LAVALINK_PORT", "2333")),
        lavalink_password=os.getenv("LAVALINK_PASSWORD", "change-me-too"),
        lavalink_secure=os.getenv("LAVALINK_SECURE", "false").lower() == "true",
        yandex_music_token=os.getenv("YANDEX_MUSIC_TOKEN", ""),
        log_level=os.getenv("LOG_LEVEL", "INFO").upper(),
        music_library_dir=Path(os.getenv("MUSIC_LIBRARY_DIR", str(data_dir_value / "music"))),
        internal_base_url=os.getenv("INTERNAL_BASE_URL", base_url_value),
    )


def validate_config(config: Config) -> None:
    """Stop the app at startup if the config is not complete.

    Alembic calls load_config only. The app calls this function before it starts.
    """
    problems = []
    if not config.discord_bot_token:
        problems.append("DISCORD_BOT_TOKEN is not set")
    if not config.discord_client_id:
        problems.append("DISCORD_CLIENT_ID is not set")
    if not config.discord_client_secret:
        problems.append("DISCORD_CLIENT_SECRET is not set")
    if config.session_secret in ("", "change-me"):
        problems.append("SESSION_SECRET is not set (do not use the default value)")
    if problems:
        raise RuntimeError(
            "The config is not complete. Fix these problems in .env and restart:\n  - "
            + "\n  - ".join(problems)
        )
    if not config.superadmin_ids:
        logger.warning("SUPERADMIN_IDS is empty. No user gets super-admin rights in the web panel.")


def setup_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level, logging.INFO),
        format="%(asctime)s %(levelname)-8s [%(name)s] %(message)s",
    )
    logging.getLogger("discord").setLevel(logging.INFO)
    logging.getLogger("discord.gateway").setLevel(logging.INFO)
    logging.getLogger("wavelink").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
