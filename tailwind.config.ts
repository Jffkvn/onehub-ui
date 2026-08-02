import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // ─── Colour palette (PLAN.md §2) ────────────────────────────────────
      colors: {
        // Layout
        sidebar:  '#0e1626',
        canvas:   '#f5f6f8',
        surface:  '#ffffff',
        line:     '#e7e9ee',

        // Text
        ink:      '#0d1626',
        soft:     '#3d4757',
        muted:    '#7a8494',
        faint:    '#a3abb8',

        // Brand — emerald (primary / Payroll)
        emerald: {
          DEFAULT: '#00c08b',
          600:     '#059669',
          tint:    '#e3f9f1',
        },

        // Accent — violet (People / HR)
        violet: {
          DEFAULT: '#8b5cf6',
          tint:    '#f2ecfe',
        },

        // Accent — blue (Inventory)
        blue: {
          DEFAULT: '#3b82f6',
          tint:    '#e9f1fe',
        },

        // Accent — amber (warning / waiting)
        amber: {
          DEFAULT: '#f59e0b',
          tint:    '#fef4e1',
        },

        // Accent — rose (danger / attention)
        rose: {
          DEFAULT: '#f43f5e',
          tint:    '#ffe9ed',
        },

        // Accent — cyan (workspace)
        cyan: {
          DEFAULT: '#06b6d4',
          tint:    '#e0f8fb',
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
