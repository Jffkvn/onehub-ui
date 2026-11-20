import type { StatusPillProps } from '@/components/ui/StatusPill'
import type { ProjectHealth, ProjectStatus } from './projectApi'

export const statusOptions: Record<ProjectStatus, { label: string; tone: StatusPillProps['tone'] }> = {
  planned: { label: 'Planned', tone: 'neutral' },
  active: { label: 'Active', tone: 'success' },
  on_hold: { label: 'On hold', tone: 'warning' },
  completed: { label: 'Completed', tone: 'info' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
  archived: { label: 'Archived', tone: 'neutral' },
}

export const healthOptions: Record<ProjectHealth, { label: string; tone: StatusPillProps['tone'] }> = {
  on_track: { label: 'On track', tone: 'success' },
  needs_attention: { label: 'Needs attention', tone: 'warning' },
  at_risk: { label: 'At risk', tone: 'danger' },
}

export const projectSelectClass = 'h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald'
export const projectFieldClass = 'block min-w-0 space-y-1 text-sm font-medium text-ink'
export const projectLinkClass = 'inline-flex items-center gap-2 text-sm font-semibold text-emerald-600 underline-offset-4 hover:underline'
export const projectCardClass = 'space-y-4 rounded-xl border border-line bg-surface p-4 sm:p-6'
export const projectAmount = new Intl.NumberFormat('en-UG', { style: 'currency', currency: 'UGX' })
