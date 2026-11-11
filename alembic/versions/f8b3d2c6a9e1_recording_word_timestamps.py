"""recording word timestamps

Revision ID: f8b3d2c6a9e1
Revises: d2f5a8c1b7e3
Create Date: 2026-11-11 14:00:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f8b3d2c6a9e1'
down_revision: Union[str, None] = 'd2f5a8c1b7e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(insp, table: str, column: str) -> bool:
    return any(c["name"] == column for c in insp.get_columns(table))


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if not _has_column(insp, "voice_recording_segments", "words"):
        op.add_column(
            'voice_recording_segments',
            sa.Column('words', sa.Text(), nullable=False, server_default='[]'),
        )


def downgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if _has_column(insp, "voice_recording_segments", "words"):
        op.drop_column('voice_recording_segments', 'words')
