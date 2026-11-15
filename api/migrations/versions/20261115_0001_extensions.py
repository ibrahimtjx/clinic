"""Base extensions: btree_gist for the appointment overlap constraint (SPEC 3.6, 14).

Revision ID: 0001
Revises:
Create Date: 2026-11-15
"""
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")  # patient search (SPEC 3.9)


def downgrade() -> None:
    op.execute("DROP EXTENSION IF EXISTS pg_trgm")
    op.execute("DROP EXTENSION IF EXISTS btree_gist")
