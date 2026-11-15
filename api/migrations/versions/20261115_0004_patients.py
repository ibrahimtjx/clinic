"""M3: patients, insurance, assignments, insurance companies; Arabic-aware search.

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-15 15:58:45.002179
"""

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


# Normalizes text for search so spelling variants match (SPEC 5.1): removes Arabic diacritics and
# tatweel, unifies alef forms (أ إ آ ٱ → ا), ta marbuta → ha, alef maqsura → ya, Arabic-Indic and
# Persian digits → Western, lower case. IMMUTABLE so it can feed a generated column and an index.
NORMALIZE = r"""
CREATE FUNCTION clinic_normalize(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT lower(translate(
    regexp_replace(t, '[\u064B-\u065F\u0670\u0640]', '', 'g'),
    'أإآٱةى٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
    'ااااهي01234567890123456789'
  ))
$$
"""


def upgrade() -> None:
    op.execute(NORMALIZE)
    op.execute("CREATE SEQUENCE patient_file_no_seq START 1")
    op.create_table(
        "insurance_companies",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("code", sa.String(length=30), nullable=False),
        sa.Column("name_ar", sa.String(length=200), nullable=False),
        sa.Column("name_en", sa.String(length=200), nullable=False),
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
        sa.UniqueConstraint("code"),
    )
    op.create_table(
        "patients",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column(
            "file_no",
            sa.BigInteger(),
            server_default=sa.text("nextval('patient_file_no_seq')"),
            nullable=False,
        ),
        sa.Column("secondary_file_no", sa.String(length=30), nullable=True),
        sa.Column("name_ar", sa.String(length=200), nullable=False),
        sa.Column("name_en", sa.String(length=200), server_default="", nullable=False),
        sa.Column("national_id", sa.String(length=10), nullable=True),
        sa.Column("nationality", sa.String(length=2), nullable=True),
        sa.Column("gender", sa.String(length=6), nullable=True),
        sa.Column("dob", sa.Date(), nullable=True),
        sa.Column("mobile", sa.String(length=10), nullable=True),
        sa.Column("phone", sa.String(length=20), nullable=True),
        sa.Column("emergency_name", sa.String(length=200), nullable=True),
        sa.Column("emergency_phone", sa.String(length=20), nullable=True),
        sa.Column("default_doctor_id", sa.BigInteger(), nullable=True),
        sa.Column("is_external", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("sms_opt_out", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("chronic_diseases", sa.Text(), server_default="", nullable=False),
        sa.Column("allergies", sa.Text(), server_default="", nullable=False),
        sa.Column("medications", sa.Text(), server_default="", nullable=False),
        sa.Column("medical_history", sa.Text(), server_default="", nullable=False),
        sa.Column("referral_source", sa.String(length=100), nullable=True),
        sa.Column("notes", sa.Text(), server_default="", nullable=False),
        sa.Column("balance", sa.Numeric(precision=12, scale=2), server_default="0", nullable=False),
        sa.Column("last_visit_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "search_text",
            sa.Text(),
            sa.Computed(
                "clinic_normalize(coalesce(name_ar, '') || ' ' || coalesce(name_en, ''))",
                persisted=True,
            ),
            nullable=False,
        ),
        sa.Column(
            "search_digits",
            sa.Text(),
            sa.Computed(
                "file_no::text || ' ' || coalesce(secondary_file_no, '') || ' ' || coalesce(mobile, '') || ' ' || coalesce(phone, '') || ' ' || coalesce(emergency_phone, '') || ' ' || coalesce(national_id, '')",
                persisted=True,
            ),
            nullable=False,
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
        sa.CheckConstraint("gender IN ('male', 'female')", name="ck_patients_gender"),
        sa.CheckConstraint("mobile IS NULL OR mobile ~ '^05\\d{8}$'", name="ck_patients_mobile"),
        sa.CheckConstraint(
            "national_id IS NULL OR national_id ~ '^\\d{10}$'", name="ck_patients_national_id"
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
        ),
        sa.ForeignKeyConstraint(
            ["default_doctor_id"],
            ["doctors.id"],
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
        sa.UniqueConstraint("file_no"),
    )
    op.create_index("ix_patients_created_at", "patients", ["created_at"], unique=False)
    op.create_index("ix_patients_default_doctor", "patients", ["default_doctor_id"], unique=False)
    op.create_index("ix_patients_mobile", "patients", ["mobile"], unique=False)
    op.create_index("ix_patients_national_id", "patients", ["national_id"], unique=False)
    op.create_index(
        "ix_patients_search_digits",
        "patients",
        ["search_digits"],
        unique=False,
        postgresql_using="gin",
        postgresql_ops={"search_digits": "gin_trgm_ops"},
    )
    op.create_index(
        "ix_patients_search_text",
        "patients",
        ["search_text"],
        unique=False,
        postgresql_using="gin",
        postgresql_ops={"search_text": "gin_trgm_ops"},
    )
    op.create_table(
        "patient_assignments",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("patient_id", sa.BigInteger(), nullable=False),
        sa.Column("assigned_to", sa.BigInteger(), nullable=False),
        sa.Column("assigned_by", sa.BigInteger(), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("done_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("done_by", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(
            ["assigned_by"],
            ["users.id"],
        ),
        sa.ForeignKeyConstraint(
            ["assigned_to"],
            ["users.id"],
        ),
        sa.ForeignKeyConstraint(
            ["done_by"],
            ["users.id"],
        ),
        sa.ForeignKeyConstraint(
            ["patient_id"],
            ["patients.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_assignments_open",
        "patient_assignments",
        ["assigned_to"],
        unique=False,
        postgresql_where=sa.text("done_at IS NULL"),
    )
    op.create_index(
        op.f("ix_patient_assignments_patient_id"),
        "patient_assignments",
        ["patient_id"],
        unique=False,
    )
    op.create_table(
        "patient_insurance",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("patient_id", sa.BigInteger(), nullable=False),
        sa.Column("company_id", sa.BigInteger(), nullable=False),
        sa.Column("policy_no", sa.String(length=60), server_default="", nullable=False),
        sa.Column("class_name", sa.String(length=60), server_default="", nullable=False),
        sa.Column("membership_no", sa.String(length=60), server_default="", nullable=False),
        sa.Column("expiry", sa.Date(), nullable=True),
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
            ["company_id"],
            ["insurance_companies.id"],
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
        ),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("patient_id"),
    )
    op.create_index(
        op.f("ix_patient_insurance_company_id"), "patient_insurance", ["company_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_patient_insurance_company_id"), table_name="patient_insurance")
    op.drop_table("patient_insurance")
    op.drop_index(op.f("ix_patient_assignments_patient_id"), table_name="patient_assignments")
    op.drop_index(
        "ix_assignments_open",
        table_name="patient_assignments",
        postgresql_where=sa.text("done_at IS NULL"),
    )
    op.drop_table("patient_assignments")
    op.drop_index(
        "ix_patients_search_text",
        table_name="patients",
        postgresql_using="gin",
        postgresql_ops={"search_text": "gin_trgm_ops"},
    )
    op.drop_index(
        "ix_patients_search_digits",
        table_name="patients",
        postgresql_using="gin",
        postgresql_ops={"search_digits": "gin_trgm_ops"},
    )
    op.drop_index("ix_patients_national_id", table_name="patients")
    op.drop_index("ix_patients_mobile", table_name="patients")
    op.drop_index("ix_patients_default_doctor", table_name="patients")
    op.drop_index("ix_patients_created_at", table_name="patients")
    op.drop_table("patients")
    op.drop_table("insurance_companies")
    op.execute("DROP SEQUENCE patient_file_no_seq")
    op.execute("DROP FUNCTION clinic_normalize(text)")
