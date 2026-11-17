"""Referral sources as an editable list (how the patient found the clinic).

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-17 10:00:00
"""

import sqlalchemy as sa
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None

SOURCES = [
    ("تيك توك", "TikTok"),
    ("إنستغرام", "Instagram"),
    ("سناب شات", "Snapchat"),
    ("إكس (تويتر)", "X (Twitter)"),
    ("بحث جوجل", "Google search"),
    ("خرائط جوجل", "Google Maps"),
    ("صديق أو قريب", "Friend or relative"),
    ("طبيب آخر", "Another doctor"),
    ("مرّ بالعيادة", "Walk-in"),
    ("شركة التأمين", "Insurance company"),
    ("أخرى", "Other"),
]


def upgrade() -> None:
    op.create_table(
        "referral_sources",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("name_ar", sa.String(length=100), nullable=False),
        sa.Column("name_en", sa.String(length=100), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
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
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["deleted_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.add_column(
        "patients",
        sa.Column("referral_source_id", sa.BigInteger(), sa.ForeignKey("referral_sources.id")),
    )
    conn = op.get_bind()
    for i, (ar, en) in enumerate(SOURCES):
        conn.execute(
            sa.text(
                "INSERT INTO referral_sources (name_ar, name_en, sort_order) VALUES (:ar, :en, :o)"
            ),
            {"ar": ar, "en": en, "o": (i + 1) * 10},
        )
    # What staff typed before becomes a list entry (matched by name when it already exists).
    typed = conn.execute(
        sa.text(
            "SELECT DISTINCT trim(referral_source) FROM patients "
            "WHERE coalesce(trim(referral_source), '') <> ''"
        )
    ).scalars()
    order = (len(SOURCES) + 1) * 10
    for text in typed:
        sid = conn.execute(
            sa.text(
                "SELECT id FROM referral_sources WHERE lower(name_ar) = lower(:t) "
                "OR lower(name_en) = lower(:t) LIMIT 1"
            ),
            {"t": text},
        ).scalar()
        if sid is None:
            sid = conn.execute(
                sa.text(
                    "INSERT INTO referral_sources (name_ar, name_en, sort_order) "
                    "VALUES (:t, :t, :o) RETURNING id"
                ),
                {"t": text[:100], "o": order},
            ).scalar()
            order += 10
        conn.execute(
            sa.text("UPDATE patients SET referral_source_id = :s WHERE trim(referral_source) = :t"),
            {"s": sid, "t": text},
        )
    op.drop_column("patients", "referral_source")


def downgrade() -> None:
    op.add_column("patients", sa.Column("referral_source", sa.String(length=100)))
    op.execute(
        "UPDATE patients p SET referral_source = r.name_ar FROM referral_sources r "
        "WHERE r.id = p.referral_source_id"
    )
    op.drop_column("patients", "referral_source_id")
    op.drop_table("referral_sources")
