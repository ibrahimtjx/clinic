"""Revenue (SPEC 11.1) and the financial reports of SPEC 11.2."""

from collections import defaultdict
from datetime import datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    CreditNote,
    CreditNoteLine,
    Doctor,
    DoctorCommissionRule,
    InsuranceCompany,
    Invoice,
    InvoiceLine,
    Patient,
    PlanInstallment,
    Receipt,
    ReceiptAllocation,
    ReceiptPayment,
    Service,
    TreatmentPlan,
    User,
)
from app.reports.engine import RIYADH, Col, Filters, Item, Report, Section, report, totals, within
from app.services import ledger
from app.services.pricing import money

Z = Decimal(0)
METHOD_AR = {
    "cash": "نقدًا",
    "mada": "مدى",
    "credit_card": "بطاقة ائتمان",
    "bank_transfer": "تحويل بنكي",
    "deposit": "من رصيد المريض",
}
METHOD_EN = {
    "cash": "Cash",
    "mada": "Mada",
    "credit_card": "Credit card",
    "bank_transfer": "Bank transfer",
    "deposit": "From account",
}
KIND_AR = {"payment": "سداد", "installment": "قسط", "deposit": "دفعة مقدمة", "refund": "استرداد"}
KIND_EN = {
    "payment": "Payment",
    "installment": "Installment",
    "deposit": "Deposit",
    "refund": "Refund",
}


def _doctors(db: Session) -> dict[int, Doctor]:
    return {d.id: d for d in db.scalars(select(Doctor))}


def _users(db: Session) -> dict[int, str]:
    return dict(db.execute(select(User.id, User.full_name_ar)).all())


def _invoice_filter(stmt, f: Filters):
    if f.doctor_id:
        stmt = stmt.where(Invoice.doctor_id == f.doctor_id)
    if f.clinic_id:
        stmt = stmt.where(Invoice.clinic_id == f.clinic_id)
    if f.patient_id:
        stmt = stmt.where(Invoice.patient_id == f.patient_id)
    return stmt


