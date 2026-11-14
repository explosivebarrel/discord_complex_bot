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


def _insp():
    return sa.inspect(op.get_bind())


def _table_exists(table: str) -> bool:
    return table in _insp().get_table_names()


def _column_exists(table: str, column: str) -> bool:
    if not _table_exists(table):
        return False
    return any(c["name"] == column for c in _insp().get_columns(table))


def _index_exists(table: str, index_name: str) -> bool:
    if not _table_exists(table):
        return False
    return any(ix["name"] == index_name for ix in _insp().get_indexes(table))


def upgrade() -> None:
    cols_to_add = [
        ('stats_access', sa.String(length=16), 'admins', False),
        ('posts_access', sa.String(length=16), 'admins', False),
        ('moderation_access', sa.String(length=16), 'admins', False),
        ('mod_log_channel_id', sa.BigInteger(), None, True),
    ]
    missing_cols = [(name, ctype, default, nullable) for name, ctype, default, nullable in cols_to_add if not _column_exists('guild_settings', name)]
    if missing_cols:
        with op.batch_alter_table('guild_settings') as batch:
            for name, ctype, default, nullable in missing_cols:
                if default is not None:
                    batch.add_column(sa.Column(name, ctype, nullable=nullable, server_default=default))
                else:
                    batch.add_column(sa.Column(name, ctype, nullable=nullable))

    if not _table_exists('mod_warnings'):
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
    if not _index_exists('mod_warnings', 'ix_mod_warnings_guild_id'):
        op.create_index('ix_mod_warnings_guild_id', 'mod_warnings', ['guild_id'])
    if not _index_exists('mod_warnings', 'ix_mod_warnings_user_id'):
        op.create_index('ix_mod_warnings_user_id', 'mod_warnings', ['user_id'])


def downgrade() -> None:
    if _index_exists('mod_warnings', 'ix_mod_warnings_user_id'):
        op.drop_index('ix_mod_warnings_user_id', table_name='mod_warnings')
    if _index_exists('mod_warnings', 'ix_mod_warnings_guild_id'):
        op.drop_index('ix_mod_warnings_guild_id', table_name='mod_warnings')
    if _table_exists('mod_warnings'):
        op.drop_table('mod_warnings')

    cols_to_drop = [name for name in ('mod_log_channel_id', 'moderation_access', 'posts_access', 'stats_access') if _column_exists('guild_settings', name)]
    if cols_to_drop:
        with op.batch_alter_table('guild_settings') as batch:
            for name in cols_to_drop:
                batch.drop_column(name)
