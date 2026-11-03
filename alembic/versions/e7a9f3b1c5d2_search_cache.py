"""search cache table

Revision ID: e7a9f3b1c5d2
Revises: d4b6c8e0f2a4
Create Date: 2026-11-04 12:00:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e7a9f3b1c5d2'
down_revision: Union[str, None] = 'd4b6c8e0f2a4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'search_cache',
        sa.Column('key', sa.String(length=320), nullable=False),
        sa.Column('payload', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('key'),
    )
    op.create_index(op.f('ix_search_cache_created_at'), 'search_cache', ['created_at'])


def downgrade() -> None:
    op.drop_index(op.f('ix_search_cache_created_at'), table_name='search_cache')
    op.drop_table('search_cache')