# ---------------------------------------------------------------- 11.1 revenue
@report(
    key="revenue",
    ar="تقرير الإيرادات",
    en="Revenue report",
    group="financial",
    perms=("report.revenue", "report.financial"),
    filters=("date_range", "user", "doctor", "patient", "clinic", "method"),
    description_ar="المقبوضات بالتفصيل مع ملخص بطرق الدفع والضريبة والإشعارات الدائنة.",
    description_en="Money received in detail, with totals by method, VAT and credit notes.",
)
def revenue(db: Session, f: Filters) -> Report:
    q = (
        select(Receipt)
        .where(*within(Receipt.received_at, f))
        .order_by(Receipt.received_at, Receipt.id)
    )
    if f.user_id:
        q = q.where(Receipt.received_by == f.user_id)
    if f.patient_id:
        q = q.where(Receipt.patient_id == f.patient_id)
    if f.method:
        q = q.where(
            Receipt.id.in_(
                select(ReceiptPayment.receipt_id).where(ReceiptPayment.method == f.method)
            )
        )
    receipts = list(db.scalars(q))
    rids = [r.id for r in receipts]
    pays: dict[int, list[ReceiptPayment]] = defaultdict(list)
    allocs: dict[int, list[ReceiptAllocation]] = defaultdict(list)
    if rids:
        for p in db.scalars(
            select(ReceiptPayment)
            .where(ReceiptPayment.receipt_id.in_(rids))
            .order_by(ReceiptPayment.id)
        ):
            pays[p.receipt_id].append(p)
        for a in db.scalars(
            select(ReceiptAllocation).where(ReceiptAllocation.receipt_id.in_(rids))
        ):
            allocs[a.receipt_id].append(a)
    inv_ids = {a.invoice_id for v in allocs.values() for a in v} | {
        r.invoice_id for r in receipts if r.invoice_id
    }
    invoices = (
        {i.id: i for i in db.scalars(select(Invoice).where(Invoice.id.in_(inv_ids)))}
        if inv_ids
        else {}
    )
    lines: dict[int, list[InvoiceLine]] = defaultdict(list)
    if inv_ids:
        for ln in db.scalars(
            select(InvoiceLine).where(InvoiceLine.invoice_id.in_(inv_ids)).order_by(InvoiceLine.seq)
        ):
            lines[ln.invoice_id].append(ln)
    patients = (
        {
            p.id: p
            for p in db.scalars(
                select(Patient).where(Patient.id.in_({r.patient_id for r in receipts}))
            )
        }
        if receipts
        else {}
    )
    doctors = _doctors(db)

    def method_text(r: Receipt, lang: str) -> str:
        names = METHOD_AR if lang == "ar" else METHOD_EN
        ps = pays[r.id]
        if len(ps) == 1:
            return names[ps[0].method]
        return " + ".join(f"{names[p.method]} {p.amount:.2f}" for p in ps)

    rows = []
    for r in receipts:
        cash_total = sum((p.amount for p in pays[r.id] if p.method != "deposit"), Z)
        if r.kind == "refund" and cash_total == 0:
            continue  # credit kept on the patient's account: no money moved (listed in the summary)
        sign = Decimal(-1) if r.kind == "refund" else Decimal(1)
        cash_share = lambda a, ct=cash_total, t=r.total: money(a * ct / t) if t else Z
        parts = [(a.invoice_id, a.amount) for a in allocs[r.id]] or [(r.invoice_id, r.total)]
        for inv_id, amount in parts:
            inv = invoices.get(inv_id) if inv_id else None
            if (f.doctor_id or f.clinic_id) and (
                inv is None
                or (f.doctor_id and inv.doctor_id != f.doctor_id)
                or (f.clinic_id and inv.clinic_id != f.clinic_id)
            ):
                continue
            pt = patients[r.patient_id]
            ls = lines.get(inv_id, [])
            rates = sorted({ln.vat_rate for ln in ls})
            doc = doctors.get(inv.doctor_id) if inv and inv.doctor_id else None
            rows.append(
                {
                    "receipt_no": r.receipt_no,
                    "kind_ar": KIND_AR[r.kind],
                    "kind_en": KIND_EN[r.kind],
                    "invoice_no": inv.invoice_no if inv else "",
                    "at": r.received_at,
                    "patient": f"{pt.name_ar} ({pt.file_no})",
                    "doctor": doc.name_ar if doc else "",
                    "services_ar": "، ".join(ln.description_ar for ln in ls),
                    "services_en": ", ".join(ln.description_en or ln.description_ar for ln in ls),
                    "total": inv.total if inv else None,
                    "discount": inv.discount if inv else None,
                    "net": inv.net if inv else None,
                    "amount": sign * cash_share(amount),
                    "from_account": (amount - cash_share(amount))
                    if cash_total != r.total
                    else None,
                    "method_ar": method_text(r, "ar"),
                    "method_en": method_text(r, "en"),
                    "vat_rate": " / ".join(f"{x:.0f}%" for x in rates),
                    "vat": sign * (money(r.vat * amount / r.total) if r.total else Z),
                }
            )
    detail = Section(
        "detail",
        "المقبوضات",
        "Receipts",
        [
            Col("receipt_no", "رقم السند", "Receipt no."),
            Col("kind_ar", "النوع", "Type"),
            Col("invoice_no", "رقم الفاتورة", "Invoice no."),
            Col("at", "التاريخ والوقت", "Date and time", "datetime"),
            Col("patient", "المريض (رقم الملف)", "Patient (file no.)"),
            Col("doctor", "الطبيب", "Doctor"),
            Col("services_ar", "الخدمة", "Service"),
            Col("services_en", "الخدمة (إنجليزي)", "Service (English)"),
            Col("total", "إجمالي الفاتورة", "Invoice total", "money"),
            Col("discount", "الخصم", "Discounts", "money"),
            Col("net", "الصافي قبل الضريبة", "Net before VAT", "money"),
            Col("amount", "المبلغ المدفوع", "Amount paid", "money"),
            Col("from_account", "من رصيد المريض", "From account", "money"),
            Col("method_ar", "طريقة الدفع", "Method"),
            Col("vat_rate", "نسبة الضريبة", "VAT rate"),
            Col("vat", "الضريبة ضمن المبلغ", "VAT in amount", "money"),
        ],
        rows,
        totals(rows, ["amount", "from_account", "vat"]),
    )

    # Payments by method (money that moved, filtered by user and dates).
    pq = (
        select(
            Receipt.kind,
            ReceiptPayment.method,
            func.sum(ReceiptPayment.amount),
            func.sum(ReceiptPayment.vat),
        )
        .join(Receipt, Receipt.id == ReceiptPayment.receipt_id)
        .where(Receipt.id.in_([r.id for r in receipts]) if receipts else False)
        .group_by(Receipt.kind, ReceiptPayment.method)
    )
    by_method: dict[str, dict[str, Decimal]] = {m: {"in": Z, "out": Z, "vat": Z} for m in METHOD_EN}
    for kind, method, amount, vat in db.execute(pq).all() if receipts else []:
        m = by_method[method]
        if kind == "refund":
            m["out"] += amount
            m["vat"] -= vat
        else:
            m["in"] += amount
            m["vat"] += vat
    mrows = [
        {
            "method_ar": METHOD_AR[k],
            "method_en": METHOD_EN[k],
            "in": v["in"],
            "out": v["out"],
            "net": v["in"] - v["out"],
            "vat": v["vat"],
        }
        for k, v in by_method.items()
        if (v["in"] or v["out"]) and k != "deposit"  # money on account is not cash; see the summary
    ]
    methods = Section(
        "methods",
        "المدفوعات حسب طريقة الدفع",
        "Payments by method",
        [
            Col("method_ar", "طريقة الدفع", "Method"),
            Col("in", "المقبوض", "Received", "money"),
            Col("out", "المسترد", "Refunded", "money"),
            Col("net", "الصافي", "Net", "money"),
            Col("vat", "منها ضريبة", "Of which VAT", "money"),
        ],
        mrows,
        totals(mrows, ["in", "out", "net", "vat"]),
    )

    iq = _invoice_filter(select(Invoice).where(*within(Invoice.issued_at, f)), f)
    invs = list(db.scalars(iq))
    cq = (
        select(CreditNote)
        .join(Invoice, Invoice.id == CreditNote.invoice_id)
        .where(*within(CreditNote.issued_at, f))
    )
    cns = list(db.scalars(_invoice_filter(cq, f)))
    cash_methods = [k for k in METHOD_EN if k != "deposit"]
    collected = sum((v["in"] for k, v in by_method.items() if k in cash_methods), Z)
    refunded = sum((v["out"] for k, v in by_method.items() if k in cash_methods), Z)
    np_q = (
        select(func.count())
        .select_from(Patient)
        .where(*within(Patient.created_at, f), Patient.deleted_at.is_(None))
    )
    summary = [
        Item("مرضى جدد في الفترة", "New patients in the period", db.scalar(np_q), "int"),
        Item("عدد الفواتير", "Invoice count", len(invs), "int"),
        Item("الإجمالي قبل الخصم", "Gross", sum((i.gross for i in invs), Z)),
        Item("الخصومات", "Discounts", sum((i.discount for i in invs), Z)),
        Item("الصافي بدون ضريبة", "Net without VAT", sum((i.net for i in invs), Z)),
        Item("الضريبة", "VAT", sum((i.vat for i in invs), Z)),
        Item("إجمالي الفواتير", "Invoices total", sum((i.total for i in invs), Z)),
        Item(
            "منها حصة التأمين",
            "Of which insurance share",
            sum((i.insurance_share for i in invs), Z),
        ),
        Item("إجمالي المحصّل", "Total collected", collected),
        Item("الإشعارات الدائنة (العدد)", "Credit notes (count)", len(cns), "int"),
        Item("الإشعارات الدائنة (القيمة)", "Credit notes (value)", sum((c.total for c in cns), Z)),
        Item("المبالغ المستردة", "Refunds paid out", refunded),
        Item(
            "الدفعات المقدمة المستلمة",
            "Deposits received",
            sum((r.total for r in receipts if r.kind == "deposit"), Z),
        ),
        Item("المدفوع من رصيد المريض", "Paid from money on account", by_method["deposit"]["in"]),
        Item(
            "إشعارات دائنة أضيفت لرصيد المريض",
            "Credit kept on account",
            by_method["deposit"]["out"],
        ),
    ]
    return Report(
        [detail, methods],
        summary,
        notes_ar=[
            "الفواتير والإشعارات الدائنة في الملخص حسب تاريخ إصدارها؛ المقبوضات حسب تاريخ السند.",
            "المبالغ المدفوعة هي ما دخل الصندوق فعلًا؛ الدفع من رصيد المريض حُسب عند استلام الدفعة المقدمة.",
        ],
        notes_en=[
            "Invoices and credit notes in the summary are by issue date; receipts by receipt date.",
            (
                "Amounts paid are money that went through the cash box; paying from money on "
                "account was counted when the deposit was taken."
            ),
        ],
    )


