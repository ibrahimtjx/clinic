"""M12: patient images and documents (SPEC 8.5)."""

from io import BytesIO

from PIL import Image
from sqlalchemy import func, select

from app.models import AuditLog, DentalVisit, Doctor, Patient
from tests.conftest import login


def png(w=1200, h=800) -> bytes:
    buf = BytesIO()
    Image.new("RGB", (w, h), (200, 30, 30)).save(buf, "PNG")
    return buf.getvalue()


def setup_patient(db, make_user):
    make_user("reem", ["doctor"])
    make_user("amal", ["reception"])
    make_user("faisal", ["cashier"])
    doc = Doctor(name_ar="د. ريم")
    pt = Patient(name_ar="سارة")
    db.add_all([doc, pt])
    db.flush()
    visit = DentalVisit(patient_id=pt.id, doctor_id=doc.id, visit_at=db.scalar(select(func.now())))
    db.add(visit)
    db.commit()
    return pt, visit


def test_upload_image_thumbnail_content_and_links(client, db, make_user):
    pt, visit = setup_patient(db, make_user)
    login(client, "reem")
    res = client.post(
        f"/patients/{pt.id}/files",
        files={"file": ("pano.png", png(), "image/png")},
        data={
            "kind": "panoramic",
            "title": "بانوراما أولى",
            "visit_id": str(visit.id),
            "tooth_fdi": "36",
        },
    )
    assert res.status_code == 201, res.text
    f = res.json()
    assert (f["kind"], f["content_type"], f["width"], f["height"], f["has_thumb"]) == (
        "panoramic",
        "image/png",
        1200,
        800,
        True,
    )
    assert (f["visit_id"], f["tooth_fdi"], f["original_name"], len(f["sha256"])) == (
        visit.id,
        36,
        "pano.png",
        64,
    )
    content = client.get(f"/files/{f['id']}/content")
    assert (
        content.status_code == 200
        and content.content == png()
        and content.headers["content-type"] == "image/png"
    )
    thumb = client.get(f"/files/{f['id']}/thumb")
    assert (
        thumb.headers["content-type"] == "image/jpeg"
        and max(Image.open(BytesIO(thumb.content)).size) == 480
    )
    assert (
        "attachment"
        in client.get(f"/files/{f['id']}/content", params={"download": True}).headers[
            "content-disposition"
        ]
    )
    listed = client.get(f"/patients/{pt.id}/files", params={"tooth": 36}).json()
    assert [x["id"] for x in listed] == [f["id"]] and listed[0]["uploaded_by_name"]
    assert client.get(f"/patients/{pt.id}/files", params={"kind": "xray"}).json() == []
    # Opening the files is logged like the dental record.
    assert db.scalar(
        select(AuditLog.id).where(AuditLog.action == "read", AuditLog.table_name == "patients")
    )
    upd = client.patch(
        f"/files/{f['id']}", json={"version": f["version"], "kind": "xray", "clear_tooth": True}
    ).json()
    assert (upd["kind"], upd["tooth_fdi"], upd["visit_id"]) == ("xray", None, visit.id)


def test_pdf_and_rejected_types(client, db, make_user):
    pt, _ = setup_patient(db, make_user)
    login(client, "amal")  # reception scans documents
    pdf = client.post(
        f"/patients/{pt.id}/files",
        files={"file": ("ref.pdf", b"%PDF-1.4\n%fake\n", "application/pdf")},
        data={"kind": "referral"},
    )
    assert (
        pdf.status_code == 201
        and pdf.json()["has_thumb"] is False
        and pdf.json()["content_type"] == "application/pdf"
    )
    # The type comes from the bytes, not the name.
    bad = client.post(
        f"/patients/{pt.id}/files",
        files={"file": ("x.png", b"MZ\x90\x00 not an image", "image/png")},
    )
    assert bad.status_code == 422 and bad.json()["detail"]["code"] == "file_type_not_allowed"
    empty = client.post(f"/patients/{pt.id}/files", files={"file": ("e.png", b"", "image/png")})
    assert empty.json()["detail"]["code"] == "file_empty"
    other = Patient(name_ar="آخر")
    db.add(other)
    db.commit()
    v = db.scalar(select(DentalVisit.id))
    wrong = client.post(
        f"/patients/{other.id}/files",
        files={"file": ("a.png", png(10, 10), "image/png")},
        data={"visit_id": str(v)},
    )
    assert wrong.json()["detail"]["code"] == "unknown_visit"


def test_permissions_and_soft_delete(client, db, make_user):
    pt, _ = setup_patient(db, make_user)
    login(client, "reem")
    f = client.post(
        f"/patients/{pt.id}/files", files={"file": ("a.png", png(20, 20), "image/png")}
    ).json()
    assert client.delete(f"/files/{f['id']}").status_code == 403  # doctors may not delete
    login(client, "faisal")
    assert client.get(f"/patients/{pt.id}/files").status_code == 403
    assert client.get(f"/files/{f['id']}/content").status_code == 403
    make_user("boss", ["manager"])
    login(client, "boss")
    assert client.delete(f"/files/{f['id']}").status_code == 204
    assert client.get(f"/patients/{pt.id}/files").json() == []
    assert client.get(f"/files/{f['id']}/content").status_code == 404
