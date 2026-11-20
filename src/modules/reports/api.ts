import { z } from 'zod'

import {
  assertProtectedSessionCurrent,
  captureProtectedSessionSnapshot,
  type IdentityScopeRef,
} from '@/lib/idempotency/pendingOperations'
import { getSupabaseClient } from '@/lib/supabase/client'

const isoDate = z.string().date()
const number = z.union([z.number(), z.string().regex(/^-?\d+(?:\.\d+)?$/u)]).pipe(z.coerce.number().finite())
const count = number.pipe(z.number().int().nonnegative())
const countsByLabel = z.array(z.object({ label: z.string(), count }))
const dateWindow = {
  fromDate: isoDate,
  toDate: isoDate,
}

const workforceSchema = z.object({
  ...dateWindow,
  headcount: count,
  hires: count,
  exits: count,
  averageHeadcount: number,
  turnoverRate: number.nullable(),
  monthly: z.array(z.object({ month: isoDate, headcount: count, hires: count, exits: count })),
  departments: countsByLabel,
  genders: countsByLabel,
  ageBands: countsByLabel,
  employmentTypes: countsByLabel,
  exitReasons: countsByLabel,
  departmentOptions: z.array(z.object({ id: z.string().uuid(), label: z.string() })),
  coverage: z.object({ missingBirthdate: count, missingGender: count, missingEmploymentPeriods: count }),
})

const financialSchema = z.object({
  ...dateWindow,
  payroll: z.object({
    runs: z.array(z.object({
      id: z.string().uuid(),
      periodStart: isoDate,
      periodLabel: z.string(),
      runNumber: count,
      runType: z.enum(['regular', 'historical', 'supplemental', 'correction']),
      gross: number,
      net: number,
      employerNssf: number,
    })),
  }).nullable(),
  advances: z.object({ asOf: isoDate, openCount: count, pendingCount: count, outstandingBalance: number }).nullable(),
})

const departmentOptions = workforceSchema.shape.departmentOptions
const departmentWindow = { ...dateWindow, departmentOptions }
const leaveSchema = z.object({
  ...departmentWindow,
  rows: z.array(z.object({ label: z.string(), days: number, requests: count })),
})
const yearEndSchema = z.object({
  ...departmentWindow, weeksLeft: count, weekdaysLeft: count,
  rows: z.array(z.object({
    id: z.string().uuid(), label: z.string(), department: z.string(),
    entitled: number, taken: number, booked: number, remaining: number, pending: number,
    flagged: z.boolean(), lastReminded: z.string().nullable(), canRemind: z.boolean(),
  })),
})
const attendanceSchema = z.object({
  ...departmentWindow,
  rows: z.array(z.object({
    id: z.string().uuid().nullable(), label: z.string(), people: count, due: count, arrivals: count, arrivalRate: number.nullable(),
    onTimeRate: number.nullable(), late: count, meanLateMinutes: number.nullable(),
    absent: count, missingIn: count, unverified: count, untracked: count,
  })),
})

const workforceDetailQueries = {
  'salary-spread': z.object({
    ...departmentWindow, rows: z.array(z.object({ label: z.string(), people: count })),
  }),
  'employment-changes': z.object({
    ...departmentWindow,
    rows: z.array(z.object({ label: isoDate, hires: count, rehires: count, assignmentChanges: count, exits: count })),
  }),
  'record-completeness': z.object({
    ...departmentWindow,
    rows: z.array(z.object({
      id: z.string().uuid(), label: z.string(), number: z.string(), department: z.string(), missing: z.array(z.string()),
    })),
  }),
} as const
const operationalQueries = {
  leave: { rpc: 'rpc_get_hr_leave_utilization', schema: leaveSchema },
  'leave-year-end': { rpc: 'rpc_get_hr_leave_year_end', schema: yearEndSchema },
  'department-attendance': { rpc: 'rpc_get_hr_department_attendance', schema: attendanceSchema },
  'salary-spread': { schema: workforceDetailQueries['salary-spread'] },
  'employment-changes': { schema: workforceDetailQueries['employment-changes'] },
  'record-completeness': { schema: workforceDetailQueries['record-completeness'] },
} as const
export type OperationalKind = keyof typeof operationalQueries
export type OperationalReport = {
  [K in OperationalKind]: { kind: K; data: z.infer<typeof operationalQueries[K]['schema']> }
}[OperationalKind]

export const employmentTypes = [
  ['full_time', 'Full time'],
  ['part_time', 'Part time'],
  ['casual', 'Casual'],
  ['intern', 'Intern'],
  ['contractor', 'Contractor'],
] as const

export type ReportKind = 'workforce' | 'payroll' | OperationalKind
export type ReportFilters = {
  from: string
  to: string
  department: string
  employmentType: string
}
export type WorkforceReport = z.infer<typeof workforceSchema>
export type FinancialReport = z.infer<typeof financialSchema>
export type Report =
  | { kind: 'workforce'; data: WorkforceReport }
  | { kind: 'payroll'; data: FinancialReport }
  | OperationalReport

