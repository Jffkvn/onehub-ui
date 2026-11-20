import type { EmployeeSetup, EmployeeSummary } from '../api/employees'

export type EmployeeImportAction = 'create' | 'update' | 'error'

export interface ParsedEmployeeImportRow {
  rowNumber: number
  action: EmployeeImportAction
  matchedEmployeeId: string | null
  employeeNumber: string
  legalName: string
  errors: string[]
  changedFields: string[]
  clearedFields: string[]
  payload: {
    row_number: number
    action: 'create' | 'update'
    employee_id: string | null
    expected_version_token: string | null
    employee_data: Record<string, string | number | null>
    period_data: Record<string, string | null>
  } | null
}

export interface EmployeeImportPreview {
  rows: ParsedEmployeeImportRow[]
  createCount: number
  updateCount: number
  errorCount: number
  clearedFieldWarningCount: number
  canCommit: boolean
}

const VALID_EMPLOYMENT_TYPES = new Set(['full_time', 'part_time', 'casual', 'intern', 'contractor'])
const VALID_CONTRACT_TYPES = new Set(['permanent', 'fixed_term', 'casual', 'internship', 'consultancy'])
const VALID_PROBATION_STATUSES = new Set(['not_applicable', 'on_probation', 'passed', 'extended', 'failed'])
const VALID_PAYMENT_METHODS = new Set(['bank', 'mobile_money', 'cash'])
const VALID_TAX_TYPES = new Set(['local', 'global', 'contractor', 'exempt'])
const VALID_GENDERS = new Set(['male', 'female', 'other', 'prefer_not_to_say'])

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function normVal(raw: string | null | undefined): string {
  return (raw ?? '').trim().toLowerCase()
}

function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  if (!y || !m || !d) return false
  const dt = new Date(Date.UTC(y, m - 1, d))
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  )
}

function parseOptionalNumber(raw: string, label: string, min: number, max: number, errors: string[]): number | null {
  if (!raw) return null
  const cleaned = raw.replace(/,/g, '')
  const num = Number(cleaned)
  if (!Number.isFinite(num)) {
    errors.push(`${label} must be a valid number.`)
    return null
  }
  if (num < min || num > max) {
    errors.push(`${label} must be between ${min} and ${max}.`)
    return null
  }
  return num
}

function mapHeaders(headerRow: string[]): Map<string, number> {
  const map = new Map<string, number>()
  headerRow.forEach((raw, idx) => {
    const k = normKey(raw)
    if (k && !map.has(k)) {
      map.set(k, idx)
    }
  })
  return map
}

function resolveCol(headerMap: Map<string, number>, ...aliases: string[]): number {
  for (const alias of aliases) {
    const idx = headerMap.get(normKey(alias))
    if (idx !== undefined) return idx
  }
  return -1
}

function sameStr(incoming: string | null, existing: string | null | undefined): boolean {
  return (incoming ?? '').trim().toLowerCase() === (existing ?? '').trim().toLowerCase()
}

function sameNum(incoming: number | null, existing: number | null | undefined): boolean {
  if (incoming === null && (existing === null || existing === undefined)) return true
  if (incoming === null || existing === null || existing === undefined) return false
  return Math.abs(incoming - Number(existing)) < 0.005
}

export type EmployeeImportTarget = EmployeeSummary & { importVersionToken?: string }

