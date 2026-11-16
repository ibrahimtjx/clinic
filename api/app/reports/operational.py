"""Operational reports of SPEC 11.2: schedule, no-shows, new patients, queue waiting times."""

from collections import Counter, defaultdict
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Appointment, AppointmentStatus, Doctor, Patient, QueueEntry, User, VisitType
from app.reports.engine import Col, Filters, Item, Report, Section, report, within

OPS = ("report.operational", "report.clinical")


def _appts(db: Session, f: Filters):
    q = (
        select(Appointment, Patient, AppointmentStatus, VisitType)
        .join(Patient, Patient.id == Appointment.patient_id)
        .join(AppointmentStatus, AppointmentStatus.id == Appointment.status_id)
        .outerjoin(VisitType, VisitType.id == Appointment.visit_type_id)
        .where(Appointment.deleted_at.is_(None), *within(Appointment.starts_at, f))
        .order_by(Appointment.starts_at)
    )
    if f.doctor_id:
        q = q.where(Appointment.doctor_id == f.doctor_id)
    if f.clinic_id:
        q = q.where(Appointment.clinic_id == f.clinic_id)
    return db.execute(q).all()


@report(
    key="daily_schedule",
    ar="جدول اليوم لكل طبيب",
    en="Daily schedule per doctor",
    group="operational",
    perms=OPS,
    filters=("day", "doctor", "clinic"),
    description_ar="مواعيد اليوم مقسمة حسب الطبيب، جاهزة للطباعة.",
    description_en="The day's appointments grouped by doctor, ready to print.",
)
def daily_schedule(db: Session, f: Filters) -> Report:
    doctors = {d.id: d for d in db.scalars(select(Doctor))}
    by_doc: dict[int, list] = defaultdict(list)
    for a, pt, st, vt in _appts(db, f):
        by_doc[a.doctor_id].append(
            {
                "from": a.starts_at,
                "to": a.ends_at,
                "patient": pt.name_ar,
                "file_no": pt.file_no,
                "mobile": pt.mobile or "",
                "visit_type": vt.name_ar if vt else "",
                "status": st.name_ar,
                "note": a.note,
            }
        )
    cols = [
        Col("from", "من", "From", "time"),
        Col("to", "إلى", "To", "time"),
        Col("patient", "المريض", "Patient"),
        Col("file_no", "رقم الملف", "File no.", "int"),
        Col("mobile", "الجوال", "Mobile"),
        Col("visit_type", "نوع الزيارة", "Visit type"),
        Col("status", "الحالة", "Status"),
        Col("note", "ملاحظة", "Note"),
    ]
    sections = [
        Section(
            f"doctor-{did}",
            doctors[did].name_ar,
            doctors[did].name_en or doctors[did].name_ar,
            cols,
            rows,
        )
        for did, rows in sorted(by_doc.items(), key=lambda kv: doctors[kv[0]].sort_order)
    ]
    return Report(
        sections, [Item("عدد المواعيد", "Appointments", sum(len(s.rows) for s in sections), "int")]
    )


@report(
    key="no_shows",
    ar="عدم الحضور والإلغاءات",
    en="No-shows and cancellations",
    group="operational",
    perms=OPS,
    filters=("date_range", "doctor", "clinic"),
    description_ar="المواعيد التي لم يحضرها المريض أو أُلغيت، مع النسب.",
    description_en="Appointments the patient missed or that were cancelled, with rates.",
)
def no_shows(db: Session, f: Filters) -> Report:
    doctors = {d.id: d for d in db.scalars(select(Doctor))}
    all_rows = _appts(db, f)
    rows = [
        {
            "at": a.starts_at,
            "doctor": doctors[a.doctor_id].name_ar,
            "patient": pt.name_ar,
            "file_no": pt.file_no,
            "mobile": pt.mobile or "",
            "status": st.name_ar,
            "reason": a.cancel_reason or "",
        }
        for a, pt, st, _ in all_rows
        if st.key in ("no_show", "cancelled")
    ]
    n = len(all_rows)
    count = Counter(st.key for _, _, st, _ in all_rows)
    pct = lambda k: Decimal(count[k] * 100) / n if n else Decimal(0)
    return Report(
        [
            Section(
                "list",
                "القائمة",
                "List",
                [
                    Col("at", "الموعد", "Appointment", "datetime"),
                    Col("doctor", "الطبيب", "Doctor"),
                    Col("patient", "المريض", "Patient"),
                    Col("file_no", "رقم الملف", "File no.", "int"),
                    Col("mobile", "الجوال", "Mobile"),
                    Col("status", "الحالة", "Status"),
                    Col("reason", "سبب الإلغاء", "Cancel reason"),
                ],
                rows,
            )
        ],
        [
            Item("كل المواعيد", "All appointments", n, "int"),
            Item("لم يحضر", "No-shows", count["no_show"], "int"),
            Item("نسبة عدم الحضور %", "No-show rate %", pct("no_show"), "pct"),
            Item("ملغاة", "Cancelled", count["cancelled"], "int"),
            Item("نسبة الإلغاء %", "Cancellation rate %", pct("cancelled"), "pct"),
        ],
    )


