"""panel notifications

Revision ID: f3b8d2a6e1c7
Revises: e7a9f3b1c5d2
Create Date: 2026-11-04 10:00:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f3b8d2a6e1c7'
down_revision: Union[str, None] = 'e7a9f3b1c5d2'
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
    if not _table_exists('notifications'):
        op.create_table(
            'notifications',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('guild_id', sa.BigInteger(), nullable=True),
            sa.Column('category', sa.String(length=16), nullable=False),
            sa.Column('title', sa.String(length=120), nullable=False),
            sa.Column('body', sa.String(length=500), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint('id'),
        )
    if not _index_exists('notifications', 'ix_notifications_guild_id'):
        op.create_index(op.f('ix_notifications_guild_id'), 'notifications', ['guild_id'])
    if not _index_exists('notifications', 'ix_notifications_created_at'):
        op.create_index(op.f('ix_notifications_created_at'), 'notifications', ['created_at'])


def downgrade() -> None:
    if _index_exists('notifications', 'ix_notifications_created_at'):
        op.drop_index(op.f('ix_notifications_created_at'), table_name='notifications')
    if _index_exists('notifications', 'ix_notifications_guild_id'):
        op.drop_index(op.f('ix_notifications_guild_id'), table_name='notifications')
    if _table_exists('notifications'):
        op.drop_table('notifications')
