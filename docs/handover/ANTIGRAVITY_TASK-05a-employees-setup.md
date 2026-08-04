# TASK-05a — Employees & HR Setup

> Read `ANTIGRAVITY_BRIEF.md` and `PLAN.md`. TASK-01–04 merged and reviewed.
> **Frozen:** never modify the backend. No `supabase/` folder. Old app untouched. No new permission strings.

## Why HR is split into three tasks

HR is **51 RPCs across five sub-domains** — far too large for one task. It is split by workflow shape:

| Task | Scope | Size |
|---|---|---|
| **05a (this)** | Employees · HR Setup (departments, job titles, pay grades) | 9 RPCs, 4 tables |
| 05b | Leave · Staff Advances — request→approve→ledger workflows | 26 RPCs |
| 05c | Performance · Training — cycles, records, documents | 21 RPCs |

**05a is first because everything else references employees** — leave, advances, performance, training and payroll all pick from this list.

## Reference — all in this repo

| What | Where |
|---|---|
| Employees contract | `src/_contract/api/hr.employees.ts` |
| Setup contract | `src/_contract/api/hr.setup.ts` |
| Zod schemas | `src/_contract/schemas/hr.employee.ts`, `hr.setup.ts` |
| Permissions (authoritative) | `src/_contract/PERMISSIONS.txt` |
| Patterns to follow | `src/modules/payroll/` from TASK-04 — mirror its structure |

**Read the contract files before writing data access.** Reproduce RPC names and arg keys exactly.

---

## Part A — Data layer

### `src/modules/hr/api/employees.ts`

Reimplement `EmployeeApi`: `list`, `get`, `setup`, `create`, `update`, `archive`, `offboard`.

```ts
list()   → from('employees').select(...) with departments / job_titles / pay_grades joins, archived filtered
get(id)  → single employee incl. current employment period
setup()  → reference data: departments, job_titles, pay_grades (for form dropdowns)

create(values)        → rpc('create_employee_with_period', toEmployeeRpcPayload(values))
update(id, values)    → rpc('update_employee_profile', { target_employee_id: id, ...toEmployeeRpcPayload(values) })
archive(id, reason)   → rpc('archive_employee',  { target_employee_id: id, reason })
offboard(id, values)  → rpc('offboard_employee', { target_employee_id: id,
                              last_working_day: values.endDate,
                              reason:           values.exitReason,
                              notes:            values.exitNotes || null,
                              pay_status:       values.finalPayStatus })
```

⚠️ **Port `toEmployeeRpcPayload()` exactly** from the contract file. It maps camelCase form values to the snake_case keys `create_employee_with_period` expects — getting a key wrong fails silently or writes the wrong column. Do not re-derive it from the form shape.

### `src/modules/hr/api/setup.ts`

`hr_list_setup_records`, `hr_save_department`, `hr_save_job_title`, `hr_save_pay_grade`, `hr_set_setup_archived` — copy arg names verbatim from `hr.setup.ts`.

### Query keys
`['hr','employees']`, `['hr','employee',id]`, `['hr','setup']`. Invalidate `employees` + `employee(id)` after every mutation; invalidate `setup` after setup mutations (dropdowns must refresh).

### Zod
Port `schemas/hr.employee.ts` and `schemas/hr.setup.ts` **as-is** and use them with react-hook-form + `@hookform/resolvers/zod`. They encode server-side validation rules — weakening them just moves the failure later.

---

## Part B — Screens

### B1. Employee Directory — `/people/employees` (gate `employees.read`)
- `PageHeader` "Employees" + **Add employee** (gate `employees.create`).
- KPI row: Total active · On probation · Contracts ending (next 30 days) · Departments.
- `DataTable`: Employee (avatar + name + employee number) · Job title · Department · Employment type · Status pill (active / probation / on-leave / archived) · Actions.
- **Search** (name + employee number) and **filters**: department, status, employment type.
- Row actions via `ActionMenu`: **View** (primary) + overflow → Edit · Offboard · Archive. Gate each.
- Skeleton loading, `EmptyState` when none.

### B2. Employee detail — `/people/employees/:id`
Use `DetailSlideOver` **or** a full page — pick one and be consistent; a full page is better here given the field count.

Sections: identity (name, number, photo/initials, status) · employment (job title, department, pay grade, type, contract dates, probation) · contact · payroll identifiers (TIN, NSSF, bank/mobile-money — **display only**, never editable here).

Header actions: Edit · Offboard · Archive, permission-gated.

### B3. Add / Edit employee form
`FormSection` groups: Identity · Employment · Compensation · Contact · Statutory IDs.
Searchable `Combobox` for department / job title / pay grade (from `setup()`). Inline Zod validation. Submit → `create` or `update` → invalidate → return to detail.

### B4. Offboard modal
Last working day (date) · exit reason · notes (optional) · **final pay status**. Map exactly to `offboard_employee` args. Make consequences explicit in the copy — this ends employment.

### B5. Archive confirm
Reason required (min length per schema). Explain archive ≠ delete: the record is retained and hidden from active lists.

### B6. HR Setup — `/people/pay-grades` (gate `employees.manage_setup`)
One page, three in-content `Tabs`: **Departments · Job Titles · Pay Grades**.

> `Tabs` here is legitimate — it's *within* one page's content, not primary navigation. Do not add page-level tab strips.

Each tab: `DataTable` + Add/Edit modal + archive toggle (`hr_set_setup_archived`). Show archived items behind a "Show archived" switch, visually de-emphasised.

---

## Part C — Permissions (all already in `PERMISSIONS.txt`)

| Action | Gate |
|---|---|
| View directory / detail | `employees.read` |
| Create | `employees.create` |
| Edit | `employees.update` |
| Archive / Offboard | `employees.archive` |
| Setup (dept / title / grade) | `employees.manage_setup` |

Gate UI on permissions; the backend enforces regardless. **No role-name checks. No new permission strings.**

---

## Verification

```bash
npm run typecheck && npm run lint && npm run test:unit && npm run build
```

**Tests (add):**
- api layer: each method calls the right RPC with **exactly** the documented arg keys (mock client, assert payload)
- `toEmployeeRpcPayload()` produces the same snake_case keys as the contract — assert against a fixture
- Zod schemas reject the cases they rejected before (port schema tests if present)
- permission gating hides Add / Edit / Archive / Offboard appropriately
- directory search + filters narrow rows correctly

**Manual, both themes:** directory with search/filters, detail page, create + edit forms with validation errors, offboard, archive, all three setup tabs incl. archived toggle, mobile width.

**Attach screenshots:** directory, employee detail, employee form, setup page — light and dark (8 images).

## Acceptance criteria

- [ ] `EmployeeApi` (7 methods) and setup API reimplemented with **identical RPC names and arg keys**.
- [ ] `toEmployeeRpcPayload()` ported exactly; asserted by test.
- [ ] Zod schemas ported unchanged and wired to forms.
- [ ] Directory, detail, create/edit, offboard, archive, and 3-tab setup all built from TASK-02 archetypes.
- [ ] Payroll identifiers are display-only on the employee detail.
- [ ] Permission gating correct; no role-name checks; no new permission strings.
- [ ] Query invalidation refreshes directory **and** setup dropdowns.
- [ ] Both themes, keyboard accessible, skeletons, motion per spec.
- [ ] `npm run verify` passes; no backend change; no `supabase/` folder.

## Out of scope
Leave, Staff Advances (05b), Performance, Training (05c). Employee document upload — flag if a screen seems to need it. Live sidebar counts (TASK-08).
