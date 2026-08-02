# OneHub — New UI

A **complete frontend rebuild** of Egypro OneHub. Self-contained: everything needed to start is in this folder.

## Read in this order

1. **`PLAN.md`** — the locked design plan. Start with **§0 Repository & backend model**.
2. **`design/`** — approved mockups + a **runnable** motion spec:
   - `01-direction-locked-dark.png` — the chosen direction
   - `02-hr-dashboard.png` — HR view
   - `03-warehouse-dashboard.png` — Warehouse Manager view (proves role-awareness)
   - `04-alt-light-notchosen.png` — the rejected alternative, kept for record
   - **`motion-study.html`** — open in a browser. This *is* the motion spec; prose can't convey it.
3. **`docs/handover/ANTIGRAVITY_BRIEF.md`** — working rules.
4. **`docs/handover/ANTIGRAVITY_TASK-01-scaffold.md`** — first task. Execute tasks in order; each is reviewed before the next.

## 🛑 Two projects, one machine — don't mix them up

| | Path | Status |
|---|---|---|
| **OLD live app** | `…/Anti gravity Projects/JantaHROnehub` | ❌ off limits — keeps running, never modified |
| **NEW UI** | this folder | ✅ all work happens here |

Quick check before running anything:

```bash
test -d supabase && echo "❌ OLD app — stop" || echo "✅ new repo — proceed"
```

The old app has a `supabase/` folder; this repo must never have one. Suggested: rename this folder `onehub-ui` so the two are never confused.

## The one rule

**The backend is frozen and the old app is untouched.**

The backend is a **hosted Supabase project** (`sewbxazwpjbtevckorbl`), not code in this repo. There is deliberately **no `supabase/` folder here** — migrations live only in `github.com/Jffkvn/jantahronehub`, so the two can never drift.

The old app keeps running. Both apps point at the same live project, so **data reflects both ways in real time** — a payroll run approved in one appears in the other.

Because of that: **anything written from this app during development is real production data.** Use a test employee when exercising write paths.

## Setup

```bash
npm install          # after TASK-01 scaffolds package.json
cp .env.example .env # then fill in the two values below
npm run dev
```

`.env` needs exactly two values — the **same** ones the old app uses, so both share live data:

```
VITE_SUPABASE_URL=https://sewbxazwpjbtevckorbl.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>
```

Get the anon key from the old app's `.env`, or Supabase dashboard → Project Settings → API → `anon` `public`. It is public-by-design (it ships in the browser bundle) and is **not** the service-role key — never put a service-role key in a `VITE_*` variable.

## What's here

```
PLAN.md                 locked design plan
README.md               this file
design/                 approved mockups + motion study
docs/handover/          BRIEF + task prompts for implementation
src/_contract/          READ-ONLY backend contract copied from the old app
                        (17 api files, 8 Zod schemas, types, permissions, lib/)
                        → see src/_contract/README.md
```

`src/_contract/lib/` (supabase client, security helpers, date helper) is **ported into the real app** in TASK-01 — everything else in `_contract/` is reference only and never imported.

## Stack

React 19 · TypeScript · Vite · **Tailwind + Radix primitives** · TanStack Query · react-router-dom · react-hook-form + Zod · lucide-react · @react-pdf/renderer · @supabase/supabase-js

Fonts self-hosted: Plus Jakarta Sans (display) + Inter (body). No CDN.
