import { getSupabaseClient } from '@/lib/supabase/client'
import type { EmployeeSummary } from './employees'

export interface EmployeeImportRecord extends EmployeeSummary {
  importVersionToken: string
}

export interface CommitEmployeeImportInput {
  sourceFileName: string
  sourceFileHash: string
  importRows: Array<{
    row_number: number
    action: 'create' | 'update'
    employee_id: string | null
    expected_version_token: string | null
    employee_data: Record<string, string | number | null>
    period_data: Record<string, string | null>
  }>
}

export interface CommitEmployeeImportResult {
  batch_id?: string
  created: number
  updated: number
}

const employeeImportSelect = `
  id, version, employee_number, legal_name, company_email, personal_email, work_phone, gender, date_of_birth, archived_at,
  employee_confidential_profiles(
    version, national_id, gross_salary, currency_code, custom_overtime_rate, payment_method,
    mobile_money_number, bank_name, account_number, sort_code, tin_number, nssf_number,
    employee_tax_type, pct_month_worked, wht_rate
  ),
  employment_periods(
    id, version, start_date, end_date, department_id, job_title_id, pay_grade_id,
    employment_type, contract_type, probation_end_date, probation_status,
    departments(name), job_titles(name), pay_grades(name)
  )
`

/** Compute lowercase hex SHA-256 hash of a workbook ArrayBuffer. */
export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function rowVersion(value: unknown): string | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? String(value) : null
}

/** Read employee fields and their versions in the same database statement. */
export async function fetchEmployeesForImport(): Promise<EmployeeImportRecord[]> {
  const { data, error } = await getSupabaseClient()
    .from('employees')
    .select(employeeImportSelect)
    .order('legal_name')

  if (error) throw error

  const rows = (data ?? []) as Array<Record<string, unknown>>
  const today = new Date().toISOString().slice(0, 10)
  const str = (v: unknown) => (typeof v === 'string' ? v : null)
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

  return rows.map((row) => {
    const rawPeriods = Array.isArray(row.employment_periods)
      ? (row.employment_periods as Array<Record<string, unknown>>)
      : []
    // Match the import executor, which always updates the latest period.
    const current = [...rawPeriods].sort((a, b) =>
      (str(b.start_date) ?? '').localeCompare(str(a.start_date) ?? '')
      || (str(b.id) ?? '').localeCompare(str(a.id) ?? ''),
    )[0]
    const confRel = row.employee_confidential_profiles
    const confidentialRow = (Array.isArray(confRel) ? confRel[0] : confRel) as Record<string, unknown> | null | undefined
    const conf = confidentialRow ?? {}

    // This representation matches public._employee_import_version_token.
    const employeeVersion = rowVersion(row.version)
    const confidentialVersion = confidentialRow ? rowVersion(conf.version) : '0'
    const periodId = str(current?.id)
    const periodVersion = rowVersion(current?.version)
    const periodToken = current ? (periodId && periodVersion ? `${periodId}@${periodVersion}` : null) : 'none'
    const archivedAt = str(row.archived_at)
    const importVersionToken = employeeVersion && confidentialVersion && periodToken
      ? [employeeVersion, archivedAt !== null, confidentialVersion, rawPeriods.length, periodToken].join(':')
      : ''

    const deptRel = current?.departments as { name?: string } | null | undefined
    const jtRel = current?.job_titles as { name?: string } | null | undefined
    const pgRel = current?.pay_grades as { name?: string } | null | undefined
    const currentEnd = str(current?.end_date)
    const id = str(row.id) ?? ''

    return {
      id,
      importVersionToken,
      employeeNumber: str(row.employee_number) ?? '',
      legalName: str(row.legal_name) ?? '',
      companyEmail: str(row.company_email),
      personalEmail: str(row.personal_email),
      workPhone: str(row.work_phone),
      gender: str(row.gender),
      dateOfBirth: str(row.date_of_birth),
      archivedAt,
      active: !row.archived_at && Boolean(current && (!currentEnd || currentEnd >= today)),
      departmentName: deptRel?.name ?? null,
      jobTitleName: jtRel?.name ?? null,
      payGradeName: pgRel?.name ?? null,
      departmentId: str(current?.department_id),
      jobTitleId: str(current?.job_title_id),
      payGradeId: str(current?.pay_grade_id),
      startDate: str(current?.start_date),
      endDate: str(current?.end_date),
      contractEndDate: str(current?.end_date),
      employmentType: str(current?.employment_type) as EmployeeSummary['employmentType'],
      contractType: str(current?.contract_type) as EmployeeSummary['contractType'],
      probationEndDate: str(current?.probation_end_date),
      probationStatus: str(current?.probation_status) as EmployeeSummary['probationStatus'],
      nationalId: str(conf.national_id),
      grossSalary: num(conf.gross_salary),
      currency: 'UGX',
      customOvertimeRate: num(conf.custom_overtime_rate),
      paymentMethod: (str(conf.payment_method) as EmployeeSummary['paymentMethod']) ?? 'cash',
      mobileMoneyNumber: str(conf.mobile_money_number),
      bankName: str(conf.bank_name),
      accountNumber: str(conf.account_number),
      sortCode: str(conf.sort_code),
      tinNumber: str(conf.tin_number),
      nssfNumber: str(conf.nssf_number),
      employeeTaxType: (str(conf.employee_tax_type) as EmployeeSummary['employeeTaxType']) ?? 'local',
      pctMonthWorked: num(conf.pct_month_worked) ?? 100,
      whtRate: num(conf.wht_rate) ?? 6,
    }
  })
}

function readableImportError(err: unknown): string {
  if (!err || typeof err !== 'object') return 'Import failed.'
  const code = 'code' in err && typeof err.code === 'string' ? err.code : ''
  const msg = 'message' in err && typeof err.message === 'string' ? err.message : 'Import failed.'
  if (code === '23505') {
    if (msg.toLowerCase().includes('hash')) {
      return 'This exact workbook file has already been imported.'
    }
    return 'A duplicate employee number, email, or National ID blocked the atomic import.'
  }
  if (code === '40001') {
    return (
      msg ||
      'One or more employee records changed since you previewed this workbook. Re-validate before committing.'
    )
  }
  if (code === '42501') return 'You do not have permission to import or export employee workbooks.'
  return msg
}

/** Atomically commit validated create/update employee rows via `commit_employee_import`. */
export async function commitEmployeeImport(
  input: CommitEmployeeImportInput,
): Promise<CommitEmployeeImportResult> {
  const response = (await getSupabaseClient().rpc('commit_employee_import', {
    source_file_name: input.sourceFileName,
    source_file_hash: input.sourceFileHash,
    import_rows: input.importRows,
  })) as { data: unknown; error: unknown }
  if (response.error) {
    throw new Error(readableImportError(response.error))
  }
  const res = (response.data ?? {}) as Record<string, unknown>
  return {
    batch_id: typeof res.batch_id === 'string' ? res.batch_id : undefined,
    created: Number(res.created ?? 0),
    updated: Number(res.updated ?? 0),
  }
}

/** Audit employee workbook export counts via `record_employee_export`. */
export async function recordEmployeeExport(exportedCount: number): Promise<void> {
  const { error } = await getSupabaseClient().rpc('record_employee_export', {
    exported_count: exportedCount,
  })
  if (error) {
    throw new Error(readableImportError(error))
  }
}
