"""play history, favorites and autoplay settings

Revision ID: d4e8a1c60b52
Revises: bdc04237c07f
Create Date: 2026-10-07 15:40:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd4e8a1c60b52'
down_revision: Union[str, None] = 'bdc04237c07f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'play_history',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('guild_id', sa.BigInteger(), nullable=False),
        sa.Column('title', sa.String(length=256), nullable=False),
        sa.Column('author', sa.String(length=256), nullable=False),
        sa.Column('uri', sa.Text(), nullable=False),
        sa.Column('source', sa.String(length=32), nullable=False),
        sa.Column('requested_by_id', sa.BigInteger(), nullable=True),
        sa.Column('requested_by_name', sa.String(length=128), nullable=False),
        sa.Column('length_ms', sa.Integer(), nullable=False),
        sa.Column('played_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_play_history_guild_id', 'play_history', ['guild_id'])
    op.create_index('ix_play_history_played_at', 'play_history', ['played_at'])

    op.create_table(
        'favorite_tracks',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.BigInteger(), nullable=False),
        sa.Column('title', sa.String(length=256), nullable=False),
        sa.Column('author', sa.String(length=256), nullable=False),
        sa.Column('uri', sa.Text(), nullable=False),
        sa.Column('source', sa.String(length=32), nullable=False),
        sa.Column('length_ms', sa.Integer(), nullable=False),
        sa.Column('artwork', sa.String(length=512), nullable=True),
        sa.Column('added_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'uri', name='uq_favorite_user_uri'),
    )
    op.create_index('ix_favorite_tracks_user_id', 'favorite_tracks', ['user_id'])

    # SQLite needs batch mode for ALTER TABLE ADD COLUMN.
    with op.batch_alter_table('guild_settings') as batch:
        batch.add_column(sa.Column('autoplay_enabled', sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column('autoplay_query', sa.String(length=128), nullable=False, server_default=''))


def downgrade() -> None:
    with op.batch_alter_table('guild_settings') as batch:
        batch.drop_column('autoplay_query')
        batch.drop_column('autoplay_enabled')
    op.drop_index('ix_favorite_tracks_user_id', table_name='favorite_tracks')
    op.drop_table('favorite_tracks')
    op.drop_index('ix_play_history_played_at', table_name='play_history')
    op.drop_index('ix_play_history_guild_id', table_name='play_history')
    op.drop_table('play_history')
