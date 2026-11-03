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


def upgrade() -> None:
    with op.batch_alter_table('guild_settings') as batch:
        batch.add_column(sa.Column('autoplay_playlist_id', sa.BigInteger(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('guild_settings') as batch:
        batch.drop_column('autoplay_playlist_id')
