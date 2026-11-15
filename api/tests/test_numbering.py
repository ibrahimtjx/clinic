import threading

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.services import numbering
from tests.conftest import TEST_URL


def test_allocate_format_and_sequence(db):
    year = numbering.current_year(db)
    assert numbering.allocate(db, "invoice") == f"INV-{year}-000001"
    assert numbering.allocate(db, "invoice") == f"INV-{year}-000002"
    assert numbering.allocate(db, "receipt") == f"RC-{year}-000001"  # own sequence


def test_rollback_returns_the_number(db):
    year = numbering.current_year(db)
    sp = db.begin_nested()
    numbering.allocate(db, "credit_note")
    sp.rollback()
    assert numbering.allocate(db, "credit_note") == f"CN-{year}-000001"


def test_settings_change_prefix_and_reset(client, admin):
    cur = client.get("/settings/numbering").json()
    assert cur["invoice"]["next_number"].startswith("INV-") and cur["invoice"]["issued"] == 0
    body = {k: v["format"] for k, v in cur.items()}
    body["invoice"] = {"prefix": "SINV", "yearly_reset": False, "padding": 8}
    res = client.put("/settings/numbering", json=body).json()
    assert res["invoice"]["next_number"] == "SINV-00000001"
    body["invoice"]["prefix"] = "inv x"
    assert client.put("/settings/numbering", json=body).status_code == 422


def test_numbering_settings_need_permission(client, make_user):
    from tests.conftest import login

    make_user("amal", ["reception"])
    login(client, "amal")
    assert client.get("/settings/numbering").status_code == 403


def test_concurrent_allocation_has_no_gaps_or_duplicates(engine):
    """Real concurrent transactions (separate connections) racing for invoice numbers."""
    eng = create_engine(TEST_URL)
    doc = "payment_order"
    with eng.begin() as c:
        c.execute(text("DELETE FROM number_sequences WHERE doc_type = :d"), {"d": doc})
    results: list[str] = []
    lock = threading.Lock()

    def worker(fail: bool):
        with Session(eng) as s:
            n = numbering.allocate(s, doc)
            if fail:
                s.rollback()  # e.g. the document failed validation: number goes back
                return
            s.commit()
            with lock:
                results.append(n)

    threads = [threading.Thread(target=worker, args=(i % 5 == 0,)) for i in range(25)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    nums = sorted(int(r.rsplit("-", 1)[1]) for r in results)
    assert nums == list(range(1, len(results) + 1))  # gapless and unique
    with eng.begin() as c:
        c.execute(text("DELETE FROM number_sequences WHERE doc_type = :d"), {"d": doc})
    eng.dispose()
