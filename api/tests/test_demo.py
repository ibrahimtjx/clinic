"""The installer's demo data: consistent with the ledger, dated in order, run once."""

import itertools
from decimal import Decimal

from sqlalchemy import func, select

from app.cli import _seed_dev_master
from app.demo import seed_demo
from app.models import Invoice, Patient, PatientFile, Prescription, Receipt
from app.services import ledger


def test_demo_data(db, make_user):
    for name, roles in [
        ("admin", ["admin"]),
        ("reception", ["reception"]),
        ("cashier", ["cashier"]),
        ("dr.reem", ["doctor"]),
        ("dr.omar", ["doctor"]),
    ]:
        make_user(name, roles)
    _seed_dev_master(db)
    db.commit()
    counts = seed_demo(db, seed=7)
    assert counts["patients"] == 400 and counts["invoices"] > 20 and counts["images"] > 0
    assert db.scalar(select(func.count()).select_from(Prescription)) == counts["prescriptions"]
    assert db.scalar(select(func.count()).select_from(PatientFile)) == counts["images"]
    # What patients owe equals what is outstanding on their invoices.
    ids = list(db.scalars(select(Invoice.id)))
    owed = sum(ledger.outstanding(db, ids).values(), Decimal(0))
    assert owed == db.scalar(select(func.sum(Patient.balance)))
    # Numbers rise with dates, like on a real system.
    invs = list(db.execute(select(Invoice.id, Invoice.issued_at).order_by(Invoice.id)).all())
    assert all(a[1] <= b[1] for a, b in itertools.pairwise(invs))
    rcs = list(db.execute(select(Receipt.id, Receipt.received_at).order_by(Receipt.id)).all())
    assert all(a[1] <= b[1] for a, b in itertools.pairwise(rcs))
    assert seed_demo(db) == {}  # only once


def test_demo_data_refused_on_a_real_database(db):
    import pytest

    for i in range(31):
        db.add(Patient(name_ar=f"مريض {i}"))
    db.commit()
    with pytest.raises(SystemExit, match="31 patients"):
        seed_demo(db)
