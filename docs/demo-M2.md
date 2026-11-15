# Demo script: M2, settings and master data

## Setup

As for M1 (`docker compose up -d --build --wait`, then `create-admin`, or `seed-dev` on a development
machine). `seed-dev` also fills fake clinic details, fake service prices, two doctors with schedules and
some saved phrases. A fresh production install has none of those: only the starting lists below.

## What a fresh install contains

Seeded by migration 0003 from SPEC 6.4 and 10.1. These are the spec's starting lists, marked
**[CONFIRM]** there, and all of them are editable in Settings:

- One clinic ("Dental clinic") and 5 departments: General dentistry, Orthodontics, Endodontics,
  Prosthodontics, Radiology.
- 8 appointment statuses. Unconfirmed, Confirmed, Arrived, With doctor and Completed block the slot;
  No-show, Cancelled and Postponed do not. These are built-in: they can be renamed and recolored, but not
  deleted or switched off.
- 5 visit types: New, Follow-up, Consultation, Emergency, Orthodontic follow-up.
- 20 services `DN001`–`DN020` with Arabic and English names and departments. **Their prices are 0 and they
  are inactive**: nothing can be sold until the clinic sets the real prices and activates them.
- Document numbering `Q-`, `PO-`, `INV-`, `CN-`, `RC-` + year + 6 digits, restarting each year.

## Walkthrough (as admin)

1. **Settings layout.** Settings has a side list in three groups: Clinic, Lists, Access and security.
   Users who lack `settings.manage` see only the sections they may open.
2. **Clinic details.** Enter the clinic's Arabic and English name: the sidebar shows it instead of the
   placeholder. VAT number must be 15 digits, CR number 10.
3. **Services.** A yellow note counts the services still waiting for a price. Open `DN001`, set sale price
   150, minimum 120, maximum 200, switch Active on, save. A minimum above the sale price is refused on screen
   and by the API. Prices are entered and stored as exact decimals (SAR, 2 places).
4. **Doctors.** New doctor: names, specialty, department, calendar color, appointment length (default 15),
   and the linked user account. Working hours: switch on Sunday, keep 09:00–13:00, add a period
   16:00–21:00 and a break 11:00–11:30, then "Copy to other days" for the other working days. Overlapping
   periods, or a break outside working hours, are refused. Commission: a general rate, plus optional rates
   per department or per service.
5. **Commission is private.** Sign in as `reception`: the doctors list has no commission data (the API
   returns `null`). The cashier (`report.financial`) can see it.
6. **Statuses and visit types.** Change a status color; its chip shows the soft tint. "Blocks the slot" is
   what the appointment overlap rule will use in M4. Try to delete "Arrived": refused.
7. **Saved phrases.** Pick a field (for example Diagnosis), add phrases, reorder with the arrows.
8. **Delete and restore.** Delete a visit type: it disappears from the list. "Show deleted" lists it again
   with a Restore button. The audit log shows create, update, delete and restore.
9. **Edit conflict.** Edit the same service in two windows: the second save says who changed it, with Reload.
10. **Numbering.** Shows each document's format, how many were issued this period and the next number. Change
    a prefix: only new documents use it. Counters cannot be edited.

## Tests

```bash
(cd api && .venv/bin/pytest -q)   # 65 tests, including 25 concurrent transactions racing for numbers
(cd web && pnpm test)             # 31 tests
(cd web && pnpm e2e)              # 12 tests
```
