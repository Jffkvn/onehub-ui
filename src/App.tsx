import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const queryClient = new QueryClient()

// ─── Token swatch data ───────────────────────────────────────────────────────
const COLOURS = [
  { label: 'Sidebar',       bg: '#0e1626',  text: '#ffffff' },
  { label: 'Canvas',        bg: '#f5f6f8',  text: '#0d1626' },
  { label: 'Surface',       bg: '#ffffff',  text: '#0d1626', border: '#e7e9ee' },
  { label: 'Emerald',       bg: '#00c08b',  text: '#ffffff' },
  { label: 'Emerald 600',   bg: '#059669',  text: '#ffffff' },
  { label: 'Emerald tint',  bg: '#e3f9f1',  text: '#059669' },
  { label: 'Violet',        bg: '#8b5cf6',  text: '#ffffff' },
  { label: 'Violet tint',   bg: '#f2ecfe',  text: '#8b5cf6' },
  { label: 'Blue',          bg: '#3b82f6',  text: '#ffffff' },
  { label: 'Blue tint',     bg: '#e9f1fe',  text: '#3b82f6' },
  { label: 'Amber',         bg: '#f59e0b',  text: '#ffffff' },
  { label: 'Amber tint',    bg: '#fef4e1',  text: '#f59e0b' },
  { label: 'Rose',          bg: '#f43f5e',  text: '#ffffff' },
  { label: 'Rose tint',     bg: '#ffe9ed',  text: '#f43f5e' },
  { label: 'Cyan',          bg: '#06b6d4',  text: '#ffffff' },
  { label: 'Cyan tint',     bg: '#e0f8fb',  text: '#06b6d4' },
]

function TokenSwatch({ label, bg, text, border }: {
  label: string; bg: string; text: string; border?: string
}) {
  return (
    <div
      className="flex h-14 items-center justify-between rounded-md px-3"
      style={{
        backgroundColor: bg,
        color: text,
        border: border ? `1px solid ${border}` : 'none',
      }}
    >
      <span className="text-xs font-medium">{label}</span>
      <span className="font-mono text-xs opacity-70">{bg}</span>
    </div>
  )
}

// ─── Main placeholder app ────────────────────────────────────────────────────
export default function App() {
  const [dark, setDark] = useState(false)

  function toggleDark() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
  }

  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-canvas px-8 py-10 font-body text-ink transition-colors duration-200">
        {/* Header */}
        <div className="mb-10 flex items-start justify-between">
          <div>
            <h1 className="font-display text-3xl font-bold text-ink">
              OneHub <span className="text-emerald">2.0</span>
            </h1>
            <p className="mt-1 text-sm text-muted">
              TASK-01 — Design token &amp; typography reference
            </p>
          </div>
          <button
            id="dark-mode-toggle"
            onClick={toggleDark}
            className="rounded-md bg-surface px-4 py-2 text-sm font-medium text-soft shadow-sm ring-1 ring-line transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:scale-[.97]"
          >
            {dark ? '☀ Light mode' : '🌙 Dark mode'}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
          {/* ─── Colour palette ──────────────────────────────────────── */}
          <section>
            <h2 className="mb-4 font-display text-lg font-semibold text-ink">
              Colour tokens
            </h2>
            <div className="grid grid-cols-2 gap-2">
              {COLOURS.map((c) => (
                <TokenSwatch key={c.label} {...c} />
              ))}
            </div>
          </section>

          {/* ─── Typography ─────────────────────────────────────────── */}
          <section>
            <h2 className="mb-4 font-display text-lg font-semibold text-ink">
              Typography — Plus Jakarta Sans (display) + Inter (body)
            </h2>
            <div className="space-y-4 rounded-lg bg-surface p-6 ring-1 ring-line">
              <p className="font-display text-4xl font-extrabold text-ink">
                Display XL · 36px
              </p>
              <p className="font-display text-2xl font-bold text-ink">
                Display L · 24px
              </p>
              <p className="font-display text-xl font-semibold text-soft">
                Display M · 20px
              </p>
              <hr className="border-line" />
              <p className="font-body text-base text-ink">
                Body regular — Inter 14px. Egypro OneHub handles HR, payroll, inventory and project cash across multiple entities.
              </p>
              <p className="font-body text-sm text-soft">
                Body small · 12px — secondary label or hint text.
              </p>
              <p className="font-body font-mono text-sm tabular-nums text-ink">
                Tabular numerals: 1,234,567.89 · UGX · 0.00%
              </p>
              <hr className="border-line" />
              {/* Status pills */}
              <div className="flex flex-wrap gap-2">
                {[
                  { label: 'Active',    bg: 'bg-emerald-tint',  text: 'text-emerald-600' },
                  { label: 'Pending',   bg: 'bg-amber-tint',    text: 'text-amber' },
                  { label: 'Rejected',  bg: 'bg-rose-tint',     text: 'text-rose' },
                  { label: 'Draft',     bg: 'bg-blue-tint',     text: 'text-blue' },
                  { label: 'HR',        bg: 'bg-violet-tint',   text: 'text-violet' },
                  { label: 'Workspace', bg: 'bg-cyan-tint',     text: 'text-cyan' },
                ].map(({ label, bg, text }) => (
                  <span
                    key={label}
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${bg} ${text}`}
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>

            {/* ─── Motion tokens ────────────────────────────────────── */}
            <h2 className="mb-4 mt-8 font-display text-lg font-semibold text-ink">
              Motion tokens
            </h2>
            <div className="space-y-3 rounded-lg bg-surface p-6 ring-1 ring-line">
              {[
                { name: '--exp',   curve: 'cubic-bezier(.16, 1, .3, 1)',    label: 'Entrance (stagger)' },
                { name: '--micro', curve: 'cubic-bezier(.4, 0, .2, 1)',     label: 'Micro (hover/press)' },
                { name: '--sheet', curve: 'cubic-bezier(.32, .72, 0, 1)',   label: 'Sheet (slide-over)' },
              ].map(({ name, curve, label }) => (
                <div key={name} className="flex items-center justify-between text-sm">
                  <span className="font-mono text-muted">{name}</span>
                  <span className="text-soft">{label}</span>
                  <div
                    className="h-8 w-32 rounded bg-emerald-tint"
                    style={{ transition: `transform 600ms ${curve}` }}
                    onMouseEnter={(e) => { e.currentTarget.style.transform = 'scaleX(1.2)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = '' }}
                    title={curve}
                  />
                </div>
              ))}
            </div>

            {/* ─── Radius scale ─────────────────────────────────────── */}
            <h2 className="mb-4 mt-8 font-display text-lg font-semibold text-ink">
              Radius scale (8–12px)
            </h2>
            <div className="flex gap-4">
              {[
                { cls: 'rounded-sm',  label: '8px'  },
                { cls: 'rounded-md',  label: '10px' },
                { cls: 'rounded-lg',  label: '12px' },
                { cls: 'rounded-xl',  label: '16px' },
              ].map(({ cls, label }) => (
                <div
                  key={label}
                  className={`flex h-16 w-16 items-center justify-center bg-violet-tint text-xs font-medium text-violet ${cls}`}
                >
                  {label}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </QueryClientProvider>
  )
}
