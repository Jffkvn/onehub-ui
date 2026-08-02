import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // ─── Colour palette (PLAN.md §2 & TASK-02b RGB variables) ────────────
      colors: {
        // Layout
        sidebar: 'rgb(var(--color-sidebar) / <alpha-value>)',
        canvas:  'rgb(var(--color-canvas)  / <alpha-value>)',
        surface: 'rgb(var(--color-surface) / <alpha-value>)',
        line:    'rgb(var(--color-line)    / <alpha-value>)',

        // Text
        ink:   'rgb(var(--color-ink)   / <alpha-value>)',
        soft:  'rgb(var(--color-soft)  / <alpha-value>)',
        muted: 'rgb(var(--color-muted) / <alpha-value>)',
        faint: 'rgb(var(--color-faint) / <alpha-value>)',

        // Brand — emerald (primary / Payroll)
        emerald: {
          DEFAULT: 'rgb(var(--color-emerald)      / <alpha-value>)',
          600:     'rgb(var(--color-emerald-600)  / <alpha-value>)',
          tint:    'rgb(var(--color-emerald-tint) / <alpha-value>)',
        },

        // Accent — violet (People / HR)
        violet: {
          DEFAULT: 'rgb(var(--color-violet)      / <alpha-value>)',
          tint:    'rgb(var(--color-violet-tint) / <alpha-value>)',
        },

        // Accent — blue (Inventory)
        blue: {
          DEFAULT: 'rgb(var(--color-blue)      / <alpha-value>)',
          tint:    'rgb(var(--color-blue-tint) / <alpha-value>)',
        },

        // Accent — amber (warning / waiting)
        amber: {
          DEFAULT: 'rgb(var(--color-amber)      / <alpha-value>)',
          tint:    'rgb(var(--color-amber-tint) / <alpha-value>)',
        },

        // Accent — rose (danger / attention)
        rose: {
          DEFAULT: 'rgb(var(--color-rose)      / <alpha-value>)',
          tint:    'rgb(var(--color-rose-tint) / <alpha-value>)',
        },

        // Accent — cyan (workspace)
        cyan: {
          DEFAULT: 'rgb(var(--color-cyan)      / <alpha-value>)',
          tint:    'rgb(var(--color-cyan-tint) / <alpha-value>)',
        },
      },

      // ─── Typography ─────────────────────────────────────────────────────
      fontFamily: {
        display: ['"Plus Jakarta Sans"', 'sans-serif'],
        body:    ['Inter', 'sans-serif'],
      },

      // ─── Radius ─────────────────────────────────────────────────────────
      borderRadius: {
        sm:  '8px',
        md:  '10px',
        lg:  '12px',
        xl:  '16px',
      },

      // ─── Motion easings (PLAN.md §6) ────────────────────────────────────
      transitionTimingFunction: {
        exp:   'cubic-bezier(.16,1,.3,1)',
        micro: 'cubic-bezier(.4,0,.2,1)',
        sheet: 'cubic-bezier(.32,.72,0,1)',
      },

      // ─── Z-index scale ──────────────────────────────────────────────────
      zIndex: {
        sidebar:   '40',
        topbar:    '50',
        overlay:   '60',
        sheet:     '70',
        toast:     '80',
      },
    },
  },
  plugins: [],
}

export default config
