"""System status per server, written by the ops container (SPEC 15.4).

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-16
"""

import sqlalchemy as sa
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "system_status",
        sa.Column("node", sa.String(length=64), nullable=False),
        sa.Column("role", sa.String(length=10), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("disk_total", sa.BigInteger(), nullable=True),
        sa.Column("disk_free", sa.BigInteger(), nullable=True),
        sa.Column("backup_total", sa.BigInteger(), nullable=True),
        sa.Column("backup_free", sa.BigInteger(), nullable=True),
        sa.Column("last_wal_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_dump_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_dump_bytes", sa.BigInteger(), nullable=True),
        sa.Column("last_dump_file", sa.String(length=200), nullable=True),
        sa.Column("last_basebackup_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("last_error_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("node"),
    )


def downgrade() -> None:
    op.drop_table("system_status")
