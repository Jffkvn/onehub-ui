import * as XLSX from 'xlsx'
import type { EmployeeSummary } from '../api/employees'

export const EMPLOYEE_TEMPLATE_HEADERS = [
  'Employee Number',
  'Full Name',
  'National ID',
  'Company Email',
  'Personal Email',
  'Work Phone',
  'Gender',
  'Date of Birth (YYYY-MM-DD)',
  'Department',
  'Job Title',
  'Pay Grade Code',
  'Employment Type',
  'Contract Type',
  'Start Date (YYYY-MM-DD)',
  'Contract End Date (YYYY-MM-DD)',
  'Probation End Date (YYYY-MM-DD)',
  'Probation Status',
  'Gross Salary (UGX)',
  'Custom Overtime Rate',
  'Payment Method',
  'Mobile Money Number',
  'Bank Name',
  'Bank Account Number',
  'Sort Code',
  'TIN Number',
  'NSSF Number',
  'Tax Type',
  'Percent Month Worked',
  'WHT Rate (%)',
] as const

export interface PreparedEmployeeExport {
  workbook: XLSX.WorkBook
  fileName: string
  exportedCount: number
  download: () => void
}

function cleanCellText(value: unknown): string {
  if (typeof value === 'string') return value.split('\u0000').join('')
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  return ''
}

/** Build a worksheet storing every string value as an explicit typed XLSX text cell (`t: 's'`, `z: '@'`), never inserting literal apostrophes or formulas. */
function buildTypedWorksheet(
  rows: ReadonlyArray<ReadonlyArray<string | number>>,
  minColWidths?: number[],
): XLSX.WorkSheet {
  const sheet: XLSX.WorkSheet = {}
  const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0)

  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c += 1) {
      const value = row[c]
      const addr = XLSX.utils.encode_cell({ r, c })
      if (typeof value === 'number' && Number.isFinite(value)) {
        sheet[addr] = { t: 'n', v: value }
      } else {
        sheet[addr] = { t: 's', v: cleanCellText(value), z: '@' }
      }
    }
  })

  if (rows.length > 0 && maxCols > 0) {
    sheet['!ref'] = XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: rows.length - 1, c: maxCols - 1 },
    })
  }
  if (minColWidths) {
    sheet['!cols'] = minColWidths.map((wch) => ({ wch }))
  }
  return sheet
}

function buildInstructionsSheet(): XLSX.WorkSheet {
  const guideRows = [
    ['OneHub Employee Workbook Import Guide'],
    [''],
    ['Required columns (all rows)', 'Employee Number, Full Name, Employment Type, Contract Type, Start Date (YYYY-MM-DD)'],
    ['Exact matching on updates', 'Rows match existing employees strictly by Employee Number, Company Email, or National ID (case-insensitive). Conflicting identifiers or archived employees are rejected.'],
    ['Blank optional cells on updates', 'Leaving an optional cell blank clears that field on the existing employee profile. Preview warnings will list every field that would be cleared.'],
    ['Employment Type values', 'full_time | part_time | casual | intern | contractor'],
    ['Contract Type values', 'permanent | fixed_term | casual | internship | consultancy (Contract End Date required for fixed_term)'],
    ['Probation Status values', 'not_applicable | on_probation | passed | extended | failed'],
    ['Payment Method values', 'bank (requires Bank Name & Bank Account Number) | mobile_money (requires Mobile Money Number) | cash'],
    ['Tax Type values', 'local | global | contractor | exempt'],
    ['Limits', 'Maximum 1,000 employee rows and 5 MB per .xlsx upload.'],
  ]
  return buildTypedWorksheet(guideRows, [32, 96])
}

/** Generate and download a blank Employee Import `.xlsx` template with instructions. */
export function downloadEmployeeTemplate(): void {
  const wb = XLSX.utils.book_new()
  const widths = EMPLOYEE_TEMPLATE_HEADERS.map((h) => Math.max(h.length + 4, 18))
  const ws = buildTypedWorksheet([[...EMPLOYEE_TEMPLATE_HEADERS]], widths)
  XLSX.utils.book_append_sheet(wb, ws, 'Employees')
  XLSX.utils.book_append_sheet(wb, buildInstructionsSheet(), 'Instructions')
  XLSX.writeFile(wb, 'OneHub_Employee_Import_Template.xlsx')
}

/** Prepare the active employee directory workbook in memory so export audits can gate download. */
export function prepareEmployeesExportWorkbook(
  employees: EmployeeSummary[],
): PreparedEmployeeExport {
  const exportable = employees.filter((e) => !e.archivedAt)
  const rows: Array<Array<string | number>> = [
    [...EMPLOYEE_TEMPLATE_HEADERS],
    ...exportable.map((emp) => [
      emp.employeeNumber,
      emp.legalName,
      emp.nationalId ?? '',
      emp.companyEmail ?? '',
      emp.personalEmail ?? '',
      emp.workPhone ?? '',
      emp.gender ?? '',
      emp.dateOfBirth ?? '',
      emp.departmentName ?? '',
      emp.jobTitleName ?? '',
      emp.payGradeName ?? '',
      emp.employmentType ?? 'full_time',
      emp.contractType ?? 'permanent',
      emp.startDate ?? '',
      emp.contractEndDate ?? '',
      emp.probationEndDate ?? '',
      emp.probationStatus ?? 'not_applicable',
      emp.grossSalary ?? '',
      emp.customOvertimeRate ?? '',
      emp.paymentMethod ?? 'cash',
      emp.mobileMoneyNumber ?? '',
      emp.bankName ?? '',
      emp.accountNumber ?? '',
      emp.sortCode ?? '',
      emp.tinNumber ?? '',
      emp.nssfNumber ?? '',
      emp.employeeTaxType ?? 'local',
      emp.pctMonthWorked ?? 100,
      emp.whtRate ?? 6,
    ]),
  ]

  const wb = XLSX.utils.book_new()
  const widths = EMPLOYEE_TEMPLATE_HEADERS.map((h) => Math.max(h.length + 4, 18))
  const ws = buildTypedWorksheet(rows, widths)
  XLSX.utils.book_append_sheet(wb, ws, 'Employees')

  const fileName = `OneHub_Employees_Export_${new Date().toISOString().slice(0, 10)}.xlsx`
  return {
    workbook: wb,
    fileName,
    exportedCount: exportable.length,
    download: () => XLSX.writeFile(wb, fileName),
  }
}