export class ReportsAccessError extends Error {}

export function reportFilterError(filters: ReportFilters, kind: ReportKind, today: string): string | null {
  if (!isoDate.safeParse(filters.from).success || !isoDate.safeParse(filters.to).success || filters.from > filters.to) {
    return 'Choose a valid start and end date.'
  }
  if (Date.parse(filters.to) - Date.parse(filters.from) > 730 * 86_400_000) {
    return 'Choose a date range of 731 days or fewer.'
  }
  if (kind === 'employment-changes' && filters.to > today) return 'Choose an end date of today or earlier.'
  if (kind === 'department-attendance' && (
    filters.to > today || Date.parse(filters.to) - Date.parse(filters.from) > 89 * 86_400_000
  )) return 'Choose up to 90 days ending today or earlier.'
  if (filters.department && !z.string().uuid().safeParse(filters.department).success) {
    return 'Choose a department from the list.'
  }
  if (filters.employmentType && !employmentTypes.some(([value]) => value === filters.employmentType)) {
    return 'Choose an employment type from the list.'
  }
  return null
}

function protect(scope: IdentityScopeRef) {
  const snapshot = captureProtectedSessionSnapshot({
    identityKey: scope.identityKey,
    authEpoch: scope.authEpoch,
    isReady: scope.isAuthReady,
  })
  return () => assertProtectedSessionCurrent(snapshot, scope.latestRef.current)
}

async function reportRpc(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const request = getSupabaseClient().rpc(name, args)
  const result: { data: unknown; error: { code: string } | null } = await (signal ? request.abortSignal(signal) : request)
  if (result.error?.code === '42501') throw new ReportsAccessError('This report requires additional access.')
  if (result.error) throw new Error('The reporting request could not be completed.')
  return result.data
}

export async function readReport(kind: ReportKind, filters: ReportFilters, scope: IdentityScopeRef, signal: AbortSignal): Promise<Report> {
  const assertCurrent = protect(scope)
  const dates = { p_from: filters.from, p_to: filters.to }
  const department = { p_department_id: filters.department || null }
  const load = async (name: string, args: Record<string, unknown>) => {
    assertCurrent()
    const response = await reportRpc(name, args, signal)
    assertCurrent()
    return response
  }
  if (kind === 'workforce') {
    const response = await load('rpc_get_hr_workforce_report', { ...dates, ...department, p_employment_type: filters.employmentType || null })
    return { kind, data: workforceSchema.parse(response) }
  }
  if (kind === 'payroll') {
    return { kind, data: financialSchema.parse(await load('rpc_get_hr_financial_report', dates)) }
  }
  const loadWorkforceDetail = () => load('rpc_get_hr_workforce_detail', {
    p_kind: kind,
    p_from: kind === 'employment-changes' ? filters.from : null,
    p_to: kind === 'employment-changes' ? filters.to : null,
    ...department,
    p_employment_type: filters.employmentType || null,
  })
  switch (kind) {
    case 'salary-spread':
      return { kind, data: workforceDetailQueries[kind].parse(await loadWorkforceDetail()) }
    case 'employment-changes':
      return { kind, data: workforceDetailQueries[kind].parse(await loadWorkforceDetail()) }
    case 'record-completeness':
      return { kind, data: workforceDetailQueries[kind].parse(await loadWorkforceDetail()) }
    case 'leave':
      return { kind, data: operationalQueries[kind].schema.parse(await load(operationalQueries[kind].rpc, { ...dates, ...department })) }
    case 'leave-year-end':
      return { kind, data: operationalQueries[kind].schema.parse(await load(operationalQueries[kind].rpc, department)) }
    case 'department-attendance':
      return { kind, data: operationalQueries[kind].schema.parse(await load(operationalQueries[kind].rpc, { ...dates, ...department })) }
  }
}

export async function sendLeaveReminders(employeeIds: string[], scope: IdentityScopeRef) {
  const assertCurrent = protect(scope)
  assertCurrent()
  const response = await reportRpc('rpc_send_hr_leave_year_end_reminders', { p_employee_ids: employeeIds })
  assertCurrent()
  return z.object({ sent: count, skipped: count }).parse(response)
}

export async function exportReport(report: Report, filters: ReportFilters, scope: IdentityScopeRef) {
  const assertCurrent = protect(scope)
  assertCurrent()
  const { prepareWorkbook } = await import('./workbook')
  const writeWorkbook = await prepareWorkbook(report, filters)
  assertCurrent()
  await reportRpc('record_report_export', {
    p_report_name: report.kind === 'payroll' ? 'hr-payroll-and-advances' : 'hr-' + report.kind,
    p_format: 'excel',
  })
  assertCurrent()
  writeWorkbook()
}
