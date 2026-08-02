# TASK-01 — Scaffold the new frontend

> Read `ANTIGRAVITY_BRIEF.md` and `PLAN.md` (especially **§0 Repository & backend model**) first.
> Outcome: a running, empty-but-correct app skeleton with the design foundation installed and the non-UI libs ported. **No screens yet.**

## 🛑 STOP — verify your working directory before running anything

Both projects live on this machine and their names are nearly identical. Running this task in the wrong one would destroy the live app.

| | Path | Status |
|---|---|---|
| **OLD live app** | `…/Anti gravity Projects/JantaHROnehub` | ❌ **OFF LIMITS** — never `git init`, scaffold, install, or delete here |
| **NEW UI (this task)** | the folder containing this file | ✅ work here |

**Run this in your intended working directory first:**

```bash
pwd
test -d supabase && echo "❌ STOP — this is the OLD app. Do NOT proceed." \
                 || echo "✅ New repo — safe to proceed"
```

`supabase/` is the unambiguous discriminator: the old app has it, and this repo **must never** have one.

Second check — the new repo contains all of these and no `package.json` yet:
```
README.md   PLAN.md   design/   docs/   src/_contract/
```

If either check fails, **stop and report** rather than adapting.

## ⚠ Nothing is deleted in this task — or in this project

This is a **new, separate, frontend-only repo**, and it is **self-contained** — everything you need is already in this folder. You do **not** need the old app checked out anywhere; its contract has already been copied into `src/_contract/`. If you do have the old app locally, treat it as strictly read-only: never modify or delete anything in it.

There is **no `supabase/` folder in this repo** and you must not create one. The backend is the live Supabase project `sewbxazwpjbtevckorbl`; this app connects to it over the network. Migrations stay in `jantahronehub` only.

---

## 1. Repo setup

Work in this folder (wherever it now lives). It already holds `README.md`, `PLAN.md`, `design/`, `docs/` and `src/_contract/`.

```bash
git init
git add .
git commit -m "docs: locked UI plan, design references and backend contract"
```

Remote: create a **new** GitHub repo (suggested name `onehub-ui`) and set it as `origin`. **Do not** add `jantahronehub` as a remote — that prevents any accidental push to the live app's repo.

## 2. Contract spec — already present

`src/_contract/` is already populated (17 api files, 8 Zod schemas, domain types, `modules.config.ts`, and `lib/`). Read `src/_contract/README.md`.

Your only job here: **exclude `src/_contract/` from the build** (`tsconfig` exclude + eslint ignore) so nothing can import it by accident — while keeping it readable in the editor. The one exception is `src/_contract/lib/`, which is *ported* in step 5.

## 3. Install the foundation

