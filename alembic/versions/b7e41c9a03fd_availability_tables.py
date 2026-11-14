"""availability samples and hourly rollups

Revision ID: b7e41c9a03fd
Revises: e9a4b7c2d5f1
Create Date: 2026-10-30 16:00:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b7e41c9a03fd'
down_revision: Union[str, None] = 'e9a4b7c2d5f1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_SERVICES = (
    'discord_api', 'discord_gateway', 'lavalink', 'youtube',
    'yandex', 'vk', 'radio', 'archive',
)


def _insp():
    return sa.inspect(op.get_bind())


def _table_exists(table: str) -> bool:
    return table in _insp().get_table_names()


def _index_exists(table: str, index_name: str) -> bool:
    if not _table_exists(table):
        return False
    return any(ix["name"] == index_name for ix in _insp().get_indexes(table))


def upgrade() -> None:
    if not _table_exists('availability_samples'):
        op.create_table(
            'availability_samples',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('ts', sa.DateTime(), nullable=False),
            *[sa.Column(name, sa.SmallInteger(), nullable=True) for name in _SERVICES],
            sa.Column('details', sa.Text(), nullable=False),
            sa.PrimaryKeyConstraint('id'),
        )
    if not _index_exists('availability_samples', 'ix_availability_samples_ts'):
        op.create_index('ix_availability_samples_ts', 'availability_samples', ['ts'])

    if not _table_exists('availability_rollups'):
        op.create_table(
            'availability_rollups',
            sa.Column('hour_start', sa.DateTime(), nullable=False),
            sa.Column('service', sa.String(length=24), nullable=False),
            sa.Column('up', sa.Integer(), nullable=False),
            sa.Column('degraded', sa.Integer(), nullable=False),
            sa.Column('down', sa.Integer(), nullable=False),
            sa.Column('na', sa.Integer(), nullable=False),
            sa.PrimaryKeyConstraint('hour_start', 'service'),
        )


def downgrade() -> None:
    if _table_exists('availability_rollups'):
        op.drop_table('availability_rollups')
    if _index_exists('availability_samples', 'ix_availability_samples_ts'):
        op.drop_index('ix_availability_samples_ts', table_name='availability_samples')
    if _table_exists('availability_samples'):
        op.drop_table('availability_samples')
