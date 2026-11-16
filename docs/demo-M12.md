# Demo script: M12, Phase 2 (images and documents; prescriptions, lab, medical reports)

SMS and the waiting-room display moved to Phase 3; there are no electronic signatures (patients sign the
printed papers, which carry signature lines).

The quickest way to see everything: install the Windows server with **Demo data** ticked, or on Docker:

```bash
docker compose exec api python -m app.cli seed-demo
```

That adds fake users (password `Clinic-dev-2026`), 150 fake patients and five weeks of activity:
appointments and today's queue, dental visits, prescriptions, lab requests with results, medical
reports, demo X-ray images, quotations, treatment plans with installments (one overdue), paid, part-paid
and unpaid invoices, deposits and credit notes. Never on a real clinic's server.

## Walkthrough (as `dr.reem`)

1. **Files tab** on a patient. Upload X-rays, photos or scanned papers (signed consent forms, referrals,
   ID): type, date, title, optional visit and tooth. JPG, PNG, TIFF, BMP, GIF, WEBP, PDF and DICOM up to
   50 MB; the type is checked from the file itself. Thumbnails in a grid; filter by type or tooth.
2. **Viewer**: zoom with the slider or buttons, PDF shown inline, download the original. Tick two images
   and **Compare** shows them side by side with one zoom (before / after).
3. **Prescriptions & lab tab → Prescriptions**: New prescription, pick drugs from the clinic's list (dose,
   frequency, duration filled in, all editable) or type any drug. The patient's allergies show at the top.
   Print: A4 with letterhead, patient details and allergies, ℞ table, doctor signature and stamp lines.
4. **Lab**: request tests from the list, then **Results** to enter values and flags (high / low); print
   the request or the results.
5. **Medical reports**: medical report, referral letter or attendance certificate, in Arabic or English,
   starting from a template; printed on letterhead with signature lines.
6. **Editing rules**: like visits, the doctor who wrote it can change it during the edit window (24 h by
   default); after that it can only be cancelled with a reason. Opening these tabs is logged.
7. **Settings → Medications / Lab tests**: the clinic's own lists.
8. **Permissions**: files have their own permissions (view, upload, remove); reception can view and
   upload (scanned papers), doctors too, only managers remove. Removed files stay in the backups.

## Backups

Files are stored on the server disk (Docker volume `patient_files`, or `C:\ProgramData\ClinicServer\files`)
and copied encrypted to the backup drive within a minute (`backups/files`). On failover (`promote.sh`)
and restores they are put back from the backup drive.

## Tests

```bash
(cd api && .venv/bin/pytest -q)   # 160 tests (files, clinical documents, demo data)
(cd web && pnpm test)             # 54 tests
(cd web && pnpm e2e)              # 29 tests (upload and view an X-ray; prescription print; lab results)
```
