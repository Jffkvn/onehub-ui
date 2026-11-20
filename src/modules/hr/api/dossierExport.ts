import { z } from 'zod'

import {
  assertProtectedSessionCurrent,
  captureProtectedSessionSnapshot,
  isAbortError,
  type IdentityScopeRef,
} from '@/lib/idempotency/pendingOperations'
import { getSupabaseClient } from '@/lib/supabase/client'
import { getTodayIsoInZone } from '@/modules/attendance/lib/zonedTime'
import { registerResponseSchema } from '@/modules/attendance/schemas/attendance'
import { createSupabaseAuthGateway } from '@/modules/auth/AuthGateway'
import { leaveRpc, workspaceSchema } from '@/modules/leave/api/leave'
import { performanceApi } from '@/modules/performance/api'
import { listTrainingRecords } from '@/modules/training/api'

import type { DossierPdfSection } from '../exports/dossierDocument'
import { formatDate, formatLabel, formatMoney } from '../lib/formatters'
import { getDossierSection } from './dossierHistory'
import { employeeApi, type EmployeeSummary } from './employees'

const periodSchema = z.object({
  start_date: z.string().date(),
  end_date: z.string().date().nullable(),
  departments: z.object({ name: z.string() }).nullable(),
  job_titles: z.object({ name: z.string(), description: z.string().nullable() }).nullable(),
})
const assignmentHistorySchema = z.array(periodSchema)
const days = (value: number) => String(Math.round(value * 100) / 100) + (value === 1 ? ' day' : ' days')

function valueOrEmpty(value: string | null | undefined) {
  return value?.trim() || 'Not recorded'
}

function maskIdentifier(value: string | null | undefined) {
  const identifier = value?.trim()
  if (!identifier) return 'Not recorded'
  if (identifier.length <= 4) return '••••'
  return '•••• ' + identifier.slice(-4)
}

function personal(employee: EmployeeSummary): DossierPdfSection {
  return { title: 'Personal details', rows: [
    ['Gender', formatLabel(employee.gender)],
    ['Date of birth', formatDate(employee.dateOfBirth)],
    ['Work email', valueOrEmpty(employee.companyEmail)],
    ['Personal email', valueOrEmpty(employee.personalEmail)],
    ['Work phone', valueOrEmpty(employee.workPhone)],
  ] }
}

function employment(employee: EmployeeSummary): DossierPdfSection {
  return { title: 'Employment and contract', rows: [
    ['Employment status', employee.archivedAt ? 'Archived' : employee.active ? 'Active' : 'Inactive'],
    ['Department', valueOrEmpty(employee.departmentName)],
    ['Job title', valueOrEmpty(employee.jobTitleName)],
    ['Employment type', formatLabel(employee.employmentType)],
    ['Contract type', formatLabel(employee.contractType)],
    ['Start date', formatDate(employee.startDate)],
    ['End date', employee.endDate ? formatDate(employee.endDate) : 'Not recorded'],
    ['Probation status', formatLabel(employee.probationStatus)],
    ['Probation end', formatDate(employee.probationEndDate)],
  ] }
}

function payrollDetails(employee: EmployeeSummary): DossierPdfSection {
  return { title: 'Pay and statutory details', rows: [
    ['Pay grade', valueOrEmpty(employee.payGradeName)],
    ['Gross monthly salary', formatMoney(employee.grossSalary, employee.currency)],
    ['Overtime rate', formatMoney(employee.customOvertimeRate, employee.currency, 'Grade / default')],
    ['Payment method', formatLabel(employee.paymentMethod)],
    ['Bank name', valueOrEmpty(employee.bankName)],
    ['Account number', maskIdentifier(employee.accountNumber)],
    ['Mobile money number', maskIdentifier(employee.mobileMoneyNumber)],
    ['TIN', maskIdentifier(employee.tinNumber)],
    ['NSSF number', maskIdentifier(employee.nssfNumber)],
    ['Tax treatment', formatLabel(employee.employeeTaxType)],
  ] }
}

async function readAssignments(employeeId: string) {
  const { error, data } = await getSupabaseClient().from('employment_periods')
    .select('start_date,end_date,departments(name),job_titles(name,description)')
    .eq('employee_id', employeeId).order('start_date', { ascending: false })
  if (error) throw new Error('Employment periods could not be loaded.')
  return assignmentHistorySchema.parse(data)
}

async function section(
  title: string,
  canRead: boolean,
  read: () => Promise<DossierPdfSection['rows']>,
  empty: string,
): Promise<DossierPdfSection> {
  if (!canRead) return { title, rows: [], note: 'Unavailable with the current access.' }
  try {
    const rows = await read()
    return { title, rows, note: rows.length === 0 ? empty : undefined }
  } catch (error) {
    if (isAbortError(error)) throw error
    return { title, rows: [], note: 'This section could not be loaded when the PDF was created.' }
  }
}

