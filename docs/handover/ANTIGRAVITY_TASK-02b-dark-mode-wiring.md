# TASK-02b — Wire dark mode (blocking fix for TASK-02)

> Small, contained, high-leverage. Fix this before any module work — every screen from TASK-04 on inherits these colours.
> **Still frozen:** no `supabase/` folder, no backend calls, old app untouched.

## The defect

TASK-02 is otherwise good — 48/48 tests, clean gate, all archetypes present. But **dark mode does not work**. Applying `class="dark"` to `<html>` leaves the canvas and cards light; only the sidebar (which is always dark) looks right.

**Root cause: two disconnected colour systems.**

1. `tailwind.config.ts` defines colours as **literal hex** — `surface: '#ffffff'`, `canvas: '#f5f6f8'`, etc.
2. `src/styles/globals.css` defines `--color-surface`, `--color-canvas`, … with `.dark { }` overrides.
3. **Nothing connects them.** No component uses `var(--color-*)`, so the `.dark` block is dead CSS.

Proof from the built stylesheet:

```css
.bg-surface{ background-color: rgb(255 255 255 / var(--tw-bg-opacity,1)) }   /* fixed — never changes */
.dark\:bg-canvas:is(.dark *){ background-color: rgb(245 246 248 / …) }        /* still the LIGHT canvas */
```

The second line is the tell: even `dark:bg-canvas` resolves to the light value, because `canvas` in the Tailwind palette only ever holds the light hex.

## The fix

Make the Tailwind palette **read the CSS variables**, and store those variables as **space-separated RGB triplets** so Tailwind's `<alpha-value>` (opacity utilities like `bg-surface/60`) keeps working.

### 1. `src/styles/globals.css` — convert tokens to RGB triplets

```css
:root {
  --color-sidebar: 14 22 38;
  --color-canvas:  245 246 248;
  --color-surface: 255 255 255;
  --color-line:    231 233 238;

  --color-ink:   13 22 38;
  --color-soft:  61 71 87;
  --color-muted: 122 132 148;
  --color-faint: 163 171 184;

  --color-emerald:      0 192 139;
  --color-emerald-600:  5 150 105;
  --color-emerald-tint: 227 249 241;

  --color-violet: 139 92 246;   --color-violet-tint: 242 236 254;
  --color-blue:   59 130 246;   --color-blue-tint:   233 241 254;
  --color-amber:  245 158 11;   --color-amber-tint:  254 244 225;
  --color-rose:   244 63 94;    --color-rose-tint:   255 233 237;
  --color-cyan:   6 182 212;    --color-cyan-tint:   224 248 251;
}

.dark {
  --color-canvas:  13 22 38;
  --color-surface: 19 31 53;
  --color-line:    30 44 67;

  --color-ink:   232 236 244;
  --color-soft:  168 180 200;
  --color-muted: 107 122 145;
  --color-faint: 61 79 104;

  --color-emerald-tint: 2 40 30;
  --color-violet-tint:  31 20 56;
  --color-blue-tint:    14 30 56;
  --color-amber-tint:   42 30 6;
  --color-rose-tint:    42 10 18;
  --color-cyan-tint:    6 30 40;
}
```

Keep `--exp`, `--micro`, `--sheet`, the radius scale, the baseline typography and the `prefers-reduced-motion` block exactly as they are.

**Sidebar stays dark in both themes** — do not add a `.dark` override for `--color-sidebar`.

### 2. `tailwind.config.ts` — point the palette at the variables

Replace every literal hex in `theme.extend.colors` with a `rgb(var(…) / <alpha-value>)` reference. Nested scales keep their shape:

```ts
colors: {
  sidebar: 'rgb(var(--color-sidebar) / <alpha-value>)',
  canvas:  'rgb(var(--color-canvas)  / <alpha-value>)',
  surface: 'rgb(var(--color-surface) / <alpha-value>)',
  line:    'rgb(var(--color-line)    / <alpha-value>)',

  ink:   'rgb(var(--color-ink)   / <alpha-value>)',
  soft:  'rgb(var(--color-soft)  / <alpha-value>)',
  muted: 'rgb(var(--color-muted) / <alpha-value>)',
  faint: 'rgb(var(--color-faint) / <alpha-value>)',

  emerald: {
    DEFAULT: 'rgb(var(--color-emerald)      / <alpha-value>)',
    600:     'rgb(var(--color-emerald-600)  / <alpha-value>)',
    tint:    'rgb(var(--color-emerald-tint) / <alpha-value>)',
  },
  // violet / blue / amber / rose / cyan — same DEFAULT + tint pattern
}
```

Leave `darkMode: 'class'`, fonts, radius, easings and the z-index scale untouched.

### 3. Remove now-redundant `dark:` variants

With tokens flipping automatically, most `dark:bg-*` / `dark:text-*` / `dark:border-*` utilities on **token colours** are unnecessary — and several are actively wrong (they point at light values). Sweep `src/components` and `src/pages`:

- **Delete** `dark:` variants that merely restate a token colour.
- **Keep** `dark:` only where the design genuinely differs beyond a token swap (e.g. shadow strength, an opacity change, a border that should disappear in dark).

### 4. Verify the sidebar still reads correctly

The sidebar is dark on a now-dark canvas. Confirm it stays visually distinct — if it disappears into the background in dark mode, add a subtle right border (`border-line`) rather than changing the sidebar colour.

---

## Verification

```bash
npm run typecheck && npm run lint && npm run test:unit && npm run build
npm run dev    # then toggle Dark in the showcase topbar
```

Confirm **in the browser, both themes**, on the showcase:
- Canvas and card surfaces actually change
- Text stays legible — check `muted`/`faint` against dark surfaces, which is where contrast usually breaks
- Status pills, icon chips and KPI tints remain readable on dark
- Charts/tables keep visible borders
- Opacity utilities still work (`bg-surface/60`, `bg-canvas/80`) — this is what the RGB-triplet format protects

Grep proof the wiring is live:
```bash
grep -o "\.bg-surface{[^}]*}" dist/assets/*.css     # should contain var(--color-surface)
grep -c "var(--color-" dist/assets/*.css            # should be > 0
```

## Acceptance criteria

- [ ] All colour tokens in `globals.css` are space-separated RGB triplets, with `.dark` overrides.
- [ ] `tailwind.config.ts` palette references `rgb(var(--color-…) / <alpha-value>)` — **no literal hex remaining** in the colour block.
- [ ] Toggling `.dark` visibly changes canvas + surfaces in the showcase; screenshots of both themes attached to the report.
- [ ] Redundant/incorrect `dark:` variants removed; remaining ones justified.
- [ ] Sidebar remains visually distinct in dark mode.
- [ ] Opacity utilities on token colours still render correctly.
- [ ] `npm run verify` passes; 48/48 tests still green.

## Also fix while you're here (minor, from review)

- **Stagger-once guard** — I couldn't find `src/lib/motion.ts` or an explicit guard. Ensure the entrance stagger fires **once on mount and never on re-render** (a `useRef` latch, or animate only on first paint). State it explicitly in your report.

## Out of scope
Any new component, route, module, or backend call. Do not restyle beyond what the token change requires.
