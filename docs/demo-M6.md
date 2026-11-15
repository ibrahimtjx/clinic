# Demo script: M6, dental record

## Walkthrough (as `dr.reem`)

1. **Open the Dental tab** on a patient's profile. Reception does not see this tab (needs `dental.view`).
   Opening it is recorded as a "Viewed" row in the patient's Activity (privacy log), like the Health tab.
2. **Tooth chart.** Clean SVG outlines in FDI numbering: 18–11 | 21–28 above, 48–41 | 31–38 below, with the
   midline marked. Permanent, Primary (55–51 | 61–65, 85–81 | 71–75) or Mixed. Children under 13 open in
   Mixed. The chart is never mirrored in Arabic: dental charts are read the same way everywhere.
3. **Select teeth** by clicking them (accent color). "Mark selected teeth" records a finding on each:
   restoration, extraction, endodontic, prosthetic, orthodontic or other. Teeth with history get small
   colored markers; extracted teeth are crossed out. Hover a tooth for its history.
4. **Visit form.** New visit: doctor (defaults to you), department, optional ICD-10, the selected teeth, and
   chief complaint, diagnosis, procedure, treatment plan note, preventive advice, complications, patient and
   family education, next visit, note. The quote button on each field inserts saved phrases. "Book the next
   visit" opens the appointment booking for this patient (needs `appointment.create`). Save, Save and print,
   New visit; `Ctrl+Enter` saves; leaving with unsaved changes asks first.
5. **Visit history** (side list, newest first): date, department, doctor, teeth, one-line summary. Filter by
   department, tooth number or text. "Print history" prints the chart and all visits on A4.
6. **24-hour lock.** A visit can be edited by its own doctor for 24 hours (Settings value `dental.edit_hours`).
   After that, or for another doctor, the form is read-only with a lock icon and "Add an addendum": addenda
   are appended with author and time, never overwriting the visit.

## Tests

```bash
(cd api && .venv/bin/pytest -q)   # 111 tests (8 for the dental record)
(cd web && pnpm test)             # 44 tests (chart numbering, selection, markers)
(cd web && pnpm e2e)              # 22 tests (doctor records a visit, marks teeth, adds an addendum)
```