# ---------------------------------------------------------------- doctor production and commission
def _rate(
    rules: list[DoctorCommissionRule], service_id: int | None, department_id: int | None
) -> Decimal:
    for r in rules:
        if service_id and r.service_id == service_id:
            return r.percent
    for r in rules:
        if department_id and r.department_id == department_id and r.service_id is None:
            return r.percent
    for r in rules:
        if r.service_id is None and r.department_id is None:
            return r.percent
    return Z


@report(
    key="doctor_production",
    ar="إنتاج الأطباء والعمولات",
    en="Doctor production and commission",
    group="financial",
    perms=("report.financial",),
    filters=("date_range", "doctor", "clinic"),
    description_ar="الفواتير والمحصّل لكل طبيب، والعمولة على المحصّل ناقص المسترد (بدون الضريبة).",
    description_en="Invoiced and collected per doctor; commission on collected minus refunds, without VAT.",
)
def doctor_production(db: Session, f: Filters) -> Report:
    doctors = _doctors(db)
    rules: dict[int, list[DoctorCommissionRule]] = defaultdict(list)
    for r in db.scalars(select(DoctorCommissionRule)):
        rules[r.doctor_id].append(r)
    svc_dept = dict(db.execute(select(Service.id, Service.department_id)).all())
    acc: dict[int, dict[str, Decimal]] = defaultdict(lambda: defaultdict(Decimal))

    for inv in db.scalars(
        _invoice_filter(
            select(Invoice).where(Invoice.doctor_id.is_not(None), *within(Invoice.issued_at, f)), f
        )
    ):
        a = acc[inv.doctor_id]
        a["invoices"] += 1
        a["net"] += inv.net
        a["patient_net"] += inv.patient_share - inv.patient_vat
        a["insurance_net"] += inv.insurance_share - inv.insurance_vat

    def spread(inv: Invoice, amount_ex_vat: Decimal, sign: int) -> None:
        """Commission on an amount collected (or refunded) against one invoice, by line rates."""
        ls = list(db.scalars(select(InvoiceLine).where(InvoiceLine.invoice_id == inv.id)))
        weights = [(ln.patient_share - (ln.vat_amount - ln.insurance_vat)) for ln in ls]
        total_w = sum(weights, Z)
        a = acc[inv.doctor_id]
        for ln, w in zip(ls, weights, strict=True):
            part = amount_ex_vat * w / total_w if total_w else Z
            rate = _rate(
                rules[inv.doctor_id],
                ln.service_id,
                svc_dept.get(ln.service_id) if ln.service_id else None,
            )
            a["commission"] += sign * part * rate / 100
        a["collected" if sign > 0 else "refunded"] += amount_ex_vat

    paid = db.execute(
        _invoice_filter(
            select(Invoice, func.sum(ReceiptAllocation.amount))
            .join(ReceiptAllocation, ReceiptAllocation.invoice_id == Invoice.id)
            .join(Receipt, Receipt.id == ReceiptAllocation.receipt_id)
            .where(Invoice.doctor_id.is_not(None), *within(Receipt.received_at, f))
            .group_by(Invoice.id),
            f,
        )
    ).all()
    for inv, amount in paid:
        ex = amount - (
            money(amount * inv.patient_vat / inv.patient_share) if inv.patient_share else Z
        )
        spread(inv, ex, 1)
    refunds = db.execute(
        _invoice_filter(
            select(Invoice, CreditNote)
            .join(CreditNote, CreditNote.invoice_id == Invoice.id)
            .where(
                Invoice.doctor_id.is_not(None),
                CreditNote.refunded > 0,
                *within(CreditNote.issued_at, f),
            ),
            f,
        )
    ).all()
    for inv, cn in refunds:
        ex = cn.refunded - (
            money(cn.refunded * cn.patient_vat / cn.patient_share) if cn.patient_share else Z
        )
        spread(inv, ex, -1)

    rows = []
    for did, a in sorted(acc.items(), key=lambda kv: doctors[kv[0]].sort_order):
        base = a["collected"] - a["refunded"]
        rows.append(
            {
                "doctor": doctors[did].name_ar,
                "doctor_en": doctors[did].name_en,
                "invoices": a["invoices"],
                "net": a["net"],
                "patient_net": a["patient_net"],
                "insurance_net": a["insurance_net"],
                "collected": a["collected"],
                "refunded": a["refunded"],
                "base": base,
                "commission": money(a["commission"]),
            }
        )
    sec = Section(
        "doctors",
        "حسب الطبيب",
        "By doctor",
        [
            Col("doctor", "الطبيب", "Doctor"),
            Col("invoices", "الفواتير", "Invoices", "int"),
            Col("net", "صافي الفواتير", "Invoiced net", "money"),
            Col("patient_net", "حصة المرضى", "Patients' share", "money"),
            Col("insurance_net", "حصة التأمين", "Insurance share", "money"),
            Col("collected", "المحصّل", "Collected", "money"),
            Col("refunded", "المسترد", "Refunded", "money"),
            Col("base", "أساس العمولة", "Commission base", "money"),
            Col("commission", "العمولة", "Commission", "money"),
        ],
        rows,
        totals(
            rows,
            ["net", "patient_net", "insurance_net", "collected", "refunded", "base", "commission"],
        ),
    )
    return Report(
        [sec],
        notes_ar=[
            "كل المبالغ بدون ضريبة. العمولة على ما حصّله المريض فعليًا؛ حصة التأمين تُحتسب عند تحصيل المطالبات (لاحقًا). النسبة: الخدمة ثم القسم ثم النسبة العامة للطبيب."
        ],
        notes_en=[
            "All amounts without VAT. Commission is on money actually collected from patients; insurance share counts once claims are collected (later). Rate: service, then department, then the doctor's general rate."
        ],
    )


