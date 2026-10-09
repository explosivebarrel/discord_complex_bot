"""music snapshots for queue persistence

Revision ID: e9a4b7c2d5f1
Revises: c5f1d8e97a24
Create Date: 2026-10-09 22:30:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e9a4b7c2d5f1'
down_revision: Union[str, None] = 'c5f1d8e97a24'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'music_snapshots',
        sa.Column('guild_id', sa.BigInteger(), nullable=False),
        sa.Column('queue', sa.Text(), nullable=False),
        sa.Column('played', sa.Text(), nullable=False),
        sa.Column('repeat', sa.String(length=8), nullable=False),
        sa.Column('saved_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('guild_id'),
    )


def downgrade() -> None:
    op.drop_table('music_snapshots')
