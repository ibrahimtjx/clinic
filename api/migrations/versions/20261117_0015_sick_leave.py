"""Sick leave certificates: a medical report kind with the days off.

Revision ID: 0015
Revises: 0014
Create Date: 2026-11-17 12:00:00
"""

import sqlalchemy as sa
from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("medical_reports", sa.Column("leave_from", sa.Date(), nullable=True))
    op.add_column("medical_reports", sa.Column("leave_to", sa.Date(), nullable=True))
    op.drop_constraint("ck_report_kind", "medical_reports", type_="check")
    op.create_check_constraint(
        "ck_report_kind",
        "medical_reports",
        "kind IN ('report','referral','attendance','sick_leave')",
    )
    op.create_check_constraint(
        "ck_report_leave_dates",
        "medical_reports",
        "kind <> 'sick_leave' OR (leave_from IS NOT NULL AND leave_to >= leave_from)",
    )


def downgrade() -> None:
    op.execute("DELETE FROM medical_reports WHERE kind = 'sick_leave'")
    op.drop_constraint("ck_report_leave_dates", "medical_reports", type_="check")
    op.drop_constraint("ck_report_kind", "medical_reports", type_="check")
    op.create_check_constraint(
        "ck_report_kind", "medical_reports", "kind IN ('report','referral','attendance')"
    )
    op.drop_column("medical_reports", "leave_to")
    op.drop_column("medical_reports", "leave_from")