- **Vite + React 19 + TypeScript** scaffold.
- **Tailwind CSS** (+ `postcss`, `autoprefixer`), content `src/**/*.{ts,tsx}`, dark mode via `class`.
- **Radix primitives**: `@radix-ui/react-dialog`, `-dropdown-menu`, `-select`, `-popover`, `-tabs`, `-tooltip`, `-avatar`, `-scroll-area`.
- **`class-variance-authority`**, **`clsx`**, **`tailwind-merge`** + a `cn()` helper — variants live in code we own.
- Runtime deps to match the old app: `@supabase/supabase-js`, `@tanstack/react-query`, `react-router-dom`, `react-hook-form`, `@hookform/resolvers`, `zod`, `lucide-react`, `@react-pdf/renderer`, `@e965/xlsx`, `qrcode`, `html5-qrcode`.
- Fonts **self-hosted**: `@fontsource/inter`, `@fontsource/plus-jakarta-sans`. No CDN.
- Dev: `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, `eslint` + `typescript-eslint`, `@playwright/test`.

Do **not** copy the old `global.css` / `tokens.css`.

## 4. Design tokens

Define the locked palette (`PLAN.md` §2) as Tailwind theme tokens + CSS variables, both themes. No hardcoded hex anywhere else after this.

```
sidebar #0e1626   canvas #f5f6f8   surface #ffffff   line #e7e9ee
ink #0d1626   soft #3d4757   muted #7a8494   faint #a3abb8
emerald #00c08b / #059669 / tint #e3f9f1     (primary + Payroll)
violet  #8b5cf6 / tint #f2ecfe               (People/HR)
blue    #3b82f6 / tint #e9f1fe               (Inventory)
amber   #f59e0b / tint #fef4e1               (waiting/warning)
rose    #f43f5e / tint #ffe9ed               (attention/danger)
cyan    #06b6d4 / tint #e0f8fb               (workspace)
```
Radius 8–12px. Plus Jakarta Sans (display) / Inter (body). Motion easings as named tokens: `--exp cubic-bezier(.16,1,.3,1)`, `--micro cubic-bezier(.4,0,.2,1)`, `--sheet cubic-bezier(.32,.72,0,1)`.

## 5. Port the non-UI libs

Move from `src/_contract/lib/` into the real app at `src/lib/`, adjusting import paths only:
- `supabase/client.ts` (36 lines — env validation + singleton)
- `security/privateFiles.ts`, `safeUrl.ts`, `filePolicy.ts`
- `date/formatKampalaDate.ts`

**Port their unit tests too** and make them pass — the "logic tests carry over" case from the brief. These are the only files that graduate out of `_contract/`.

## 6. Connect to the live backend

- `.env.example` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` and the existing warning comment about never putting secrets in `VITE_*`.
- Local `.env` uses **the same values as the old app** (project `sewbxazwpjbtevckorbl`) so both apps share live data. Copy them from the old app's `.env`; do not commit `.env`.
- `.gitignore` must exclude `.env`, `.env.*` (allowing `.env.example`), `node_modules/`, `dist/`, `coverage/`, `playwright-report/`, `test-results/`, `*.tsbuildinfo`, `.DS_Store`.

**Read-only sanity check** (proves connectivity without writing anything): sign in is not required — just confirm the client constructs and an unauthenticated call to a public/permission-gated RPC returns a normal auth/permission response rather than a network or config error. **Do not create, update or delete any data.**

## 7. Minimal running app

- `index.html`, `src/main.tsx`, `App.tsx` rendering a single placeholder page proving Tailwind, both fonts, dark-mode toggle, and the full token palette render correctly — a swatch + typography sheet. It doubles as the reference for TASK-02.
- `QueryClientProvider` wired.
- `package.json` scripts: `dev`, `build`, `preview`, `typecheck`, `lint`, `test:unit`, `test:e2e`, and `verify` chaining typecheck + lint + unit + build.

---

## Verification

```bash
npm install
npm run typecheck && npm run lint && npm run test:unit && npm run build
npm run dev     # placeholder page: fonts, tokens, dark mode all correct
```

Also report, to prove nothing was touched:
- `ls` at repo root → **no `supabase/` folder**
- `git remote -v` → **does not list `jantahronehub`**
- If the old app is present on this machine: `git -C <old app path> status --short` → **empty**

## Acceptance criteria

- [ ] New standalone repo initialised and committed; origin is a **new** repo, not `jantahronehub`.
- [ ] **No `supabase/` folder** created here.
- [ ] Old app (if present locally) **completely unmodified**.
- [ ] `src/_contract/` excluded from the build; `_contract/lib/` graduated to `src/lib/`.
- [ ] Tailwind + Radix + CVA installed; locked palette, fonts and motion easings defined as tokens; no stray hex.
- [ ] `lib/` (supabase client, security, date) ported **with tests passing**.
- [ ] `.env` points at the same Supabase project as the old app; `.env` gitignored.
- [ ] Placeholder page renders proving fonts, tokens, dark mode.
- [ ] `npm run verify` passes.

## Out of scope
Any component, screen, route or module (TASK-02 onward). Any change to the old app, its repo, or the Supabase project.
