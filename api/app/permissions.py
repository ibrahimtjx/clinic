"""Per-action permission catalog (SPEC 3.2).

Permissions are assigned to roles; Admin always has every permission. Add new keys here as each
module lands; the role matrix screen lists exactly this catalog.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Perm:
    key: str
    group: str


_CATALOG: list[tuple[str, list[str]]] = [
    (
        "admin",
        ["user.manage", "role.manage", "settings.manage", "audit.view", "record.view_deleted"],
    ),
    (
        "patient",
        [
            "patient.view",
            "patient.create",
            "patient.edit",
            "patient.delete",
            "patient.export",
            "patient.medical_view",
            "patient.assign",
        ],
    ),
    (
        "appointment",
        [
            "appointment.view",
            "appointment.view_all",
            "appointment.create",
            "appointment.edit",
            "appointment.delete",
            "appointment.override_hours",
        ],
    ),
    ("queue", ["queue.view", "queue.manage"]),
    ("dental", ["dental.view", "dental.edit"]),
    ("files", ["file.view", "file.upload", "file.delete"]),
    ("plan", ["plan.view", "plan.edit"]),
    (
        "billing",
        [
            "quotation.view",
            "quotation.edit",
            "invoice.view",
            "invoice.price_override",
            "invoice.credit_note",
            "invoice.correct",
            "payment.collect",
            "cashbox.close",
        ],
    ),
    (
        "report",
        [
            "report.revenue",
            "report.financial",
            "report.clinical",
            "report.operational",
            "report.own",
        ],
    ),
]

PERMISSIONS: list[Perm] = [Perm(k, g) for g, keys in _CATALOG for k in keys]
PERMISSION_KEYS: frozenset[str] = frozenset(p.key for p in PERMISSIONS)

ADMIN_ROLE = "admin"


def _all(prefixes: tuple[str, ...]) -> list[str]:
    return [p.key for p in PERMISSIONS if p.key.startswith(prefixes)]


# Starting matrix from SPEC 3.2 "Typical access". Admin edits it in Settings.
DEFAULT_ROLES: dict[str, dict] = {
    "admin": {"name_ar": "مدير النظام", "name_en": "Admin", "permissions": sorted(PERMISSION_KEYS)},
    "manager": {
        "name_ar": "المدير",
        "name_en": "Manager",
        "permissions": sorted(
            k
            for k in PERMISSION_KEYS
            if not k.startswith(("user.", "role.", "settings.")) and k != "invoice.price_override"
        ),
    },
    "reception": {
        "name_ar": "الاستقبال",
        "name_en": "Reception",
        "permissions": sorted(
            [
                "patient.view",
                "patient.create",
                "patient.edit",
                "patient.assign",
                *_all(("appointment.",)),
                "queue.view",
                "queue.manage",
                "quotation.view",
                "quotation.edit",
                "invoice.view",
                "invoice.price_override",
                "payment.collect",
                "report.operational",
            ]
        ),
    },
    "doctor": {
        "name_ar": "الطبيب",
        "name_en": "Doctor",
        "permissions": sorted(
            [
                "patient.view",
                "patient.medical_view",
                "appointment.view",
                "queue.view",
                "queue.manage",
                "dental.view",
                "dental.edit",
                "plan.view",
                "plan.edit",
                "quotation.view",
                "quotation.edit",
                "invoice.price_override",
                "report.clinical",
                "report.own",
            ]
        ),
    },
    "cashier": {
        "name_ar": "المحاسب / أمين الصندوق",
        "name_en": "Cashier / Accountant",
        "permissions": sorted(
            [
                "patient.view",
                "appointment.view",
                "appointment.view_all",
                "quotation.view",
                "invoice.view",
                "invoice.credit_note",
                "payment.collect",
                "cashbox.close",
                "report.revenue",
                "report.financial",
            ]
        ),
    },
}
