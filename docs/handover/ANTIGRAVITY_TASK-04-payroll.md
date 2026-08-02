# TASK-04 — Payroll module

> Read `ANTIGRAVITY_BRIEF.md` and `PLAN.md`. TASK-01–03 merged and reviewed.
> **Frozen:** never modify the backend. No `supabase/` folder. Old app untouched. No new permission strings.
> **First real module — it sets the pattern the other four copy.** Data layer from `_contract`, screens from the TASK-02 archetypes.

## Reference — all in this repo

| What | Where |
|---|---|
| API contract (RPC names, exact arg names, table selects) | `src/_contract/api/payroll.payroll.ts` |
| Domain types | `src/_contract/types/payroll.types.ts` |
| **Export logic to PORT — statutory formats** | `src/_contract/payroll-exports/` — `masterPayroll.ts`, `paymentFiles.ts`, `payslip.tsx`, `amendmentDraft.ts` (+ their tests) |
| Target look — dense run table | `design/02-hr-dashboard.png`, and the payroll table in `design/` mockup HTML |
| Motion | `design/motion-study.html` |

**Read `payroll.payroll.ts` before writing any data access.** Reproduce RPC names and argument names **exactly** — the backend is frozen.

---

## Part A — Data layer (`src/modules/payroll/api/payroll.ts`)

Reimplement the `PayrollApi` interface. Same function names, same RPCs, same arg keys:

```ts
list(): Promise<PayrollRun[]>                    // from('payroll_runs').select(...).order('created_at', desc)
get(id): Promise<PayrollRun>                     // .eq('id', id).single()
eligibleEmployees(): Promise<PayrollEmployee[]>  // employees + employee_confidential_profiles(pct_month_worked)
                                                 //   + employment_periods(start_date,end_date,departments(name))
                                                 //   → derive current period → departmentName
create(periodStart, items)   → rpc('create_payroll_draft',      { target_period_start, target_run_type:'regular', target_source_run_id:null, run_reason:'Regular monthly payroll', item_payload })
replace(id, items, reason)   → rpc('replace_payroll_draft_items',{ target_run_id, item_payload, change_reason })
approve(id, reason)          → rpc('approve_payroll_run',        { target_run_id, approval_reason })
amend(id, type, reason, items)→rpc('create_payroll_amendment',   { source_run_id, amendment_type, amendment_reason, item_payload })
recordPayment(id, input)     → rpc('record_payroll_payment',     { target_run_id, payment_date, reference, method, payment_proof_path:null, payment_notes })
recordExport(runId, itemId, kind) → rpc('record_payroll_export', { target_run_id, target_item_id, export_kind })
```

`item_payload` items must be exactly:
```ts
{ employee_id, percent_of_month_worked, overtime_hours,
  line_items: [{ kind, code, description, amount }] }
```

Wrap in TanStack Query: `['payroll','runs']`, `['payroll','run',id]`, `['payroll','eligible-employees']`. Invalidate the list + the run after every mutation.

## Part B — Port the export modules (business logic — do NOT rewrite)

Move `_contract/payroll-exports/*` into `src/modules/payroll/exports/`, adjusting imports only. **Port their tests and keep them green.** These encode statutory output formats — inventing your own would produce filings that are wrong.

- `paymentFiles.ts` → `bankPaymentCsv`, `mtnBulkPayCsv`, `nssfCsv`, `payeCsv`, `whtCsv`, `downloadText`
- `masterPayroll.ts` → Master Excel
- `payslip.tsx` → payslip PDF **and `payslipFileName()`**, which already produces `Ben_Ten_July_2026_Payslip.pdf`. Keep that naming exactly — it was a specific fix in the old app.
- `amendmentDraft.ts` → `buildAmendmentDraftItems`

Every export must call `recordExport(...)` **before** the download — that's the audit trail.

## Part C — Screens

### C1. Payroll Runs list — `/finance/payroll`
- `PageHeader` "Payroll Runs" + **New payroll** action (only with `payroll.prepare`).
- KPI row: Payroll runs (+approved count) · Latest net pay · Payments recorded · Draft runs.
- `DataTable`: Period · Status pill (draft=warning, approved=success) · Gross · Net pay · Payment (Paid / Not recorded) · Open.
- Loading = skeleton rows. Empty = `EmptyState` with the New-payroll CTA.

### C2. Create payroll modal
- Month picker + helper: *"Imports all active employees at their current salary rates."*
- **All / None** toggles, **search** (name + employee number), employees **grouped by `departmentName`** (fallback group "Unassigned"), groups alphabetical.
- **"X of Y selected"** counter. Create disabled at zero selection.
- Submit → `create(periodStart, items)` → navigate to the new run.
- ⚠️ There is **no run-name parameter** in `create_payroll_draft`. Do not add a run-name field.

### C3. Payroll Run detail — `/finance/payroll/:id`
The dense table is the centrepiece.

