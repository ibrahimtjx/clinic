"""Doctors see their own appointments; doctors get their own statement.

New permissions: appointment.view_all (the whole clinic's calendar and queue) for every role that
could see appointments, except doctors; report.own (a doctor's own statement) for doctors.

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-17 11:00:00
"""

import sqlalchemy as sa
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text(
            "INSERT INTO role_permissions (role_id, permission) "
            "SELECT rp.role_id, 'appointment.view_all' FROM role_permissions rp "
            "JOIN roles r ON r.id = rp.role_id "
            "WHERE rp.permission = 'appointment.view' AND r.key <> 'doctor' ON CONFLICT DO NOTHING"
        )
    )
    conn.execute(
        sa.text(
            "INSERT INTO role_permissions (role_id, permission) "
            "SELECT id, 'report.own' FROM roles WHERE key IN ('doctor', 'admin') "
            "ON CONFLICT DO NOTHING"
        )
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM role_permissions WHERE permission IN ('appointment.view_all', 'report.own')"
    )
