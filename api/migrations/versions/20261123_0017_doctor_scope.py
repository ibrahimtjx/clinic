"""Doctors work with their own patients and documents; the accountant sees every calendar.

Revision ID: 0017
Revises: 0016
Create Date: 2026-11-23 10:00:00
"""

from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None

GRANTS = ("appointment.view", "appointment.view_all")


def upgrade() -> None:
    # Owner, 2026-11-23: admin, reception and the accountant see all calendars; doctors their own.
    for perm in GRANTS:
        op.execute(
            "INSERT INTO role_permissions (role_id, permission) "
            f"SELECT id, '{perm}' FROM roles WHERE key = 'cashier' ON CONFLICT DO NOTHING"
        )


def downgrade() -> None:
    for perm in GRANTS:
        op.execute(
            "DELETE FROM role_permissions WHERE permission = "
            f"'{perm}' AND role_id IN (SELECT id FROM roles WHERE key = 'cashier')"
        )
