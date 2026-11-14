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


def _insp():
    return sa.inspect(op.get_bind())


def _table_exists(table: str) -> bool:
    return table in _insp().get_table_names()


def _index_exists(table: str, index_name: str) -> bool:
    if not _table_exists(table):
        return False
    return any(ix["name"] == index_name for ix in _insp().get_indexes(table))


def upgrade() -> None:
    if not _table_exists('search_cache'):
        op.create_table(
            'search_cache',
            sa.Column('key', sa.String(length=320), nullable=False),
            sa.Column('payload', sa.Text(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint('key'),
        )
    if not _index_exists('search_cache', 'ix_search_cache_created_at'):
        op.create_index(op.f('ix_search_cache_created_at'), 'search_cache', ['created_at'])


def downgrade() -> None:
    if _index_exists('search_cache', 'ix_search_cache_created_at'):
        op.drop_index(op.f('ix_search_cache_created_at'), table_name='search_cache')
    if _table_exists('search_cache'):
        op.drop_table('search_cache')
