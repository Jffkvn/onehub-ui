import React from 'react'

export interface AuthLayoutProps {
  eyebrow?: string
  title: string
  description?: string
  children: React.ReactNode
}

export function AuthLayout({
  eyebrow = 'Egypro Uganda',
  title,
  description,
  children,
}: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-canvas p-4 sm:p-6 lg:p-8">
      {/* Decorative ambient background glows */}
      <div
        className="pointer-events-none fixed left-1/2 top-1/4 -z-10 h-[380px] w-[380px] -translate-x-1/2 rounded-full bg-emerald/10 blur-[120px]"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none fixed right-1/4 bottom-1/4 -z-10 h-[300px] w-[300px] rounded-full bg-violet/10 blur-[100px]"
        aria-hidden="true"
      />

      <main className="w-full max-w-md space-y-6">
        {/* Top Brand Chip */}
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-sidebar text-emerald shadow-lg ring-1 ring-white/10">
            <span className="font-display text-xl font-bold tracking-tight">OH</span>
          </div>
          <div>
            <span className="text-xs font-semibold uppercase tracking-widest text-emerald-600">
              {eyebrow}
            </span>
            <h1 className="font-display text-2xl font-bold text-ink mt-1">
              {title}
            </h1>
            {description && (
              <p className="font-body text-xs text-soft mt-1 max-w-sm mx-auto">
                {description}
              </p>
            )}
          </div>
        </div>

        {/* Form Container Card */}
        <div className="rounded-xl border border-line bg-surface p-6 shadow-xl space-y-5 backdrop-blur-xs">
          {children}
        </div>

        {/* Footer */}
        <p className="text-center font-body text-[11px] text-muted">
          &copy; {new Date().getFullYear()} Egypro Uganda Ltd. OneHub Enterprise System.
        </p>
      </main>
    </div>
  )
}