# ---------------------------------------------------------------- patient account statement
@report(
    key="account_statement",
    ar="كشف حساب مريض",
    en="Patient account statement",
    group="financial",
    perms=("report.financial", "invoice.view"),
    filters=("date_range", "patient_required"),
    description_ar="كل الفواتير والسندات والإشعارات الدائنة للمريض مع الرصيد الجاري.",
    description_en="Every invoice, receipt and credit note of a patient with the running balance.",
)
def account_statement(db: Session, f: Filters) -> Report:
    if not f.patient_id:
        raise ValueError("patient_required")
    pid = f.patient_id
    events: list[tuple[datetime, int, dict]] = []
    for inv in db.scalars(select(Invoice).where(Invoice.patient_id == pid)):
        events.append(
            (
                inv.issued_at,
                0,
                {
                    "doc": inv.invoice_no,
                    "ar": "فاتورة",
                    "en": "Invoice",
                    "owed": inv.patient_share,
                    "acct": Z,
                },
            )
        )
    for cn in db.scalars(select(CreditNote).where(CreditNote.patient_id == pid)):
        events.append(
            (
                cn.issued_at,
                1,
                {
                    "doc": cn.credit_note_no,
                    "ar": f"إشعار دائن: {cn.reason}",
                    "en": f"Credit note: {cn.reason}",
                    "owed": -cn.balance_reduced,
                    "acct": Z,
                },
            )
        )
    for r in db.scalars(select(Receipt).where(Receipt.patient_id == pid)):
        ps = list(db.scalars(select(ReceiptPayment).where(ReceiptPayment.receipt_id == r.id)))
        from_acct = sum((p.amount for p in ps if p.method == "deposit"), Z)
        methods_ar = " + ".join(METHOD_AR[p.method] for p in ps)
        methods_en = " + ".join(METHOD_EN[p.method] for p in ps)
        if r.kind in ("payment", "installment"):
            e = {"owed": -r.total, "acct": -from_acct}
        elif r.kind == "deposit":
            e = {"owed": Z, "acct": r.total}
        elif r.credit_note_id:  # refund of a credit note: cash out, or kept on account
            e = {"owed": Z, "acct": from_acct}
        else:  # money on account given back
            e = {"owed": Z, "acct": -r.total}
        e.update(
            doc=r.receipt_no,
            ar=f"{KIND_AR[r.kind]} ({methods_ar})",
            en=f"{KIND_EN[r.kind]} ({methods_en})",
            amount=r.total,
        )
        events.append((r.received_at, 2, e))
    events.sort(key=lambda x: (x[0], x[1]))
    owed = acct = Z
    rows = []
    start, end = f.start(), f.end()
    for at, _, e in events:
        if end and at >= end:
            break
        owed += e["owed"]
        acct += e["acct"]
        if start and at < start:
            continue
        rows.append(
            {
                "at": at,
                "doc": e["doc"],
                "desc_ar": e["ar"],
                "desc_en": e["en"],
                "debit": e["owed"] if e["owed"] > 0 else None,
                "credit": -e["owed"] if e["owed"] < 0 else None,
                "owed": owed,
                "acct_change": e["acct"] or None,
                "acct": acct,
            }
        )
    opening_owed = owed - sum((r["debit"] or Z) - (r["credit"] or Z) for r in rows)
    opening_acct = acct - sum((r["acct_change"] or Z) for r in rows)
    pt = db.get(Patient, pid)
    sec = Section(
        "statement",
        f"{pt.name_ar} ({pt.file_no})",
        f"{pt.name_en or pt.name_ar} ({pt.file_no})",
        [
            Col("at", "التاريخ", "Date", "datetime"),
            Col("doc", "المستند", "Document"),
            Col("desc_ar", "البيان", "Description"),
            Col("debit", "مدين (مستحق)", "Debit (owed)", "money"),
            Col("credit", "دائن (مسدد)", "Credit (paid)", "money"),
            Col("owed", "المستحق", "Balance owed", "money"),
            Col("acct_change", "حركة الرصيد", "Account movement", "money"),
            Col("acct", "رصيد المريض", "On account", "money"),
        ],
        rows,
        totals(rows, ["debit", "credit"]),
    )
    return Report(
        [sec],
        [
            Item("الرصيد الافتتاحي المستحق", "Opening balance owed", opening_owed),
            Item("الرصيد الختامي المستحق", "Closing balance owed", owed),
            Item("رصيد المريض الافتتاحي", "Opening on account", opening_acct),
            Item("رصيد المريض الختامي", "Closing on account", acct),
        ],
    )