export async function downloadEmployeeDossier(
  employeeId: string,
  includePay: boolean,
  scope: IdentityScopeRef,
  signal: AbortSignal,
) {
  const snapshot = captureProtectedSessionSnapshot({
    identityKey: scope.identityKey,
    authEpoch: scope.authEpoch,
    isReady: scope.isAuthReady,
  })
  function checkCurrent() {
    signal.throwIfAborted()
    assertProtectedSessionCurrent(snapshot, scope.latestRef.current)
  }

  async function checkAccess() {
    checkCurrent()
    const access = await createSupabaseAuthGateway().loadAccessContext()
    checkCurrent()
    const permissions = access.permissionKeys
    if (!access.isActive || access.profile?.id !== snapshot.identityKey
      || !permissions.includes('employees.read') || !permissions.includes('reports.export')) {
      throw new Error('Your account no longer has access to export the employee dossier.')
    }
    if (includePay && !permissions.includes('payroll.read')) {
      throw new Error('Your account no longer has access to export pay details.')
    }
    return permissions
  }

  const permissions = await checkAccess()
  const employee = await employeeApi.get(employeeId)
  checkCurrent()
  if (employee.id !== employeeId) throw new Error('Employee record did not match the requested dossier.')

  const today = getTodayIsoInZone('Africa/Kampala')
  const year = Number(today.slice(0, 4))
  const start = new Date(Date.parse(today) - 29 * 86_400_000).toISOString().slice(0, 10)
  const assignment = readAssignments(employeeId)
  const details = await Promise.all([
    section('Emergency contacts', true, async () => {
      const result = await getDossierSection(scope, employeeId, 'emergency_contacts')
      return result.records.flatMap((record) => 'full_name' in record
        ? [[record.full_name, [record.relationship, record.phone, record.alt_phone].filter(Boolean).join(' · ')]]
        : [])
    }, 'No emergency contacts on record.'),
    section('Job description', true, async () => {
      const periods = await assignment
      const current = periods.find((period) => period.start_date === employee.startDate)
      const description = current?.job_titles?.description?.trim()
      return description ? [['Responsibilities', description]] : []
    }, 'No job description on record.'),
    section('Employment history', true, async () => (await assignment).map((period) => [
      formatDate(period.start_date) + ' – ' + (period.end_date ? formatDate(period.end_date) : 'Open-ended'),
      [period.job_titles?.name, period.departments?.name].filter(Boolean).join(' · ') || 'No assignment recorded.',
    ]), 'No employment periods on record.'),
    section('Previous employment', true, async () => {
      const result = await getDossierSection(scope, employeeId, 'previous_employment')
      return result.records.flatMap((record) => 'employer' in record
        ? [[record.employer, [
            record.job_title,
            record.started_on || record.ended_on
              ? formatDate(record.started_on) + ' – ' + formatDate(record.ended_on)
              : null,
          ].filter(Boolean).join(' · ') || 'No further details.']]
        : [])
    }, 'No previous employment on record.'),
    section('Attendance · last 30 days', !employee.archivedAt && (
      permissions.includes('attendance.read_all') || permissions.includes('attendance.manage')
    ), async () => {
      const response = await getSupabaseClient().rpc('rpc_attendance_get_register', {
        p_from: start, p_to: today, p_department_id: null, p_status: null,
        p_employee_id: employeeId, p_limit: 30, p_offset: 0,
      })
      if (response.error) throw new Error('Attendance could not be loaded.')
      const register = registerResponseSchema.parse(response.data)
      const recorded = register.rows.filter((row) => row.attendance_day_id && row.employee_id === employeeId)
      if (recorded.length === 0) return []
      return [
        ['Reporting period', formatDate(start) + ' – ' + formatDate(today)],
        ['Days with a recorded arrival', String(recorded.filter((row) => row.clock_in_at).length)],
        ['Arrivals assessed as on time', String(recorded.filter((row) => row.policy_verified && row.punctuality === 'on_time').length)],
        ['Recorded days needing review', String(recorded.filter((row) => row.needs_review).length)],
      ]
    }, 'No attendance days recorded in this period.'),
    section('Leave · ' + year, !employee.archivedAt && permissions.includes('leave.manage'), async () => {
      const result = workspaceSchema.parse(await leaveRpc('rpc_leave_workspace', {
        p_manage: true, p_employee_id: employeeId, p_year: year, p_filter: {},
      }))
      if (result.employee_id !== employeeId) throw new Error('Leave returned for a different employee.')
      return result.balances.map((balance) => [
        balance.name,
        days(balance.used_days) + ' approved · ' + days(balance.pending_days) + ' pending',
      ])
    }, 'No leave balances available for this year.'),
    section('Released performance reviews', permissions.includes('performance.manage'), async () => (
      await performanceApi(scope).listReviews()
    ).filter((record) => record.employee_id === employeeId
      && (record.status === 'hr_approved' || record.status === 'employee_acknowledged')).map((record) => [
      record.cycle_name,
      [formatLabel(record.status), record.overall_score === null ? null : 'Score ' + record.overall_score].filter(Boolean).join(' · '),
    ]), 'No released performance reviews on record.'),
    section('Training', permissions.includes('training.manage'), async () => (
      await listTrainingRecords(scope, true)
    ).filter((record) => record.employee_id === employeeId).map((record) => [
      record.topic,
      [formatLabel(record.status), formatDate(record.completion_date), record.provider].filter(Boolean).join(' · '),
    ]), 'No training on record.'),
  ])
  checkCurrent()

  const { prepareEmployeeDossierPdf } = await import('../exports/dossierDocument')
  checkCurrent()
  const download = await prepareEmployeeDossierPdf({
    employeeNumber: employee.employeeNumber,
    employeeName: employee.legalName,
    date: formatDate(today),
    includePay,
    sections: [personal(employee), employment(employee), ...details, ...(includePay ? [payrollDetails(employee)] : [])],
  })
  const currentPermissions = await checkAccess()
  const secondaryPermissions = ['attendance.read_all', 'attendance.manage', 'leave.manage', 'performance.manage', 'training.manage']
  if (secondaryPermissions.some((key) => permissions.includes(key) && !currentPermissions.includes(key))) {
    throw new Error('Your account no longer has access to one of the dossier sections. Reopen the export to try again.')
  }

  const { error } = await getSupabaseClient().rpc('record_report_export', {
    p_report_name: (includePay ? 'employee-dossier-with-pay:' : 'employee-dossier:') + employeeId,
    p_format: 'pdf',
  })
  checkCurrent()
  if (error) throw new Error('Could not record this export. Please try again.')
  download()
}
