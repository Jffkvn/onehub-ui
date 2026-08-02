# TASK-02 — Design system: primitives + screen archetypes

> Read `ANTIGRAVITY_BRIEF.md` and `PLAN.md` first. TASK-01 is merged and reviewed.
> **Still frozen:** no `supabase/` folder, no backend calls, old app untouched.
> This task builds **components only** — no routes, no data, no modules. Everything later composes from what you build here, so consistency now saves rework everywhere.

## Reference material (look at these before coding)

- `design/motion-study.html` — **open it in a browser.** This is the motion spec; match its feel.
- `design/02-hr-dashboard.png` and `design/03-warehouse-dashboard.png` — the target look for shell, KPIs, tables, alerts, quick actions.
- The TASK-01 placeholder page — your token/type reference.

---

## Part A — Cleanup

Delete `src/_contract/lib/` — it graduated to `src/lib/` in TASK-01 and is now dead weight. **Leave the rest of `src/_contract/` untouched** (api, schemas, types, modules.config.ts); it's still the backend spec for TASK-04 onward.

## Part B — Primitives (`src/components/ui/`)

Radix-backed, owned in-repo, styled with Tailwind + CVA variants. Every one must: use tokens only (no hex), work in **light and dark**, have visible `focus-visible` states, and be keyboard operable.

| Component | Notes |
|---|---|
| `Button` | variants: `primary` (emerald), `secondary`, `ghost`, `danger`, `outline`; sizes `sm`/`md`; `loading` and `disabled`; icon slot. **Hover lift 1px, press `scale(.97)`** |
| `Input`, `Textarea`, `Label`, `FieldError` | label + hint + error composition; `aria-invalid` wiring |
| `Select` | Radix Select — the styled replacement for native `<select>` |
| `Combobox` | Radix Popover + filter input, for **long/searchable** lists (employees, projects) |
| `MultiCombobox` | multi-select with removable chips + "N of M selected" counter |
| `Checkbox`, `RadioGroup`, `Switch` | |
| `Dialog` | Radix Dialog — centre modal; backdrop fade + panel rise |
| `SlideOver` | Radix Dialog positioned right; **420ms `--sheet` easing over a blurred scrim**; Esc + click-away close |
| `DropdownMenu` | Radix — used by `ActionMenu` |
| `Tabs`, `Tooltip`, `Avatar`, `ScrollArea` | Radix wrappers |
| `Badge` / `StatusPill` | tones: success, warning, danger, info, neutral; optional leading dot |
| `Skeleton` | shimmer; **must accept a shape** so it can mirror real content (text line, card, table row, KPI) |
| `Toast` | bottom-centre, rises in, auto-dismiss ~2.6s; provider + `useToast()` |
| `IconChip` | the recurring tinted square: `tone` × `size`. Used by KPIs, alerts, quick actions, nav |

**Note on `Tabs`:** available as a primitive for *in-content* use (e.g. a record's sub-sections). It is **not** used for primary navigation — that's the sidebar. Do not reintroduce page-level tab strips.

## Part C — Screen archetypes (`src/components/patterns/`)

Composed from Part B. These are what modules actually use.

1. **`Sidebar`** — dark navy, grouped sections with uppercase labels, icon + label rows, count badges, **sliding active indicator** (`--exp`), org chip at top, user block at bottom. Presentational: takes a nav config array + active path. *(Wiring to routes/permissions is TASK-03.)*
2. **`Topbar`** — search field, notification bell with count, avatar, optional action slot.
3. **`AppShell`** — `Sidebar` + `Topbar` + scrollable content region. Responsive: sidebar collapses to a drawer below `lg`.
4. **`PageHeader`** — plain heading + subtitle + right-aligned actions. **No gradient banners.**
5. **`KpiCard`** — `IconChip` + label + figure (display font, `tabular-nums`) + optional delta and sub-line. Hover lift 3px. Supports a loading state via `Skeleton`.
6. **`DataTable`** — dense rows; column defs with `align` (`right` for numbers, `tabular-nums`); optional **totals footer**; row hover tint; row click; sticky header; `overflow-x:auto`; built-in empty and loading (skeleton rows) states.
7. **`DetailSlideOver`** — header (eyebrow/ID + title + `StatusPill` + close), summary stat grid, section blocks, optional timeline, **sticky footer actions**. See advance-detail in the mockups.
8. **`AlertsCard`** — titled card ("HR Alerts & Events") + meta ("Next 30 days"); rows of `IconChip` + title + subtitle + right-aligned relative time, with an `urgent` tone that renders red.
9. **`QuickActionsCard`** — rows of `IconChip` + label + subtitle + chevron.
10. **`EmptyState`** — `IconChip` + title + one line + primary CTA. Compact.
11. **`FormSection`** — grouped fields with a section heading, responsive columns.

## Part D — Motion utilities (`src/lib/motion.ts` + CSS)

- `Stagger` helper (or a `useStagger` hook) producing incremental delays ~20ms. **Fires once on mount, never on re-render** — guard it.
- Named easing/duration tokens already exist from TASK-01; use them, don't inline new curves.
- `CountUp` component: eases to value ≤900ms, respects reduced motion (jumps straight to final value).
- All animation wrapped so `prefers-reduced-motion: reduce` collapses to ~0. **Verify by toggling the OS setting**, not just by reading the CSS.

## Part E — Showcase route (required for review)

Add a dev-only page at `/_showcase` rendering **every** primitive and archetype with realistic Egypro data (UGX figures, Ugandan names — reuse the mockups' content), including:

- every `Button` variant × state
- form controls incl. `Combobox` open
- a `DataTable` with a totals row, plus its loading and empty states
- `KpiCard` row, `AlertsCard`, `QuickActionsCard`, `EmptyState`
- buttons to trigger `SlideOver`, `Dialog`, and a `Toast`
- a **light/dark toggle** and a **"replay motion"** button

This page is how the work gets reviewed — make it complete.

---

## Verification

```bash
npm run typecheck && npm run lint && npm run test:unit && npm run build
npm run dev   # visit /_showcase
```

- Unit tests for the primitives: variants render, `disabled`/`loading` behave, `SlideOver`/`Dialog` close on Esc and click-away, `DropdownMenu` is keyboard navigable, `StatusPill` maps tones correctly.
- Manually confirm: **light and dark** both correct; keyboard-only pass through the showcase; reduced-motion actually disables animation.
- Confirm **zero hardcoded hex** outside the token definitions.

## Acceptance criteria

- [ ] `src/_contract/lib/` deleted; rest of `_contract/` untouched.
- [ ] All Part B primitives exist, Radix-backed, token-styled, keyboard accessible, light + dark.
- [ ] All Part C archetypes exist and are composed from the primitives.
- [ ] Motion matches `design/motion-study.html`: stagger-once, count-up, hover lift, press scale, slide-over easing, toast rise, skeletons that mirror content shape.
- [ ] `prefers-reduced-motion` verified to disable animation.
- [ ] `/_showcase` renders everything with realistic data, plus theme toggle and replay-motion.
- [ ] No routes, no data fetching, no backend calls, no `supabase/` folder.
- [ ] `npm run verify` passes; zero stray hex.

## Out of scope
Routing, auth, permissions, any module screen, any backend call — TASK-03 onward.
