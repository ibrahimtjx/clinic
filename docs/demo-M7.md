# Demo script: M7, treatment plans and quotations

Run `python -m app.cli seed-dev` first: it adds a fake insurer "تأمين تجريبي / Demo Insurance" with classes
VIP (0% copay), A (10%, capped at 50 per invoice) and B (20%, capped at 75), a consultation limit of 150,
a daily limit of 1,500 and veneers (DN017) excluded. All numbers are fake; the clinic enters real ones in
Settings → Insurance classes.

## Walkthrough

1. **Insurance classes** (Settings, as `admin`). Per class: patient share %, maximum patient share per
   invoice, consultation maximum covered, daily limit, excluded services. Give a patient a company and class
   in the patient form.
2. **Quotation** (as `dr.omar`). On the patient's profile, "New quotation". Add services: the price starts at
   the service's sale price; outside its min–max range is refused unless you hold `invoice.price_override`.
   Discount by amount or %. Totals, VAT, insurance share and patient share update live as you type; they are
   always recalculated on the server. Notes explain what happened (copay capped, excluded service, daily
   limit reached, insurance expired, nationality unknown so VAT charged). Untick "Use insurance" to quote as
   cash.
3. **Lifecycle.** Draft → Send → Accept → Convert to a payment order. Past its validity (30 days by default,
   Settings → Billing) an open quotation shows as expired. Print from the editor (A4).
4. **Payment orders.** Converting, or creating one directly, then "Send to reception". Reception sees the
   inbox in Billing and a count in the notifications bell. Collecting payment comes with M8.
5. **Treatment plan** (Plans tab). Several options (e.g. implant vs bridge), each with sessions (description,
   service, teeth, share of the price). Propose → Accept an option → In progress → Completed. Once accepted
   the price is locked. "Generate installments": down payment plus monthly amounts (dates clamped to month
   end). Overdue installments are listed; "Payment order" creates a sent order for an installment.
6. **Sessions and appointments.** Book an appointment for a plan session: the session becomes Booked, and
   Done when the appointment is completed (also from the queue).

## Pricing rules (assumed for Saudi practice; the accountant should confirm)

- VAT 15% (a setting). Saudi citizens (nationality SA, or a national ID starting with 1) are exempt on
  healthcare; residents pay VAT. Services can also be marked "VAT not applicable".
- Excluded services: the patient pays all. Consultations: the insurer covers up to the consultation limit,
  the rest is the patient's. Copay %: applied to the covered amount, capped per invoice. Daily limit: on the
  insurer's share before VAT, across the day's invoices. VAT is split in proportion to each side's net.
- Insurer use earlier the same day counts from M8 (final invoices); until then it is 0.

## Tests

```bash
(cd api && .venv/bin/pytest -q)   # 128 tests (pricing worked examples, quotations, orders, plans)
(cd web && pnpm test)             # 45 tests
(cd web && pnpm e2e)              # 24 tests (quotation → order → reception inbox; plan → installments)
```
