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


def upgrade() -> None:
    op.create_table(
        'availability_samples',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('ts', sa.DateTime(), nullable=False),
        *[sa.Column(name, sa.SmallInteger(), nullable=True) for name in _SERVICES],
        sa.Column('details', sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_availability_samples_ts', 'availability_samples', ['ts'])
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
    op.drop_table('availability_rollups')
    op.drop_index('ix_availability_samples_ts', table_name='availability_samples')
    op.drop_table('availability_samples')
