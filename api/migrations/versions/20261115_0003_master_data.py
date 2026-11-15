"""M2: clinics, departments, doctors, schedules, commission rules, services, statuses,
visit types, saved phrases, number sequences. Seeds the starting lists from SPEC 6.4 and 10.1.

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-15 15:43:32.882900
"""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "number_sequences",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("doc_type", sa.String(length=20), nullable=False),
        sa.Column("year", sa.SmallInteger(), nullable=False),
        sa.Column("next_value", sa.BigInteger(), server_default="1", nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("doc_type", "year"),
    )
    op.create_table(
        "appointment_statuses",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("key", sa.String(length=40), nullable=False),
        sa.Column("name_ar", sa.String(length=100), nullable=False),
        sa.Column("name_en", sa.String(length=100), nullable=False),
        sa.Column("color", sa.String(length=20), nullable=False),
        sa.Column("blocks_slot", sa.Boolean(), nullable=False),
        sa.Column("is_system", sa.Boolean(), server_default="false", nullable=False),
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
        sa.UniqueConstraint("key"),
    )
    op.create_table(
        "clinics",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("name_ar", sa.String(length=150), nullable=False),
        sa.Column("name_en", sa.String(length=150), nullable=False),
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
    )
    op.create_table(
        "saved_phrases",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("field_key", sa.String(length=40), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
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
    )
    op.create_index(
        op.f("ix_saved_phrases_field_key"), "saved_phrases", ["field_key"], unique=False
    )
    op.create_table(
        "visit_types",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("name_ar", sa.String(length=100), nullable=False),
        sa.Column("name_en", sa.String(length=100), nullable=False),
        sa.Column("color", sa.String(length=20), server_default="neutral", nullable=False),
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
    )
    op.create_table(
        "departments",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("clinic_id", sa.BigInteger(), nullable=True),
        sa.Column("name_ar", sa.String(length=150), nullable=False),
        sa.Column("name_en", sa.String(length=150), nullable=False),
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
            ["updated_by"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "doctors",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=True),
        sa.Column("name_ar", sa.String(length=150), nullable=False),
        sa.Column("name_en", sa.String(length=150), server_default="", nullable=False),
        sa.Column("specialty_ar", sa.String(length=150), server_default="", nullable=False),
        sa.Column("specialty_en", sa.String(length=150), server_default="", nullable=False),
        sa.Column("clinic_id", sa.BigInteger(), nullable=True),
        sa.Column("department_id", sa.BigInteger(), nullable=True),
        sa.Column("color", sa.String(length=20), server_default="blue", nullable=False),
        sa.Column("slot_minutes", sa.SmallInteger(), server_default="15", nullable=False),
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
        sa.CheckConstraint("slot_minutes BETWEEN 5 AND 240", name="ck_doctors_slot"),
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
            ["department_id"],
            ["departments.id"],
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["users.id"],
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
    )
    op.create_table(
        "services",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(length=30), nullable=False),
        sa.Column("name_ar", sa.String(length=200), nullable=False),
        sa.Column("name_en", sa.String(length=200), nullable=False),
        sa.Column("department_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "sale_price", sa.Numeric(precision=12, scale=2), server_default="0", nullable=False
        ),
        sa.Column(
            "min_price", sa.Numeric(precision=12, scale=2), server_default="0", nullable=False
        ),
        sa.Column(
            "max_price", sa.Numeric(precision=12, scale=2), server_default="0", nullable=False
        ),
        sa.Column(
            "cost_price", sa.Numeric(precision=12, scale=2), server_default="0", nullable=False
        ),
        sa.Column("vat_applicable", sa.Boolean(), server_default="true", nullable=False),
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
        sa.CheckConstraint(
            "min_price <= sale_price AND sale_price <= max_price", name="ck_services_price_range"
        ),
        sa.CheckConstraint("min_price >= 0 AND cost_price >= 0", name="ck_services_nonneg"),
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
            ["updated_by"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
        sa.UniqueConstraint("number"),
    )
    op.create_table(
        "doctor_commission_rules",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("doctor_id", sa.BigInteger(), nullable=False),
        sa.Column("department_id", sa.BigInteger(), nullable=True),
        sa.Column("service_id", sa.BigInteger(), nullable=True),
        sa.Column("percent", sa.Numeric(precision=5, scale=2), nullable=False),
        sa.CheckConstraint(
            "NOT (department_id IS NOT NULL AND service_id IS NOT NULL)", name="ck_commission_scope"
        ),
        sa.CheckConstraint("percent >= 0 AND percent <= 100", name="ck_commission_percent"),
        sa.ForeignKeyConstraint(
            ["department_id"],
            ["departments.id"],
        ),
        sa.ForeignKeyConstraint(["doctor_id"], ["doctors.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["service_id"],
            ["services.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_doctor_commission_rules_doctor_id"),
        "doctor_commission_rules",
        ["doctor_id"],
        unique=False,
    )
    op.create_table(
        "doctor_schedules",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("doctor_id", sa.BigInteger(), nullable=False),
        sa.Column("weekday", sa.SmallInteger(), nullable=False),
        sa.Column("start_time", sa.Time(), nullable=False),
        sa.Column("end_time", sa.Time(), nullable=False),
        sa.Column("kind", sa.String(length=10), server_default="work", nullable=False),
        sa.CheckConstraint("kind IN ('work', 'break')", name="ck_doctor_schedules_kind"),
        sa.CheckConstraint("end_time > start_time", name="ck_doctor_schedules_times"),
        sa.CheckConstraint("weekday BETWEEN 0 AND 6", name="ck_doctor_schedules_weekday"),
        sa.ForeignKeyConstraint(["doctor_id"], ["doctors.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_doctor_schedules_doctor_id"), "doctor_schedules", ["doctor_id"], unique=False
    )

    _seed()


# Starting lists from SPEC 6.4 and 10.1, marked [CONFIRM] there: all editable in Settings.
DEPARTMENTS = [
    ("general", "العلاج العام", "General dentistry"),
    ("ortho", "التقويم", "Orthodontics"),
    ("endo", "علاج العصب", "Endodontics"),
    ("prosth", "التركيبات", "Prosthodontics"),
    ("radio", "الأشعة", "Radiology"),
]
STATUSES = [
    ("unconfirmed", "غير مؤكد", "Unconfirmed", "neutral", True),
    ("confirmed", "مؤكد", "Confirmed", "blue", True),
    ("arrived", "حضر", "Arrived", "cyan", True),
    ("with_doctor", "عند الطبيب", "With doctor", "violet", True),
    ("completed", "مكتمل", "Completed", "green", True),
    ("no_show", "لم يحضر", "No-show", "orange", False),
    ("cancelled", "ملغى", "Cancelled", "red", False),
    ("postponed", "مؤجل", "Postponed", "yellow", False),
]
VISIT_TYPES = [
    ("جديد", "New", "blue"),
    ("متابعة", "Follow-up", "teal"),
    ("استشارة", "Consultation", "violet"),
    ("طارئ", "Emergency", "red"),
    ("متابعة تقويم", "Orthodontic follow-up", "grape"),
]
# Prices are not known yet: seeded at 0 and inactive, so nothing is sold until staff set prices and activate.
SERVICES = [
    ("general", "كشف عام", "General consultation"),
    ("general", "كشف أخصائي", "Specialist consultation"),
    ("general", "كشف استشاري", "Consultant consultation"),
    ("radio", "أشعة صغيرة (ذروية / مجنحة)", "Periapical / bitewing X-ray"),
    ("radio", "أشعة بانوراما", "Panoramic X-ray"),
    ("radio", "أشعة سيفالومترية", "Cephalometric film"),
    ("radio", "أشعة مقطعية مخروطية (CBCT)", "CBCT"),
    ("prosth", "طقم كامل أكريليك (فك واحد)", "Acrylic complete denture (one arch)"),
    ("prosth", "طقم جزئي أكريليك (فك واحد)", "Acrylic partial denture (one arch)"),
    ("prosth", "طقم مرن (فك واحد)", "Flexible denture (one arch)"),
    ("prosth", "طقم جزئي معدني (فك واحد)", "Metal partial denture (one arch)"),
    ("prosth", "تعديل طقم", "Denture correction"),
    ("prosth", "لحام طقم", "Denture soldering"),
    ("prosth", "تبطين وضبط طقم", "Denture relining and adjustment"),
    ("prosth", "طقم فوري", "Immediate denture"),
    ("prosth", "إضافة سن للطقم", "Add tooth to denture"),
    ("prosth", "فينير (للسن)", "Veneer (per tooth)"),
    ("prosth", "تاج مؤقت CAD/CAM", "CAD/CAM temporary crown"),
    ("ortho", "زيارة متابعة تقويم", "Orthodontic follow-up visit"),
    ("ortho", "باقة التقويم الشفاف", "Clear aligner package"),
]


def _seed() -> None:
    conn = op.get_bind()
    clinics = sa.table(
        "clinics",
        sa.column("id"),
        sa.column("name_ar"),
        sa.column("name_en"),
        sa.column("sort_order"),
    )
    clinic_id = conn.execute(
        clinics.insert()
        .values(name_ar="عيادة الأسنان", name_en="Dental clinic", sort_order=10)
        .returning(clinics.c.id)
    ).scalar_one()

    deps = sa.table(
        "departments",
        sa.column("id"),
        sa.column("clinic_id"),
        sa.column("name_ar"),
        sa.column("name_en"),
        sa.column("sort_order"),
    )
    dep_ids = {}
    for i, (key, ar, en) in enumerate(DEPARTMENTS):
        dep_ids[key] = conn.execute(
            deps.insert()
            .values(clinic_id=clinic_id, name_ar=ar, name_en=en, sort_order=(i + 1) * 10)
            .returning(deps.c.id)
        ).scalar_one()

    statuses = sa.table(
        "appointment_statuses",
        sa.column("key"),
        sa.column("name_ar"),
        sa.column("name_en"),
        sa.column("color"),
        sa.column("blocks_slot"),
        sa.column("is_system"),
        sa.column("sort_order"),
    )
    conn.execute(
        statuses.insert(),
        [
            {
                "key": k,
                "name_ar": ar,
                "name_en": en,
                "color": c,
                "blocks_slot": b,
                "is_system": True,
                "sort_order": (i + 1) * 10,
            }
            for i, (k, ar, en, c, b) in enumerate(STATUSES)
        ],
    )

    vts = sa.table(
        "visit_types",
        sa.column("name_ar"),
        sa.column("name_en"),
        sa.column("color"),
        sa.column("sort_order"),
    )
    conn.execute(
        vts.insert(),
        [
            {"name_ar": ar, "name_en": en, "color": c, "sort_order": (i + 1) * 10}
            for i, (ar, en, c) in enumerate(VISIT_TYPES)
        ],
    )

    services = sa.table(
        "services",
        sa.column("number"),
        sa.column("code"),
        sa.column("name_ar"),
        sa.column("name_en"),
        sa.column("department_id"),
        sa.column("is_active"),
    )
    conn.execute(
        services.insert(),
        [
            {
                "number": i + 1,
                "code": f"DN{i + 1:03d}",
                "name_ar": ar,
                "name_en": en,
                "department_id": dep_ids[dep],
                "is_active": False,
            }
            for i, (dep, ar, en) in enumerate(SERVICES)
        ],
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_doctor_schedules_doctor_id"), table_name="doctor_schedules")
    op.drop_table("doctor_schedules")
    op.drop_index(
        op.f("ix_doctor_commission_rules_doctor_id"), table_name="doctor_commission_rules"
    )
    op.drop_table("doctor_commission_rules")
    op.drop_table("services")
    op.drop_table("doctors")
    op.drop_table("departments")
    op.drop_table("visit_types")
    op.drop_index(op.f("ix_saved_phrases_field_key"), table_name="saved_phrases")
    op.drop_table("saved_phrases")
    op.drop_table("clinics")
    op.drop_table("appointment_statuses")
    op.drop_table("number_sequences")
