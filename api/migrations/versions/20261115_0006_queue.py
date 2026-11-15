"""M5: patient queue entries with a daily queue number.

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-15 16:36:20.641192
"""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "queue_entries",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("queue_no", sa.Integer(), nullable=False),
        sa.Column("patient_id", sa.BigInteger(), nullable=False),
        sa.Column("doctor_id", sa.BigInteger(), nullable=False),
        sa.Column("clinic_id", sa.BigInteger(), nullable=True),
        sa.Column("appointment_id", sa.BigInteger(), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("received_by", sa.BigInteger(), nullable=False),
        sa.Column("called_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("called_by", sa.BigInteger(), nullable=True),
        sa.Column("entered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("entered_by", sa.BigInteger(), nullable=True),
        sa.Column("exited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("exited_by", sa.BigInteger(), nullable=True),
        sa.Column("postponed", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("note", sa.Text(), server_default="", nullable=False),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.ForeignKeyConstraint(
            ["appointment_id"],
            ["appointments.id"],
        ),
        sa.ForeignKeyConstraint(
            ["called_by"],
            ["users.id"],
        ),
        sa.ForeignKeyConstraint(
            ["clinic_id"],
            ["clinics.id"],
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
        ),
        sa.ForeignKeyConstraint(
            ["doctor_id"],
            ["doctors.id"],
        ),
        sa.ForeignKeyConstraint(
            ["entered_by"],
            ["users.id"],
        ),
        sa.ForeignKeyConstraint(
            ["exited_by"],
            ["users.id"],
        ),
        sa.ForeignKeyConstraint(
            ["patient_id"],
            ["patients.id"],
        ),
        sa.ForeignKeyConstraint(
            ["received_by"],
            ["users.id"],
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("day", "queue_no", name="uq_queue_day_no"),
    )
    op.create_index("ix_queue_day_doctor", "queue_entries", ["day", "doctor_id"], unique=False)
    op.create_index(
        op.f("ix_queue_entries_appointment_id"), "queue_entries", ["appointment_id"], unique=False
    )
    op.create_index(
        op.f("ix_queue_entries_patient_id"), "queue_entries", ["patient_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_queue_entries_patient_id"), table_name="queue_entries")
    op.drop_index(op.f("ix_queue_entries_appointment_id"), table_name="queue_entries")
    op.drop_index("ix_queue_day_doctor", table_name="queue_entries")
    op.drop_table("queue_entries")
