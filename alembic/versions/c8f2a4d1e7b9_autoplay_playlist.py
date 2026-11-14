"""guild autoplay playlist source

Revision ID: c8f2a4d1e7b9
Revises: b7e41c9a03fd
Create Date: 2026-11-03 12:00:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c8f2a4d1e7b9'
down_revision: Union[str, None] = 'b7e41c9a03fd'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _insp():
    return sa.inspect(op.get_bind())


def _column_exists(table: str, column: str) -> bool:
    insp = _insp()
    if table not in insp.get_table_names():
        return False
    return any(c["name"] == column for c in insp.get_columns(table))


def upgrade() -> None:
    if not _column_exists('guild_settings', 'autoplay_playlist_id'):
        with op.batch_alter_table('guild_settings') as batch:
            batch.add_column(sa.Column('autoplay_playlist_id', sa.BigInteger(), nullable=True))


def downgrade() -> None:
    if _column_exists('guild_settings', 'autoplay_playlist_id'):
        with op.batch_alter_table('guild_settings') as batch:
            batch.drop_column('autoplay_playlist_id')
