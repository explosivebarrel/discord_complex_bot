"""personal user playlists

Revision ID: c5f1d8e97a24
Revises: f3a9c7d21b48
Create Date: 2026-10-09 21:00:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c5f1d8e97a24'
down_revision: Union[str, None] = 'f3a9c7d21b48'
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
    if not _table_exists('user_playlists'):
        op.create_table(
            'user_playlists',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('user_id', sa.BigInteger(), nullable=False),
            sa.Column('name', sa.String(length=100), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('user_id', 'name', name='uq_user_playlist_name'),
        )
    if not _index_exists('user_playlists', 'ix_user_playlists_user_id'):
        op.create_index('ix_user_playlists_user_id', 'user_playlists', ['user_id'])

    if not _table_exists('user_playlist_tracks'):
        op.create_table(
            'user_playlist_tracks',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('playlist_id', sa.Integer(), nullable=False),
            sa.Column('position', sa.Integer(), nullable=False),
            sa.Column('title', sa.String(length=256), nullable=False),
            sa.Column('author', sa.String(length=256), nullable=False),
            sa.Column('uri', sa.Text(), nullable=False),
            sa.Column('source', sa.String(length=32), nullable=False),
            sa.Column('length_ms', sa.Integer(), nullable=False),
            sa.Column('artwork', sa.String(length=512), nullable=True),
            sa.PrimaryKeyConstraint('id'),
        )
    if not _index_exists('user_playlist_tracks', 'ix_user_playlist_tracks_playlist_id'):
        op.create_index('ix_user_playlist_tracks_playlist_id', 'user_playlist_tracks', ['playlist_id'])


def downgrade() -> None:
    if _index_exists('user_playlist_tracks', 'ix_user_playlist_tracks_playlist_id'):
        op.drop_index('ix_user_playlist_tracks_playlist_id', table_name='user_playlist_tracks')
    if _table_exists('user_playlist_tracks'):
        op.drop_table('user_playlist_tracks')
    if _index_exists('user_playlists', 'ix_user_playlists_user_id'):
        op.drop_index('ix_user_playlists_user_id', table_name='user_playlists')
    if _table_exists('user_playlists'):
        op.drop_table('user_playlists')