@report(
    key="new_patients",
    ar="المرضى الجدد",
    en="New patients",
    group="operational",
    perms=OPS,
    filters=("date_range",),
    description_ar="المرضى المسجلون في الفترة حسب الجنس والجنسية ومصدر الإحالة.",
    description_en="Patients registered in the period by gender, nationality and referral source.",
)
def new_patients(db: Session, f: Filters) -> Report:
    users = dict(db.execute(select(User.id, User.full_name_ar)).all())
    pts = list(
        db.scalars(
            select(Patient)
            .where(Patient.deleted_at.is_(None), *within(Patient.created_at, f))
            .order_by(Patient.created_at)
        )
    )
    rows = [
        {
            "file_no": p.file_no,
            "patient": p.name_ar,
            "patient_en": p.name_en,
            "gender": {"male": "ذكر", "female": "أنثى"}.get(p.gender or "", ""),
            "nationality": p.nationality or "",
            "mobile": p.mobile or "",
            "referral": p.referral_source or "",
            "at": p.created_at,
            "by": users.get(p.created_by, ""),
        }
        for p in pts
    ]
    refs = Counter(p.referral_source or "—" for p in pts)
    ref_rows = [{"source": k, "count": v} for k, v in refs.most_common()]
    return Report(
        [
            Section(
                "patients",
                "المرضى",
                "Patients",
                [
                    Col("file_no", "رقم الملف", "File no.", "int"),
                    Col("patient", "الاسم", "Name"),
                    Col("patient_en", "الاسم (إنجليزي)", "Name (English)"),
                    Col("gender", "الجنس", "Gender"),
                    Col("nationality", "الجنسية", "Nationality"),
                    Col("mobile", "الجوال", "Mobile"),
                    Col("referral", "مصدر الإحالة", "Referral source"),
                    Col("at", "تاريخ التسجيل", "Registered", "datetime"),
                    Col("by", "سجله", "By"),
                ],
                rows,
            ),
            Section(
                "referrals",
                "حسب مصدر الإحالة",
                "By referral source",
                [Col("source", "المصدر", "Source"), Col("count", "العدد", "Count", "int")],
                ref_rows,
            ),
        ],
        [
            Item("المرضى الجدد", "New patients", len(pts), "int"),
            Item("ذكور", "Male", sum(1 for p in pts if p.gender == "male"), "int"),
            Item("إناث", "Female", sum(1 for p in pts if p.gender == "female"), "int"),
            Item("سعوديون", "Saudi", sum(1 for p in pts if p.nationality == "SA"), "int"),
            Item(
                "غير سعوديين",
                "Non-Saudi",
                sum(1 for p in pts if p.nationality and p.nationality != "SA"),
                "int",
            ),
        ],
    )


@report(
    key="queue_waits",
    ar="أوقات الانتظار حسب الطبيب",
    en="Queue waiting times per doctor",
    group="operational",
    perms=OPS,
    filters=("date_range", "doctor", "clinic"),
    description_ar="متوسط وأقصى الانتظار ومدة الكشف، ومن غادر دون أن يُرى.",
    description_en="Average and longest wait, time with the doctor, and who left without being seen.",
)
def queue_waits(db: Session, f: Filters) -> Report:
    q = select(QueueEntry)
    if f.date_from:
        q = q.where(QueueEntry.day >= f.date_from)
    if f.date_to:
        q = q.where(QueueEntry.day <= f.date_to)
    if f.doctor_id:
        q = q.where(QueueEntry.doctor_id == f.doctor_id)
    if f.clinic_id:
        q = q.where(QueueEntry.clinic_id == f.clinic_id)
    doctors = {d.id: d for d in db.scalars(select(Doctor))}
    acc: dict[int, dict] = defaultdict(
        lambda: {"n": 0, "seen": 0, "left": 0, "waits": [], "visits": []}
    )
    for e in db.scalars(q):
        a = acc[e.doctor_id]
        a["n"] += 1
        if e.cancelled_at:
            a["left"] += 1
        if e.entered_at:
            a["seen"] += 1
            a["waits"].append((e.entered_at - e.received_at).total_seconds() / 60)
            if e.exited_at:
                a["visits"].append((e.exited_at - e.entered_at).total_seconds() / 60)
    avg = lambda xs: Decimal(str(round(sum(xs) / len(xs), 1))) if xs else None
    rows = [
        {
            "doctor": doctors[did].name_ar,
            "n": a["n"],
            "seen": a["seen"],
            "left": a["left"],
            "avg_wait": avg(a["waits"]),
            "max_wait": Decimal(str(round(max(a["waits"]), 1))) if a["waits"] else None,
            "avg_visit": avg(a["visits"]),
        }
        for did, a in sorted(acc.items(), key=lambda kv: doctors[kv[0]].sort_order)
    ]
    all_waits = [w for a in acc.values() for w in a["waits"]]
    return Report(
        [
            Section(
                "doctors",
                "حسب الطبيب",
                "By doctor",
                [
                    Col("doctor", "الطبيب", "Doctor"),
                    Col("n", "في الطابور", "Queued", "int"),
                    Col("seen", "تم الكشف", "Seen", "int"),
                    Col("left", "غادر دون كشف", "Left unseen", "int"),
                    Col("avg_wait", "متوسط الانتظار (دقيقة)", "Avg wait (min)", "number"),
                    Col("max_wait", "أطول انتظار (دقيقة)", "Longest wait (min)", "number"),
                    Col("avg_visit", "متوسط مدة الكشف (دقيقة)", "Avg visit (min)", "number"),
                ],
                rows,
            )
        ],
        [
            Item(
                "كل المرضى في الطابور", "Patients queued", sum(a["n"] for a in acc.values()), "int"
            ),
            Item(
                "متوسط الانتظار (دقيقة)",
                "Average wait (min)",
                avg(all_waits) or Decimal(0),
                "number",
            ),
        ],
    )
