"""Admin commands.

python -m app.cli create-admin --username admin --name-ar "مدير النظام"
python -m app.cli seed-dev        # fake users for development only
"""

import argparse
import getpass
import sys
from datetime import time
from decimal import Decimal

from sqlalchemy import func, select, text

from app.audit import log_event
from app.db import SessionLocal
from app.models import (
    Department,
    Doctor,
    DoctorCommissionRule,
    DoctorSchedule,
    InsuranceClass,
    InsuranceCompany,
    Role,
    SavedPhrase,
    Service,
    User,
    UserRole,
)
from app.security import PolicyError, check_password_policy, hash_secret
from app.services.settings import ClinicInfo, save_setting

DEV_PASSWORD = "Clinic-dev-2026"


def _create(
    db,
    username: str,
    name_ar: str,
    name_en: str,
    password: str,
    role_keys: list[str],
    must_change: bool,
):
    if db.scalar(select(User.id).where(func.lower(User.username) == username.lower())):
        print(f"User {username} already exists", file=sys.stderr)
        return None
    check_password_policy(password, username)
    user = User(
        username=username,
        full_name_ar=name_ar,
        full_name_en=name_en,
        password_hash=hash_secret(password),
        must_change_password=must_change,
    )
    db.add(user)
    db.flush()
    for key in role_keys:
        role = db.scalar(select(Role).where(Role.key == key))
        db.add(UserRole(user_id=user.id, role_id=role.id))
    return user


def create_admin(args) -> int:
    password = args.password or getpass.getpass("Password (min 10 characters): ")
    with SessionLocal() as db:
        try:
            user = _create(
                db,
                args.username,
                args.name_ar,
                args.name_en,
                password,
                ["admin"],
                must_change=False,
            )
        except PolicyError as e:
            print(f"Rejected: {e.code}", file=sys.stderr)
            return 1
        if user is None:
            return 1
        log_event(db, "create_admin_cli", "users", user.id)
        db.commit()
        print(f"Created admin {user.username} (id {user.id})")
    return 0


def seed_dev(_args) -> int:
    users = [
        ("admin", "مدير النظام", "System Admin", ["admin"]),
        ("manager", "هند المطيري", "Hind Almutairi", ["manager"]),
        ("reception", "أمل الغامدي", "Amal Alghamdi", ["reception"]),
        ("dr.reem", "د. ريم الحربي", "Dr. Reem Alharbi", ["doctor"]),
        ("dr.omar", "د. عمر الزهراني", "Dr. Omar Alzahrani", ["doctor"]),
        ("cashier", "فيصل العنزي", "Faisal Alanazi", ["cashier"]),
    ]
    with SessionLocal() as db:
        for username, ar, en, roles in users:
            u = _create(db, username, ar, en, DEV_PASSWORD, roles, must_change=False)
            if u is not None:
                u.pin_hash = hash_secret("2468")
                print(f"  {username:10} password {DEV_PASSWORD}  PIN 2468")
        db.flush()
        _seed_dev_master(db)
        db.commit()
    return 0


# Fake development prices only. Real prices are set by the clinic in Settings → Services.
DEV_PRICES = {
    "DN001": "100",
    "DN002": "200",
    "DN003": "300",
    "DN004": "50",
    "DN005": "150",
    "DN006": "150",
    "DN007": "600",
    "DN008": "1800",
    "DN009": "1200",
    "DN010": "2000",
    "DN011": "2500",
    "DN012": "150",
    "DN013": "200",
    "DN014": "350",
    "DN015": "1500",
    "DN016": "250",
    "DN017": "1200",
    "DN018": "400",
    "DN019": "250",
    "DN020": "12000",
}


