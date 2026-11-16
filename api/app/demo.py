"""Rich FAKE demo data for trying the system (installer "Demo data" option, `python -m app.cli seed-demo`).

Builds on seed-dev (users, doctors, prices, demo insurer) and adds about three months of clinic life:
patients, appointments, today's queue, dental visits, prescriptions, lab results, reports, images,
quotations, treatment plans with installments, paid / part-paid / unpaid invoices, deposits and credit
notes. Everything goes through the same code the app uses, so the numbers are consistent.

Never run this on a real clinic's database: the data is invented, and issued invoices and receipts are
back-dated (the immutability trigger is bypassed inside this one transaction, for demo data only).
"""

import io
import random
import uuid
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.audit import AuditContext, set_audit_context
from app.deps import Principal
from app.fake_patients import fake_patient
from app.models import (
    Appointment,
    AppointmentStatus,
    DentalVisit,
    Department,
    Doctor,
    DoctorSchedule,
    InsuranceClass,
    InsuranceCompany,
    LabTest,
    Medication,
    Patient,
    PatientFile,
    PatientInsurance,
    QueueEntry,
    Service,
    Setting,
    ToothFinding,
    User,
    VisitType,
)
from app.permissions import PERMISSION_KEYS
from app.services.scheduling import TZ

DEMO_KEY = "demo_data"
# How much fake activity: about 400 patients and three months of history plus three weeks ahead.
PATIENTS = 400
DAYS_BACK = 90
DAYS_AHEAD = 21
# Refuse when the database already looks like a real clinic's.
REAL_DATA_PATIENTS = 30
COMPLAINTS = [
    "ألم عند المضغ",
    "حساسية للبارد",
    "نزيف اللثة",
    "ألم ليلي في الضرس",
    "كسر في حشوة قديمة",
    "رغبة في تنظيف الأسنان",
    "تورم في اللثة",
]
DIAGNOSES = [
    "تسوس عميق",
    "التهاب لب السن",
    "التهاب اللثة",
    "تسوس بسيط",
    "خراج حول ذروي",
    "ترسبات جيرية",
]
PROCEDURES = [
    "حشوة تجميلية",
    "تنظيف وتلميع",
    "علاج عصب - الجلسة الأولى",
    "خلع بسيط",
    "تركيب تاج مؤقت",
    "أشعة وتقييم",
]
NEXT = ["مراجعة بعد أسبوعين", "مراجعة بعد شهر", "استكمال علاج العصب", ""]
TEETH = [11, 12, 14, 16, 21, 24, 26, 31, 36, 37, 41, 44, 46, 47]


