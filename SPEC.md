# SPEC.md: Clinic Management System

Version 0.2, 15 Nov 2026. Owner: Ibrahim Altaweel.

This is the source of truth for what to build. Read the section for the module you are working on before writing code. If something here is unclear or contradicts itself, stop and ask instead of guessing.

Items marked **[CONFIRM]** must be checked with clinic staff before that part is built.

This is an original product. The functional scope reflects how a dental and medical complex works day to day. Do not reproduce the look, layout, wording, icons, artwork or branding of any existing clinic software. The UI follows section 4 (Design direction).

---

## 1. Goals and non-goals

### Goals
1. Run day-to-day clinic operations: appointments, patient queue, patient files, dental records, treatment plans, quotations, invoices, payments and reports.
2. Run fully offline on the clinic's local network. One server machine, many client PCs. No internet needed for daily work.
3. Arabic first (RTL), with English supported for service names, medical terms and printed reports.
4. A fresh, modern, fast interface that reception staff and doctors can learn in a day.
5. Survive a server failure with less than 1 hour of downtime and at most 15 minutes of lost data (section 15).

### Non-goals for v1
- Cloud hosting or multi-branch sync.
- Online patient booking or a patient mobile app.
- Data migration from any previous system (not needed for now).
- ZATCA e-invoicing integration and NPHIES insurance claims (designed for, built in Phase 3).
- Full general-ledger accounting. v1 covers invoices, receipts, cash box closing and revenue reports only.

---

## 2. Architecture

```
 Client PCs (Windows)                     Primary server PC (UPS, fixed LAN IP)
 ┌──────────────────────┐                 ┌───────────────────────────────┐
 │ Tauri desktop app    │  HTTPS on LAN   │ Docker Compose                │
 │ (React UI inside)    │ ──────────────► │  ├─ proxy (Caddy, local TLS)  │
 │ printing helper      │                 │  ├─ api   (FastAPI)           │
 │ auto-update from LAN │                 │  ├─ db    (PostgreSQL 16)     │
 └──────────────────────┘                 │  ├─ web   (React build,       │
                                          │  │         update files)      │
                                          │  └─ backup (WAL + dumps)      │
                                          └──────────────┬────────────────┘
                                                         │ streaming replication
                                          ┌──────────────▼────────────────┐
                                          │ Standby PC (section 15)       │
                                          └───────────────────────────────┘
```

### Default stack (change only with a reason, and record it under Decisions)
| Layer | Choice |
|---|---|
| Database | PostgreSQL 16 |
| Backend | Python 3.12, FastAPI, SQLAlchemy 2, Alembic migrations, Pydantic v2 |
| Auth | Username and password, JWT access token plus refresh token, bcrypt hashes, optional 4 to 6 digit PIN for quick switch |
| Frontend | React 18, TypeScript, Vite, Mantine 7 (RTL via DirectionProvider), TanStack Query, React Hook Form plus Zod |
| Calendar | MIT-licensed only (react-big-calendar or a custom grid). No paid-license components. |
| Desktop shell | Tauri 2 (Windows .msi installer) |
| PDF reports | Server-side HTML to PDF with WeasyPrint (supports Arabic shaping) |
| Reverse proxy and TLS | Caddy with an internal certificate authority |
| Packaging | Docker Compose on the server |
| Tests | pytest (backend), Vitest plus Playwright (frontend) |