def _seed_dev_master(db) -> None:
    save_setting(
        db,
        "clinic",
        ClinicInfo(
            name_ar="مجمع الندى الطبي (تجريبي)",
            name_en="Al Nada Medical Complex (demo)",
            phone="0110000000",
        ),
        user_id=None,
    )
    for svc in db.scalars(select(Service)):
        price = DEV_PRICES.get(svc.code)
        if price and not svc.is_active:
            svc.sale_price = Decimal(price)
            svc.min_price = Decimal(price) * Decimal("0.8")
            svc.max_price = Decimal(price) * Decimal("1.2")
            svc.is_active = True
    deps = {d.name_en: d for d in db.scalars(select(Department))}
    week = [(d, time(9), time(13)) for d in range(5)] + [(d, time(16), time(21)) for d in range(5)]
    for username, dep, color, specialty in [
        ("dr.reem", "Orthodontics", "grape", ("أخصائية تقويم", "Orthodontist")),
        ("dr.omar", "General dentistry", "blue", ("طبيب أسنان عام", "General dentist")),
    ]:
        user = db.scalar(select(User).where(User.username == username))
        if user is None or db.scalar(select(Doctor.id).where(Doctor.user_id == user.id)):
            continue
        doc = Doctor(
            user_id=user.id,
            name_ar=user.full_name_ar,
            name_en=user.full_name_en,
            specialty_ar=specialty[0],
            specialty_en=specialty[1],
            department_id=deps[dep].id,
            clinic_id=deps[dep].clinic_id,
            color=color,
            slot_minutes=20 if username == "dr.reem" else 15,
            sort_order=10 if username == "dr.reem" else 20,
        )
        doc.schedules = [
            DoctorSchedule(weekday=d, start_time=a, end_time=b, kind="work") for d, a, b in week
        ] + [
            DoctorSchedule(weekday=d, start_time=time(11), end_time=time(11, 30), kind="break")
            for d in range(5)
        ]
        doc.commission_rules = [DoctorCommissionRule(percent=Decimal(30))]
        db.add(doc)
    if not db.scalar(select(SavedPhrase.id).limit(1)):
        for i, (field, text) in enumerate(
            [
                ("chief_complaint", "ألم عند المضغ"),
                ("chief_complaint", "حساسية للبارد"),
                ("chief_complaint", "نزيف اللثة"),
                ("diagnosis", "تسوس عميق"),
                ("diagnosis", "التهاب لب السن"),
                ("diagnosis", "التهاب اللثة"),
                ("procedure", "حشوة تجميلية"),
                ("procedure", "تنظيف وتلميع"),
                ("next_visit", "مراجعة بعد أسبوعين"),
                ("next_visit", "مراجعة بعد شهر"),
                ("appointment_note", "يفضّل الفترة المسائية"),
            ]
        ):
            db.add(SavedPhrase(field_key=field, text=text, sort_order=(i + 1) * 10))
    if not db.scalar(select(InsuranceCompany.id).where(InsuranceCompany.code == "DEMO-INS")):
        company = InsuranceCompany(
            code="DEMO-INS", name_ar="تأمين تجريبي", name_en="Demo Insurance", sort_order=10
        )
        db.add(company)
        db.flush()
        veneer = db.scalar(select(Service.id).where(Service.code == "DN017"))
        for i, (name, pct, cap) in enumerate(
            [("VIP", "0", None), ("A", "10", "50"), ("B", "20", "75")]
        ):
            db.add(
                InsuranceClass(
                    company_id=company.id,
                    name=name,
                    patient_share_pct=Decimal(pct),
                    max_patient_share_per_invoice=Decimal(cap) if cap else None,
                    consultation_max_covered=Decimal(150),
                    daily_limit=Decimal(1500),
                    excluded_service_ids=[veneer] if veneer else [],
                    sort_order=(i + 1) * 10,
                )
            )
    print("  + clinic details, priced services, doctors, saved phrases, demo insurer (fake data)")


def seed_patients(args) -> int:
    """Bulk-insert fake patients (development and performance checks only)."""
    import random

    from sqlalchemy import insert

    from app.fake_patients import fake_patient
    from app.models import Patient

    rnd = random.Random(args.seed)
    with SessionLocal() as db:
        start = (db.scalar(select(func.count()).select_from(Patient)) or 0) + 1
        batch = []
        for i in range(start, start + args.count):
            batch.append(fake_patient(i, rnd))
            if len(batch) == 2000:
                db.execute(insert(Patient), batch)
                batch = []
        if batch:
            db.execute(insert(Patient), batch)
        db.execute(text("ANALYZE patients"))
        db.commit()
    print(f"Inserted {args.count} fake patients")
    return 0


def seed_demo_cmd(args) -> int:
    """seed-dev plus about five weeks of FAKE clinic activity, for trying the system."""
    from app.demo import seed_demo

    seed_dev(args)
    with SessionLocal() as db:
        counts = seed_demo(db, seed=args.seed)
    if not counts:
        print("Demo data is already there.")
    for k, v in counts.items():
        print(f"  + {v} {k} (fake)")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(required=True)
    p = sub.add_parser("create-admin", help="Create the first admin user")
    p.add_argument("--username", required=True)
    p.add_argument("--name-ar", required=True)
    p.add_argument("--name-en", default="")
    p.add_argument("--password", help="Prompted if omitted")
    p.set_defaults(func=create_admin)
    s = sub.add_parser("seed-dev", help="Create fake development users (never in production)")
    s.set_defaults(func=seed_dev)
    sd = sub.add_parser(
        "seed-demo", help="Fake users and five weeks of fake activity (never in production)"
    )
    sd.add_argument("--seed", type=int, default=2026)
    sd.set_defaults(func=seed_demo_cmd)
    sp = sub.add_parser(
        "seed-patients", help="Bulk fake patients for performance checks (never in production)"
    )
    sp.add_argument("--count", type=int, default=50_000)
    sp.add_argument("--seed", type=int, default=2026)
    sp.set_defaults(func=seed_patients)
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
