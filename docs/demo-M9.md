# Demo script: M9, reports

Run `python -m app.cli seed-dev`, then create a little activity (M7/M8 demo scripts): a few payment orders
paid in cash and Mada, a deposit, a credit note. All data is fake.

## Walkthrough

1. **Reports** in the sidebar (as `cashier`). The list shows only the reports your role may run:
   financial (revenue, doctor production and commission, account statement, outstanding balances and
   overdue installments, insurance per company, services sold) and operations (daily schedule per doctor,
   no-shows and cancellations, new patients, queue waiting times). As `reception` you see the operations
   reports and the account statement.
2. **Revenue report.** Opens on this month. Filters: period, patient, doctor, clinic, received by, method.
   Rows: receipt, invoice, date and time, patient and file number, doctor, service in Arabic and English,
   invoice total, discounts, net, amount paid, paid from account, method, VAT rate and VAT. Then payments by
   method and the summary: new patients, invoice count, gross, discounts, net without VAT, VAT, total,
   insurance share, total collected, credit notes, refunds, deposits, money on account used or kept.
3. **Print** opens the A4 landscape print view with the letterhead. **PDF** downloads the report rendered on
   the server (WeasyPrint, added in M10). **Excel** downloads the same report: right-to-left sheet in Arabic, bilingual
   headers, numbers and dates as real Excel values. Each export appears in the audit log.
4. **Account statement.** Pick a patient: invoices, payments, credit notes, deposits and refunds in order,
   with the running balance owed and money on account, opening and closing balances for the period.
5. **Doctor production.** Per doctor: invoices, net invoiced, patients' and insurer's share, collected,
   refunded, commission base and commission (all without VAT, rate by service, department or general).
6. **Daily schedule** prints one table per doctor for the chosen day.

## Tests

```bash
(cd api && .venv/bin/pytest -q)   # 147 tests (8 for reports: numbers agree with the ledger, Excel, access)
(cd web && pnpm test)             # 49 tests
(cd web && pnpm e2e)              # 27 tests (revenue → print → Excel; statement; reception's reports)
```
