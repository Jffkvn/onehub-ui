# `_contract/` — reference only, never imported

This folder is the **authoritative record of how the backend is called**: exact RPC names, table names, column names and payload shapes.

It is copied from the existing app (`github.com/Jffkvn/jantahronehub`) and is **not part of the running application**. Exclude it from the build. Never import from it.

## How to use it

**Before implementing any data access, read the matching file here.** Snake_case payload keys must match the Postgres function signatures exactly — the backend is frozen, so the new UI adapts to it, never the reverse.

```
api/          17 files — every backend call the old app made, prefixed by module
              e.g. hr.employees.ts, payroll.payroll.ts, portal.selfService.ts
schemas/       8 files — Zod validation rules
types/         payroll + projects domain types
modules.config.ts  role / permission taxonomy — reuse these permission strings verbatim
lib/           supabase client, security helpers, date helper (+ their tests)
               → these are PORTED into the real app, not just referenced
```

## Examples of contracts recorded here

- `create_employee_with_period`, `update_employee_profile`, `archive_employee`, `offboard_employee`
- `create_payroll_draft`, `replace_payroll_draft_items`, `approve_payroll_run`, `record_payroll_export`
- `rpc_decide_staff_advance`, `rpc_record_advance_repayment`, `rpc_transition_staff_advance`
- `get_my_payslips`, `get_governance_report_snapshot`, `get_my_access_context`

113 RPCs exist in total. If a screen appears to need something not covered here, **stop and flag it** — do not invent a migration.
