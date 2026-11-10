"""voice recordings

Revision ID: d2f5a8c1b7e3
Revises: a1b2c3d4e5f6
Create Date: 2026-11-11 12:00:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd2f5a8c1b7e3'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'guild_settings',
        sa.Column('recordings_access', sa.String(length=16), nullable=False, server_default='admins'),
    )
    op.create_table(
        'voice_recordings',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('guild_id', sa.BigInteger(), nullable=False),
        sa.Column('channel_id', sa.BigInteger(), nullable=False),
        sa.Column('started_by', sa.BigInteger(), nullable=False),
        sa.Column('started_at', sa.DateTime(), nullable=False),
        sa.Column('ended_at', sa.DateTime(), nullable=True),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('error', sa.String(length=500), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_voice_recordings_guild_id'), 'voice_recordings', ['guild_id'])
    op.create_table(
        'voice_recording_segments',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('recording_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.BigInteger(), nullable=False),
        sa.Column('username', sa.String(length=128), nullable=False),
        sa.Column('offset_s', sa.Float(), nullable=False),
        sa.Column('duration_s', sa.Float(), nullable=False),
        sa.Column('text', sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_voice_recording_segments_recording_id'), 'voice_recording_segments', ['recording_id'])


def downgrade() -> None:
    op.drop_index(op.f('ix_voice_recording_segments_recording_id'), table_name='voice_recording_segments')
    op.drop_table('voice_recording_segments')
    op.drop_index(op.f('ix_voice_recordings_guild_id'), table_name='voice_recordings')
    op.drop_table('voice_recordings')
    op.drop_column('guild_settings', 'recordings_access')
