"""track artwork cache

Revision ID: d4b6c8e0f2a4
Revises: c8f2a4d1e7b9
Create Date: 2026-11-04 10:00:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd4b6c8e0f2a4'
down_revision: Union[str, None] = 'c8f2a4d1e7b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _insp():
    return sa.inspect(op.get_bind())


def _table_exists(table: str) -> bool:
    return table in _insp().get_table_names()


def upgrade() -> None:
    if not _table_exists('track_artwork'):
        op.create_table(
            'track_artwork',
            sa.Column('key', sa.String(length=320), nullable=False),
            sa.Column('artwork', sa.String(length=512), nullable=False),
            sa.Column('updated_at', sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint('key'),
        )


def downgrade() -> None:
    if _table_exists('track_artwork'):
        op.drop_table('track_artwork')
