# TASK-03 — App shell, routing, auth & role-aware navigation

> Read `ANTIGRAVITY_BRIEF.md` and `PLAN.md`. TASK-01, 02, 02b are merged and reviewed.
> **Still frozen:** never modify the backend. No `supabase/` folder. Old app untouched.
> **Last foundation task** — every module from TASK-04 mounts into this. Get it exact.

A user can sign in, land on a role-appropriate shell, navigate, and be blocked from routes they lack permission for. Module pages stay **placeholders** — no business screens.

## Reference material — all of it is already in this repo

| What | Where |
|---|---|
| Auth implementation to port (incl. the real `get_my_access_context` call) | `src/_contract/auth-reference/` — 17 files: `AuthGateway.ts`, `AuthProvider`, `RequireAuth`, `RequirePermission`, Login/Invite/TOTP pages, tests |
| Old router (route shapes, gate usage) | `src/_contract/auth-reference/_old-router.tsx` |
| **Authoritative permission list — 58 strings** | `src/_contract/PERMISSIONS.txt` |
| Role keys | `src/_contract/modules.config.ts` |
| Target look | `design/02-hr-dashboard.png` (HR), `design/03-warehouse-dashboard.png` (Warehouse) |

**Read `auth-reference/AuthGateway.ts` before writing any auth code.** Port its behaviour and the access-context shape exactly; rebuild only the UI on the new design system.

**Never invent a permission string.** Every value must appear in `PERMISSIONS.txt`. If a nav item has no matching permission, use the closest listed one or **stop and flag it** — do not make one up.

---

## Part A — Navigation config (`src/config/navigation.ts`)

Single source of truth for nav, routing and gating.

```ts
export type NavSection =
  | 'Overview' | 'People' | 'Finance' | 'Operations'
  | 'Inventory' | 'Custody' | 'System'

export interface NavItem {
  key: string
  label: string
  path: string
  icon: LucideIcon
  section: NavSection
  permission?: string      // must exist in _contract/PERMISSIONS.txt
  anyOf?: string[]         // OR-gate
  countKey?: string        // live badge; data wired in TASK-08
}
```

### Exact route table — implement these paths verbatim

Later tasks link against them; changing a path later breaks other modules.

| Path | Label | Section | Gate | countKey |
|---|---|---|---|---|
| `/dashboard` | Dashboard | Overview | — (any authenticated) | — |
| `/my` | My Workspace | Overview | — (any authenticated) | `myPending` |
| `/people/employees` | Employees | People | `employees.read` | `employees` |
| `/people/leave` | Leave | People | `leave.manage` | `leavePending` |
| `/people/performance` | Performance | People | `performance.manage` | `reviewsPending` |
| `/people/training` | Training | People | `training.manage` | — |
| `/people/pay-grades` | Pay Grades | People | `employees.manage_setup` | — |
| `/finance/payroll` | Payroll Runs | Finance | `payroll.read` | `payrollDraft` |
| `/finance/advances` | Staff Advances | Finance | `staff_advances.manage` | `advancesActive` |
| `/finance/deductions` | Deductions & Adj | Finance | `payroll.prepare` | — |
| `/finance/exports` | Statutory Exports | Finance | `payroll.export` | — |
| `/ops/projects` | Projects | Operations | `anyOf: ['projects.read_all','projects.read_operational']` | `projectsActive` |
| `/ops/cash` | Project Cash | Operations | `anyOf: ['cash_advances.manage','cash_advances.view_all']` | `cashPending` |
| `/inventory` | Inventory | Operations | `inventory.read` | — |
| `/inventory/consumables` | Consumables | Inventory | `inventory.read` | `consumables` |
| `/inventory/equipment` | Equipment | Inventory | `inventory.read` | `equipment` |
| `/inventory/requests` | Stock Requests | Inventory | `anyOf: ['inventory.approve','inventory.request']` | `stockRequests` |
| `/inventory/receiving` | Receiving | Inventory | `inventory.receipt` | — |
| `/inventory/ledger` | Stock Ledger | Inventory | `inventory.read` | — |
| `/inventory/bulk` | Bulk Tools | Inventory | `inventory.adjust` | — |
| `/custody/issued` | Issued Assets | Custody | `inventory.issue` | `issuedAssets` |
| `/custody/returns` | Returns Due | Custody | `inventory.issue` | `returnsDue` |
| `/system/reports` | Reports | System | `reports.view` | — |
| `/system/settings` | Settings | System | `company.manage` | — |
| `/system/audit` | Audit Log | System | `audit.read` | — |
| `/system/users` | User Access | System | `users.read` *(verify in PERMISSIONS.txt; else `roles.read`)* | — |

