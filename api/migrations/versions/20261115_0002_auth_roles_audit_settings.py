"""M1: users, roles, permissions, sessions, audit log, settings.

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-15 15:17:12.138418
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

DEFAULT_ROLES = {
    "admin": {
        "name_ar": "مدير النظام",
        "name_en": "Admin",
        "permissions": [
            "appointment.create",
            "appointment.delete",
            "appointment.edit",
            "appointment.override_hours",
            "appointment.view",
            "audit.view",
            "cashbox.close",
            "dental.edit",
            "dental.view",
            "invoice.credit_note",
            "invoice.price_override",
            "invoice.view",
            "patient.assign",
            "patient.create",
            "patient.delete",
            "patient.edit",
            "patient.export",
            "patient.medical_view",
            "patient.view",
            "payment.collect",
            "plan.edit",
            "plan.view",
            "queue.manage",
            "queue.view",
            "quotation.edit",
            "quotation.view",
            "record.view_deleted",
            "report.clinical",
            "report.financial",
            "report.operational",
            "report.revenue",
            "role.manage",
            "settings.manage",
            "user.manage",
        ],
    },
    "manager": {
        "name_ar": "المدير",
        "name_en": "Manager",
        "permissions": [
            "appointment.create",
            "appointment.delete",
            "appointment.edit",
            "appointment.override_hours",
            "appointment.view",
            "audit.view",
            "cashbox.close",
            "dental.edit",
            "dental.view",
            "invoice.credit_note",
            "invoice.view",
            "patient.assign",
            "patient.create",
            "patient.delete",
            "patient.edit",
            "patient.export",
            "patient.medical_view",
            "patient.view",
            "payment.collect",
            "plan.edit",
            "plan.view",
            "queue.manage",
            "queue.view",
            "quotation.edit",
            "quotation.view",
            "record.view_deleted",
            "report.clinical",
            "report.financial",
            "report.operational",
            "report.revenue",
        ],
    },
    "reception": {
        "name_ar": "الاستقبال",
        "name_en": "Reception",
        "permissions": [
            "appointment.create",
            "appointment.delete",
            "appointment.edit",
            "appointment.override_hours",
            "appointment.view",
            "invoice.view",
            "patient.assign",
            "patient.create",
            "patient.edit",
            "patient.view",
            "payment.collect",
            "queue.manage",
            "queue.view",
            "quotation.view",
            "report.operational",
        ],
    },
    "doctor": {
        "name_ar": "الطبيب",
        "name_en": "Doctor",
        "permissions": [
            "appointment.view",
            "dental.edit",
            "dental.view",
            "patient.medical_view",
            "patient.view",
            "plan.edit",
            "plan.view",
            "queue.manage",
            "queue.view",
            "quotation.edit",
            "quotation.view",
            "report.clinical",
        ],
    },
    "cashier": {
        "name_ar": "المحاسب / أمين الصندوق",
        "name_en": "Cashier / Accountant",
        "permissions": [
            "cashbox.close",
            "invoice.credit_note",
            "invoice.view",
            "patient.view",
            "payment.collect",
            "quotation.view",
            "report.financial",
            "report.revenue",
        ],
    },
}


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("username", sa.String(length=50), nullable=False),
        sa.Column("password_hash", sa.String(length=100), nullable=False),
        sa.Column("pin_hash", sa.String(length=100), nullable=True),
        sa.Column("full_name_ar", sa.String(length=150), nullable=False),
        sa.Column("full_name_en", sa.String(length=150), server_default="", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("failed_logins", sa.Integer(), server_default="0", nullable=False),
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("must_change_password", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("password_changed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "preferences",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="{}",
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
        "audit_log",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column(
            "at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column("user_id", sa.BigInteger(), nullable=True),
        sa.Column("machine", sa.String(length=64), nullable=True),
        sa.Column("ip", sa.String(length=64), nullable=True),
        sa.Column("table_name", sa.String(length=60), nullable=False),
        sa.Column("record_id", sa.String(length=80), nullable=True),
        sa.Column("action", sa.String(length=30), nullable=False),
        sa.Column("old_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("new_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_audit_log_at", "audit_log", ["at"], unique=False)
    op.create_index("ix_audit_log_record", "audit_log", ["table_name", "record_id"], unique=False)
    op.create_index("ix_audit_log_user_at", "audit_log", ["user_id", "at"], unique=False)
    op.create_table(
        "auth_sessions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("method", sa.String(length=20), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "last_used_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_reason", sa.String(length=40), nullable=True),
        sa.Column("machine", sa.String(length=64), nullable=True),
        sa.Column("ip", sa.String(length=64), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_auth_sessions_user_id"), "auth_sessions", ["user_id"], unique=False)
    op.create_table(
        "roles",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("key", sa.String(length=50), nullable=False),
        sa.Column("name_ar", sa.String(length=100), nullable=False),
        sa.Column("name_en", sa.String(length=100), nullable=False),
        sa.Column("is_system", sa.Boolean(), server_default="false", nullable=False),
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
            ["created_by"],
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
        "settings",
        sa.Column("key", sa.String(length=80), nullable=False),
        sa.Column("value_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("key"),
    )
    op.create_table(
        "role_permissions",
        sa.Column("role_id", sa.BigInteger(), nullable=False),
        sa.Column("permission", sa.String(length=80), nullable=False),
        sa.ForeignKeyConstraint(["role_id"], ["roles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("role_id", "permission"),
    )
    op.create_table(
        "user_roles",
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("role_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["role_id"], ["roles.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "role_id"),
    )

    # Usernames are unique ignoring case, forever (users are never hard deleted).
    op.create_index("ux_users_username_lower", "users", [sa.text("lower(username)")], unique=True)

    # The audit log is append-only, enforced in the database (SPEC 3.4).
    op.execute(
        """
        CREATE FUNCTION audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'audit_log is append-only' USING ERRCODE = 'insufficient_privilege';
        END $$;
        CREATE TRIGGER audit_log_no_update_delete
          BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_log
          FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();
        """
    )

    # Starting roles (SPEC 3.2). Frozen copy: later catalog changes get their own migrations.
    roles = sa.table(
        "roles",
        sa.column("id", sa.BigInteger),
        sa.column("key", sa.String),
        sa.column("name_ar", sa.String),
        sa.column("name_en", sa.String),
        sa.column("is_system", sa.Boolean),
    )
    perms = sa.table(
        "role_permissions", sa.column("role_id", sa.BigInteger), sa.column("permission", sa.String)
    )
    conn = op.get_bind()
    for key, r in DEFAULT_ROLES.items():
        rid = conn.execute(
            roles.insert()
            .values(key=key, name_ar=r["name_ar"], name_en=r["name_en"], is_system=True)
            .returning(roles.c.id)
        ).scalar_one()
        if r["permissions"]:
            conn.execute(
                perms.insert(), [{"role_id": rid, "permission": p} for p in r["permissions"]]
            )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS audit_log_no_update_delete ON audit_log")
    op.execute("DROP FUNCTION IF EXISTS audit_log_immutable()")
    op.drop_index("ux_users_username_lower", table_name="users")
    op.drop_table("user_roles")
    op.drop_table("role_permissions")
    op.drop_table("settings")
    op.drop_table("roles")
    op.drop_index(op.f("ix_auth_sessions_user_id"), table_name="auth_sessions")
    op.drop_table("auth_sessions")
    op.drop_index("ix_audit_log_user_at", table_name="audit_log")
    op.drop_index("ix_audit_log_record", table_name="audit_log")
    op.drop_index("ix_audit_log_at", table_name="audit_log")
    op.drop_table("audit_log")
    op.drop_table("users")
