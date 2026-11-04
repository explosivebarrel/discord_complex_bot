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


def upgrade() -> None:
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
    op.create_index(op.f('ix_notifications_guild_id'), 'notifications', ['guild_id'])
    op.create_index(op.f('ix_notifications_created_at'), 'notifications', ['created_at'])


def downgrade() -> None:
    op.drop_index(op.f('ix_notifications_created_at'), table_name='notifications')
    op.drop_index(op.f('ix_notifications_guild_id'), table_name='notifications')
    op.drop_table('notifications')