**Rules**
- **Gate on permissions, never role names.** No `if (role === 'hr_admin')` anywhere.
- Render a section only when ≥1 item is permitted — no empty headings.
- `Inventory` and `Custody` sections exist so a Warehouse Manager gets the `design/03` layout; an HR Admin without `inventory.*` simply won't see them.
- Section order: Overview → People → Finance → Operations → Inventory → Custody → System.

## Part B — Auth (`src/modules/auth/`)

Port behaviour from `src/_contract/auth-reference/`; rebuild UI with TASK-02 primitives.

- **`AuthProvider`** — Supabase session, auto-refresh, `onAuthStateChange`, explicit loading state (never flash the login screen while restoring a session).
- **Access context** — call `get_my_access_context` exactly as `AuthGateway.ts` does; keep the same return shape. Expose `usePermissions()` and `useHasPermission(key)`. Cache in TanStack Query keyed by user id; invalidate on auth change; clear on sign-out.
- **`RequireAuth`** — redirect to `/login`, preserving the intended destination and restoring it after login.
- **`RequirePermission`** — takes `permission` or `anyOf`; renders the **403 page**, never a blank screen.
- **Pages:** Login, Invite/accept, TOTP challenge, TOTP enrolment, 403, 404.
- **Sign-out** clears the Supabase session *and* the query cache.

Do not weaken any auth rule to make a screen render. Port the TOTP flow faithfully — if it can't work without a backend change, **stop and flag it**.

## Part C — Router (`src/app/router.tsx`)

- `react-router-dom`, lazy-loaded elements, `Suspense` fallback = **skeletons, not spinners**.
- Public: `/login`, `/invite`, TOTP routes. Everything else behind `RequireAuth` → `RequirePermission`.
- Every Part A path renders `<PagePlaceholder title=… task="TASK-0N" />` built on `EmptyState`, naming the task that will build it.
- `/` → `/dashboard` if permitted, else `/my`.
- Keep `/_showcase` in dev only.
- Unknown paths → 404 **inside the shell** (so nav stays usable).

## Part D — Wire the shell

Connect the TASK-02 presentational `AppShell` / `Sidebar` / `Topbar`:

- Sidebar consumes the filtered nav config; active item from current route; **sliding indicator animates** between items.
- Collapses to a drawer below `lg`; closes on navigate and Esc; focus trapped while open; restores focus to the trigger.
- Topbar: global search input (UI only), notification bell with unread count, avatar menu with **Sign out**.
- Org chip from access context — **not hardcoded**.
- Entrance stagger fires **once per navigation**, not per re-render (reuse the 02b guard).

## Part E — Dev-only role preview

A role switcher (topbar or `/_showcase`) re-rendering the shell as any of the eight roles using **mock permission sets**.

- Presentation preview **only** — must never bypass `RequireAuth` / `RequirePermission` for real data.
- Must be excluded from production builds (`import.meta.env.DEV` guard).

This is how role-awareness gets reviewed without eight real accounts.

---

## Verification

```bash
npm run typecheck && npm run lint && npm run test:unit && npm run build
npm run dev
```

**Automated tests:**
- nav filters correctly for HR Admin vs Warehouse Manager vs Employee permission sets
- empty sections omitted
- every `permission`/`anyOf` value in `navigation.ts` exists in `_contract/PERMISSIONS.txt` *(write this as a test — it prevents invented strings)*
- `RequireAuth` redirects when signed out and restores intended destination
- `RequirePermission` renders 403, not blank
- sidebar marks the correct active item per path

**Manual, both themes:**
- Sign in → Dashboard placeholder, correct sidebar
- Role preview → Warehouse Manager shows Inventory + Custody and **no People/Finance**; matches `design/03`
- Deep-link a forbidden route → 403
- Keyboard-only: nav, drawer, avatar menu, sign-out
- Mobile width: drawer opens/closes/traps focus

**Attach screenshots:** HR shell and Warehouse Manager shell, light and dark (4 images).

## Acceptance criteria

- [ ] `src/config/navigation.ts` implements the route table **exactly** (paths verbatim).
- [ ] Gating is permission-based; **every string verified against `PERMISSIONS.txt` by a test**; zero role-name checks.
- [ ] Auth ported from `auth-reference`: login, invite, TOTP challenge + enrolment, session refresh, sign-out clears cache; 403 + 404 exist.
- [ ] Access context uses `get_my_access_context` with the same shape as `AuthGateway.ts`.
- [ ] Every nav path routes to a placeholder naming its future task; `/` redirects sensibly; lazy + skeleton fallbacks.
- [ ] Shell wired: sliding active indicator, responsive drawer with focus trap, topbar search/bell/avatar, org chip from context.
- [ ] Role preview works, is dev-only, and cannot bypass real gates.
- [ ] Both themes correct; keyboard accessible; stagger fires once.
- [ ] `npm run verify` passes; no backend change; no `supabase/` folder; old app untouched.

## Out of scope
Module screens and business data (TASK-04+). Live count badge **data** (TASK-08) — define `countKey` only. Global search results.
