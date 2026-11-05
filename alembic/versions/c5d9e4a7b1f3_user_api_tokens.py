"""user api tokens table

Revision ID: c5d9e4a7b1f3
Revises: f3b8d2a6e1c7
Create Date: 2026-11-05 12:00:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c5d9e4a7b1f3'
down_revision: Union[str, None] = 'f3b8d2a6e1c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'user_api_tokens',
        sa.Column('id', sa.String(length=64), nullable=False),
        sa.Column('discord_id', sa.BigInteger(), nullable=False),
        sa.Column('username', sa.String(length=128), nullable=False),
        sa.Column('global_name', sa.String(length=128), nullable=False),
        sa.Column('label', sa.String(length=128), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('last_used_at', sa.DateTime(), nullable=True),
        sa.Column('revoked', sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_user_api_tokens_discord_id'), 'user_api_tokens', ['discord_id'])


def downgrade() -> None:
    op.drop_index(op.f('ix_user_api_tokens_discord_id'), table_name='user_api_tokens')
    op.drop_table('user_api_tokens')
