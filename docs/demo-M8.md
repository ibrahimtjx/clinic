# Demo script: M8, payments and invoices

Run `python -m app.cli seed-dev` for the demo users (`reception`, `cashier`, `dr.omar`, password
`Clinic-dev-2026`). All amounts are fake.

## Walkthrough

1. **Payment order** (as `dr.omar`, or `admin`). On a patient's profile, Accounts tab → New payment order. Add a
   service, then "Send to reception for payment".
2. **Collect** (as `reception`). The bell shows the waiting count; Billing → Waiting for payment lists it.
   "Collect payment": the amount due is prefilled as cash. Split it: change the cash amount, "Add payment
   method" (prefilled with what is left, e.g. Mada with the approval number). Paying less is allowed: the
   rest goes to the patient's balance. Money on account (deposits) can pay too. "Issue invoice and receipt"
   issues the final invoice `INV-YYYY-000001` and receipt `RC-YYYY-000001` together.
   If the amounts changed since the doctor wrote the order (insurer's daily limit used by an earlier
   invoice today, VAT rate, nationality), nothing is charged: the new amount is shown to confirm.
3. **Print.** Invoice on A4 as a simplified tax invoice with the ZATCA QR code, seller VAT number, buyer
   details and UUID. Receipt on the 80 mm receipt printer.
4. **Final means final.** The invoice page has no edit button; the API has no update or delete route; the
   database itself rejects changes (try `UPDATE invoices SET total = 1;` in psql).
5. **Patient account** (Accounts tab). What the patient owes, money on account, unpaid invoices, receipts.
   "Pay balance" (oldest invoice first), "Take deposit", "Refund money on account" (cashier).
6. **Credit note** (as `cashier`). On an invoice: Credit note → choose lines and quantities (or Whole
   invoice) and a reason. If the patient still owed money, it lowers the balance. If they had paid, refund
   it now (refund receipt) or keep it on the account. Credit notes are numbered `CN-YYYY-000001` and print
   with their own QR.
7. **Installments.** On an accepted plan, "Payment order" on an installment, then collect it: the
   installment shows as paid.
8. **Cash box** (Billing → Cash box). My shift: money in, refunds and net per method, each split into
   without VAT, VAT and total. "Close shift" saves and prints the closing slip; the next payment starts a new
   shift. The cashier also sees other users' open shifts and can close them.

## Tests

```bash
(cd api && .venv/bin/pytest -q)   # 139 tests (11 for payments, credit notes, deposits, cash box)
(cd web && pnpm test)             # 48 tests
(cd web && pnpm e2e)              # 25 tests (collect split payment → credit note → close shift)
```
