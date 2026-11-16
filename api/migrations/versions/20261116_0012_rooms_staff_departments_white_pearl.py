"""Doctor rooms, staff departments, White Pearl as the clinic name, prices as suggestions.

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-16 13:00:00
"""

import json

import sqlalchemy as sa
from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None

OLD_NAMES = ("", "مجمع الندى الطبي (تجريبي)")
NAME = {"name_ar": "اللؤلؤة البيضاء", "name_en": "White Pearl"}
# The service price is a suggestion: reception and doctors set the final price (owner, 2026-11-16).
GRANTS = {
    "reception": ["quotation.edit", "invoice.price_override"],
    "doctor": ["invoice.price_override"],
}


def upgrade() -> None:
    op.add_column("doctors", sa.Column("room", sa.String(50), server_default="", nullable=False))
    op.add_column(
        "users", sa.Column("department_id", sa.BigInteger(), sa.ForeignKey("departments.id"))
    )
    conn = op.get_bind()
    row = conn.execute(sa.text("SELECT value_json FROM settings WHERE key = 'clinic'")).first()
    if row is None:
        conn.execute(
            sa.text("INSERT INTO settings (key, value_json) VALUES ('clinic', CAST(:v AS jsonb))"),
            {"v": json.dumps(NAME, ensure_ascii=False)},
        )
    elif (row[0] or {}).get("name_ar", "") in OLD_NAMES:
        value = {**(row[0] or {}), **NAME}
        conn.execute(
            sa.text("UPDATE settings SET value_json = CAST(:v AS jsonb) WHERE key = 'clinic'"),
            {"v": json.dumps(value, ensure_ascii=False)},
        )
    for role, perms in GRANTS.items():
        for perm in perms:
            conn.execute(
                sa.text(
                    "INSERT INTO role_permissions (role_id, permission) "
                    "SELECT id, :perm FROM roles WHERE key = :role ON CONFLICT DO NOTHING"
                ),
                {"role": role, "perm": perm},
            )


def downgrade() -> None:
    conn = op.get_bind()
    for role, perms in GRANTS.items():
        conn.execute(
            sa.text(
                "DELETE FROM role_permissions WHERE permission = ANY(:perms) "
                "AND role_id = (SELECT id FROM roles WHERE key = :role)"
            ),
            {"role": role, "perms": perms},
        )
    op.drop_column("users", "department_id")
    op.drop_column("doctors", "room")