/** Validate raw workbook rows against existing employees and HR setup catalogs. */
export function parseEmployeeImportWorkbook(
  rawRows: string[][],
  existingEmployees: EmployeeImportTarget[],
  setup: EmployeeSetup,
): EmployeeImportPreview {
  if (rawRows.length < 2) {
    throw new Error('The uploaded workbook has no employee data rows beneath the header row.')
  }

  const headers = mapHeaders(rawRows[0] ?? [])
  const col = {
    employeeNumber: resolveCol(headers, 'employee number', 'employee id', 'emp no'),
    legalName: resolveCol(headers, 'full name', 'legal name', 'employee name'),
    nationalId: resolveCol(headers, 'national id', 'nin'),
    companyEmail: resolveCol(headers, 'company email', 'work email'),
    personalEmail: resolveCol(headers, 'personal email'),
    workPhone: resolveCol(headers, 'work phone', 'phone', 'phone number'),
    gender: resolveCol(headers, 'gender'),
    dateOfBirth: resolveCol(headers, 'date of birth'),
    department: resolveCol(headers, 'department'),
    jobTitle: resolveCol(headers, 'job title', 'role', 'position'),
    payGrade: resolveCol(headers, 'pay grade code', 'pay grade'),
    employmentType: resolveCol(headers, 'employment type'),
    contractType: resolveCol(headers, 'contract type'),
    startDate: resolveCol(headers, 'start date'),
    contractEndDate: resolveCol(headers, 'contract end date', 'end date'),
    probationEndDate: resolveCol(headers, 'probation end date'),
    probationStatus: resolveCol(headers, 'probation status'),
    grossSalary: resolveCol(headers, 'gross salary'),
    customOvertimeRate: resolveCol(headers, 'custom overtime rate', 'overtime rate'),
    paymentMethod: resolveCol(headers, 'payment method'),
    mobileMoneyNumber: resolveCol(headers, 'mobile money number'),
    bankName: resolveCol(headers, 'bank name'),
    accountNumber: resolveCol(headers, 'bank account number', 'account number'),
    sortCode: resolveCol(headers, 'sort code'),
    tinNumber: resolveCol(headers, 'tin number', 'tin'),
    nssfNumber: resolveCol(headers, 'nssf number', 'nssf'),
    taxType: resolveCol(headers, 'tax type', 'employee tax type'),
    pctMonthWorked: resolveCol(headers, 'percent month worked', 'pct month worked'),
    whtRate: resolveCol(headers, 'wht rate'),
  }

  if (col.employeeNumber < 0 || col.legalName < 0) {
    throw new Error('Workbook header row must include "Employee Number" and "Full Name" columns.')
  }

  const byEmpNo = new Map<string, EmployeeImportTarget>()
  const byCompanyEmail = new Map<string, EmployeeImportTarget>()
  const byNationalId = new Map<string, EmployeeImportTarget>()
  for (const emp of existingEmployees) {
    if (normVal(emp.employeeNumber)) byEmpNo.set(normVal(emp.employeeNumber), emp)
    if (normVal(emp.companyEmail)) byCompanyEmail.set(normVal(emp.companyEmail), emp)
    if (normVal(emp.nationalId)) byNationalId.set(normVal(emp.nationalId), emp)
  }

  const deptByName = new Map(setup.departments.map((d) => [normVal(d.name), d]))
  const gradeByCodeOrName = new Map<string, { id: string; name: string }>()
  for (const g of setup.payGrades) {
    if (g.code) gradeByCodeOrName.set(normVal(g.code), g)
    gradeByCodeOrName.set(normVal(g.name), g)
  }

  const seenEmpNo = new Map<string, number>()
  const seenEmail = new Map<string, number>()
  const seenNationalId = new Map<string, number>()
  const rows: ParsedEmployeeImportRow[] = []

  for (let i = 1; i < rawRows.length; i += 1) {
    const raw = rawRows[i] ?? []
    const get = (idx: number) => (idx >= 0 ? (raw[idx] ?? '').trim() : '')
    if (raw.every((cell) => !cell.trim())) continue

    const rowNumber = i + 1
    const errors: string[] = []
    const changedFields: string[] = []
    const clearedFields: string[] = []

    const employeeNumber = get(col.employeeNumber)
    const legalName = get(col.legalName)
    const nationalId = get(col.nationalId)
    const companyEmail = get(col.companyEmail)
    const personalEmail = get(col.personalEmail)
    const workPhone = get(col.workPhone)
    const genderRaw = normVal(get(col.gender))
    const dateOfBirth = get(col.dateOfBirth)
    const deptName = get(col.department)
    const jobTitleName = get(col.jobTitle)
    const payGradeRaw = get(col.payGrade)
    const employmentType = normVal(get(col.employmentType))
    const contractType = normVal(get(col.contractType))
    const startDate = get(col.startDate)
    const contractEndDate = get(col.contractEndDate)
    const probationEndDate = get(col.probationEndDate)
    const probationStatusRaw = normVal(get(col.probationStatus))
    const grossSalaryRaw = get(col.grossSalary)
    const customOtRaw = get(col.customOvertimeRate)
    const paymentMethodRaw = normVal(get(col.paymentMethod))
    const mobileMoneyNumber = get(col.mobileMoneyNumber)
    const bankName = get(col.bankName)
    const accountNumber = get(col.accountNumber)
    const sortCode = get(col.sortCode)
    const tinNumber = get(col.tinNumber)
    const nssfNumber = get(col.nssfNumber)
    const taxTypeRaw = normVal(get(col.taxType))
    const pctWorkedRaw = get(col.pctMonthWorked)
    const whtRateRaw = get(col.whtRate)

    if (!employeeNumber || employeeNumber.length > 40) {
      errors.push('Employee Number is required (1–40 characters).')
    }
    if (legalName.length < 2 || legalName.length > 160) {
      errors.push('Full Name is required (2–160 characters).')
    }

    if (employeeNumber) {
      const k = normVal(employeeNumber)
      const prev = seenEmpNo.get(k)
      if (prev) errors.push(`Duplicate Employee Number also appears on row ${prev}.`)
      else seenEmpNo.set(k, rowNumber)
    }
    if (companyEmail) {
      if (!EMAIL_RE.test(companyEmail)) errors.push('Company Email is invalid.')
      const k = normVal(companyEmail)
      const prev = seenEmail.get(k)
      if (prev) errors.push(`Duplicate Company Email also appears on row ${prev}.`)
      else seenEmail.set(k, rowNumber)
    }
    if (nationalId) {
      const k = normVal(nationalId)
      const prev = seenNationalId.get(k)
      if (prev) errors.push(`Duplicate National ID also appears on row ${prev}.`)
      else seenNationalId.set(k, rowNumber)
    }
    if (personalEmail && !EMAIL_RE.test(personalEmail)) {
      errors.push('Personal Email is invalid.')
    }
    if (genderRaw && !VALID_GENDERS.has(genderRaw)) {
      errors.push('Gender must be male, female, other, or prefer_not_to_say.')
    }
    if (dateOfBirth && !isValidIsoDate(dateOfBirth)) {
      errors.push('Date of Birth must use YYYY-MM-DD.')
    }

    // Match existing employees strictly by exact identifiers.
    const matchedMap = new Map<string, EmployeeImportTarget>()
    const mEmp = byEmpNo.get(normVal(employeeNumber))
    const mEmail = byCompanyEmail.get(normVal(companyEmail))
    const mNin = byNationalId.get(normVal(nationalId))
    if (mEmp) matchedMap.set(mEmp.id, mEmp)
    if (mEmail) matchedMap.set(mEmail.id, mEmail)
    if (mNin) matchedMap.set(mNin.id, mNin)

    if (matchedMap.size > 1) {
      errors.push(
        'Conflicting identifiers: Employee Number, Company Email, and National ID refer to different existing employees.',
      )
    }
    const existing = matchedMap.size === 1 ? ([...matchedMap.values()][0] ?? null) : null
    if (existing?.archivedAt) {
      errors.push('Matched employee is archived and cannot be updated via import.')
    }

    const effEmploymentType = employmentType || existing?.employmentType || ''
    const effContractType = contractType || existing?.contractType || ''
    const effStartDate = startDate || existing?.startDate || ''
    const effProbationStatus = probationStatusRaw || existing?.probationStatus || 'not_applicable'
    const effPaymentMethod = paymentMethodRaw || existing?.paymentMethod || 'cash'
    const effTaxType = taxTypeRaw || existing?.employeeTaxType || 'local'

    if (!VALID_EMPLOYMENT_TYPES.has(effEmploymentType)) {
      errors.push('Employment Type must be full_time, part_time, casual, intern, or contractor.')
    }
    if (!VALID_CONTRACT_TYPES.has(effContractType)) {
      errors.push('Contract Type must be permanent, fixed_term, casual, internship, or consultancy.')
    }
    if (!effStartDate || !isValidIsoDate(effStartDate)) {
      errors.push('Start Date is required in YYYY-MM-DD format.')
    }
    if (effContractType === 'fixed_term' && !contractEndDate) {
      errors.push('Contract End Date is required for fixed_term contracts.')
    }
    if (contractEndDate) {
      if (!isValidIsoDate(contractEndDate)) errors.push('Contract End Date must use YYYY-MM-DD.')
      else if (isValidIsoDate(effStartDate) && contractEndDate < effStartDate) {
        errors.push('Contract End Date cannot precede Start Date.')
      }
    }
    if (probationEndDate) {
      if (!isValidIsoDate(probationEndDate)) errors.push('Probation End Date must use YYYY-MM-DD.')
      else if (isValidIsoDate(effStartDate) && probationEndDate < effStartDate) {
        errors.push('Probation End Date cannot precede Start Date.')
      }
    }
    if (!VALID_PROBATION_STATUSES.has(effProbationStatus)) {
      errors.push('Probation Status must be not_applicable, on_probation, passed, extended, or failed.')
    }
    if (!VALID_PAYMENT_METHODS.has(effPaymentMethod)) {
      errors.push('Payment Method must be bank, mobile_money, or cash.')
    }
    if (effPaymentMethod === 'bank' && (!bankName || !accountNumber)) {
      errors.push('Bank Name and Bank Account Number are required for bank payments.')
    }
    if (effPaymentMethod === 'mobile_money' && !mobileMoneyNumber) {
      errors.push('Mobile Money Number is required for mobile_money payments.')
    }
    if (!VALID_TAX_TYPES.has(effTaxType)) {
      errors.push('Tax Type must be local, global, contractor, or exempt.')
    }

    const dept = deptName ? deptByName.get(normVal(deptName)) : null
    if (deptName && !dept) {
      errors.push(`Unknown Department "${deptName}".`)
    }

    let jobTitle: { id: string; name: string } | null = null
    if (jobTitleName) {
      const matchingTitles = setup.jobTitles.filter((jt) => normVal(jt.name) === normVal(jobTitleName))
      const scoped = dept
        ? matchingTitles.find((jt) => jt.departmentId === dept.id || !jt.departmentId)
        : undefined
      if (scoped) {
        jobTitle = scoped
      } else if (matchingTitles.length === 1 && matchingTitles[0]) {
        jobTitle = matchingTitles[0]
      } else if (matchingTitles.length > 1) {
        errors.push(`Ambiguous Job Title "${jobTitleName}"; specify its Department as well.`)
      } else {
        errors.push(`Unknown Job Title "${jobTitleName}".`)
      }
    }

    const payGrade = payGradeRaw ? gradeByCodeOrName.get(normVal(payGradeRaw)) ?? null : null
    if (payGradeRaw && !payGrade) {
      errors.push(`Unknown Pay Grade "${payGradeRaw}".`)
    }

    const grossSalary = parseOptionalNumber(grossSalaryRaw, 'Gross Salary', 0, 1_000_000_000, errors)
    const customOvertimeRate = parseOptionalNumber(customOtRaw, 'Custom Overtime Rate', 0, 100_000_000, errors)
    const pctMonthWorked = pctWorkedRaw
      ? parseOptionalNumber(pctWorkedRaw, 'Percent Month Worked', 0, 100, errors) ?? 100
      : existing?.pctMonthWorked ?? 100
    const whtRate = whtRateRaw
      ? parseOptionalNumber(whtRateRaw, 'WHT Rate (%)', 0, 100, errors) ?? 6
      : existing?.whtRate ?? 6

    if (existing && !existing.archivedAt) {
      const checkClearedOrChangedStr = (label: string, incoming: string, prev: string | null | undefined) => {
        const cleanIn = incoming.trim()
        const cleanPrev = (prev ?? '').trim()
        if (!cleanIn && cleanPrev) clearedFields.push(label)
        else if (cleanIn && !sameStr(cleanIn, cleanPrev)) changedFields.push(label)
      }
      const checkClearedOrChangedNum = (label: string, incoming: number | null, prev: number | null | undefined) => {
        if (incoming === null && prev !== null && prev !== undefined) clearedFields.push(label)
        else if (incoming !== null && !sameNum(incoming, prev)) changedFields.push(label)
      }

      if (!sameStr(employeeNumber, existing.employeeNumber)) changedFields.push('Employee Number')
      if (!sameStr(legalName, existing.legalName)) changedFields.push('Full Name')
      checkClearedOrChangedStr('National ID', nationalId, existing.nationalId)
      checkClearedOrChangedStr('Company Email', companyEmail, existing.companyEmail)
      checkClearedOrChangedStr('Personal Email', personalEmail, existing.personalEmail)
      checkClearedOrChangedStr('Work Phone', workPhone, existing.workPhone)
      checkClearedOrChangedStr('Gender', genderRaw, existing.gender)
      checkClearedOrChangedStr('Date of Birth', dateOfBirth, existing.dateOfBirth)
      checkClearedOrChangedStr('Department', dept?.id ?? '', existing.departmentId)
      checkClearedOrChangedStr('Job Title', jobTitle?.id ?? '', existing.jobTitleId)
      checkClearedOrChangedStr('Pay Grade', payGrade?.id ?? '', existing.payGradeId)
      if (effEmploymentType !== (existing.employmentType ?? '')) changedFields.push('Employment Type')
      if (effContractType !== (existing.contractType ?? '')) changedFields.push('Contract Type')
      if (effStartDate !== (existing.startDate ?? '')) changedFields.push('Start Date')
      checkClearedOrChangedStr('Contract End Date', contractEndDate, existing.contractEndDate)
      checkClearedOrChangedStr('Probation End Date', probationEndDate, existing.probationEndDate)
      if (effProbationStatus !== (existing.probationStatus ?? 'not_applicable')) changedFields.push('Probation Status')
      checkClearedOrChangedNum('Gross Salary', grossSalary, existing.grossSalary)
      checkClearedOrChangedNum('Custom Overtime Rate', customOvertimeRate, existing.customOvertimeRate)
      if (effPaymentMethod !== (existing.paymentMethod ?? 'cash')) changedFields.push('Payment Method')
      checkClearedOrChangedStr('Mobile Money Number', mobileMoneyNumber, existing.mobileMoneyNumber)
      checkClearedOrChangedStr('Bank Name', bankName, existing.bankName)
      checkClearedOrChangedStr('Bank Account Number', accountNumber, existing.accountNumber)
      checkClearedOrChangedStr('Sort Code', sortCode, existing.sortCode)
      checkClearedOrChangedStr('TIN Number', tinNumber, existing.tinNumber)
      checkClearedOrChangedStr('NSSF Number', nssfNumber, existing.nssfNumber)
      if (effTaxType !== (existing.employeeTaxType ?? 'local')) changedFields.push('Tax Type')
      if (!sameNum(pctMonthWorked, existing.pctMonthWorked ?? 100)) changedFields.push('Percent Month Worked')
      if (!sameNum(whtRate, existing.whtRate ?? 6)) changedFields.push('WHT Rate (%)')
    }

    const hasError = errors.length > 0
    const action: EmployeeImportAction = hasError ? 'error' : existing ? 'update' : 'create'

    const payload =
      hasError
        ? null
        : {
            row_number: rowNumber,
            action: existing ? ('update' as const) : ('create' as const),
            employee_id: existing ? existing.id : null,
            expected_version_token: existing ? (existing.importVersionToken ?? null) : null,
            employee_data: {
              employee_number: employeeNumber,
              legal_name: legalName,
              national_id: nationalId || null,
              company_email: companyEmail || null,
              personal_email: personalEmail || null,
              work_phone: workPhone || null,
              gender: genderRaw || null,
              date_of_birth: dateOfBirth || null,
              gross_salary: grossSalary,
              currency_code: 'UGX',
              custom_overtime_rate: customOvertimeRate,
              payment_method: effPaymentMethod,
              mobile_money_number: mobileMoneyNumber || null,
              bank_name: bankName || null,
              account_number: accountNumber || null,
              sort_code: sortCode || null,
              tin_number: tinNumber || null,
              nssf_number: nssfNumber || null,
              employee_tax_type: effTaxType,
              pct_month_worked: pctMonthWorked,
              wht_rate: whtRate,
            },
            period_data: {
              start_date: effStartDate,
              end_date: contractEndDate || null,
              department_id: dept?.id ?? null,
              job_title_id: jobTitle?.id ?? null,
              pay_grade_id: payGrade?.id ?? null,
              employment_type: effEmploymentType,
              contract_type: effContractType,
              probation_end_date: probationEndDate || null,
              probation_status: effProbationStatus,
            },
          }

    rows.push({
      rowNumber,
      action,
      matchedEmployeeId: existing?.id ?? null,
      employeeNumber,
      legalName,
      errors,
      changedFields,
      clearedFields,
      payload,
    })
  }

  if (rows.length === 0) {
    throw new Error('The uploaded workbook contains no non-empty data rows.')
  }

  const createCount = rows.filter((r) => r.action === 'create').length
  const updateCount = rows.filter((r) => r.action === 'update').length
  const errorCount = rows.filter((r) => r.action === 'error').length
  const clearedFieldWarningCount = rows.filter((r) => r.clearedFields.length > 0).length

  return {
    rows,
    createCount,
    updateCount,
    errorCount,
    clearedFieldWarningCount,
    canCommit: errorCount === 0 && createCount + updateCount > 0,
  }
}
