"""Realistic fake patients for development and the 50,000-patient performance check.
Never real data (SPEC 18)."""

import random
from datetime import date, timedelta

FIRST_M = [
    ("محمد", "Mohammed"),
    ("أحمد", "Ahmed"),
    ("عبدالله", "Abdullah"),
    ("خالد", "Khalid"),
    ("فهد", "Fahad"),
    ("سعود", "Saud"),
    ("عمر", "Omar"),
    ("فيصل", "Faisal"),
    ("ناصر", "Nasser"),
    ("سلطان", "Sultan"),
    ("تركي", "Turki"),
    ("ماجد", "Majed"),
    ("بندر", "Bandar"),
    ("يوسف", "Yousef"),
    ("إبراهيم", "Ibrahim"),
    ("عبدالرحمن", "Abdulrahman"),
    ("مشعل", "Mishal"),
    ("راشد", "Rashed"),
    ("حمد", "Hamad"),
    ("مصطفى", "Mustafa"),
]
FIRST_F = [
    ("نورة", "Noura"),
    ("سارة", "Sara"),
    ("فاطمة", "Fatimah"),
    ("مريم", "Maryam"),
    ("ريم", "Reem"),
    ("هند", "Hind"),
    ("أمل", "Amal"),
    ("لمى", "Lama"),
    ("جود", "Joud"),
    ("دانة", "Dana"),
    ("عبير", "Abeer"),
    ("منيرة", "Munirah"),
    ("هيا", "Haya"),
    ("آمنة", "Aminah"),
    ("إيمان", "Eman"),
    ("رهف", "Rahaf"),
    ("شهد", "Shahad"),
    ("غادة", "Ghada"),
    ("ليلى", "Laila"),
    ("حصة", "Hessa"),
]
FAMILY = [
    ("العتيبي", "Alotaibi"),
    ("القحطاني", "Alqahtani"),
    ("الدوسري", "Aldosari"),
    ("الشمري", "Alshammari"),
    ("الحربي", "Alharbi"),
    ("الزهراني", "Alzahrani"),
    ("الغامدي", "Alghamdi"),
    ("المطيري", "Almutairi"),
    ("العنزي", "Alanazi"),
    ("السبيعي", "Alsubaie"),
    ("الشهري", "Alshehri"),
    ("الرشيدي", "Alrashidi"),
    ("البقمي", "Albaqami"),
    ("المالكي", "Almalki"),
    ("العمري", "Alomari"),
    ("السهلي", "Alsahli"),
    ("الجهني", "Aljuhani"),
    ("الخالدي", "Alkhalidi"),
    ("الفيفي", "Alfaifi"),
    ("التميمي", "Altamimi"),
]
NATIONALITIES = ["SA"] * 8 + ["EG", "YE", "SY", "IN", "PK", "SD", "JO"]


def fake_patient(i: int, rnd: random.Random) -> dict:
    female = rnd.random() < 0.5
    first = rnd.choice(FIRST_F if female else FIRST_M)
    father = rnd.choice(FIRST_M)
    family = rnd.choice(FAMILY)
    nat = rnd.choice(NATIONALITIES)
    dob = date(1945, 1, 1) + timedelta(days=rnd.randrange(0, 365 * 78))
    return {
        "name_ar": f"{first[0]} {father[0]} {family[0]}",
        "name_en": f"{first[1]} {father[1]} {family[1]}",
        "gender": "female" if female else "male",
        "dob": dob,
        "nationality": nat,
        # Unique by construction: the index i is embedded in the number.
        "national_id": f"{1 if nat == 'SA' else 2}{i:09d}",
        "mobile": f"05{(i * 7919) % 100_000_000:08d}",
        "emergency_name": rnd.choice(FIRST_M)[0] + " " + family[0],
        "emergency_phone": f"05{(i * 104729 + 13) % 100_000_000:08d}",
        "chronic_diseases": rnd.choice(["", "", "", "", "سكري", "ضغط", "ربو"]),
        "allergies": rnd.choice(["", "", "", "", "", "بنسلين"]),
    }
