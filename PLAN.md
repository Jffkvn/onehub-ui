# OneHub — New UI Build Plan (LOCKED)

**Locked:** 2 August 2026
**Location:** `/Users/dora.agai/Downloads/OneHub New UI`
**Design references:** `design/` in this folder (approved mockups + live motion study)

## 0. Repository & backend model — READ FIRST

This is a **separate, frontend-only repository**. The existing app (`github.com/Jffkvn/jantahronehub`) is **never modified, never deleted, and keeps running**.

The "backend" is a **hosted Supabase project**, not code: `sewbxazwpjbtevckorbl` — "Egypro Onehub Antigravity". Both apps connect to it with the same `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`, so **data reflects both ways in real time** — a payroll run approved in the old app appears in the new one, and vice versa. Same tables, same RLS, same RPCs.

| | Old app (`jantahronehub`) | New app (this repo) |
|---|---|---|
| Frontend code | untouched, keeps running | built fresh |
| `supabase/` migrations | **lives there only** | **none — do not copy** |
| Live database | ← same Supabase project → | ← same → |

**This repo contains no `supabase/` folder.** One migration history, in `jantahronehub` only, so the two can never drift. If a backend change is ever genuinely required, it is made **once** in `jantahronehub` and both apps pick it up automatically.

The old repo's `src/modules/*/api/*.ts` files are copied here **read-only** into `src/_contract/` as the RPC specification — reference material, never imported into the running app.

---

## 1. Why this rebuild

The backend is solid — 87 Supabase migrations, RLS, audited RPCs, one Edge Function — and every fix in tasks 01–08 deliberately preserved it. The frontend is the problem. After three rounds of incremental polish (fonts, motion, visual enrichment), the app still didn't stand next to industry products (Kuubiik, Knowvio, Zendenta, HireFlow).

Two root causes, both structural and neither fixable by more patching:

1. **Navigation.** The old app exposed **6 sidebar items** and buried ~15 functions behind in-page tab strips (HR Management had 7 tabs; My Workspace had 8). Every reference app exposes 9–14 functions directly in the sidebar. Tab strips also ate two rows of vertical space on every page.
2. **Foundation.** A hand-rolled CSS system (`tokens.css` + a 2,412-line `global.css`) with partial component adoption — 67 raw `<select>` elements vs 3 uses of the smooth `Combobox`. Accessibility and consistency problems kept recurring because there was no real primitive layer.

**Decision:** rebuild the frontend from scratch here, on Tailwind + Radix primitives, treating the old `api/*.ts` files as the authoritative backend contract so the new UI stays fully compatible with an untouched backend.

---

## 2. Locked design decisions

All approved from rendered mockups (see `design/`).

