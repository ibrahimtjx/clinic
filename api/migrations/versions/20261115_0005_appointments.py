"""M4: appointments with a database-enforced no-overlap rule per doctor, and the waiting list.

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-15 16:16:03.231782
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "appointments",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("patient_id", sa.BigInteger(), nullable=False),
        sa.Column("doctor_id", sa.BigInteger(), nullable=False),
        sa.Column("clinic_id", sa.BigInteger(), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status_id", sa.BigInteger(), nullable=False),
        sa.Column("blocks_slot", sa.Boolean(), nullable=False),
        sa.Column("visit_type_id", sa.BigInteger(), nullable=True),
        sa.Column("service_id", sa.BigInteger(), nullable=True),
        sa.Column("plan_session_id", sa.BigInteger(), nullable=True),
        sa.Column("is_waiting_list", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("note", sa.Text(), server_default="", nullable=False),
        sa.Column("exclude_sms", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("confirmed_by", sa.BigInteger(), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancel_reason", sa.Text(), nullable=True),
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
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        postgresql.ExcludeConstraint(
            (sa.column("doctor_id"), "="),
            (sa.text("tstzrange(starts_at, ends_at)"), "&&"),
            where=sa.text("blocks_slot AND deleted_at IS NULL"),
            using="gist",
            name="ex_appointments_doctor_overlap",
        ),
        sa.CheckConstraint("ends_at > starts_at", name="ck_appointments_times"),
        sa.ForeignKeyConstraint(
            ["clinic_id"],
            ["clinics.id"],
        ),
        sa.ForeignKeyConstraint(
            ["confirmed_by"],
            ["users.id"],
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
        ),
        sa.ForeignKeyConstraint(
            ["deleted_by"],
            ["users.id"],
        ),
        sa.ForeignKeyConstraint(
            ["doctor_id"],
            ["doctors.id"],
        ),
        sa.ForeignKeyConstraint(
            ["patient_id"],
            ["patients.id"],
        ),
        sa.ForeignKeyConstraint(
            ["service_id"],
            ["services.id"],
        ),
        sa.ForeignKeyConstraint(
            ["status_id"],
            ["appointment_statuses.id"],
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["users.id"],
        ),
        sa.ForeignKeyConstraint(
            ["visit_type_id"],
            ["visit_types.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_appointments_doctor_start", "appointments", ["doctor_id", "starts_at"], unique=False
    )
    op.create_index(
        "ix_appointments_patient_start", "appointments", ["patient_id", "starts_at"], unique=False
    )
    op.create_index("ix_appointments_start", "appointments", ["starts_at"], unique=False)
    op.create_table(
        "waiting_list",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("patient_id", sa.BigInteger(), nullable=False),
        sa.Column("doctor_id", sa.BigInteger(), nullable=True),
        sa.Column("appointment_id", sa.BigInteger(), nullable=True),
        sa.Column("preferred_days", sa.String(length=20), server_default="", nullable=False),
        sa.Column("preferred_from", sa.String(length=5), nullable=True),
        sa.Column("preferred_to", sa.String(length=5), nullable=True),
        sa.Column("note", sa.Text(), server_default="", nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by", sa.BigInteger(), nullable=True),
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
            ["created_by"],
            ["users.id"],
        ),
        sa.ForeignKeyConstraint(
            ["doctor_id"],
            ["doctors.id"],
        ),
        sa.ForeignKeyConstraint(
            ["patient_id"],
            ["patients.id"],
        ),
        sa.ForeignKeyConstraint(
            ["resolved_by"],
            ["users.id"],
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_waiting_list_open",
        "waiting_list",
        ["doctor_id"],
        unique=False,
        postgresql_where=sa.text("resolved_at IS NULL"),
    )
    op.create_index(
        op.f("ix_waiting_list_patient_id"), "waiting_list", ["patient_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_waiting_list_patient_id"), table_name="waiting_list")
    op.drop_index(
        "ix_waiting_list_open",
        table_name="waiting_list",
        postgresql_where=sa.text("resolved_at IS NULL"),
    )
    op.drop_table("waiting_list")
    op.drop_index("ix_appointments_start", table_name="appointments")
    op.drop_index("ix_appointments_patient_start", table_name="appointments")
    op.drop_index("ix_appointments_doctor_start", table_name="appointments")
    op.drop_table("appointments")
