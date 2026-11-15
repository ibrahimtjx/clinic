# Demo script: M3, patients

## Setup

As for M2, then on a development machine:

```bash
docker compose exec api python -m app.cli seed-dev
docker compose exec api python -m app.cli seed-patients --count 50000   # fake patients, ~10 s
```

## Walkthrough

1. **Patient list.** Patients in the sidebar. 50 per page, newest first. Columns: file number, name
   (Arabic with English below), mobile, national ID, treating doctor, insurance, balance (red when owed),
   last visit. The columns button hides and reorders columns; the choice is saved per user on this PC.
2. **Search as you type.** Press `/` to jump to the search box. Try:
   - `فاطمه الشمري`: finds "فاطمة … الشمري". Spelling variants match: أ/إ/آ/ا, ة/ه, ى/ي, and typed
     diacritics are ignored. Matches are highlighted, including the variant letters.
   - `Noura Alq`: English names, partial words, any order.
   - part of a mobile, a national ID, an emergency number, or a file number (an exact file number comes
     first). Arabic-Indic digits work too.
   With 50,000 patients every search returns in well under 300 ms (measured 12–152 ms; the slowest is a
   very common first name with thousands of matches).
3. **Filters.** Treating doctor, insurance company, registration date range, has balance, show inactive.
4. **Export.** "Export to Excel" (needs `patient.export`) downloads the filtered list with Arabic/English
   headers in a right-to-left sheet. The export is recorded in the audit log.
5. **New patient.** `Alt+N` or "New patient". Only the Arabic name is required; "More details" opens the
   full form. Mobile must be `05XXXXXXXX`, national ID 10 digits (Arabic digits and spaces are accepted and
   cleaned). Type a mobile that already exists: a yellow warning links to that patient. Saving anyway asks
   for confirmation ("Register a new patient anyway"). File numbers are sequential and never reused.
6. **Ctrl+K.** Type a name, mobile or file number: patients appear first in the palette; Enter opens the
   profile. "New patient" is also an action there.
7. **Profile page.** Header card: names, file number, age in years/months/days, gender, mobile with a call
   link, insurance badge (or "Cash"), balance badge (red when owed), and warning badges for allergies and
   chronic diseases. Action bar: buttons for later milestones are visible but disabled with the milestone in
   the tooltip; SMS says "coming soon". More: assign to staff, deactivate, delete (admin).
8. **Tabs.** Overview (summary, open tasks), Personal info (edit; unsaved-changes warning; edit conflict
   shows who changed it with Reload), Health (chronic diseases, allergies, medications, history), Activity
   (admin and manager). Dental, plans, appointments, billing, files and prescriptions show their milestone.
9. **Health is private.** Reception does not see the Health tab and the API refuses it. A doctor opening it
   creates a "Viewed" row in the audit log (patient's Activity tab), every time.
10. **Assign to staff.** More → Assign to staff → pick a person and write a note. That person sees a red
    count on the bell, with the patient and note; "Done" closes it. Open tasks also show on the Overview tab.
11. **Insurance companies.** Settings → Insurance companies. Coverage rules arrive with quotations (M7).

## Tests

```bash
(cd api && .venv/bin/pytest -q)   # 82 tests: search variants, numbers, duplicates, health logging, export, assignments
(cd web && pnpm test)             # 37 tests: highlighter, list search, duplicate flow, profile header, health tab
(cd web && pnpm e2e)              # 15 tests (needs seed-dev and seed-patients)
```
