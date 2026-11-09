"""player qol batch: sleep/rejoin snapshots, vote-skip, np channel, player perms, lyrics cache

Revision ID: a1b2c3d4e5f6
Revises: c5d9e4a7b1f3
Create Date: 2026-11-09 12:00:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = 'c5d9e4a7b1f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(table: str) -> set[str]:
        return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    # Idempotent by design: create_all already materialized the newer tables
    # on live databases that never ran alembic (see the note in env.py).
    if "voice_channel_id" not in _columns("music_snapshots"):
        op.add_column('music_snapshots', sa.Column('voice_channel_id', sa.BigInteger(), nullable=True))
    if "effect" not in _columns("music_snapshots"):
        op.add_column('music_snapshots', sa.Column('effect', sa.String(length=32), nullable=True))
    if "vote_skip" not in _columns("guild_settings"):
        op.add_column('guild_settings', sa.Column('vote_skip', sa.Boolean(), nullable=False, server_default=sa.false()))
    if "np_channel_id" not in _columns("guild_settings"):
        op.add_column('guild_settings', sa.Column('np_channel_id', sa.BigInteger(), nullable=True))
    if "np_message_id" not in _columns("guild_settings"):
        op.add_column('guild_settings', sa.Column('np_message_id', sa.BigInteger(), nullable=True))
    for column in ('volume_access', 'effects_access', 'queue_clear_access', 'seek_access'):
        if column not in _columns("guild_settings"):
            op.add_column(
                'guild_settings',
                sa.Column(column, sa.String(length=16), nullable=False, server_default='members'),
            )
    if 'lyrics_cache' not in sa.inspect(op.get_bind()).get_table_names():
        op.create_table(
            'lyrics_cache',
            sa.Column('key', sa.String(length=320), nullable=False),
            sa.Column('data', sa.Text(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint('key'),
        )


def downgrade() -> None:
    op.drop_table('lyrics_cache')
    for column in ('volume_access', 'effects_access', 'queue_clear_access', 'seek_access',
                   'np_message_id', 'np_channel_id', 'vote_skip'):
        op.drop_column('guild_settings', column)
    op.drop_column('music_snapshots', 'effect')
    op.drop_column('music_snapshots', 'voice_channel_id')
