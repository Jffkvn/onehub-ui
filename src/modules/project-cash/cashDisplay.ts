import type { StatusPillProps } from '@/components/ui/StatusPill'
import type { CashStatus } from './projectCashApi'

export const cashStateLabels: Record<CashStatus, { label: string; tone: StatusPillProps['tone'] }> = {
  pending_approval: { label: 'Pending approval', tone: 'warning' },
  approved: { label: 'Approved', tone: 'info' },
  disbursed: { label: 'Disbursed', tone: 'info' },
  completed: { label: 'Completed', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
}

const moneyFormat = new Intl.NumberFormat('en-UG', { maximumFractionDigits: 2 })

export function cashAmount(value: number) {
  return 'UGX ' + moneyFormat.format(value)
}

export const cashCard = 'rounded-xl border border-line bg-surface p-4 sm:p-5'
export const cashField = 'block min-w-0 space-y-1 text-sm font-medium text-ink'
export const cashSelect = 'h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald disabled:opacity-50'
export const cashLink = 'inline-flex items-center gap-2 text-sm font-semibold text-emerald-600 underline-offset-4 hover:underline'