# ---------------------------------------------------------------- outstanding balances
@report(
    key="outstanding",
    ar="الأرصدة المستحقة والأقساط المتأخرة",
    en="Outstanding balances and overdue installments",
    group="financial",
    perms=("report.financial",),
    filters=("patient",),
    description_ar="المرضى الذين عليهم مبالغ مستحقة، والأقساط المتأخرة في خطط العلاج.",
    description_en="Patients who owe money, and overdue treatment plan installments.",
)
def outstanding(db: Session, f: Filters) -> Report:
    today = datetime.now(tz=RIYADH).date()
    q = (
        select(Patient)
        .where(Patient.balance > 0, Patient.deleted_at.is_(None))
        .order_by(Patient.balance.desc())
    )
    if f.patient_id:
        q = q.where(Patient.id == f.patient_id)
    rows = []
    for pt in db.scalars(q):
        ids = list(
            db.scalars(
                select(Invoice.id).where(Invoice.patient_id == pt.id).order_by(Invoice.issued_at)
            )
        )
        owed = ledger.outstanding(db, ids)
        oldest_id = next((i for i in ids if owed[i] > 0), None)
        oldest = db.get(Invoice, oldest_id) if oldest_id else None
        rows.append(
            {
                "file_no": pt.file_no,
                "patient": pt.name_ar,
                "mobile": pt.mobile or "",
                "balance": pt.balance,
                "invoices": sum(1 for v in owed.values() if v > 0),
                "oldest": oldest.issued_at if oldest else None,
                "days": (today - oldest.issued_at.astimezone(RIYADH).date()).days
                if oldest
                else None,
            }
        )
    balances = Section(
        "balances",
        "مبالغ مستحقة على المرضى",
        "Patient balances",
        [
            Col("file_no", "رقم الملف", "File no.", "int"),
            Col("patient", "المريض", "Patient"),
            Col("mobile", "الجوال", "Mobile"),
            Col("invoices", "فواتير غير مسددة", "Unpaid invoices", "int"),
            Col("oldest", "أقدم فاتورة", "Oldest invoice", "date"),
            Col("days", "منذ (يوم)", "Days", "int"),
            Col("balance", "المستحق", "Owed", "money"),
        ],
        rows,
        totals(rows, ["balance"]),
    )
    iq = (
        select(PlanInstallment, TreatmentPlan, Patient)
        .join(TreatmentPlan, TreatmentPlan.id == PlanInstallment.plan_id)
        .join(Patient, Patient.id == TreatmentPlan.patient_id)
        .where(
            PlanInstallment.due_date < today,
            PlanInstallment.paid_amount < PlanInstallment.amount,
            TreatmentPlan.status.in_(("accepted", "in_progress")),
            TreatmentPlan.deleted_at.is_(None),
        )
        .order_by(PlanInstallment.due_date)
    )
    if f.patient_id:
        iq = iq.where(Patient.id == f.patient_id)
    irows = [
        {
            "file_no": pt.file_no,
            "patient": pt.name_ar,
            "mobile": pt.mobile or "",
            "plan": pl.title,
            "due": i.due_date,
            "days": (today - i.due_date).days,
            "amount": i.amount,
            "paid": i.paid_amount,
            "left": i.amount - i.paid_amount,
        }
        for i, pl, pt in db.execute(iq).all()
    ]
    overdue = Section(
        "installments",
        "أقساط متأخرة",
        "Overdue installments",
        [
            Col("file_no", "رقم الملف", "File no.", "int"),
            Col("patient", "المريض", "Patient"),
            Col("mobile", "الجوال", "Mobile"),
            Col("plan", "الخطة", "Plan"),
            Col("due", "تاريخ الاستحقاق", "Due date", "date"),
            Col("days", "متأخر (يوم)", "Days overdue", "int"),
            Col("amount", "القسط", "Installment", "money"),
            Col("paid", "المدفوع", "Paid", "money"),
            Col("left", "المتبقي", "Remaining", "money"),
        ],
        irows,
        totals(irows, ["amount", "paid", "left"]),
    )
    return Report(
        [balances, overdue],
        [
            Item("إجمالي المستحق على المرضى", "Total owed by patients", balances.totals["balance"]),
            Item("إجمالي الأقساط المتأخرة", "Total overdue installments", overdue.totals["left"]),
        ],
        notes_ar=["الأقساط مبالغ قبل الضريبة."],
        notes_en=["Installment amounts are before VAT."],
    )


