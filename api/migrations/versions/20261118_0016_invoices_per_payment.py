"""Invoices per payment; corrected invoices.

A payment order can now be paid in parts; each payment issues an invoice for that part
(owner, 2026-11-18). Invoices before this keep portion 1.

Revision ID: 0016
Revises: 0015
Create Date: 2026-11-18 10:00:00
"""

import sqlalchemy as sa
from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Issued documents are immutable by trigger; schema changes (not row updates) are fine.
    op.drop_constraint("invoices_payment_order_id_key", "invoices", type_="unique")
    op.create_index(
        op.f("ix_invoices_payment_order_id"), "invoices", ["payment_order_id"], unique=False
    )
    op.add_column(
        "invoices",
        sa.Column("portion", sa.Numeric(9, 6), server_default="1", nullable=False),
    )
    op.add_column(
        "invoices",
        sa.Column("corrects_invoice_id", sa.BigInteger(), sa.ForeignKey("invoices.id")),
    )
    op.add_column(
        "payment_orders",
        sa.Column("paid_amount", sa.Numeric(12, 2), server_default="0", nullable=False),
    )
    op.add_column(
        "payment_orders",
        sa.Column("closed_reason", sa.Text(), server_default="", nullable=False),
    )
    op.add_column(
        "payment_orders", sa.Column("billed_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "payment_orders", sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "payment_orders",
        sa.Column(
            "corrects_invoice_id",
            sa.BigInteger(),
            sa.ForeignKey("invoices.id", name="fk_po_corrects_invoice"),
        ),
    )
    op.drop_constraint("ck_po_status", "payment_orders", type_="check")
    op.create_check_constraint(
        "ck_po_status",
        "payment_orders",
        "status IN ('draft','sent','part_paid','paid','closed','cancelled')",
    )
    op.create_check_constraint("ck_po_paid", "payment_orders", "paid_amount >= 0")
    # Correcting issued invoices (credit note + corrected invoice): admins and managers.
    op.execute(
        "INSERT INTO role_permissions (role_id, permission) "
        "SELECT id, 'invoice.correct' FROM roles WHERE key IN ('admin', 'manager') "
        "ON CONFLICT DO NOTHING"
    )
    # Orders paid before: what was invoiced is their whole patient share.
    op.execute("UPDATE payment_orders SET paid_amount = patient_share WHERE status = 'paid'")


def downgrade() -> None:
    op.execute("DELETE FROM role_permissions WHERE permission = 'invoice.correct'")
    op.drop_constraint("ck_po_paid", "payment_orders", type_="check")
    op.drop_constraint("ck_po_status", "payment_orders", type_="check")
    op.create_check_constraint(
        "ck_po_status", "payment_orders", "status IN ('draft','sent','paid','cancelled')"
    )
    op.drop_column("payment_orders", "corrects_invoice_id")
    op.drop_column("payment_orders", "closed_at")
    op.drop_column("payment_orders", "billed_at")
    op.drop_column("payment_orders", "closed_reason")
    op.drop_column("payment_orders", "paid_amount")
    op.drop_column("invoices", "corrects_invoice_id")
    op.drop_column("invoices", "portion")
    op.drop_index(op.f("ix_invoices_payment_order_id"), table_name="invoices")
    op.create_unique_constraint("invoices_payment_order_id_key", "invoices", ["payment_order_id"])
