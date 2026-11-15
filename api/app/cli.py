"""Admin commands.

    python -m app.cli create-admin --username admin --name-ar "مدير النظام"
    python -m app.cli seed-dev        # fake users for development only
"""

import argparse
import getpass
import sys

from sqlalchemy import func, select

from app.audit import log_event
from app.db import SessionLocal
from app.models import Role, User, UserRole
from app.security import PolicyError, check_password_policy, hash_secret

DEV_PASSWORD = "Clinic-dev-2026"


def _create(db, username: str, name_ar: str, name_en: str, password: str, role_keys: list[str], must_change: bool):
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
            user = _create(db, args.username, args.name_ar, args.name_en, password, ["admin"], must_change=False)
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
        db.commit()
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
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