# ---------------------------------------------------------------- insurance summary
@report(
    key="insurance",
    ar="ملخص التأمين حسب الشركة",
    en="Insurance summary per company",
    group="financial",
    perms=("report.financial",),
    filters=("date_range", "company", "doctor", "clinic"),
    description_ar="حصة شركات التأمين في الفواتير (المطالبات) بعد الإشعارات الدائنة، مع التفاصيل.",
    description_en="Insurance companies' share of invoices (claims) after credit notes, with details.",
)
def insurance(db: Session, f: Filters) -> Report:
    q = _invoice_filter(
        select(Invoice)
        .where(Invoice.insurance_company_id.is_not(None), *within(Invoice.issued_at, f))
        .order_by(Invoice.issued_at),
        f,
    )
    if f.company_id:
        q = q.where(Invoice.insurance_company_id == f.company_id)
    invs = list(db.scalars(q))
    credited = (
        dict(
            db.execute(
                select(CreditNote.invoice_id, func.sum(CreditNote.insurance_share))
                .where(CreditNote.invoice_id.in_([i.id for i in invs]))
                .group_by(CreditNote.invoice_id)
            ).all()
        )
        if invs
        else {}
    )
    companies = {c.id: c for c in db.scalars(select(InsuranceCompany))}
    by_co: dict[int, dict] = {}
    detail = []
    for inv in invs:
        c = by_co.setdefault(inv.insurance_company_id, defaultdict(Decimal))
        cr = credited.get(inv.id, Z)
        c["count"] += 1
        c["total"] += inv.total
        c["patient"] += inv.patient_share
        c["insurance"] += inv.insurance_share
        c["credited"] += cr
        snap = inv.insurance or {}
        detail.append(
            {
                "company": companies[inv.insurance_company_id].name_ar,
                "invoice_no": inv.invoice_no,
                "at": inv.issued_at,
                "patient": f"{inv.buyer_name_ar} ({inv.buyer_file_no})",
                "membership": snap.get("membership_no") or "",
                "class": snap.get("class_name") or "",
                "total": inv.total,
                "insurance": inv.insurance_share,
                "credited": cr,
                "claim": inv.insurance_share - cr,
            }
        )
    rows = [
        {
            "company": companies[cid].name_ar,
            "company_en": companies[cid].name_en,
            "count": c["count"],
            "total": c["total"],
            "patient": c["patient"],
            "insurance": c["insurance"],
            "credited": c["credited"],
            "claim": c["insurance"] - c["credited"],
        }
        for cid, c in by_co.items()
    ]
    money_cols = ["total", "patient", "insurance", "credited", "claim"]
    return Report(
        [
            Section(
                "companies",
                "حسب الشركة",
                "By company",
                [
                    Col("company", "الشركة", "Company"),
                    Col("count", "الفواتير", "Invoices", "int"),
                    Col("total", "إجمالي الفواتير", "Invoices total", "money"),
                    Col("patient", "حصة المرضى", "Patients' share", "money"),
                    Col("insurance", "حصة التأمين", "Insurance share", "money"),
                    Col("credited", "إشعارات دائنة", "Credited", "money"),
                    Col("claim", "صافي المطالبة", "Net claim", "money"),
                ],
                rows,
                totals(rows, money_cols),
            ),
            Section(
                "invoices",
                "الفواتير",
                "Invoices",
                [
                    Col("company", "الشركة", "Company"),
                    Col("invoice_no", "رقم الفاتورة", "Invoice no."),
                    Col("at", "التاريخ", "Date", "date"),
                    Col("patient", "المريض", "Patient"),
                    Col("membership", "رقم العضوية", "Membership no."),
                    Col("class", "الفئة", "Class"),
                    Col("total", "الإجمالي", "Total", "money"),
                    Col("insurance", "حصة التأمين", "Insurance share", "money"),
                    Col("credited", "إشعارات دائنة", "Credited", "money"),
                    Col("claim", "صافي المطالبة", "Net claim", "money"),
                ],
                detail,
                totals(detail, ["total", "insurance", "credited", "claim"]),
            ),
        ],
        notes_ar=["الإشعارات الدائنة محسوبة على فواتير الفترة أيًا كان تاريخها."],
        notes_en=[
            "Credit notes are counted against the period's invoices whatever their own date."
        ],
    )