### Rules
- Clients never connect to the database directly. Everything goes through the API so permissions and the audit log cannot be bypassed.
- The app must also work in a normal browser (https://SERVER_NAME). The Tauri app wraps the same UI.
- On first launch the Tauri app asks for the server address, trusts the clinic's internal CA certificate, and remembers both.
- Server time zone: Asia/Riyadh. Currency: SAR, 2 decimal places. Store money as `NUMERIC(12,2)`, never float.
- Server time is the only clock that matters. Clients never send timestamps for records.
- Dates shown Gregorian `dd/MM/yyyy`, times 12-hour. Hijri display optional **[CONFIRM]**.

---

## 3. Cross-cutting requirements

### 3.1 Language
- UI default language Arabic, RTL. Toggle to English per user.
- All UI text lives in i18n files (`ar.json`, `en.json`), written fresh for this product.
- Service names stored in Arabic and English (`name_ar`, `name_en`) and shown together where space allows.
- Printed reports are bilingual (Arabic and English column headers).

### 3.2 Users, roles and permissions
Roles (a user can have more than one):
| Role | Typical access |
|---|---|
| Admin | Everything, including settings and user management |
| Manager | All reports, all data, no settings |
| Reception | Patients, appointments, queue, send to doctor, collect payments |
| Doctor | Own schedule, medical records, treatment plans, quotations |
| Cashier / Accountant | Payments, receipts, credit notes, box closing, financial reports |

Permissions are per action (for example `appointment.delete`, `invoice.price_override`, `report.revenue`), assigned to roles. Admin edits the role matrix.

### 3.3 Security
- HTTPS everywhere on the LAN, using Caddy's internal CA. The CA certificate is installed on each client PC once.
- Password policy: minimum 10 characters, not equal to username. Admin can force a reset.
- Account lockout: 5 failed attempts locks the account for 15 minutes; Admin can unlock.
- Sessions: access token 15 minutes, refresh token 12 hours (one shift).
- **Auto-lock:** after 5 minutes of inactivity (configurable) the screen locks. Unlock with the same user's PIN or password.
- **Quick user switch:** from the lock screen, another user can sign in with their own PIN without closing open work of the previous user. Every action is recorded under whoever is signed in at that moment.
- Patient files and images on disk are not served by direct URL; the API checks permission on each download.

### 3.4 Audit log
- Every create, update and delete on patients, appointments, medical records, treatment plans, invoices, payments and settings writes an audit row: who, when, which record, old values, new values, client machine name.
- Opening a patient's medical file is also logged (read access), for privacy reviews.
- Records are never hard deleted. Use `deleted_at` and `deleted_by` (soft delete). Admin can view deleted records with a filter.

### 3.5 Unsaved changes
Every editable screen warns before leaving with unsaved changes, offering Save, Discard and Keep editing.

### 3.6 Concurrency
- Two users must never book the same doctor for overlapping times. Enforced in the database (section 14, `appointments` exclusion constraint), not only in the UI.
- Optimistic locking with a `version` column on every editable record. A stale save shows who changed the record and offers to reload.

### 3.7 Quick text (saved phrases)
Free-text clinical and note fields have a phrase picker: a small button that opens a searchable list of saved phrases for that field, inserted at the cursor. Phrases are managed in settings per field (appointment note, chief complaint, diagnosis, procedure, complications, patient education, next visit, reception note).

### 3.8 Printing
- Every printable thing offers Preview, Print and Save as PDF.
- From the Tauri app, printing goes straight to the PC's default A4 or receipt printer without a dialog (configurable per PC). Tauri 2 has no built-in silent printing, so this needs a plugin or a small native helper. Proven in milestone M0.5 before any printing features are built.
- In a browser, printing falls back to the normal print dialog.

### 3.9 Performance
- Patient search returns in under 300 ms with 50,000 patients.
- The appointment day view loads in under 1 second.
- Minimum supported screen: 1366 x 768.

---

## 4. Design direction

The interface must look and feel like a modern product built in 2026, not a legacy Windows form application.

### 4.1 Principles
1. **Calm and clean:** generous spacing, a light neutral background, one accent color, soft shadows, rounded corners (8 px). No dense toolbars of icons.
2. **Search first:** a global search bar is always visible at the top, and `Ctrl+K` opens a command palette that finds patients, appointments, invoices and actions ("new appointment", "open queue").
3. **One screen per job:** a patient has one profile page with tabs, instead of popups stacked on popups. Use side drawers for quick edits, full pages for deep work.
4. **Keyboard friendly:** reception staff work fast. Every common action has a shortcut, forms submit with `Ctrl+Enter`, and tab order is logical in RTL.
5. **Status at a glance:** status is shown with colored chips and soft tinted backgrounds, never full saturated rows.
6. **Light and dark mode**, per user.

### 4.2 Visual system
- Arabic font: IBM Plex Sans Arabic (open license). English: IBM Plex Sans. Numbers use Western digits by default, configurable.
- Design tokens (colors, spacing, radius, font sizes) defined once in the Mantine theme. No hard-coded colors in components.
- Icons: one consistent open-source line icon set (Tabler Icons, bundled with Mantine).
- Toast notifications for success and errors. Empty states with a short hint and the main action button.
- Skeleton loaders instead of spinners for lists and the calendar.

### 4.3 App shell
- **Sidebar** (on the right in RTL, collapsible to icons): Home, Appointments, Queue, Patients, Billing, Reports, Settings. Items are shown by role.
- **Top bar:** global search, "New appointment" primary button, notifications (payment orders waiting, patients arrived), server connection indicator, user menu (language, theme, lock, sign out).
- **Connection indicator:** if the server is unreachable, a clear banner appears and actions are disabled until it reconnects. No local offline writes.

### 4.4 Home dashboard (per role)
- Reception: today's appointments by status, patients waiting now, payment orders waiting, quick actions.
- Doctor: my patients today in order, next patient card with "Call" button, unfinished visit notes.
- Manager: today's revenue, appointments vs no-shows, new patients this week, a few small charts.

### 4.5 Design deliverable before coding the UI
In milestone M0, produce a small style guide page inside the app (`/design`) showing colors, type scale, buttons, inputs, chips, table, card, drawer and modal in both Arabic and English, light and dark. All later screens are built from these parts.

---

## 5. Patients

### 5.1 Patient list
- Columns: file number, name, mobile, national ID, treating doctor, insurance company, balance, last visit date. Users can hide or reorder columns.
- One search box that matches as you type on file number, name (Arabic or English, partial), mobile, emergency number and national ID, highlighting the matched text.
- Filters: doctor, insurance company, has balance, created date range.
- Export to Excel (permission required).
- Clicking a row opens the patient profile.

### 5.2 Patient profile page
**Header card:** name (Arabic and English), file number, age (years, months, days), gender, mobile with call and SMS buttons, insurance badge, balance badge (red if the patient owes money), and warning badges for chronic diseases and allergies.

**Action bar:** New appointment, Send to doctor, New quotation, Collect payment, Send SMS, More (print statement, assign to user, deactivate).

**Tabs:**
1. Overview: upcoming appointments, last visit summary, open treatment plans, balance, recent activity
2. Personal info: editable fields from 5.3
3. Health: chronic diseases, allergies, current medications, medical history
4. Dental: chart and visits (section 8)
5. Treatment plans (section 9)
6. Appointments: past and upcoming, with status
7. Billing: quotations, invoices, receipts, credit notes, account statement
8. Files: images and documents (Phase 2)
9. Prescriptions and lab (Phase 2)
10. Activity: audit trail for this patient (Admin and Manager)

### 5.3 Patient fields
- File number (auto, sequential, never reused), secondary file number
- Full name Arabic, full name English
- National ID or iqama number, nationality, gender, date of birth
- Mobile, phone, emergency contact name and number
- Default treating doctor
- Insurance: company, policy number, class, membership number, expiry **[CONFIRM]**
- Chronic diseases, allergies
- External patient flag (referred from outside for a single service)
- SMS opt-out
- Referral source **[CONFIRM]**
- Notes

Validation: national ID 10 digits; Saudi mobile `05XXXXXXXX`; duplicate warning when the ID or mobile already exists, with a link to the existing patient.

### 5.4 Assign to user
Any patient can be assigned to a staff member with a note (for example "call to reschedule"). The assignee sees it in their notifications until marked done.

---

## 6. Appointments

### 6.1 Calendar
- Default view: **day view with one column per doctor**, time on the vertical axis. Also week view for a single doctor, and a list (agenda) view.
- Slot length per doctor (default 15 minutes) **[CONFIRM]**. Non-working hours and breaks shaded.
- Each appointment card shows: patient name, file number, visit type, a status chip, and small icons for "new patient", "insured", "has balance".
- Status colors are soft tints defined in settings.
- Drag to move (time or doctor), drag the edge to resize. Both ask for confirmation and respect the overlap rule.
- Click an empty slot to create an appointment in a side drawer with the doctor and time already filled.
- Hovering a card shows a details popover: phone, visit type, service, note, created by and when, confirmed by and when, SMS status, the patient's appointment count.
- Toolbar: date picker, Today, previous and next, doctor filter, view switch, "Find next free slot", Print day.

### 6.2 Appointment actions (card menu and drawer)
Edit, Confirm, Change status, Change visit type, Move to waiting list, Copy, Cancel (reason required), Open patient profile, Open dental record, View patient invoices, Send to doctor (queue), Send SMS reminder, Send SMS with details, Print appointment slip.

### 6.3 Appointment form (side drawer)
- Patient (search as you type, or "new patient" inline with name and mobile only)
- Doctor, visit type, service (optional)
- Date, start time, duration (end time calculated, editable)
- Linked treatment plan session (optional, from the patient's open plans)
- Status (default Unconfirmed), waiting-list flag
- Note with saved phrases
- Exclude from SMS
- Buttons: Save, Save and print slip, Cancel

Rules:
- Cannot overlap another slot-blocking appointment for the same doctor.
- Warn if the patient already has an appointment the same day.
- Warn outside the doctor's working hours; users with `appointment.override_hours` can continue.

### 6.4 Statuses and visit types (configurable lists)
Each status has: name Arabic, name English, color, and a **blocks slot** flag. Starting set **[CONFIRM]**:
| Status | Blocks slot |
|---|---|
| Unconfirmed | Yes |
| Confirmed | Yes |
| Arrived | Yes |
| With doctor | Yes |
| Completed | Yes |
| No-show | No |
| Cancelled | No |
| Postponed | No |

Visit types, starting set **[CONFIRM]**: New, Follow-up, Consultation, Emergency, Orthodontic follow-up.

### 6.5 Find next free slot
Given doctor (or any doctor), duration and optional date range or preferred times, list the next free slots. Clicking one opens the appointment form prefilled.

### 6.6 Waiting list
Patients who want an earlier slot, with preferred doctor and times. Shown in a side panel on the calendar. When an appointment is cancelled, matching waiting-list entries are highlighted with a "Offer this slot" action.

---

## 7. Patient queue

Tracks patients physically in the clinic today.

### 7.1 Board view (default)
Columns: **Waiting**, **Called**, **With doctor**, **Done**. Each card shows queue number, patient name, file number, doctor, visit type, and minutes waited (turns amber after 15 minutes, red after 30, configurable).

Actions per card: Call (doctor or reception), Start (enter), Finish (exit), Postpone, Send to another doctor, Add note, Open profile.

### 7.2 Table view
Same data as rows with every timestamp: received at and by, called at, entered at, exited at, sent by, note. Filters: doctor, clinic, date range, user. Totals: total, seen, not seen, average wait.

### 7.3 Flow
Reception sends a patient to a doctor (from an appointment, the patient profile or walk-in) → card appears in Waiting with a queue number → doctor clicks Call → Start → Finish. Each step stamps server time and user. Finishing can prompt reception if a payment order was created during the visit.

Phase 2 option: waiting-room display screen showing called numbers **[CONFIRM]**.

---

## 8. Dental record

### 8.1 Layout
The Dental tab of the patient profile has three areas: tooth chart at the top, visit history list on the side, visit form in the main area.

### 8.2 Tooth chart
- Built as SVG, clean modern tooth outlines (no photographic tooth images).
- FDI numbering: 11 to 48 permanent, 51 to 85 primary. Toggle: Permanent, Primary, Mixed.
- Click to select one or more teeth for the current visit. Selected teeth highlight with the accent color.
- Teeth with history show small colored markers by category (restoration, extraction, endodontic, prosthetic, orthodontic). Hover shows that tooth's history.
- Chart prints cleanly on A4.

### 8.3 Visit history
List of visits, newest first: date, department, doctor, one-line summary. Search and filter by department or tooth. Print visit history statement.

### 8.4 Visit form
| Field | Notes |
|---|---|
| Department | e.g. Orthodontics, Endodontics, General |
| Date and time | defaults to now |
| Teeth | from chart selection |
| Chief complaint | saved phrases |
| Diagnosis | saved phrases; optional ICD-10 code **[CONFIRM]** |
| Procedure done | saved phrases; can add services directly to a quotation |
| Treatment plan note | link to or create a treatment plan (section 9) |
| Preventive advice | saved phrases |
| Complications | saved phrases |
| Patient and family education | saved phrases |
| Next visit | text plus "Book now" button |
| Note | free text |

Buttons: Save, Save and print, New visit. A saved visit can be edited by its doctor for 24 hours (configurable); after that, changes are added as addenda, not overwrites.

### 8.5 Images and documents (Phase 2, milestone M12)
- Upload images (X-ray, panoramic, intraoral photos) and documents, tagged by type and date, optionally linked to a visit or tooth.
- Files stored on the server disk outside the database; database stores path, hash, size, uploader.
- Image viewer with zoom and side-by-side compare.
- Electronic signatures are not part of the system (decided 2026-11-16): patients sign the printed papers. Printouts that need a signature carry signature lines.

### 8.6 Prescriptions, lab tests, medical reports (Phase 2, milestone M12)
Prescription: drug, dose, frequency, duration, instructions, printed on letterhead. Lab: request and result entry. Medical report: free text on letterhead. **[CONFIRM scope]**

---

## 9. Treatment plans

Multi-session treatments, especially orthodontics and prosthetics, are planned and priced as a whole and paid over time. **[CONFIRM details with doctors]**

- A plan belongs to a patient and a doctor: title, department, status (Draft, Proposed, Accepted, In progress, Completed, Cancelled), total price, discount, notes.
- **Planned sessions:** ordered list, each with description, teeth, linked service, expected price share, status (Planned, Booked, Done). Appointments can link to a session; completing the visit marks it Done.
- **Payment schedule:** installments with due date and amount. Payments received against the plan reduce the remaining balance.
- **Options:** a plan can carry alternatives for the patient to choose (for example "fixed braces" vs "clear aligners") with different prices. Accepting one option sets the plan's price.
- Accepting a plan can require the patient's signature (Phase 2).
- Overdue installments appear on the reception dashboard and in a report.

---

## 10. Billing

### 10.1 Services catalog
Fields: internal number, code, name Arabic, name English, department, sale price, minimum price, maximum price, cost price, VAT applicable, active.

Seed data (dental, prices **[CONFIRM]**): general consultation, specialist consultation, consultant consultation, periapical / bitewing X-ray, panoramic X-ray, cephalometric film, CBCT, acrylic complete denture (one arch), acrylic partial denture (one arch), flexible denture (one arch), metal partial denture (one arch), denture correction, denture soldering, denture relining and adjustment, immediate denture, add tooth to denture, veneer (per tooth), CAD/CAM temporary crown, orthodontic follow-up visit, clear aligner package. Codes in the format `DN001`, `DN002`, and so on.

### 10.2 Document types and numbering
| Document | Editable | Number sequence |
|---|---|---|
| Quotation | Yes, until accepted or expired | `Q-YYYY-000001`, own sequence |
| Payment order (temporary invoice) | Yes, until paid | `PO-YYYY-000001`, own sequence |
| Final invoice | **Never** | `INV-YYYY-000001`, own **gapless** sequence |
| Credit note | Never | `CN-YYYY-000001`, own gapless sequence |
| Receipt | Never | `RC-YYYY-000001`, own gapless sequence |

- Sequences live in a `number_sequences` table and are allocated inside the same database transaction that issues the document, with a row lock, so there are no gaps and no duplicates.
- Quotations and payment orders never consume final invoice numbers.
- Prefix format and yearly reset **[CONFIRM]**.

### 10.3 Quotation and payment order screen
Usually created by the doctor during or after a visit, then sent to reception.

- **Header:** patient (with insurance badge), doctor, clinic, created by, created at, notes.
- **Insurance panel** (shown if insured): company, policy number, class, membership number, patient share %, maximum per invoice, daily limit, consultation limit. Prefilled from the patient, editable with permission.
- **Line items:** service (search by code or name), price (editable within min and max; outside needs `invoice.price_override`), quantity, discount (amount or %), VAT, line total, patient share, insurance share. Teeth optional per line.
- **Summary card:** gross, discounts, net before VAT, VAT, total, insurance share, patient amount due.
- **Actions:** Send to reception for payment (primary), Save draft, Print, Add patient signature (Phase 2), Convert quotation to payment order.

### 10.4 Insurance calculation
Each line splits into patient share and insurance share using: patient share %, maximum per invoice, daily limit, consultation limit and class rules. Show both shares per line and in totals. **[CONFIRM exact rules with the accountant; collect 3 real examples and write them as test cases before coding]**

### 10.5 Payments at reception
- Reception sees incoming payment orders in a list (patient, doctor, amount, waiting since, note) with a badge count in the top bar.
- Collect payment: one or more methods (Cash, Mada / ATM card, credit card, bank transfer, insurance, patient deposit), amounts, references.
- Paying a payment order **issues the final invoice** (gapless number) and a receipt in one transaction.
- Partial payment allowed; the remainder goes to the patient balance.
- Deposits and advance payments on account, and payments against treatment plan installments.

### 10.6 Final invoices are immutable
- Once issued, a final invoice and its lines can never be edited or deleted, by anyone, including Admin. The API rejects any change.
- Corrections, refunds and returns are made with a **credit note** that references the original invoice, with reason and `invoice.credit_note` permission. A credit note can cover the whole invoice or selected lines.
- Refunding money issues a refund receipt linked to the credit note.

### 10.7 VAT
- Rate configurable (currently 15%), stored per line at issue time. Changing the rate never touches issued invoices.
- VAT eligibility depends on the patient and/or the service (some invoices carry VAT, some do not). **[CONFIRM the rule with the accountant before building]**
- Invoices store from day one the fields ZATCA e-invoicing needs (seller VAT number, buyer details, UUID, previous invoice hash, QR payload placeholder), even though the integration comes in Phase 3.

### 10.8 Doctor commission
- Each doctor has a commission rule: percentage of net collected revenue, optionally different per department or service **[CONFIRM]**.
- Commission is calculated on collected payments minus credit notes, in the commission report (11.2).

### 10.9 Cash box closing
Per user per shift: payments in by method, refunds, net, each split into amount without VAT, VAT and total. Closing locks the shift and prints a closing slip. Late corrections go into the next shift with a note.

---

## 11. Reports

All reports: filter panel (date range, user, doctor, patient, clinic, payment method as relevant), on-screen preview, print, export to PDF and Excel, bilingual headers, clinic letterhead.

### 11.1 Revenue report
Detail rows: receipt number, invoice number, date and time, patient (name and file number), doctor, service description (Arabic and English), total, discounts, net, payment amount and method, VAT rate and VAT amount.

Summary at the end:
- New patients registered in the period
- Payments by method
- Totals: gross, discounts, net without VAT, VAT, total collected
- Credit notes and refunds in the period
- Deposits received
- Invoice count

### 11.2 Other v1 reports **[CONFIRM priority with the clinic manager]**
- Daily schedule per doctor (printable)
- No-shows and cancellations
- Doctor production and commission
- Patient account statement
- Outstanding balances and overdue treatment plan installments
- Insurance summary per company
- Services sold (count and value per service)
- New patients per period
- Queue waiting times per doctor

---

## 12. Settings
- Clinic info: name Arabic and English, logo (the clinic's own), address, VAT number, CR number, letterhead layout
- Clinics / departments
- Doctors: name, specialty, department, working hours per weekday, breaks, slot length, calendar color, commission rule
- Users, roles, permissions, PINs
- Services catalog
- Insurance companies, classes and coverage rules
- Appointment statuses (color, blocks slot) and visit types
- Saved phrases
- SMS provider and templates (Phase 2)
- Payment methods
- Number sequence prefixes
- Security: auto-lock minutes, lockout rules
- Backups and standby status (read-only health view, section 15)

---

## 13. Later phases

### Phase 2 (milestone M12)
- Images and documents (8.5).
- Prescriptions, lab, medical reports (8.6).

### Phase 3
- SMS (moved from Phase 2 on 2026-11-16): through a Saudi SMS gateway when internet is available; messages queue while offline and send later. Templates with placeholders (`{patient_name}`, `{date}`, `{time}`, `{doctor}`). SMS balance shown in settings. Until then, SMS buttons are visible but disabled with a "coming soon" tooltip.
- Waiting-room display screen (moved from Phase 2 on 2026-11-16).
- Inventory: items, stock in and out, consumption per procedure, low-stock alerts **[CONFIRM scope]**.
- ZATCA e-invoicing integration (needs internet to report invoices; confirm the clinic's required phase and deadline).
- NPHIES insurance eligibility and claims, if the clinic needs it.

---

## 14. Data model (starting point; refine during schema design)

```
users(id, username, password_hash, pin_hash, full_name_ar, full_name_en,
      is_active, failed_logins, locked_until, ...)
roles(id, name) ; user_roles(user_id, role_id) ; role_permissions(role_id, permission)
clinics(id, name_ar, name_en)
doctors(id, user_id, clinic_id, specialty, color, slot_minutes)
doctor_schedules(id, doctor_id, weekday, start_time, end_time)
doctor_commission_rules(id, doctor_id, department NULL, service_id NULL, percent)

patients(id, file_no UNIQUE, secondary_file_no, name_ar, name_en, national_id,
         nationality, gender, dob, mobile, phone, emergency_name, emergency_phone,
         default_doctor_id, is_external, sms_opt_out, chronic_diseases, allergies,
         medications, notes, created_at, created_by, version, deleted_at, deleted_by)
patient_insurance(id, patient_id, company_id, policy_no, class, membership_no, expiry)
patient_assignments(id, patient_id, assigned_to, assigned_by, note, done_at)

appointment_statuses(id, name_ar, name_en, color, blocks_slot BOOLEAN)
visit_types(id, name_ar, name_en)
appointments(id, patient_id, doctor_id, clinic_id, starts_at, ends_at,
             status_id, blocks_slot BOOLEAN NOT NULL,  -- copied from status on every status change
             visit_type_id, service_id, plan_session_id NULL, is_waiting_list,
             note, confirmed_by, confirmed_at, exclude_sms,
             created_by, created_at, version, deleted_at, deleted_by, cancel_reason)
  -- CREATE EXTENSION btree_gist;
  -- EXCLUDE USING gist (doctor_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
  --   WHERE (blocks_slot AND deleted_at IS NULL)
  -- blocks_slot is set by the API in the same transaction as any status change,
  -- because an exclusion constraint cannot read the statuses table.
waiting_list(id, patient_id, doctor_id NULL, preferred_times, note, resolved_at)

queue_entries(id, queue_no, date, patient_id, doctor_id, clinic_id, appointment_id NULL,
              received_at, received_by, called_at, entered_at, exited_at,
              sent_by, postponed, note)

dental_visits(id, patient_id, doctor_id, department, visit_at, chief_complaint,
              diagnosis, icd10, procedure, treatment_note, preventive_advice,
              complications, patient_education, next_visit, note,
              locked_at, version, ...)
dental_visit_teeth(visit_id, tooth_fdi)
dental_visit_addenda(id, visit_id, text, created_by, created_at)
tooth_findings(id, patient_id, tooth_fdi, category, description, visit_id, created_at)

treatment_plans(id, patient_id, doctor_id, title, department, status,
                total_price, discount, accepted_option_id NULL, notes, version, ...)
treatment_plan_options(id, plan_id, title, price, description)
treatment_plan_sessions(id, plan_id, seq, description, service_id, teeth,
                        price_share, status)
treatment_plan_installments(id, plan_id, due_date, amount, paid_amount)

services(id, number, code UNIQUE, name_ar, name_en, department, sale_price,
         min_price, max_price, cost_price, vat_applicable, is_active)
insurance_companies(id, code, name_ar, name_en, rules_json)

number_sequences(doc_type, year, next_value)   -- locked with SELECT ... FOR UPDATE

quotations(id, quotation_no UNIQUE, patient_id, doctor_id, status, ..., version)
payment_orders(id, order_no UNIQUE, patient_id, doctor_id, quotation_id NULL,
               plan_id NULL, status, reception_note, sent_at, ..., version)
draft_lines(id, parent_type, parent_id, service_id, description_ar, description_en,
            price, qty, discount_amount, discount_pct, vat_rate, vat_amount,
            line_total, patient_share, insurance_share, teeth)

invoices(id, invoice_no UNIQUE, uuid, payment_order_id, patient_id, doctor_id,
         clinic_id, issued_at, issued_by, insurance snapshot fields,
         buyer snapshot fields, seller_vat_no, gross, discount, net, vat, total,
         patient_share, insurance_share, previous_hash, hash, qr_payload)
         -- no UPDATE or DELETE allowed: enforce with a trigger, not only in the API
invoice_lines(id, invoice_id, ... same columns as draft_lines ...)
credit_notes(id, credit_note_no UNIQUE, invoice_id, reason, issued_at, issued_by,
             net, vat, total)   -- immutable, same trigger
credit_note_lines(id, credit_note_id, invoice_line_id, qty, amount, vat)

receipts(id, receipt_no UNIQUE, kind ENUM('payment','deposit','refund','installment'),
         patient_id, invoice_id NULL, credit_note_id NULL, plan_id NULL,
         received_by, received_at, total)   -- immutable
receipt_payments(id, receipt_id, method, amount, reference)
cash_closings(id, user_id, from_at, to_at, totals_json, closed_at)

saved_phrases(id, field_key, text, sort_order)
patient_files(id, patient_id, visit_id NULL, tooth_fdi NULL, kind, path, sha256,
              size, uploaded_by, uploaded_at)                       -- Phase 2
-- signatures: not built; patients sign printed papers (2026-11-16)
audit_log(id, at, user_id, machine, table_name, record_id, action, old_json, new_json)
settings(key, value_json)
```

---

## 15. Server failure plan

Targets: **downtime under 1 hour (RTO)**, **data loss at most 15 minutes (RPO)**, and in normal operation with the standby, near zero.

### 15.1 Hardware
- Primary server: a dedicated PC or mini PC on a UPS, fixed LAN IP, wired network, SSD.
- Standby server: a second PC on the same network (can be a lower-spec machine) with the same Docker setup.
- Backup drive: an external USB drive or a small NAS, plus a second drive rotated off-site weekly.

### 15.2 Data protection
- **Streaming replication:** PostgreSQL on the standby continuously replicates from the primary (hot standby, read-only).
- **WAL archiving:** the primary archives write-ahead logs to the backup drive every 5 minutes at most, so a point-in-time restore is possible even if both PCs fail.
- **Nightly full backup:** `pg_dump` at 2:00 AM to the backup drive, keeping 14 daily and 8 weekly copies.
- **Files** (Phase 2 images and documents): rsync to the standby every 5 minutes and to the backup drive nightly.
- Backups are encrypted at rest (the backup drive holds patient data).

### 15.3 Failover runbook (in `docs/failover.md`)
1. Confirm the primary is really down (not just one client's network).
2. On the standby, run one script: `./promote.sh`. It promotes PostgreSQL to primary, starts the API and web containers, and takes over the server's hostname and IP (or updates the internal DNS name).
3. Clients reconnect automatically because they use the hostname, not the IP of a specific machine.
4. Check the health page shows green, then announce to staff.
5. After repairing the old primary, rebuild it as the new standby with `./rebuild-standby.sh`.

### 15.4 Monitoring
- Health page in Settings: replication lag, last WAL archive time, last nightly backup time and size, free disk space on each machine.
- Admin users see a warning banner if replication lag exceeds 5 minutes, the last backup is older than 26 hours, or disk space is under 15%.

### 15.5 Drills
- A full failover and restore drill is part of milestone M11 and must succeed within 1 hour.
- Repeat the drill every 3 months; log the result in `docs/drills.md`.

---

## 16. Build order and definition of done

Work one milestone at a time. Each milestone ends with tests passing, a short demo script in `docs/demo-<milestone>.md`, and the app running from `docker compose up`.

| # | Milestone | Done when |
|---|---|---|
| M0 | Skeleton and design system | Compose runs proxy, api, db, web over HTTPS; RTL Arabic and English toggle; light and dark mode; `/design` style guide page (4.5); CI runs tests |
| M0.5 | Printing spike | A Tauri test app prints a sample Arabic PDF silently to an A4 and a receipt printer on Windows. If it fails, document the fallback before continuing |
| M1 | Auth and security | Login, roles, permissions on the API, audit log, lockout, auto-lock, PIN quick switch |
| M2 | Settings and master data | Clinics, doctors with schedules and commission rules, services with seed data, statuses with blocks-slot flag, visit types, saved phrases, number sequences |
| M3 | Patients | App shell, global search and `Ctrl+K` palette, patient list under 300 ms on 50k seeded patients, profile page with header, tabs and action bar |
| M4 | Appointments | Doctor-column day view, week and list views, drawer form, drag to move and resize, overlap blocked by the database, find next free slot, waiting list, print slip and day |
| M5 | Queue | Board and table views, send to doctor, call, start, finish, wait-time colors, filters, totals |
| M6 | Dental record | SVG tooth chart with FDI numbering and markers, visit history, visit form with saved phrases, 24-hour edit lock and addenda, print |
| M7 | Treatment plans and quotations | Plans with options, sessions, installments; quotations and payment orders with insurance split and price limits; send to reception |
| M8 | Payments and invoices | Reception inbox, split payments, gapless final invoices and receipts, immutability trigger, credit notes, deposits, installments, box closing |
| M9 | Reports | Revenue report (11.1) as Arabic and English PDF and Excel, plus agreed v1 reports |
| M10 | Desktop app | Tauri installer, server address and CA setup, silent printing, auto-update from server |
| M11 | Deployment and failover | Install guide, standby replication, WAL archiving, nightly backups, health page, failover drill passed within 1 hour |
| M12 | Phase 2 | Images and documents, prescriptions, lab requests and results, medical reports (SMS and the waiting-room display moved to Phase 3; signatures on paper) |

The pilot can start in the browser after M9, before the Tauri app (M10) is finished.

---

## 17. Open questions for the clinic (answer before the related milestone)
1. Appointment statuses, their colors and which ones block the slot. (M2)
2. Visit types. (M2)
3. Slot length per doctor, working hours, breaks. (M2)
4. Doctor commission rules. (M2)
5. Number formats: prefixes, yearly reset. (M2)
6. Treatment plan details: how packages and installments work today. (M7)
7. Insurance calculation rules, with 3 real examples. (M7)
8. VAT rule: which patients or services are exempt. (M7)
9. Which reports staff use weekly, in priority order. (M9)
10. How many client PCs and printers (A4, receipt), printer models. (M0.5)
11. Hardware for the primary and standby servers and the backup drive. (M11)
12. SMS provider and message templates. (M12)
13. ZATCA phase and NPHIES needs, and deadlines. (Phase 3)

---

## 18. Conventions for Claude Code
- Keep this file updated. When a decision is made, add a dated line under Decisions.
- Never hard delete. Never store money as float. Never trust the client for permissions, timestamps or totals; the API recalculates every document total.
- Issued invoices, credit notes and receipts are immutable, enforced by database triggers as well as the API.
- Every API endpoint has a test. Every migration is reversible.
- No hard-coded UI strings or colors in components; use i18n files and theme tokens.
- Seed script creates realistic fake data only. No real patient data in the repository, ever.
- Do not copy the look, wording, icons, images or layout of any existing clinic software.

## Decisions
- 2026-11-15: Stack and architecture as in section 2.
- 2026-11-15: Data migration from a previous system is out of scope for now.
- 2026-11-15: Fresh, original UI (section 4). Nothing copied from existing clinic software.
- 2026-11-15: HTTPS on the LAN with an internal CA; auto-lock and PIN quick switch.
- 2026-11-15: Primary plus standby server with streaming replication and WAL archiving (section 15).
- 2026-11-15: Frontend package manager is pnpm (npm's resolver crashed on the dependency tree). React Router 7 and Vitest 4 instead of older majors, to avoid known advisories in React Router 6 and Vitest 3.
- 2026-11-15: The web container is a small Caddy static server (SPA fallback); the proxy container is a separate Caddy with `tls internal`. API is served under `/api` with the prefix stripped by the proxy.
- 2026-11-15: Postgres extensions `btree_gist` (appointment overlap constraint) and `pg_trgm` (patient search) are enabled in the first migration.
- 2026-11-15: Until M1 (auth), language, theme and digit style are stored per browser; from M1 they move to the user profile on the server.
- 2026-11-15: Refresh token = one server-side session per sign-in, stored hashed, sent in an HttpOnly, Secure, SameSite=Strict cookie scoped to `/api/auth`. Not rotated on each refresh (rotation logs users out when two tabs refresh at once; on a LAN with HttpOnly cookies it adds little). The session ends at 12 hours, on sign-out, on lock, on password reset and on deactivation. Every API request re-checks the session, so these take effect at once.
- 2026-11-15: Lock ends the server session; unlocking signs in again with PIN or password. The UI stays mounted under the lock screen so open work is kept (SPEC 3.3 quick switch).
- 2026-11-15: Failed password and PIN attempts share one lockout counter. Lockout attempts and minutes, and auto-lock minutes, are settings (defaults 5, 15, 5).
- 2026-11-15: Audit rows are written automatically for every change to audited tables (a SQLAlchemy flush hook); sign-in events are logged explicitly. `audit_log` is append-only via a trigger. Password and PIN hashes are masked as `***`.
- 2026-11-15: Sign-in counters and UI preferences are written without bumping the record `version`, so they never cause false edit conflicts.
- 2026-11-15: Users are created with a temporary password and must change it at first sign-in. Usernames are unique ignoring case and never reused.
- 2026-11-15: The audit "machine" is the X-Client-Machine header: per-browser name for now (editable on the sign-in page); the Tauri app will send the Windows PC name (M10).
- 2026-11-15 (M2, pending clinic answers to section 17 Q1–5): the spec's starting lists are seeded as editable defaults. Statuses carry a `key`; the 8 starting ones are built-in (renamable and recolorable, not deletable or disableable) because later modules act on them.
- 2026-11-15: The 20 seeded services have prices 0 and start **inactive**, so nothing is sold at a placeholder price. Staff set prices and activate them. Services default to VAT applicable until the VAT rule is confirmed (Q8).
- 2026-11-15: Number formats default to `PREFIX-YYYY-000001` with a yearly reset, editable in Settings → Document numbering (prefix, yearly reset, digits). Year is by server time in Asia/Riyadh. Allocation locks the sequence row inside the issuing transaction; a rollback returns the number.
- 2026-11-15: Clinics and departments are separate lists (a department may belong to a clinic). Doctors may exist without a user account and link to one later.
- 2026-11-15: Doctor schedules are weekly periods (`work`) and breaks (`break`), weekday 0 = Sunday. Commission rules: a general rate plus optional per-department or per-service rates; the most specific applies. Commission rates are returned only to users with `settings.manage` or `report.financial`.
- 2026-11-15: Settings lists are deactivated or soft-deleted, never hard deleted; `record.view_deleted` shows deleted rows with Restore.
- 2026-11-15: Clinic logo upload is deferred to the printing work (letterhead), since it needs file storage.
- 2026-11-15: CI runs `alembic check` so the models and migrations cannot drift (autogenerate once silently dropped an index declared only in a migration).
- 2026-11-15 (M3): Patient search normalizes Arabic in the database (`clinic_normalize()`: diacritics and tatweel removed, أ/إ/آ/ٱ→ا, ة→ه, ى→ي, Arabic-Indic digits → Western, lower case) into generated columns with trigram GIN indexes; the UI highlights with the same rules. Measured 12–152 ms at 50,000 patients.
- 2026-11-15: File numbers come from a PostgreSQL sequence: sequential and never reused (a failed insert may skip a number; file numbers are not required to be gapless, unlike invoices).
- 2026-11-15: The patient's current insurance is one row per patient; earlier values stay in the audit log. Insurance classes and coverage rules come with M7.
- 2026-11-15: Chronic diseases and allergies are returned with the patient (they drive the header warning badges). Medications and medical history are returned only by `/patients/{id}/health`, which needs `patient.medical_view` and logs every read. Editing health needs `patient.edit` or `dental.edit`.
- 2026-11-15: Duplicate check on national ID or mobile returns 409 `possible_duplicate` with the matches; the client can resend with `allow_duplicate: true` after the user confirms.
- 2026-11-15: Patient list column choice and order are saved per user per PC (browser storage), not on the server.
- 2026-11-15: `balance` and `last_visit_at` exist on patients now and are maintained by later milestones (M4–M8).
- 2026-11-15 (M4): The calendar is a custom grid (MIT, no calendar library): RTL and doctor columns are simpler to get right than adapting react-big-calendar.
- 2026-11-15: The no-overlap rule is the exclusion constraint from section 14. The API also pre-checks to name the clashing booking; the constraint still decides races.
- 2026-11-15: Same-day and outside-hours warnings come back as 409 `needs_confirmation`; the client resends with `acknowledge`. Outside hours additionally needs `appointment.override_hours`. The default Reception role has it (all `appointment.*`); remove it in the role matrix if reception must not override.
- 2026-11-15: Appointment times are sent with the +03:00 offset (Asia/Riyadh has no DST). These are the scheduled times the user chooses, not record timestamps, so SPEC 2 "clients never send timestamps for records" still holds.
- 2026-11-15: "Waiting-list flag" on an appointment = the patient would take an earlier slot; the waiting list holds both such patients and patients without a booking. A freed slot is matched by doctor (or any), preferred weekday and time window.
- 2026-11-15: Cancelling uses the Cancelled status (reason required); deleting (soft) is for entries made by mistake and needs `appointment.delete`.
- 2026-11-15: Completing an appointment updates the patient's `last_visit_at`.
- 2026-11-15: Printing for now is a print-preview page plus the browser's print dialog (slip and day schedule); silent printing waits for the desktop app spike (M0.5).
- 2026-11-15 (M5): Queue numbers restart daily and are allocated under a row lock (number_sequences row `queue-YYYYMMDD`). One open queue entry per patient per day.
- 2026-11-15: Queue steps drive the linked appointment's status: send → Arrived, start → With doctor, finish → Completed. "Left without being seen" is an extra end state for the table and totals.
- 2026-11-15: Minutes waited = from received until the doctor started (or until now while waiting). Thresholds (15/30 by default) are a setting.
- 2026-11-15: "Finishing prompts reception if a payment order was created" (SPEC 7.3) waits for payment orders (M7).
- 2026-11-15 (M6): Visit teeth are an FDI `smallint[]` on the visit (GIN index) instead of a separate `dental_visit_teeth` table: one row per visit, and "visits on tooth 36" still uses an index.
- 2026-11-15: The edit window (24 h default) is a setting (`dental.edit_hours`). "Its doctor" = the user linked to the visit's doctor, or the user who wrote it. Nobody, including Admin, edits after the window; addenda only.
- 2026-11-15: Tooth chart markers come from `tooth_findings` (category + optional description), recorded per tooth; removing one is a soft delete.
- 2026-11-15: The chart is always drawn in the conventional orientation (patient's right on the viewer's left), also in the Arabic UI.
- 2026-11-15: Opening the dental record logs a read, like the Health tab. History search is debounced so typing does not log one read per keystroke.
- 2026-11-15: "Procedure: add services to a quotation" and "Treatment plan note: link to a plan" come with M7.
- 2026-11-15 (M7, assumed Saudi practice, accountant to confirm): VAT 15% (setting `billing.vat_rate`). Saudi citizens are exempt on healthcare (nationality SA, or a national ID starting with 1); everyone else pays VAT. Unknown nationality charges VAT and shows a note. A service marked VAT not applicable is never taxed.
- 2026-11-15: Insurance split order: excluded services → patient; consultations covered up to the class's consultation maximum, the rest patient; patient share % on the covered amount, capped per invoice (largest-remainder allocation to lines); the class daily limit applies to the insurer's net share; VAT split in proportion to each side's net. Expired insurance bills as cash with a note.
- 2026-11-15: Insurance classes are a master list under the company (copay %, cap per invoice, consultation maximum, daily limit, excluded services). The patient's class must belong to the patient's company. Using a different class on a document than the patient's needs `invoice.price_override`.
- 2026-11-15: Insurer use earlier the same day is read from final invoices, which arrive in M8; until then it is 0.
- 2026-11-15: Prices outside a service's min–max range and free-text lines need `invoice.price_override`; overridden lines are flagged.
- 2026-11-15: Quotations are valid 30 days by default (setting); an open quotation past its date becomes Expired when read. Quotation and payment order lines share one `draft_lines` table.
- 2026-11-15: A treatment plan's price is locked once an option is accepted. Installment amounts are before VAT: the installment's payment order adds VAT for patients who pay it (corrected in M8). Months clamp to month end. Installments with payments cannot be regenerated.
- 2026-11-15: Services have an `is_consultation` flag (seeded on DN001–DN003). Booking an appointment for a plan session marks it Booked; completing the appointment marks it Done.
- 2026-11-15 (M8): Paying a payment order recalculates it first (VAT rate, nationality and the insurer's daily limit may have changed). If any amount changed, the new amounts are saved and the API answers 409 `totals_changed`, so reception confirms the new amount due before money is taken. The client also sends the amount it showed (`expected_patient_share`).
- 2026-11-15: One transaction issues the final invoice (gapless `INV`), the receipt (gapless `RC`), the patient balance change and the installment update; any failure returns every number. Issued tables (`invoices`, `invoice_lines`, `credit_notes`, `credit_note_lines`, `receipts`, `receipt_payments`, `receipt_allocations`, `cash_closings`) reject UPDATE, DELETE and TRUNCATE with a trigger.
- 2026-11-15: Payment methods: cash, Mada, credit card, bank transfer, and money on the patient's account. "Insurance" (SPEC 10.5) is not a reception payment method: the insurer's share is on the invoice itself and becomes a receivable for the insurance claims work.
- 2026-11-15: `patients.balance` = what the patient still owes on final invoices; `patients.deposit_balance` = money held on account. Both change only through issued documents, by atomic UPDATEs that do not bump the patient's version. Outstanding on an invoice = patient share - payments allocated to it - credit notes that lowered it. One receipt can pay several invoices (oldest first) via `receipt_allocations`.
- 2026-11-15: Credit notes credit chosen line quantities (or the whole invoice). The patient's part first lowers what is still owed on that invoice; the rest must be refunded (refund receipt, any method except account) or kept on the patient's account. The insurer's part lowers the insurer's share, and counts back for the daily limit. Credit notes need `invoice.credit_note`; refunding money on account needs it too.
- 2026-11-15: ZATCA fields stored at issue: UUID, seller name/VAT/CR/address, buyer name/ID/nationality/file, previous hash and SHA-256 hash (one chain for invoices and credit notes, serialized by an advisory lock; the first previous hash is SHA-256 of "0"), and the phase 1 simplified-invoice QR (TLV base64: seller, VAT number, time, total, VAT). Phase 2 signing and reporting stay in Phase 3.
- 2026-11-15: Receipts store the VAT contained in the amount (in proportion to the invoice's patient VAT), so the cash box can split net, VAT and total. Deposits carry no VAT here; VAT is accounted on the invoice they later pay. Accountant to confirm (KSA may treat advances as taxable on receipt).
- 2026-11-15: Cash box = one shift per user, from their last closing to now. Every money movement and every closing take a per-user advisory lock and stamp `clock_timestamp()` after it, so no receipt can land inside a shift that is already closed. Closing saves the totals (by method: in, refunds, net; each net/VAT/total) and prints the slip. Anyone with `payment.collect` closes their own shift; `cashbox.close` closes and sees other users' shifts. Payments from money on account and credit kept on account are not cash and are listed separately.
- 2026-11-15: The "finishing a visit prompts reception about a payment order" item (SPEC 7.3) is covered by the waiting-payment badge and inbox, which refresh every 15 s; no separate prompt.
- 2026-11-15 (M9, pending the clinic's priority list, SPEC 17 Q9): all ten reports of 11.1 and 11.2 are built on one engine (sections of typed columns + summary), so the screen, the print view and Excel always show the same numbers. Adding a report is one function.
- 2026-11-15: (Corrected in M10.) Reports are exported as PDF on the server with WeasyPrint, the stack default; Pango/HarfBuzz shape Arabic correctly with the Noto Arabic fonts in the API image. The M9 note that this needed a headless browser was wrong. The print view stays for printing.
- 2026-11-15: Excel: one sheet, right-to-left when exported in Arabic, letterhead rows, headers "Arabic / English" in each cell, money as numbers with 2 decimals, dates as real Excel dates in clinic time. Every export is written to the audit log (report key and filters).
- 2026-11-15: Revenue report counts money that passed the cash box: paying from money on account is shown in its own column and was counted when the deposit was taken; credit kept on account is not a refund. Invoices and credit notes in its summary are by issue date, receipts by receipt date.
- 2026-11-15: Doctor commission (report) = rate × (money collected from patients on the doctor's invoices − refunds), without VAT; the rate per invoice line is service, then department, then the doctor's general rate. The insurer's share counts once insurance claims are collected (later module).
- 2026-11-15: Report access: revenue needs report.revenue or report.financial; doctor production, outstanding, insurance, services sold need report.financial; the patient account statement also opens with invoice.view (reception); schedule, no-shows, new patients and waiting times need report.operational or report.clinical. Ranges are limited to two years.
- 2026-11-16 (M10): Silent printing uses WebView2's own print API (ICoreWebView2_16.Print with a printer name; PrintToPdf for PDFs) from the Tauri app: no extra program on the PCs. A hidden window loads the server's print page and prints when the page reports its data is ready. Printer per document size (A4, receipt 80 mm) is chosen per PC. If silent printing fails, the preview opens with the normal dialog. This replaces the separate M0.5 spike; it still has to be confirmed on the clinic's Windows PCs and printers (SPEC 17 Q10).
- 2026-11-16: First launch: the server address is normalised to `https://host[:port]`; the clinic root certificate is fetched from `http://SERVER/ca.crt` (Caddy serves it over plain HTTP only for this), its SHA-256 fingerprint is shown to compare with the server, then it is added to the user's trusted roots with `certutil -user` (Windows asks to confirm).
- 2026-11-16: The web app gets desktop features through a runtime capability granted only to the configured server's origin (and only the listed app commands). Desktop commands refuse URLs outside that server. In a browser nothing changes.
- 2026-11-16: In the desktop app the audit "machine" is the Windows computer name.
- 2026-11-16: Updates come from `https://SERVER/desktop/latest.json` (a Caddy volume), signed with a key the clinic keeps; until a key is configured the app does not update itself. Installers are built by GitHub Actions on Windows (MSI in Arabic and English, and a setup .exe with the WebView2 bootstrapper).
- 2026-11-16: The desktop app's HTTPS (certificate check, updates) uses Windows' own TLS (schannel), so it trusts exactly what Windows trusts.
- 2026-11-16 (M11): Both servers run the same Compose file; the difference is only the data directory (a standby has standby.signal, made by `ops/setup-standby.sh` with pg_basebackup -R and a replication slot) and `.env` (`PEER_IP` = the other server). Failover is `ops/promote.sh` on the standby; the repaired server becomes the new standby with `ops/rebuild-standby.sh`. The PCs follow the name `SERVER_NAME`, via local DNS or an optional moving `SERVICE_IP` that promote.sh takes over.
- 2026-11-16: The database port is published only on this host, or on the server's LAN address for the other server; pg_hba allows the peer only for replication (`replicator`) and the health heartbeat (`clinic_monitor`, which may only write `system_status`).
- 2026-11-16: An `ops` container (postgres:16 image: psql, pg_dump, pg_basebackup, gpg) runs on both servers. PostgreSQL's archive_command copies WAL to a shared staging volume (archive_timeout 5 minutes); ops encrypts each file onto the backup drive within a minute (RPO ≤ 15 min even if both servers are lost). Nightly at 02:00: pg_dump (custom format) kept 14 daily and 8 weekly (Fridays), plus the clinic CA. Weekly: a base backup for point-in-time restore (2 kept; older WAL pruned). Decisions read the files on the backup drive, so restarts never skip or repeat a backup.
- 2026-11-16: Backups are encrypted with GnuPG symmetric AES-256 using a passphrase file (`BACKUP_KEY_FILE`) that is the same on both servers; a printed copy is kept in the clinic's safe. Without a key nothing is written and the health page says so.
- 2026-11-16: Health (SPEC 15.4) comes from PostgreSQL itself (replication lag from pg_stat_replication, archiver status) and from a `system_status` row per server written every minute by ops (disk and backup-drive space, last WAL shipped, last nightly and base backup, last error). The standby writes its row into the primary. Admins (settings.manage) get a red banner for: replication lag > 5 min or standby disconnected, last backup > 26 h, no WAL shipped for 15 min, archiving failing, a server silent for 5 min, disk or backup drive < 15% free, an ops error, or two primaries.
- 2026-11-16: The failover drill was run on one Docker host in development (docs/drills.md). The clinic must repeat it on its own servers before going live; that is the M11 definition-of-done drill.
- 2026-11-16 (owner): Phase 2 is images and documents, prescriptions, lab, medical reports. SMS and the waiting-room display move to Phase 3. No electronic signatures: patients sign the printed papers, which carry signature lines.
- 2026-11-16 (M12): Patient files are stored on the server disk (`CLINIC_FILES_DIR`: the Docker volume `patient_files`, or `%ProgramData%\ClinicServer\files`) under `YYYY/MM/<random>.<ext>`; the database keeps path, SHA-256, size, type and links (visit, tooth). The type is decided from the file's first bytes (images, PDF, DICOM); 50 MB per file. Removing a file is a soft delete; the bytes stay on disk and in backups. New permissions `file.view`, `file.upload`, `file.delete` (reception and doctors: view and upload; managers: all).
- 2026-11-16: Instead of rsync to the standby every 5 minutes (SPEC 15.2), ops encrypts each new file onto the backup drive within a minute, and `promote.sh` and the restore commands put the files back from there. One mechanism for failover and disaster recovery; the backup drive must be reachable from the standby (NAS or a drive moved over).
- 2026-11-16: Prescriptions, lab requests and medical reports follow the dental record's rules: written with `dental.edit`, read with `dental.view` (logged), editable by their doctor within `dental.edit_hours`, then only cancelled with a reason. Lab results can be entered by any doctor while the request is not cancelled. Drug and lab-test lists are editable settings lists; the seeded doses are defaults for the doctor to adjust, not recommendations.
- 2026-11-16: Medical reports: kinds report, referral letter, attendance certificate; Arabic or English; printed in that language's direction. Prescriptions and lab prints are bilingual.
- 2026-11-16: Demo data (`seed-demo`, installer option): five weeks of fake activity created through the app's own functions; invoices and receipts are back-dated in issue order (bypassing the immutability trigger inside that one transaction), so numbers rise with dates. Never on a real database.
- 2026-11-16 (owner feedback): The service price is a suggestion. Reception and doctors write bills and quotations (`quotation.edit`) and may set any price (`invoice.price_override`, also for lines without a service and for choosing another insurance class); changed prices are marked on the line and kept in the audit log. Managers keep the min–max range unless an admin grants the override in Roles. The editor shows the suggested price next to a changed one.
- 2026-11-16: The clinic is called White Pearl (اللؤلؤة البيضاء) by default; editable in Settings → Clinic details. Doctors have a room (free text). Staff can belong to a department; a department opens to show its doctors (with rooms), its staff, and the patients its doctors saw in the last 180 days.
- 2026-11-16 (edge-case review): A doctor writes visits, prescriptions, lab requests and medical reports in their own name; staff who are not doctors choose the doctor. A line discount cannot be larger than the line. File dates and visit times cannot be in the future. Blank report bodies and addenda are refused; a lab result lists each test once.
- 2026-11-16: Windows server: the backup service follows the PC's IPv4 addresses (adds a new one to the web server within a minute; `clinic-ops addresses` does it at once), and the installer offers to switch a network marked Public to Private.
