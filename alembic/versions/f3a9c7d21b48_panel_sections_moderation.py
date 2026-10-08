"""panel section access and moderation warnings

Revision ID: f3a9c7d21b48
Revises: d4e8a1c60b52
Create Date: 2026-10-07 23:30:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f3a9c7d21b48'
down_revision: Union[str, None] = 'd4e8a1c60b52'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('guild_settings') as batch:
        batch.add_column(sa.Column('stats_access', sa.String(length=16), nullable=False, server_default='admins'))
        batch.add_column(sa.Column('posts_access', sa.String(length=16), nullable=False, server_default='admins'))
        batch.add_column(sa.Column('moderation_access', sa.String(length=16), nullable=False, server_default='admins'))
        batch.add_column(sa.Column('mod_log_channel_id', sa.BigInteger(), nullable=True))

    op.create_table(
        'mod_warnings',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('guild_id', sa.BigInteger(), nullable=False),
        sa.Column('user_id', sa.BigInteger(), nullable=False),
        sa.Column('user_name', sa.String(length=128), nullable=False),
        sa.Column('issuer_id', sa.BigInteger(), nullable=True),
        sa.Column('issuer_name', sa.String(length=128), nullable=False),
        sa.Column('reason', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_mod_warnings_guild_id', 'mod_warnings', ['guild_id'])
    op.create_index('ix_mod_warnings_user_id', 'mod_warnings', ['user_id'])


def downgrade() -> None:
    op.drop_table('mod_warnings')
    with op.batch_alter_table('guild_settings') as batch:
        batch.drop_column('mod_log_channel_id')
        batch.drop_column('moderation_access')
        batch.drop_column('posts_access')
        batch.drop_column('stats_access')