# ---------------------------------------------------------------- services sold
@report(
    key="services_sold",
    ar="الخدمات المباعة",
    en="Services sold",
    group="financial",
    perms=("report.financial",),
    filters=("date_range", "doctor", "clinic"),
    description_ar="العدد والقيمة لكل خدمة في الفواتير، ناقص المرتجع.",
    description_en="Count and value per service on invoices, less credited quantities.",
)
def services_sold(db: Session, f: Filters) -> Report:
    q = _invoice_filter(
        select(InvoiceLine, Service.code)
        .join(Invoice, Invoice.id == InvoiceLine.invoice_id)
        .outerjoin(Service, Service.id == InvoiceLine.service_id)
        .where(*within(Invoice.issued_at, f)),
        f,
    )
    acc: dict[tuple, dict] = {}
    line_key = {}
    for ln, code in db.execute(q).all():
        key = (ln.service_id, None if ln.service_id else ln.description_ar)
        line_key[ln.id] = key
        a = acc.setdefault(
            key,
            {
                "code": code or "",
                "name_ar": ln.description_ar,
                "name_en": ln.description_en,
                **{
                    k: Z
                    for k in ("qty", "gross", "discount", "net", "vat", "total", "cr_qty", "cr_net")
                },
            },
        )
        a["qty"] += ln.qty
        a["gross"] += ln.gross
        a["discount"] += ln.discount
        a["net"] += ln.net
        a["vat"] += ln.vat_amount
        a["total"] += ln.line_total
    if line_key:
        for c in db.scalars(
            select(CreditNoteLine).where(CreditNoteLine.invoice_line_id.in_(list(line_key)))
        ):
            a = acc[line_key[c.invoice_line_id]]
            a["cr_qty"] += c.qty
            a["cr_net"] += c.net
    rows = sorted(
        ({**a, "net_after": a["net"] - a["cr_net"]} for a in acc.values()),
        key=lambda r: r["net_after"],
        reverse=True,
    )
    return Report(
        [
            Section(
                "services",
                "الخدمات",
                "Services",
                [
                    Col("code", "الرمز", "Code"),
                    Col("name_ar", "الخدمة", "Service"),
                    Col("name_en", "الخدمة (إنجليزي)", "Service (English)"),
                    Col("qty", "الكمية", "Qty", "number"),
                    Col("gross", "الإجمالي", "Gross", "money"),
                    Col("discount", "الخصم", "Discounts", "money"),
                    Col("net", "الصافي", "Net", "money"),
                    Col("vat", "الضريبة", "VAT", "money"),
                    Col("total", "الإجمالي مع الضريبة", "Total with VAT", "money"),
                    Col("cr_qty", "الكمية المرتجعة", "Credited qty", "number"),
                    Col("net_after", "الصافي بعد المرتجع", "Net after credits", "money"),
                ],
                rows,
                totals(rows, ["gross", "discount", "net", "vat", "total", "net_after"]),
            )
        ]
    )
