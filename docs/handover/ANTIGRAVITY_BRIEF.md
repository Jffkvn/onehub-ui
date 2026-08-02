# Antigravity Brief — OneHub New UI Rebuild

**Date:** 2 August 2026
**Working model:** Antigravity implements one task at a time. Claude reviews each push against the task's acceptance criteria, then Antigravity applies fixes. Repeat.
**Read first:** `PLAN.md` at the repo root — the locked design plan. Design references live in `design/` (approved mockups + a runnable motion study).
**Task prompts:** `docs/handover/ANTIGRAVITY_TASK-NN-*.md`. Execute in order; do not start the next until the previous is reviewed.

---

## 1. What this is

A **complete frontend rebuild** of Egypro OneHub, on an **untouched backend**. The old UI is being replaced, not refactored.

Two structural reasons the old UI couldn't be salvaged by polish:
1. **Navigation** — 6 sidebar items with ~15 functions buried behind in-page tab strips. The new IA exposes ~16 functions directly in a grouped sidebar, with **no tab strips anywhere**.
2. **Foundation** — a hand-rolled CSS system (2,412-line `global.css`) with partial component adoption: 67 raw `<select>` elements vs 3 uses of the smooth `Combobox`. Replaced by Tailwind + Radix primitives owned in-repo.

## 2. Repository & backend model

This is a **separate, frontend-only repo**. The existing app (`github.com/Jffkvn/jantahronehub`) is **never modified, never deleted, and keeps running.**

> ### 🛑 Both projects are on this machine
> | | Path | Status |
> |---|---|---|
> | **OLD live app** | `…/Anti gravity Projects/JantaHROnehub` | ❌ **OFF LIMITS** |
> | **NEW UI** | the folder containing this brief | ✅ all work happens here |
>
> Never `git init`, scaffold, `npm install`, delete, or commit in the old folder. Before running anything, confirm your directory: **the old app has a `supabase/` folder — this repo must never have one.**
>
> You do not need the old app for any task; its contract is already copied into `src/_contract/`.

The "backend" is a **hosted Supabase project**, not code: `sewbxazwpjbtevckorbl`. Both apps connect with the same `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`, so **data reflects both ways in real time**.

- **This repo has no `supabase/` folder.** Do not create one. Migrations live in `jantahronehub` only — one history, no drift.
- Do **not** add `jantahronehub` as a git remote here.
- Both apps can run side by side against the same live data for as long as you like; cutover happens only when the owner decides.

## 3. THE non-negotiable: never modify the backend

The Supabase project is **frozen**. No migrations. No RPC signature changes. No new tables. No schema edits from this app.

This backend is verified in production (payslip access, RLS, payroll approval, audit). Breaking it is the one unrecoverable mistake available here.

**Also frozen by extension:**
- **No direct table mutations from the browser.** Every write goes through an existing audited RPC. `supabase.from('x').update(...)` in a component is exactly the pattern OneHub 2.0 removed — do not reintroduce it.
- **No secrets in `VITE_*`.** Browser config is public by design.

**If a screen appears to need a backend change, STOP and flag it.** Do not invent a migration. See `PLAN.md` §8b — 113 RPCs already exist and cover every workflow; the assessed answer is that no backend change is required.

## 4. The contract layer (how the new UI stays compatible)

The old `src/modules/*/api/*.ts` files are the **authoritative spec** for backend calls — exact RPC names, table names, column names, payload shapes. They are being replaced by new implementations, but the *contract* must be reproduced exactly.

Examples: `create_employee_with_period`, `update_employee_profile`, `archive_employee`, `offboard_employee`, `rpc_decide_staff_advance`, `get_my_payslips`, `create_payroll_draft`, `approve_payroll_run`.

**Read the old file before writing its replacement.** Snake_case payload keys must match the Postgres function signatures exactly.

## 5. Design rules (from `PLAN.md` §2 and `design/`)

- **Dark navy sidebar** (`#0e1626`), light canvas (`#f5f6f8`).
- **Deep grouped sidebar**, ~16 items, live count badges. **No in-page tab strips.**
- **Role-aware** — sidebar and dashboard compose from permissions. HR sees People/Finance; a Warehouse Manager sees Inventory/Custody and no HR routes at all. Every role keeps My Workspace.
- **Colour lives in icon chips, status pills, nav active state and charts.** No gradient hero banners. Plain page headings.
- Plus Jakarta Sans (display) + Inter (body), self-hosted.
- Dense: 8–12px radius, tight padding, `tabular-nums` + right-aligned on every figure.
- **Tokens only — no hardcoded hex.** Both light and dark themes, always.

## 6. Motion rules (`PLAN.md` §6, live spec in `design/motion-study.html`)

CSS `transform`/`opacity` only — no JS animation loops. Open the motion study and match its feel.

- Staggered entrance ~20ms apart, **once per navigation, never on re-render**
- Numbers count up ≤900ms; charts draw themselves
- **Skeletons shaped like the real content** — no spinners, no layout shift
- Hover: cards lift 3px, rows tint (~200ms). Press: `scale(.97)`
- Slide-over: 420ms `cubic-bezier(.32,.72,0,1)` over a blurred scrim; Esc / click-away closes
- **Optimistic confirmation** — state flips immediately, toast rises, never block the user
- `prefers-reduced-motion` collapses all animation to ~0. Non-negotiable.

When in doubt, tune motion **down**.

## 7. Verification bar

Run and report real output — never claim a pass you didn't run:

```bash
npm run typecheck && npm run lint && npm run test:unit && npm run build
```

Plus, per task: the acceptance criteria in that task file. Where a task touches data access, cross-check payload shapes against the old `api/*.ts`.

**Token discipline:** implement a whole task, then run the gate **once**. Don't test after every one-line change.

## 8. Testing policy

- **Port** logic tests (API/contract, Zod schemas, `lib/` helpers) — that logic carries over.
- **Write fresh** component tests — old ones reference components that no longer exist.
- **Keep e2e journeys, re-selector them** — the scenarios stay valid, the DOM changes.

## 9. Report format

When a task is done, hand back:
1. **Files changed** (paths)
2. **What changed and why**, mapped to that task's acceptance criteria
3. **Verification output** (typecheck / lint / unit / build)
4. **Anything ambiguous or out of scope** — flag it, don't invent. If reality contradicts the task prompt, say so and stop rather than guessing.

## 10. Task sequence

| Task | Scope |
|---|---|
| **01** | Scaffold — branch, Tailwind + Radix, port `lib/`, verify backend untouched |
| **02** | Design system — tokens, primitives, the 9 screen archetypes |
| **03** | App shell + routing + auth (role-aware nav) |
| **04** | Payroll module |
| **05** | HR module (employees, leave, advances, performance, training) |
| **06** | Portal / My Workspace |
| **07** | Warehouse, Projects, Cash |
| **08** | Reports, Admin |
| **09** | Role dashboards (HR, Warehouse, CFO/MD, PM, Coordinator, Employee) |

Nothing module-specific begins until **02** is reviewed — the archetypes are what keep every screen consistent.

Start with **`ANTIGRAVITY_TASK-01-scaffold.md`**.
