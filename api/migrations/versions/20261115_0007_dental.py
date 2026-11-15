"""M6: dental visits (teeth as FDI array), addenda, tooth findings.

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-15 20:19:05.048342
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "dental_visits",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("patient_id", sa.BigInteger(), nullable=False),
        sa.Column("doctor_id", sa.BigInteger(), nullable=False),
        sa.Column("department_id", sa.BigInteger(), nullable=True),
        sa.Column("appointment_id", sa.BigInteger(), nullable=True),
        sa.Column("visit_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "teeth", postgresql.ARRAY(sa.SmallInteger()), server_default="{}", nullable=False
        ),
        sa.Column("chief_complaint", sa.Text(), server_default="", nullable=False),
        sa.Column("diagnosis", sa.Text(), server_default="", nullable=False),
        sa.Column("icd10", sa.String(length=10), nullable=True),
        sa.Column("procedure", sa.Text(), server_default="", nullable=False),
        sa.Column("treatment_note", sa.Text(), server_default="", nullable=False),
        sa.Column("preventive_advice", sa.Text(), server_default="", nullable=False),
        sa.Column("complications", sa.Text(), server_default="", nullable=False),
        sa.Column("patient_education", sa.Text(), server_default="", nullable=False),
        sa.Column("next_visit", sa.Text(), server_default="", nullable=False),
        sa.Column("note", sa.Text(), server_default="", nullable=False),
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
        sa.ForeignKeyConstraint(
            ["appointment_id"],
            ["appointments.id"],
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
            ["department_id"],
            ["departments.id"],
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
            ["updated_by"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_dental_visits_patient_at", "dental_visits", ["patient_id", "visit_at"], unique=False
    )
    op.create_index(
        "ix_dental_visits_teeth", "dental_visits", ["teeth"], unique=False, postgresql_using="gin"
    )
    op.create_table(
        "dental_visit_addenda",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("visit_id", sa.BigInteger(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("created_by", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
        ),
        sa.ForeignKeyConstraint(
            ["visit_id"],
            ["dental_visits.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_dental_visit_addenda_visit_id"), "dental_visit_addenda", ["visit_id"], unique=False
    )
    op.create_table(
        "tooth_findings",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("patient_id", sa.BigInteger(), nullable=False),
        sa.Column("tooth_fdi", sa.SmallInteger(), nullable=False),
        sa.Column("category", sa.String(length=20), nullable=False),
        sa.Column("description", sa.Text(), server_default="", nullable=False),
        sa.Column("visit_id", sa.BigInteger(), nullable=True),
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
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.CheckConstraint(
            "category IN ('restoration','extraction','endodontic','prosthetic','orthodontic','other')",
            name="ck_finding_category",
        ),
        sa.CheckConstraint(
            "(tooth_fdi BETWEEN 11 AND 48 AND mod(tooth_fdi, 10) BETWEEN 1 AND 8) OR (tooth_fdi BETWEEN 51 AND 85 AND mod(tooth_fdi, 10) BETWEEN 1 AND 5)",
            name="ck_finding_tooth",
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
            ["patient_id"],
            ["patients.id"],
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["users.id"],
        ),
        sa.ForeignKeyConstraint(
            ["visit_id"],
            ["dental_visits.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_findings_patient_tooth", "tooth_findings", ["patient_id", "tooth_fdi"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_findings_patient_tooth", table_name="tooth_findings")
    op.drop_table("tooth_findings")
    op.drop_index(op.f("ix_dental_visit_addenda_visit_id"), table_name="dental_visit_addenda")
    op.drop_table("dental_visit_addenda")
    op.drop_index("ix_dental_visits_teeth", table_name="dental_visits", postgresql_using="gin")
    op.drop_index("ix_dental_visits_patient_at", table_name="dental_visits")
    op.drop_table("dental_visits")