class _Demo:
    def __init__(self, db: Session, seed: int):
        self.db = db
        self.rnd = random.Random(seed)
        self.now: datetime = db.scalar(select(func.now()))
        self.today: date = self.now.astimezone(TZ).date()
        users = {u.username: u for u in db.scalars(select(User))}
        self.reception = users.get("reception") or users["admin"]
        self.cashier = users.get("cashier") or users["admin"]
        self.doctors = list(
            db.scalars(
                select(Doctor).where(Doctor.deleted_at.is_(None)).order_by(Doctor.sort_order)
            )
        )
        if not self.doctors:
            raise SystemExit("Run seed-dev first (it creates the demo doctors and prices).")
        self.doc_user = {
            d.id: (db.get(User, d.user_id) if d.user_id else users["admin"]) for d in self.doctors
        }
        self.statuses = {s.key: s for s in db.scalars(select(AppointmentStatus))}
        self.visit_types = list(db.scalars(select(VisitType)))
        self.services = list(
            db.scalars(select(Service).where(Service.is_active, Service.deleted_at.is_(None)))
        )
        self.cheap = [s for s in self.services if s.sale_price <= 700]
        self.counts: dict[str, int] = {}

    def p(self, user: User) -> Principal:
        set_audit_context(self.db, AuditContext(user_id=user.id, machine="DEMO-DATA", ip=None))
        return Principal(user=user, session_id=uuid.uuid4(), permissions=PERMISSION_KEYS)

    def add(self, key: str, n: int = 1) -> None:
        self.counts[key] = self.counts.get(key, 0) + n

    def at(self, day: date, hh: int, mm: int = 0) -> datetime:
        return datetime.combine(day, time(hh, mm), TZ)

    # ------------------------------------------------------------ patients
    def patients(self, n: int) -> list[Patient]:
        db, rnd = self.db, self.rnd
        start = (db.scalar(select(func.count()).select_from(Patient)) or 0) + 900_000
        company = db.scalar(select(InsuranceCompany).where(InsuranceCompany.code == "DEMO-INS"))
        classes = (
            list(db.scalars(select(InsuranceClass).where(InsuranceClass.company_id == company.id)))
            if company
            else []
        )
        self.p(self.reception)
        out = []
        for i in range(n):
            pt = Patient(
                **fake_patient(start + i, rnd),
                created_by=self.reception.id,
                updated_by=self.reception.id,
            )
            db.add(pt)
            out.append(pt)
        db.flush()
        for pt in out:
            if classes and rnd.random() < 0.35:
                cls = rnd.choice(classes)
                pt.insurance = PatientInsurance(
                    company_id=company.id,
                    class_id=cls.id,
                    class_name=cls.name,
                    policy_no=f"POL-{rnd.randint(10000, 99999)}",
                    membership_no=f"M{pt.id:07d}",
                    expiry=self.today + timedelta(days=rnd.randint(60, 500)),
                )
            # Registered over the last four months (shows in New patients).
            pt.created_at = self.now - timedelta(
                days=rnd.randint(0, DAYS_BACK + 30), hours=rnd.randint(0, 8)
            )
        db.commit()
        self.add("patients", n)
        return out

    # ------------------------------------------------------------ appointments, queue, visits
    def schedule(self, patients: list[Patient]) -> list[tuple[Appointment, Patient]]:
        db, rnd = self.db, self.rnd
        slots = [(9, 0), (9, 40), (10, 20), (11, 40), (16, 0), (16, 40), (17, 20), (18, 0)]
        done = []
        self.p(self.reception)
        for offset in range(-DAYS_BACK, DAYS_AHEAD + 1):
            day = self.today + timedelta(days=offset)
            if day.isoweekday() in (5, 6):  # Friday, Saturday: closed
                continue
            for doc in self.doctors:
                for hh, mm in rnd.sample(slots, rnd.randint(4, 7)):
                    pt = rnd.choice(patients)
                    start = self.at(day, hh, mm)
                    if offset < 0:
                        key = rnd.choices(
                            ["completed", "no_show", "cancelled", "postponed"], [78, 9, 9, 4]
                        )[0]
                    elif offset == 0:
                        key = (
                            "completed"
                            if start < self.now - timedelta(hours=1)
                            else rnd.choice(["confirmed", "arrived", "unconfirmed"])
                        )
                    else:
                        key = rnd.choices(["confirmed", "unconfirmed"], [60, 40])[0]
                    st = self.statuses[key]
                    a = Appointment(
                        patient_id=pt.id,
                        doctor_id=doc.id,
                        clinic_id=doc.clinic_id,
                        starts_at=start,
                        ends_at=start + timedelta(minutes=30),
                        status_id=st.id,
                        blocks_slot=st.blocks_slot,
                        visit_type_id=rnd.choice(self.visit_types).id if self.visit_types else None,
                        service_id=rnd.choice(self.cheap).id
                        if self.cheap and rnd.random() < 0.6
                        else None,
                        note=rnd.choice(["", "", "يفضّل الفترة المسائية", "مريض جديد"]),
                        cancel_reason="اعتذر المريض" if key == "cancelled" else None,
                        created_by=self.reception.id,
                        updated_by=self.reception.id,
                    )
                    db.add(a)
                    if key == "completed":
                        done.append((a, pt))
                    self.add("appointments")
        db.commit()
        return done

    def queue_today(self) -> None:
        db = self.db
        rows = db.execute(
            select(Appointment, AppointmentStatus.key)
            .join(AppointmentStatus, AppointmentStatus.id == Appointment.status_id)
            .where(func.date(func.timezone("Asia/Riyadh", Appointment.starts_at)) == self.today)
            .order_by(Appointment.starts_at)
        ).all()
        no = 0
        self.p(self.reception)
        for a, key in rows:
            if key not in ("completed", "arrived"):
                continue
            no += 1
            received = a.starts_at - timedelta(minutes=10)
            e = QueueEntry(
                day=self.today,
                queue_no=no,
                patient_id=a.patient_id,
                doctor_id=a.doctor_id,
                clinic_id=a.clinic_id,
                appointment_id=a.id,
                received_at=min(received, self.now),
                received_by=self.reception.id,
                created_by=self.reception.id,
                updated_by=self.reception.id,
            )
            if key == "completed":
                e.called_at = a.starts_at
                e.entered_at = a.starts_at + timedelta(minutes=2)
                e.exited_at = a.starts_at + timedelta(minutes=25)
            db.add(e)
            self.add("queue entries")
        db.commit()

    def visits(self, done: list[tuple[Appointment, Patient]]) -> list[DentalVisit]:
        db, rnd = self.db, self.rnd
        out = []
        for a, pt in done:
            if rnd.random() > 0.7:
                continue
            self.p(self.doc_user[a.doctor_id])
            teeth = sorted(rnd.sample(TEETH, rnd.randint(1, 2)))
            v = DentalVisit(
                patient_id=pt.id,
                doctor_id=a.doctor_id,
                appointment_id=a.id,
                visit_at=a.starts_at + timedelta(minutes=5),
                teeth=teeth,
                chief_complaint=rnd.choice(COMPLAINTS),
                diagnosis=rnd.choice(DIAGNOSES),
                procedure=rnd.choice(PROCEDURES),
                next_visit=rnd.choice(NEXT),
                created_by=self.doc_user[a.doctor_id].id,
                updated_by=self.doc_user[a.doctor_id].id,
            )
            db.add(v)
            out.append(v)
            if rnd.random() < 0.4:
                db.add(
                    ToothFinding(
                        patient_id=pt.id,
                        tooth_fdi=teeth[0],
                        category=rnd.choice(["restoration", "endodontic", "extraction"]),
                        description="",
                        created_by=v.created_by,
                    )
                )
            pt.last_visit_at = a.starts_at
            self.add("dental visits")
        db.commit()
        return out

    # ------------------------------------------------------------ prescriptions, lab, reports, images
    def clinical(self, visits: list[DentalVisit]) -> None:
        from app.routers import clinical as c

        db, rnd = self.db, self.rnd
        meds = list(db.scalars(select(Medication)))
        tests = list(db.scalars(select(LabTest)))
        for v in rnd.sample(visits, min(90, len(visits))):
            p = self.p(self.doc_user[v.doctor_id])
            items = [
                c.RxItemIn(
                    drug=m.name,
                    form=m.form,
                    dose=m.dose,
                    frequency=m.frequency,
                    duration=m.duration,
                    instructions=m.instructions,
                )
                for m in rnd.sample(meds, rnd.randint(1, 2))
            ]
            rx = c.create_prescription(
                v.patient_id,
                c.RxIn(doctor_id=v.doctor_id, visit_id=v.id, diagnosis=v.diagnosis, items=items),
                db,
                p,
            )
            self._backdate("prescriptions", rx.id, "issued_at", v.visit_at)
            self.add("prescriptions")
        for v in rnd.sample(visits, min(30, len(visits))):
            p = self.p(self.doc_user[v.doctor_id])
            chosen = rnd.sample(tests, rnd.randint(1, 3))
            req = c.create_lab_request(
                v.patient_id,
                c.LabIn(
                    doctor_id=v.doctor_id,
                    visit_id=v.id,
                    lab_name="مختبر تجريبي",
                    clinical_info="قبل الإجراء الجراحي",
                    items=[
                        c.LabItemIn(
                            test_id=x.id,
                            name=x.name_en,
                            unit=x.unit,
                            reference_range=x.reference_range,
                        )
                        for x in chosen
                    ],
                ),
                db,
                p,
            )
            if rnd.random() < 0.7:
                res = [
                    c.ResultIn(
                        seq=i + 1,
                        result=rnd.choice(["Negative", "5.4", "92", "1.0", "6.8"]),
                        flag=rnd.choice(["normal", "normal", "high"]),
                    )
                    for i in range(len(chosen))
                ]
                c.enter_results(req.id, c.ResultsIn(version=req.version, results=res), db, p)
            self._backdate("lab_requests", req.id, "issued_at", v.visit_at)
            self.add("lab requests")
        for v in rnd.sample(visits, min(18, len(visits))):
            p = self.p(self.doc_user[v.doctor_id])
            kind = rnd.choice(["report", "referral", "attendance"])
            body = {
                "report": f"راجع المريض العيادة وشكواه: {v.chief_complaint}.\nالتشخيص: {v.diagnosis}.\nالعلاج: {v.procedure}.",
                "referral": "نحيل إليكم المريض للتكرم بالفحص والعلاج اللازم لضرس العقل السفلي.",
                "attendance": "نفيد بأن المريض راجع العيادة في التاريخ المذكور أعلاه.",
            }[kind]
            r = c.create_report(
                v.patient_id,
                c.ReportIn(
                    doctor_id=v.doctor_id,
                    visit_id=v.id,
                    kind=kind,
                    recipient="إلى من يهمه الأمر",
                    body=body,
                ),
                db,
                p,
            )
            self._backdate("medical_reports", r.id, "issued_at", v.visit_at)
            self.add("medical reports")

    def images(self, visits: list[DentalVisit]) -> None:
        from app.services import files as storage

        db, rnd = self.db, self.rnd
        try:
            from PIL import Image, ImageDraw
        except ImportError:  # pragma: no cover
            return
        for v in rnd.sample(visits, min(40, len(visits))):
            kind = rnd.choice(["panoramic", "xray", "intraoral"])
            w, h = (1600, 800) if kind == "panoramic" else (900, 700)
            im = Image.new(
                "L" if kind != "intraoral" else "RGB",
                (w, h),
                30 if kind != "intraoral" else (180, 90, 90),
            )
            d = ImageDraw.Draw(im)
            for k in range(14):  # a row of "teeth"
                x = 60 + k * (w - 120) // 14
                d.rounded_rectangle(
                    [x + 6, h // 3, x + (w - 120) // 14 - 6, 2 * h // 3],
                    radius=18,
                    fill=200 if kind != "intraoral" else (245, 240, 230),
                )
            d.text(
                (20, 20), "DEMO - FAKE IMAGE", fill=255 if kind != "intraoral" else (255, 255, 255)
            )
            buf = io.BytesIO()
            im.save(buf, "PNG")
            stored = storage.store_bytes(buf.getvalue(), v.visit_at.astimezone(TZ).date())
            self.p(self.doc_user[v.doctor_id])
            db.add(
                PatientFile(
                    patient_id=v.patient_id,
                    visit_id=v.id,
                    tooth_fdi=v.teeth[0] if v.teeth and kind == "xray" else None,
                    kind=kind,
                    title={
                        "panoramic": "بانوراما",
                        "xray": "أشعة ذروية",
                        "intraoral": "صورة داخل الفم",
                    }[kind],
                    taken_on=v.visit_at.astimezone(TZ).date(),
                    path=stored.path,
                    original_name=f"demo-{kind}.png",
                    content_type=stored.content_type,
                    size=stored.size,
                    sha256=stored.sha256,
                    width=stored.width,
                    height=stored.height,
                    has_thumb=stored.has_thumb,
                    created_by=v.created_by,
                    updated_by=v.created_by,
                )
            )
            self.add("images")
        db.commit()

    # ------------------------------------------------------------ billing
    def _lines(self, n: int):
        from app.services.documents import LineIn

        return [LineIn(service_id=s.id, price=s.sale_price) for s in self.rnd.sample(self.cheap, n)]

    def _backdate(self, table: str, row_id: int, column: str, when: datetime) -> None:
        self._pending.append((table, row_id, column, when))

    def _collect(self, po, payments, when: datetime):
        """Pay a payment order as reception and date the invoice and receipt `when`."""
        from app.routers import billing as b
        from app.routers import ledger as lg
        from app.services.ledger import PaymentIn

        rp = self.p(self.reception)
        try:
            res = lg.collect_payment(
                po.id,
                lg.CollectIn(
                    version=po.version, expected_patient_share=po.patient_share, payments=payments
                ),
                self.db,
                rp,
            )
        except HTTPException as e:  # amounts changed (insurer daily limit): collect the new amount
            if (e.detail or {}).get("code") != "totals_changed":
                raise
            po = b.get_payment_order(po.id, self.db, rp)
            pay = (
                [PaymentIn(method="cash", amount=po.patient_share)] if po.patient_share > 0 else []
            )
            res = lg.collect_payment(
                po.id,
                lg.CollectIn(
                    version=po.version, expected_patient_share=po.patient_share, payments=pay
                ),
                self.db,
                rp,
            )
        self._backdate("invoices", res.invoice.id, "issued_at", when)
        if res.receipt:
            self._backdate("receipts", res.receipt.id, "received_at", when)
        return res

    def _payments(self, pay: Decimal):
        from app.services.ledger import PaymentIn

        rnd = self.rnd
        if pay <= 0:
            return []
        if rnd.random() < 0.3 and pay > 50:
            cash = (pay * Decimal("0.4")).quantize(Decimal("0.01"))
            return [
                PaymentIn(method="cash", amount=cash),
                PaymentIn(
                    method="mada", amount=pay - cash, reference=f"{rnd.randint(100000, 999999)}"
                ),
            ]
        return [PaymentIn(method=rnd.choice(["cash", "mada", "mada", "credit_card"]), amount=pay)]

    def money(self, done: list[tuple[Appointment, Patient]], patients: list[Patient]) -> None:
        """Quotations and plans, then every money event on one timeline, issued in date order so that
        invoice, receipt and credit note numbers rise with their dates, as on a real system."""
        from app.routers import billing as b
        from app.routers import ledger as lg
        from app.services.ledger import PaymentIn

        db, rnd = self.db, self.rnd
        events: list[tuple[datetime, str, tuple]] = []

        for i in range(30):
            doc = rnd.choice(self.doctors)
            p = self.p(self.doc_user[doc.id])
            q = b.create_quotation(
                b.DocIn(
                    patient_id=rnd.choice(patients).id,
                    doctor_id=doc.id,
                    lines=self._lines(rnd.randint(1, 3)),
                ),
                db,
                p,
            )
            if i % 3 == 1:
                b.quotation_action(q.id, "send", b.QuoteAction(version=q.version), db, p)
            elif i % 3 == 2:
                q = b.quotation_action(q.id, "send", b.QuoteAction(version=q.version), db, p)
                b.quotation_action(q.id, "accept", b.QuoteAction(version=q.version), db, p)
            self.add("quotations")

        ortho = self.doctors[0]
        plans = [
            ("تقويم ثابت للفكين", [("تقويم معدني ثابت", 9000), ("تقويم شفاف", 15000)], 0),
            ("زراعة الضرس 36", [("زرعة مع تاج زيركون", 5500)], 0),
            ("تركيبات أمامية", [("ثلاث تيجان زيركون", 4200), ("فينير خزفي", 6000)], None),
        ]
        for title, options, pick in plans * 3:
            p = self.p(self.doc_user[ortho.id])
            plan = b.create_plan(
                b.PlanIn(
                    patient_id=rnd.choice(patients).id,
                    doctor_id=ortho.id,
                    title=title,
                    options=[b.OptionIn(title=t, price=Decimal(pr)) for t, pr in options],
                    sessions=[b.SessionIn(description=f"الجلسة {k + 1}") for k in range(4)],
                ),
                db,
                p,
            )
            self.add("treatment plans")
            if pick is None:
                b.set_plan_status(
                    plan.id, b.PlanStatusIn(version=plan.version, status="proposed"), db, p
                )
                continue
            plan = b.accept_plan(
                plan.id, b.AcceptIn(version=plan.version, option_id=plan.options[pick].id), db, p
            )
            first = self.today - timedelta(days=45)
            plan = b.generate_installments(
                plan.id,
                b.GenerateIn(
                    version=plan.version, count=6, first_due=first, down_payment=Decimal(1000)
                ),
                db,
                p,
            )
            # The down payment is paid; the next installment is overdue (shows in Outstanding).
            po = b.installment_payment_order(
                plan.id, plan.installments[0].id, b.InstallmentOrderIn(), db, p
            )
            events.append((datetime.combine(first, time(10), TZ), "po", (po.id, "transfer")))

        credit_slots = 6
        for a, pt in sorted(done, key=lambda x: x[0].starts_at):
            if rnd.random() > 0.55 or a.starts_at > self.now:
                continue
            when = a.starts_at + timedelta(minutes=35)
            share = rnd.choices(["full", "part", "none"], [75, 15, 10])[0]
            events.append((when, "visit", (a, pt, share)))
            if (
                share == "full"
                and credit_slots
                and when + timedelta(days=1) < self.now - timedelta(hours=1)
                and rnd.random() < 0.1
            ):
                events.append((when + timedelta(days=1), "credit", (a.id, credit_slots == 1)))
                credit_slots -= 1
        for pt in rnd.sample(patients, 10):
            events.append(
                (
                    self.now - timedelta(days=rnd.randint(1, 10), hours=rnd.randint(1, 5)),
                    "deposit",
                    (pt,),
                )
            )

        invoice_of: dict[int, object] = {}
        for when, kind, data in sorted(events, key=lambda e: e[0]):
            if kind == "po":
                po = b.get_payment_order(data[0], db, self.p(self.reception))
                self._collect(
                    po,
                    [
                        PaymentIn(
                            method="bank_transfer", amount=po.patient_share, reference="TRX-DEMO"
                        )
                    ],
                    when,
                )
            elif kind == "visit":
                a, pt, share = data
                doc_p = self.p(self.doc_user[a.doctor_id])
                po = b.create_payment_order(
                    b.DocIn(
                        patient_id=pt.id,
                        doctor_id=a.doctor_id,
                        lines=self._lines(rnd.randint(1, 3)),
                    ),
                    db,
                    doc_p,
                )
                po = b.send_to_reception(po.id, b.SendIn(version=po.version), db, doc_p)
                due = po.patient_share
                pay = (
                    due
                    if share == "full"
                    else (due / 2).quantize(Decimal("0.01"))
                    if share == "part"
                    else Decimal(0)
                )
                invoice_of[a.id] = self._collect(po, self._payments(pay), when).invoice
                self.add("invoices")
            elif kind == "deposit":
                r = lg.take_deposit(
                    data[0].id,
                    lg.DepositIn(
                        payments=[
                            PaymentIn(method="cash", amount=Decimal(rnd.choice([300, 500, 1000])))
                        ],
                        note="دفعة مقدمة (تجريبية)",
                    ),
                    db,
                    self.p(self.reception),
                )
                self._backdate("receipts", r.id, "received_at", when)
                self.add("deposits")
            elif kind == "credit":
                inv = invoice_of.get(data[0])
                if (
                    inv is None
                    or inv.patient_share <= 0
                    or lg.ledger.outstanding(db, [inv.id])[inv.id] != 0
                ):
                    continue
                refund = (
                    lg.RefundIn(to_deposit=True)
                    if data[1]
                    else lg.RefundIn(payments=[PaymentIn(method="cash", amount=inv.patient_share)])
                )
                cn = lg.create_credit_note(
                    inv.id,
                    lg.CreditIn(reason="إلغاء الخدمة (بيانات تجريبية)", refund=refund),
                    db,
                    self.p(self.cashier),
                )
                self._backdate("credit_notes", cn.id, "issued_at", when)
                if cn.refund_receipt_id:
                    self._backdate("receipts", cn.refund_receipt_id, "received_at", when)
                self.add("credit notes")

    def apply_backdates(self) -> None:
        """Demo only: move issued documents to the dates they would have had. Issued tables are
        append-only by trigger; replication_role=replica skips triggers for this transaction."""
        if not self._pending:
            return
        try:
            self.db.execute(text("SET LOCAL session_replication_role = replica"))
        except Exception:  # noqa: BLE001  (needs a superuser; without it the demo keeps today's dates)
            self.db.rollback()
            return
        for table, row_id, column, when in self._pending:
            self.db.execute(
                text(f"update {table} set {column} = :w where id = :i"), {"w": when, "i": row_id}
            )
        self.db.commit()


EXTRA_DOCTORS = [
    # name_ar, name_en, department, specialty, color, room
    (
        "د. سارة القحطاني",
        "Dr. Sara Alqahtani",
        "Endodontics",
        ("أخصائية علاج العصب", "Endodontist"),
        "teal",
        3,
    ),
    (
        "د. خالد الشهري",
        "Dr. Khalid Alshehri",
        "Prosthodontics",
        ("أخصائي تركيبات", "Prosthodontist"),
        "orange",
        4,
    ),
    (
        "د. لمى العتيبي",
        "Dr. Lama Alotaibi",
        "General dentistry",
        ("طبيبة أسنان عامة", "General dentist"),
        "pink",
        5,
    ),
]


def _more_doctors(db: Session) -> None:
    """Three more demo doctors (no sign-in accounts), so departments and the calendar look lived-in."""
    deps = {d.name_en: d for d in db.scalars(select(Department))}
    top = db.scalar(select(func.max(Doctor.sort_order))) or 0
    for i, (ar, en, dep, spec, color, room) in enumerate(EXTRA_DOCTORS):
        if db.scalar(select(Doctor.id).where(Doctor.name_en == en)) or dep not in deps:
            continue
        doc = Doctor(
            name_ar=ar,
            name_en=en,
            specialty_ar=spec[0],
            specialty_en=spec[1],
            department_id=deps[dep].id,
            clinic_id=deps[dep].clinic_id,
            color=color,
            slot_minutes=20,
            room=f"غرفة {room} / Room {room}",
            sort_order=top + (i + 1) * 10,
        )
        days = [0, 1, 2, 3] if i % 2 == 0 else [1, 2, 3, 4]
        doc.schedules = [
            DoctorSchedule(weekday=d, start_time=time(9), end_time=time(14), kind="work")
            for d in days
        ] + [
            DoctorSchedule(weekday=d, start_time=time(17), end_time=time(21), kind="work")
            for d in days
        ]
        db.add(doc)
    db.flush()


def demo_present(db: Session) -> bool:
    return db.get(Setting, DEMO_KEY) is not None


def refuse_real_data(db: Session) -> None:
    real = db.scalar(select(func.count()).select_from(Patient).where(Patient.deleted_at.is_(None)))
    if (real or 0) > REAL_DATA_PATIENTS:
        raise SystemExit(
            f"This database already has {real} patients: demo data is only for an empty test server."
        )


def seed_demo(db: Session, seed: int = 2026) -> dict[str, int]:
    if db.get(Setting, DEMO_KEY) is not None:
        return {}
    refuse_real_data(db)
    _more_doctors(db)
    d = _Demo(db, seed)
    d._pending = []
    pts = d.patients(PATIENTS)
    done = d.schedule(pts)
    d.queue_today()
    visits = d.visits(done)
    d.clinical(visits)
    d.images(visits)
    d.money(done, pts)
    d.apply_backdates()
    db.add(Setting(key=DEMO_KEY, value_json={"seeded_at": d.now.isoformat(), "counts": d.counts}))
    db.commit()
    return d.counts
