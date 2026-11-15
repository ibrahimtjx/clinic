# Demo script: M5, patient queue

## Walkthrough

1. **Send to doctor.** Three ways: the calendar card menu → Send to doctor (the appointment becomes
   *Arrived*), the patient profile → Send to doctor, or Queue → "Send patient to doctor" for a walk-in.
   Pick the doctor (defaults to the appointment's or the patient's treating doctor) and an optional note.
   The patient gets today's queue number (restarts at 1 each day). A patient already waiting today is
   refused with their number.
2. **Board.** Queue in the sidebar: Waiting, Called, With doctor, Done. Each card: queue number, patient,
   file number, doctor, visit type, minutes waited (green, amber after 15, red after 30; Settings → Queue).
   A doctor whose user account is linked sees their own column by default. The board refreshes every 10 s.
3. **Steps.** Call → Start (enters; the appointment becomes *With doctor*) → Finish (the appointment becomes
   *Completed* and the patient's last visit updates). Each step records server time and who did it.
   Card menu: Postpone (back of the line), Send to another doctor (back to Waiting), Left without being
   seen, Note, Open profile.
4. **Table view.** Every timestamp (received with the user, called, entered, exited), wait, status and note,
   for a date range and doctor. Totals: total, seen, not seen, average wait.

## Tests

```bash
(cd api && .venv/bin/pytest -q)   # 103 tests (7 for the queue)
(cd web && pnpm test)             # 42 tests
(cd web && pnpm e2e)              # 20 tests, incl. send → call → start → finish
```
