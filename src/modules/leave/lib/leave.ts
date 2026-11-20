import { z } from 'zod'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value &&
    Number(value.slice(0, 4)) >= 2000 && Number(value.slice(0, 4)) <= 2200
}, 'Choose a valid date.')
export const leaveDraftSchema = z.object({
  employeeId: z.string().uuid(),
  leaveTypeId: z.string().uuid(),
  startDate: date,
  endDate: date,
  portion: z.enum(['full', 'morning', 'afternoon', 'exact']),
  reason: z.string().trim().min(3).max(2000),
  leavingTime: z.string(),
}).superRefine((value, ctx) => {
  if (value.endDate < value.startDate) {
    ctx.addIssue({
      code: 'custom',
      path: ['endDate'],
      message: 'End date must follow the start date.',
    })
  }
  if (value.portion !== 'full' && value.startDate !== value.endDate) {
    ctx.addIssue({
      code: 'custom',
      path: ['endDate'],
      message: 'Partial-day leave must use one date.',
    })
  }
  if (value.portion === 'exact' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.leavingTime)) {
    ctx.addIssue({
      code: 'custom',
      path: ['leavingTime'],
      message: 'Choose the time you will leave your shift.',
    })
  }
})
export type LeaveDraft = z.infer<typeof leaveDraftSchema>
export type Portion = LeaveDraft['portion']
export function leaveEligibility(code: string, gender: string | null) {
  const g = gender?.trim().toLowerCase()
  if ((code === 'maternity' && g === 'male') || (code === 'paternity' && g === 'female')) {
    return {
      allowed: false,
      guidance:
        'This leave type does not match the employee gender record. Ask HR to check the record if it is incorrect.',
    }
  }
  return {
    allowed: true,
    guidance: !g && ['maternity', 'paternity'].includes(code)
      ? 'Gender is not recorded. You can still request this leave; HR can help confirm your employee details.'
      : null,
  }
}
export function formatDays(days: number) {
  return new Intl.NumberFormat('en-UG', { maximumFractionDigits: 2 }).format(days)
}
export function formatLeaveDuration(days: number, portion: Portion, minutes: number | null) {
  const label = {
    full: 'Full day',
    morning: 'Morning',
    afternoon: 'Afternoon',
    exact: 'Rest of shift',
  }[portion]
  return `${formatDays(days)} ${days === 1 ? 'day' : 'days'} · ${label}${
    minutes === null ? '' : ` · ${formatDays(minutes)} min`
  }`
}
export function allocateByYear(allocations: { leave_date: string; days: number }[]) {
  const years = new Map<number, number>()
  for (const day of allocations) {
    const year = Number(day.leave_date.slice(0, 4))
    years.set(year, (years.get(year) ?? 0) + day.days)
  }
  return [...years].sort(([a], [b]) => a - b).map(([year, days]) => ({ year, days }))
}
export const localToday = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Kampala',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