- Header: run type · run number · period label · status pill; "Approved and locked" messaging when approved.
- KPI row: Gross · Deductions · Net pay · Employees.
- **Employer NSSF banner:** *"Employer NSSF cost: UGX {sum nssfEmployer} — company contribution on top of salaries. Total NSSF to remit: UGX {nssfEmployee + nssfEmployer}"*.
- **Dense table**, columns in this order, all figures right-aligned `tabular-nums`:

  | Column | Source |
  |---|---|
  | Employee | `employeeName` + `employeeNumber` |
  | Gross Salary | `contractualGross` |
  | Overtime | `overtimePay` |
  | Allowances | `allowances` |
  | PAYE (URA) | `paye` |
  | NSSF (Emp) | `nssfEmployee` |
  | WHT / Other | `wht + otherDeductions` |
  | Advance | `salaryAdvanceDeduction` |
  | Unpaid Leave | `lineItems` where `kind==='proration' && code==='UNPAID_LEAVE'`, else `—` |
  | Total Deductions | `totalDeductions` |
  | Net Pay | `netPay` (emphasised) |
  | Action | draft → **Edit**; approved → **Payslip PDF** (needs `payroll.export`) |

- **TOTALS footer** summing every numeric column. Totals come from the **full run**, not the search-filtered subset.
- Employee **search** filters displayed rows only.
- **Draft rows expand inline** to edit: percentage worked, overtime hours, add/remove allowance · advance repayment · deduction, and **Defer from run**. No giant per-employee cards.
- Sticky action bar: reason input + **Save draft** (enabled only when `reason.length ≥ 3 && dirty && draft.length`) and **Approve payroll** (disabled while dirty). Locked runs show exports + **Create supplemental/correction** + **Record payment**.

### C4. Modals
- **Approve & lock** — permanent-action warning, reason ≥ 3 chars.
- **Record payment** — date (max today), reference ≥ 3, method (bank/mobile_money/cash/other), notes.
- **Create linked run** — type (supplemental/correction) with explanatory copy, reason, employee picker **with the same search + All/None + grouping + counter as C2**, using `buildAmendmentDraftItems`.

## Part D — Permissions (only these, all already in `PERMISSIONS.txt`)

| Action | Gate |
|---|---|
| View payroll | `payroll.read` |
| Create/edit draft, deductions | `payroll.prepare` |
| Approve | `payroll.approve` |
| Master Excel / CSVs / payslip PDF | `payroll.export` |
| Record payment | `payroll.record_payment` |

Gate UI on permissions — the backend enforces regardless. **No role-name checks.**

## Part E — Also wire these nav routes

`/finance/exports` (Statutory Exports — the five CSVs + Master Excel for a chosen approved run, gate `payroll.export`) and `/finance/deductions` (Deductions & Adj, gate `payroll.prepare`). If either genuinely needs backend support that doesn't exist, leave the placeholder and **flag it** — do not invent an RPC.

---

## Verification

```bash
npm run typecheck && npm run lint && npm run test:unit && npm run build
```

**Tests (add):**
- api layer: each method calls the right RPC with **exactly** the documented arg keys (mock the client and assert the payload) — this is the contract guard
- `item_payload` snake_case mapping is correct
- ported export tests still pass, incl. `payslipFileName()` → `Ben_Ten_July_2026_Payslip.pdf`
- TOTALS computed from the full run, not the filtered rows
- Approve disabled while dirty; Save disabled when reason < 3 chars
- permission gating hides Approve/Export/Payment for users lacking those keys

**Manual, both themes:** runs list, create modal (search/All/None/grouping/counter), draft run with inline edit, approved run with exports, all three modals, mobile width.

**Attach screenshots:** runs list, draft run, approved run — light and dark (6 images).

## Acceptance criteria

- [ ] All 9 `PayrollApi` methods reimplemented with **identical RPC names and arg keys**; `item_payload` shape exact.
- [ ] Export modules **ported, not rewritten**; their tests pass; `recordExport` called before every download; payslip filename preserved.
- [ ] Runs list, create modal, run detail and three modals built from TASK-02 archetypes.
- [ ] Dense table: all 12 columns in order, right-aligned tabular figures, TOTALS footer from the full run, Employer-NSSF banner, inline row editing for drafts, Payslip PDF when approved.
- [ ] Draft guards intact: Save needs reason ≥ 3 + dirty; Approve blocked while dirty.
- [ ] Permission gating correct; no role-name checks; no new permission strings.
- [ ] `/finance/exports` and `/finance/deductions` wired or explicitly flagged.
- [ ] Both themes, keyboard accessible, skeleton loading, motion per spec.
- [ ] `npm run verify` passes; no backend change; no `supabase/` folder.

## Out of scope
HR/Portal/Warehouse modules. Live sidebar count badges (TASK-08). Any change to payroll calculation — the backend computes it; the UI only submits inputs and displays results.
