# Demo script: M4, appointments

## Setup

As for M3 (`seed-dev` gives two doctors with schedules: Dr. Reem, 20-minute slots, and Dr. Omar,
15-minute slots, Sunday to Thursday 09:00–13:00 and 16:00–21:00 with a break 11:00–11:30).

## Walkthrough (as `reception`)

1. **Day view.** Appointments in the sidebar. One column per doctor, time running down. Non-working time is
   grey, breaks are hatched, the red line is now. Each column header shows how many bookings the doctor has.
   Toolbar: Today, previous/next (`Alt+←/→`, `Alt+T`), date picker, Day/Week/List, doctor filter, show
   cancelled, find next free slot, waiting list (with count), print day.
2. **Book from a slot.** Click an empty slot: the drawer opens with that doctor, date and time and the
   doctor's slot length. Type part of a name, mobile or file number to pick the patient, or "New patient
   (name and mobile only)". Visit type, service, note (with saved phrases), waiting-list flag, exclude from
   SMS. `Ctrl+Enter` saves. "Save and print slip" opens the slip.
3. **No double booking.** Try a second booking overlapping the first: "The doctor is booked: {name} from …
   to …". The rule lives in the database, so two receptionists clicking Save at the same moment cannot both
   win (tested with two concurrent connections).
4. **Warnings.** Book the same patient twice on one day: "already has an appointment that day", with
   "Continue anyway". Book during a break or outside hours: "outside working hours"; only users with
   `appointment.override_hours` can continue.
5. **Cards.** Patient name, file number, time, visit type and status chip in soft colors from Settings.
   Small icons: new patient, insured, has balance, waiting list. Hover for details: phone, times, visit type,
   service, note, who created and confirmed it and when, SMS, the patient's appointment count.
6. **Drag.** Drag a card to another time or another doctor's column; drag its bottom edge to change the
   length. A confirmation shows the new doctor, date and time. The same warnings and overlap rule apply.
7. **Card menu (…).** Edit, Confirm (stamps who and when), change status, change visit type, move to waiting
   list, copy (opens a new booking with the same patient, doctor and type), cancel (reason required), open
   patient profile / dental record / invoices, print slip. Send to doctor (M5) and SMS (Phase 2) are visible
   but disabled.
8. **Cancel and the waiting list.** Add a patient to the waiting list (any doctor or one doctor, preferred
   days and times). Cancel an appointment in a matching time: the waiting list opens, the matching patients
   are highlighted, and "Offer this slot" opens a booking for that patient in the freed slot; saving it
   closes their waiting-list entry.
9. **Find next free slot.** Pick a doctor or any doctor, a duration, a start date and optional preferred
   times. The list skips breaks, existing bookings and the past; clicking a slot opens the booking.
10. **Week and list.** Week view shows one doctor's week (Sunday to Saturday). List view is the agenda for the
    week, grouped by day.
11. **Patient profile.** "New appointment" opens the calendar booking with the patient filled in. The
    Appointments tab lists upcoming and past appointments with status and cancellation reasons; Overview
    shows the next three.
12. **Print.** Slip (receipt width) and day schedule (A4, Arabic/English headers) open in a print preview
    and the print dialog. Silent printing to the PC's printers comes with the desktop app (M0.5/M10).

## Tests

```bash
(cd api && .venv/bin/pytest -q)   # 96 tests, incl. the exclusion constraint in SQL and two concurrent bookings
(cd web && pnpm test)             # 41 tests
(cd web && pnpm e2e)              # 19 tests: book, overlap, drag, cancel + waiting list, warnings, free slots
```