| Decision | Locked choice |
|---|---|
| Shell | **Dark navy sidebar** (`#0e1626`), light content canvas (`#f5f6f8`) — "Option A" |
| Navigation | **Deep sidebar, ~16 functions exposed, grouped.** No in-page tab strips anywhere |
| Sidebar groups | Overview / People / Finance / Operations / System (from the legacy app's categorisation) |
| Brand colour | Egypro **navy + emerald** retained |
| Colour usage | Icon chips, status pills, nav active state, charts. **No gradient hero banners** |
| Page headers | Plain heading on canvas — matches all four references |
| Typography | Plus Jakarta Sans (display) + Inter (body), self-hosted |
| Density | 8–12px radius, tight padding, `tabular-nums` + right-aligned on every figure |
| Dashboards | **Role-aware** — sidebar and content composed from permissions |
| Motion | Purposeful only; see §6 |

### Sidebar information architecture (HR Administrator)
```
OVERVIEW    Dashboard · My Workspace
PEOPLE      Employees 18 · Leave 3 · Performance · Training · Pay Grades
FINANCE     Payroll 1 · Staff Advances 2 · Deductions & Adj · Statutory Exports
OPERATIONS  Projects 6 · Inventory · Project Cash 2
SYSTEM      Reports · Settings · Audit Log
```
Live counts render as badges on nav items. Sidebar also carries the org chip (e.g. "Egypro Uganda · UGX · UG"), an "Ask AI Assistant" affordance, and the user block.

**Role-aware:** a Warehouse Manager sees `INVENTORY` (Consumables, Equipment, Stock Requests, Receiving, Stock Ledger, Bulk Tools) and `CUSTODY` (Issued Assets, Returns Due) instead of People/Finance — and no HR or payroll routes at all, because permissions don't grant them. Every role keeps **My Workspace**. Verified in `design/03-warehouse-dashboard.png`.

---

## 3. Scope boundary

### Not in this repo at all
- `supabase/` — migrations, Edge Function, pgTAP tests. **Stays in `jantahronehub`.** This app talks to the live project over the network like any client.

### Reimplement from spec (do NOT copy the UI, DO honour the contract)
These files encode exact table names, RPC names and payload shapes. Read them as the API contract:
- All 17 `src/modules/*/api/*.ts` — e.g. `hr/api/employees.ts` (`create_employee_with_period`, `update_employee_profile`, `archive_employee`, `offboard_employee`), `payroll/api/payroll.ts`, `portal/api/selfService.ts` (`get_my_payslips`), `hr/api/staffAdvances.ts` (`rpc_decide_staff_advance`).
- `src/modules/*/schemas/*.ts` (Zod), `src/modules/*/types.ts`
- `src/config/modules.ts` — role/permission taxonomy; rewrite, but reuse its permission strings verbatim.

### Port near-verbatim (small, non-UI, proven)
- `src/lib/supabase/client.ts` (36 lines), `src/lib/security/*` (privateFiles, safeUrl, filePolicy), `src/lib/date/formatKampalaDate.ts`
- `src/components/charts/*` — restyle, don't reinvent.

### Rebuild entirely
`src/components/ui/*`, `src/layout/*`, `src/styles/*`, every module's `pages/` and `components/`, `src/app/router.tsx`.

---

## 4. Stack

Keep: **React 19 · TypeScript · Vite · TanStack Query · react-router-dom · react-hook-form · Zod · lucide-react · @react-pdf/renderer · @supabase/supabase-js**

Add: **Tailwind CSS** + **Radix UI primitives**, owned in-repo shadcn/ui-style — Select, Dialog, Dropdown, Combobox, Tabs, Tooltip, Popover. This directly fixes the 67-raw-`<select>` problem.

Drop: the hand-rolled `global.css`/`tokens.css` system.

---

## 5. Screen archetypes (build once, reuse everywhere)

1. **App shell** — dark sidebar w/ grouped deep nav + count badges + sliding active indicator; topbar w/ search, notifications, avatar.
2. **Dashboard** — plain greeting, KPI grid (icon chip + figure + delta), charts, alerts, quick actions.
3. **KPI card** — module-tinted icon chip, tabular figure, trend line.
4. **Data table** — dense rows, avatar+name cells, status pills, right-aligned numerals, TOTALS footer where relevant, row actions as primary + `⋯` overflow.
5. **Detail slide-over** — header w/ ID + status pill, summary stat grid, sections, event timeline, sticky footer actions.
6. **Forms** — grouped sections, inline validation, Radix Combobox for long lists, native select only for short enums.
7. **Alerts & Events card** — titled, per-type colour chips, relative timing, urgency in red (birthdays, contract endings, probation reviews, certification expiry, advance decisions, deliveries, warranties).
8. **Quick Actions card** — icon chip + label + subtitle + chevron.
9. **Empty state** — icon chip, one line, primary CTA.

---

## 6. Motion spec

Approved via the live study (`design/motion-study.html`). CSS `transform`/`opacity` only — no JS animation loops.

| Moment | Behaviour |
|---|---|
| Page load | Staggered rise, ~20ms apart, `cubic-bezier(.16,1,.3,1)`. **Once per navigation, never on re-render** |
| Numbers | Count up, ≤900ms, cubic ease-out |
| Charts | Line traces, then fill fades in |
| Loading | **Skeletons shaped like the real content.** No spinners, no layout shift |
| Hover | Cards lift 3px; rows tint; ~200ms |
| Press | `scale(.97)` |
| Slide-over | Ease in over blurred scrim, 420ms `cubic-bezier(.32,.72,0,1)`; Esc / click-away closes |
| Confirmation | **Optimistic** — pill flips state immediately, toast rises. Never block the user |
| Reduced motion | `prefers-reduced-motion` collapses all animation to ~0. Non-negotiable |

Guiding rule: the heaviest lifting for perceived smoothness comes from skeletons and optimistic updates, not entrance flourish. When in doubt, tune motion **down**.

---

## 7. Build sequence

1. **Scaffold** — Vite + React + TS + Tailwind here; copy `supabase/` verbatim; port `lib/` (supabase client, security, date); wire `.env` from `.env.example`.
2. **Design system** — tokens, then the Radix primitive layer, then the 9 archetypes from §5. Nothing module-specific until this is done.
3. **App shell + routing** — role-aware nav config, `RequireAuth` / `RequirePermission` equivalents, auth flows (login, invite, TOTP).
4. **Modules, in order of visibility:**
   1. Payroll (runs list, dense run table, payslip PDF)
   2. HR (employees, leave, staff advances, performance, training)
   3. Portal / My Workspace (payslips, profile, documents)
   4. Warehouse, Projects, Cash
   5. Reports, Admin
5. **Role dashboards** — HR, Warehouse Manager, CFO/MD, Project Manager, Coordinator, Employee.

---

## 8. Verification

- Per module: `npm run typecheck && npm run lint && npm run test:unit`.
- **The backend contract is the source of truth** — the 24 unchanged `supabase/tests/*.sql` pgTAP suites must still pass. Run them against the linked project (`sewbxazwpjbtevckorbl` — "Egypro Onehub Antigravity").
- Spot-check RPC payload shapes against the old `api/*.ts` per module (`create_employee_with_period`, `rpc_decide_staff_advance`, `get_my_payslips`).
- Visual QA against `design/` mockups: light + dark, desktop / tablet / phone.
- Confirm `prefers-reduced-motion` disables all animation.

---

## 8b. Backend changes required (assessed 2 Aug 2026)

**Verdict: no changes for anything that reads or writes business data.** All 113 RPCs exist and cover every CRUD/workflow path the new UI needs. `get_governance_report_snapshot` already backs workforce/payroll/inventory/project/cash summaries, and `reports.ts` already exposes `WorkforceSummary` (incl. `departmentCounts` → the donut) and `PayrollPeriodSummaryItem` (incl. period totals → the cost-over-time chart).

The **only** possible additions are read-only conveniences for two new dashboard surfaces:

| Need | Data exists? | Options |
|---|---|---|
| Sidebar live counts | Yes | Client-side from existing list queries **(start here)**, or one narrow `rpc_get_nav_counts()` later if it costs too many round-trips |
| Alerts: certification expiry | Yes — `rpc_refresh_training_expiry_alerts` (0092) | Reuse as-is |
| Alerts: contract ending, probation review | Yes — `employment_periods.end_date`, `probation_end_date` | Derive client-side, or one `rpc_get_hr_alerts(p_days int)` |
| Alerts: birthdays | **Verify** `date_of_birth` is present and readable under RLS | If absent, that's the one genuine schema addition |
| Headcount growth over time | Partially — derivable from `employment_periods` | Derive, or add a narrow read-only aggregate |

**Rule:** prefer composing from existing RPCs first. Only add a **new, read-only, `security definer` + `search_path=''` aggregate function** in a forward-only migration if a visual genuinely can't be produced securely from what's there — and never alter an existing RPC signature.

## 9. Non-negotiables

- **Never modify the backend.** No migration edits, no RPC signature changes. If the UI seems to need one, stop and flag it.
- **No direct browser table mutations.** All writes go through the existing audited RPCs — the legacy apps' `supabase.from(...).update(...)` pattern is exactly what OneHub 2.0 removed.
- **No secrets in `VITE_*`** — browser config is public by design.
- **Both themes, always.** Tokens only; no hardcoded hex.

---

## 10. Open items

- Whether to port the 108 unit tests / 6 Playwright specs or write fresh against new components.
- Whether the `docs/handover` task-prompt workflow continues for this rebuild.
- Git: initialise fresh, or branch off `jantahronehub`.
