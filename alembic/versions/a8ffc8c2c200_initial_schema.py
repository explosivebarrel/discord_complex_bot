"""initial schema

Revision ID: a8ffc8c2c200
Revises: 
Create Date: 2026-10-06 23:42:22.140507

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a8ffc8c2c200'
down_revision: Union[str, None] = None
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
    if not _table_exists('audit_log'):
        op.create_table(
            'audit_log',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('guild_id', sa.BigInteger(), nullable=True),
            sa.Column('actor_id', sa.BigInteger(), nullable=True),
            sa.Column('actor_kind', sa.String(length=16), nullable=False),
            sa.Column('action', sa.String(length=64), nullable=False),
            sa.Column('details', sa.Text(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint('id'),
        )
    if not _index_exists('audit_log', 'ix_audit_log_created_at'):
        op.create_index('ix_audit_log_created_at', 'audit_log', ['created_at'], unique=False)
    if not _index_exists('audit_log', 'ix_audit_log_guild_id'):
        op.create_index('ix_audit_log_guild_id', 'audit_log', ['guild_id'], unique=False)

    if not _table_exists('guild_admins'):
        op.create_table(
            'guild_admins',
            sa.Column('guild_id', sa.BigInteger(), nullable=False),
            sa.Column('discord_id', sa.BigInteger(), nullable=False),
            sa.Column('added_by', sa.BigInteger(), nullable=True),
            sa.Column('added_at', sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint('guild_id', 'discord_id'),
        )

    if not _table_exists('guild_settings'):
        op.create_table(
            'guild_settings',
            sa.Column('guild_id', sa.BigInteger(), nullable=False),
            sa.Column('name', sa.String(length=128), nullable=False),
            sa.Column('default_voice_channel_id', sa.BigInteger(), nullable=True),
            sa.Column('admin_role_ids', sa.Text(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('updated_at', sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint('guild_id'),
        )

    if not _table_exists('web_sessions'):
        op.create_table(
            'web_sessions',
            sa.Column('id', sa.String(length=64), nullable=False),
            sa.Column('discord_id', sa.BigInteger(), nullable=False),
            sa.Column('username', sa.String(length=128), nullable=False),
            sa.Column('global_name', sa.String(length=128), nullable=False),
            sa.Column('avatar', sa.String(length=256), nullable=True),
            sa.Column('access_token', sa.String(length=256), nullable=False),
            sa.Column('refresh_token', sa.String(length=256), nullable=False),
            sa.Column('expires_at', sa.DateTime(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('revoked', sa.Boolean(), nullable=False),
            sa.PrimaryKeyConstraint('id'),
        )
    if not _index_exists('web_sessions', 'ix_web_sessions_discord_id'):
        op.create_index('ix_web_sessions_discord_id', 'web_sessions', ['discord_id'], unique=False)


def downgrade() -> None:
    if _index_exists('web_sessions', 'ix_web_sessions_discord_id'):
        op.drop_index('ix_web_sessions_discord_id', table_name='web_sessions')
    if _table_exists('web_sessions'):
        op.drop_table('web_sessions')
    if _table_exists('guild_settings'):
        op.drop_table('guild_settings')
    if _table_exists('guild_admins'):
        op.drop_table('guild_admins')
    if _index_exists('audit_log', 'ix_audit_log_guild_id'):
        op.drop_index('ix_audit_log_guild_id', table_name='audit_log')
    if _index_exists('audit_log', 'ix_audit_log_created_at'):
        op.drop_index('ix_audit_log_created_at', table_name='audit_log')
    if _table_exists('audit_log'):
        op.drop_table('audit_log')
