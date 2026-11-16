"""M7: insurance classes, treatment plans (options, sessions, installments), quotations,
payment orders, draft lines; services.is_consultation; patient_insurance.class_id.

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-15 20:45:26.796193
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "insurance_classes",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("company_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column(
            "patient_share_pct",
            sa.Numeric(precision=5, scale=2),
            server_default="0",
            nullable=False,
        ),
        sa.Column(
            "max_patient_share_per_invoice", sa.Numeric(precision=12, scale=2), nullable=True
        ),
        sa.Column("consultation_max_covered", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("daily_limit", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column(
            "excluded_service_ids",
            postgresql.ARRAY(sa.BigInteger()),
            server_default="{}",
            nullable=False,
        ),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
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
        sa.CheckConstraint("patient_share_pct BETWEEN 0 AND 100", name="ck_ins_class_pct"),
        sa.ForeignKeyConstraint(
            ["company_id"],
            ["insurance_companies.id"],
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
            ["updated_by"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_insurance_classes_company_id"), "insurance_classes", ["company_id"], unique=False
    )
    op.create_table(
        "draft_lines",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("parent_type", sa.String(length=20), nullable=False),
        sa.Column("parent_id", sa.BigInteger(), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("service_id", sa.BigInteger(), nullable=True),
        sa.Column("description_ar", sa.Text(), nullable=False),
        sa.Column("description_en", sa.Text(), server_default="", nullable=False),
        sa.Column("price", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("qty", sa.Numeric(precision=8, scale=2), server_default="1", nullable=False),
        sa.Column(
            "discount_amount", sa.Numeric(precision=12, scale=2), server_default="0", nullable=False
        ),
        sa.Column(
            "discount_pct", sa.Numeric(precision=5, scale=2), server_default="0", nullable=False
        ),
        sa.Column("gross", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("discount", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("net", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("vat_rate", sa.Numeric(precision=5, scale=2), nullable=False),
        sa.Column("vat_amount", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("line_total", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("patient_share", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("insurance_share", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column(
            "teeth", postgresql.ARRAY(sa.SmallInteger()), server_default="{}", nullable=False
        ),
        sa.Column("price_overridden", sa.Boolean(), server_default="false", nullable=False),
        sa.CheckConstraint("parent_type IN ('quotation','payment_order')", name="ck_draft_parent"),
        sa.CheckConstraint("qty > 0 AND price >= 0", name="ck_draft_amounts"),
        sa.ForeignKeyConstraint(
            ["service_id"],
            ["services.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_draft_lines_parent", "draft_lines", ["parent_type", "parent_id"], unique=False
    )
    op.create_table(
        "treatment_plans",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("patient_id", sa.BigInteger(), nullable=False),
        sa.Column("doctor_id", sa.BigInteger(), nullable=False),
        sa.Column("department_id", sa.BigInteger(), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("status", sa.String(length=20), server_default="draft", nullable=False),
        sa.Column(
            "total_price", sa.Numeric(precision=12, scale=2), server_default="0", nullable=False
        ),
        sa.Column(
            "discount", sa.Numeric(precision=12, scale=2), server_default="0", nullable=False
        ),
        sa.Column("accepted_option_id", sa.BigInteger(), nullable=True),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), server_default="", nullable=False),
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
        sa.CheckConstraint(
            "status IN ('draft','proposed','accepted','in_progress','completed','cancelled')",
            name="ck_plan_status",
        ),
        sa.CheckConstraint("discount >= 0 AND discount <= total_price", name="ck_plan_discount"),
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
        op.f("ix_treatment_plans_patient_id"), "treatment_plans", ["patient_id"], unique=False
    )
    op.create_table(
        "quotations",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("quotation_no", sa.String(length=30), nullable=False),
        sa.Column("status", sa.String(length=20), server_default="draft", nullable=False),
        sa.Column("valid_until", sa.Date(), nullable=True),
        sa.Column("patient_id", sa.BigInteger(), nullable=False),
        sa.Column("doctor_id", sa.BigInteger(), nullable=True),
        sa.Column("clinic_id", sa.BigInteger(), nullable=True),
        sa.Column("plan_id", sa.BigInteger(), nullable=True),
        sa.Column("notes", sa.Text(), server_default="", nullable=False),
        sa.Column("insurance", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("saudi", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("gross", sa.Numeric(precision=12, scale=2), server_default="0", nullable=False),
        sa.Column(
            "discount", sa.Numeric(precision=12, scale=2), server_default="0", nullable=False
        ),
        sa.Column("net", sa.Numeric(precision=12, scale=2), server_default="0", nullable=False),
        sa.Column("vat", sa.Numeric(precision=12, scale=2), server_default="0", nullable=False),
        sa.Column("total", sa.Numeric(precision=12, scale=2), server_default="0", nullable=False),
        sa.Column(
            "insurance_share", sa.Numeric(precision=12, scale=2), server_default="0", nullable=False
        ),
        sa.Column(
            "patient_share", sa.Numeric(precision=12, scale=2), server_default="0", nullable=False
        ),
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
        sa.CheckConstraint(
            "status IN ('draft','sent','accepted','converted','expired','cancelled')",
            name="ck_quotation_status",
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
            ["plan_id"],
            ["treatment_plans.id"],
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("quotation_no"),
    )
    op.create_index(op.f("ix_quotations_patient_id"), "quotations", ["patient_id"], unique=False)
    op.create_table(
        "treatment_plan_installments",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("plan_id", sa.BigInteger(), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column(
            "paid_amount", sa.Numeric(precision=12, scale=2), server_default="0", nullable=False
        ),
        sa.CheckConstraint(
            "amount > 0 AND paid_amount >= 0 AND paid_amount <= amount",
            name="ck_installment_amounts",
        ),
        sa.ForeignKeyConstraint(["plan_id"], ["treatment_plans.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_treatment_plan_installments_plan_id"),
        "treatment_plan_installments",
        ["plan_id"],
        unique=False,
    )
    op.create_table(
        "treatment_plan_options",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("plan_id", sa.BigInteger(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("price", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("description", sa.Text(), server_default="", nullable=False),
        sa.ForeignKeyConstraint(["plan_id"], ["treatment_plans.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_treatment_plan_options_plan_id"),
        "treatment_plan_options",
        ["plan_id"],
        unique=False,
    )
    op.create_table(
        "treatment_plan_sessions",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("plan_id", sa.BigInteger(), nullable=False),
        sa.Column("seq", sa.SmallInteger(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("service_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "teeth", postgresql.ARRAY(sa.SmallInteger()), server_default="{}", nullable=False
        ),
        sa.Column(
            "price_share", sa.Numeric(precision=12, scale=2), server_default="0", nullable=False
        ),
        sa.Column("status", sa.String(length=10), server_default="planned", nullable=False),
        sa.CheckConstraint("status IN ('planned','booked','done')", name="ck_session_status"),
        sa.ForeignKeyConstraint(["plan_id"], ["treatment_plans.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["service_id"],
            ["services.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_treatment_plan_sessions_plan_id"),
        "treatment_plan_sessions",
        ["plan_id"],
        unique=False,
    )
    op.create_table(
        "payment_orders",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("order_no", sa.String(length=30), nullable=False),
        sa.Column("status", sa.String(length=20), server_default="draft", nullable=False),
        sa.Column("quotation_id", sa.BigInteger(), nullable=True),
        sa.Column("installment_id", sa.BigInteger(), nullable=True),
        sa.Column("reception_note", sa.Text(), server_default="", nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sent_by", sa.BigInteger(), nullable=True),
        sa.Column("patient_id", sa.BigInteger(), nullable=False),
        sa.Column("doctor_id", sa.BigInteger(), nullable=True),
        sa.Column("clinic_id", sa.BigInteger(), nullable=True),
        sa.Column("plan_id", sa.BigInteger(), nullable=True),
        sa.Column("notes", sa.Text(), server_default="", nullable=False),
        sa.Column("insurance", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("saudi", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("gross", sa.Numeric(precision=12, scale=2), server_default="0", nullable=False),
        sa.Column(
            "discount", sa.Numeric(precision=12, scale=2), server_default="0", nullable=False
        ),
        sa.Column("net", sa.Numeric(precision=12, scale=2), server_default="0", nullable=False),
        sa.Column("vat", sa.Numeric(precision=12, scale=2), server_default="0", nullable=False),
        sa.Column("total", sa.Numeric(precision=12, scale=2), server_default="0", nullable=False),
        sa.Column(
            "insurance_share", sa.Numeric(precision=12, scale=2), server_default="0", nullable=False
        ),
        sa.Column(
            "patient_share", sa.Numeric(precision=12, scale=2), server_default="0", nullable=False
        ),
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
        sa.CheckConstraint("status IN ('draft','sent','paid','cancelled')", name="ck_po_status"),
        sa.ForeignKeyConstraint(
            ["clinic_id"],
            ["clinics.id"],
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
            ["installment_id"],
            ["treatment_plan_installments.id"],
        ),
        sa.ForeignKeyConstraint(
            ["patient_id"],
            ["patients.id"],
        ),
        sa.ForeignKeyConstraint(
            ["plan_id"],
            ["treatment_plans.id"],
        ),
        sa.ForeignKeyConstraint(
            ["quotation_id"],
            ["quotations.id"],
        ),
        sa.ForeignKeyConstraint(
            ["sent_by"],
            ["users.id"],
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("order_no"),
    )
    op.create_index(
        op.f("ix_payment_orders_patient_id"), "payment_orders", ["patient_id"], unique=False
    )
    op.create_index("ix_po_status_sent", "payment_orders", ["status", "sent_at"], unique=False)
    op.add_column("patient_insurance", sa.Column("class_id", sa.BigInteger(), nullable=True))
    op.create_foreign_key(
        "patient_insurance_class_id_fkey",
        "patient_insurance",
        "insurance_classes",
        ["class_id"],
        ["id"],
    )
    op.add_column(
        "services",
        sa.Column("is_consultation", sa.Boolean(), server_default="false", nullable=False),
    )

    # The three seeded consultations follow the insurance consultation limit.
    op.execute(
        "UPDATE services SET is_consultation = true WHERE code IN ('DN001', 'DN002', 'DN003')"
    )


def downgrade() -> None:
    op.drop_column("services", "is_consultation")
    # WARNING: constraint name is None; this directive will fail as
    # rendered.  Add a name, or use a naming convention; see
    # https://alembic.sqlalchemy.org/en/latest/naming.html
    op.drop_constraint("patient_insurance_class_id_fkey", "patient_insurance", type_="foreignkey")
    op.drop_column("patient_insurance", "class_id")
    op.drop_index("ix_po_status_sent", table_name="payment_orders")
    op.drop_index(op.f("ix_payment_orders_patient_id"), table_name="payment_orders")
    op.drop_table("payment_orders")
    op.drop_index(op.f("ix_treatment_plan_sessions_plan_id"), table_name="treatment_plan_sessions")
    op.drop_table("treatment_plan_sessions")
    op.drop_index(op.f("ix_treatment_plan_options_plan_id"), table_name="treatment_plan_options")
    op.drop_table("treatment_plan_options")
    op.drop_index(
        op.f("ix_treatment_plan_installments_plan_id"), table_name="treatment_plan_installments"
    )
    op.drop_table("treatment_plan_installments")
    op.drop_index(op.f("ix_quotations_patient_id"), table_name="quotations")
    op.drop_table("quotations")
    op.drop_index(op.f("ix_treatment_plans_patient_id"), table_name="treatment_plans")
    op.drop_table("treatment_plans")
    op.drop_index("ix_draft_lines_parent", table_name="draft_lines")
    op.drop_table("draft_lines")
    op.drop_index(op.f("ix_insurance_classes_company_id"), table_name="insurance_classes")
    op.drop_table("insurance_classes")
