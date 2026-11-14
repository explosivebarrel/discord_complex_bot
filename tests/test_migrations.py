from __future__ import annotations

from pathlib import Path
from alembic.config import Config as AlembicConfig
from alembic import command
import sqlalchemy as sa
from app.core.db.models import Base


def test_migrations_fresh_db_idempotency(tmp_path: Path) -> None:
    db_path = tmp_path / "fresh.db"
    cfg = AlembicConfig("alembic.ini")
    cfg.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")

    # Upgrade to head from scratch
    command.upgrade(cfg, "head")

    # Re-running upgrade head must succeed with zero errors
    command.upgrade(cfg, "head")

    # Downgrade to base and upgrade back to head
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")


def test_migrations_on_precreated_tables(tmp_path: Path) -> None:
    db_path = tmp_path / "precreated.db"
    engine = sa.create_engine(f"sqlite:///{db_path}")
    Base.metadata.create_all(engine)
    engine.dispose()

    cfg = AlembicConfig("alembic.ini")
    cfg.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")

    # Upgrade on already created tables must succeed without crashing
    command.upgrade(cfg, "head")
