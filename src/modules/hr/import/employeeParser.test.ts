import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { parseWorkbookBuffer } from '@/lib/security/workbookCore'
import type { EmployeeSetup, EmployeeSummary } from '../api/employees'
import { EMPLOYEE_TEMPLATE_HEADERS, prepareEmployeesExportWorkbook } from './employeeTemplate'
import { parseEmployeeImportWorkbook } from './employeeParser'

const setup: EmployeeSetup = {
  departments: [{ id: 'd1', name: 'Engineering' }],
  jobTitles: [{ id: 'j1', name: 'Technician', departmentId: 'd1' }],
  payGrades: [{ id: 'p1', code: 'PG-2', name: 'Technical Officer' }],
}

const existingActive: EmployeeSummary = {
  id: 'e1000000-0000-4000-8000-000000000001',
  employeeNumber: 'EMP-001',
  legalName: 'Alice Namukasa',
  companyEmail: 'alice@example.com',
  workPhone: '+256700000001',
  archivedAt: null,
  active: true,
  departmentId: 'd1',
  departmentName: 'Engineering',
  jobTitleId: 'j1',
  jobTitleName: 'Technician',
  payGradeId: 'p1',
  payGradeName: 'Technical Officer',
  startDate: '2025-01-15',
  endDate: null,
  contractEndDate: null,
  employmentType: 'full_time',
  contractType: 'permanent',
  probationStatus: 'not_applicable',
  nationalId: 'CM900011223344',
  tinNumber: '1000222333',
  grossSalary: 3200000,
  paymentMethod: 'cash',
  employeeTaxType: 'local',
  pctMonthWorked: 100,
  whtRate: 6,
}

const existingArchived: EmployeeSummary = {
  ...existingActive,
  id: 'e1000000-0000-4000-8000-000000000099',
  employeeNumber: 'EMP-ARCH',
  companyEmail: 'archived@example.com',
  nationalId: 'CM999999999999',
  archivedAt: '2026-01-10T00:00:00Z',
  active: false,
}

function makeBlankRow(overrides: Record<string, string>): string[] {
  return EMPLOYEE_TEMPLATE_HEADERS.map((header) => overrides[header] ?? '')
}

describe('workbookReader & employeeParser', () => {
  it('rejects forged files lacking ZIP magic bytes and caps oversized row counts', () => {
    const fakeBytes = new TextEncoder().encode('not-a-zip-file').buffer
    expect(() => parseWorkbookBuffer(fakeBytes)).toThrow(/not a valid \.xlsx workbook/i)

    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([
      ['Employee Number', 'Full Name'],
      ['EMP-1', '=SUM(1,2)'],
      ['EMP-2', 'Normal Name'],
    ])
    XLSX.utils.book_append_sheet(wb, ws, 'Employees')
    const xlsxBuf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer

    const parsed = parseWorkbookBuffer(xlsxBuf, { preferredSheetName: 'Employees', maxRows: 5 })
    expect(parsed.rows).toHaveLength(3)
    expect(parsed.rows[1]?.[1]).not.toBe('3')
    expect(() => parseWorkbookBuffer(xlsxBuf, { maxRows: 2 })).toThrow(/exceeding/i)
  })

  it('preserves exact +256 phone numbers and leading zeroes across export -> parse -> re-import round trips', () => {
    const roundTripEmp = {
      ...existingActive,
      importVersionToken: '1:false:1:1:ep1@1',
      workPhone: '+256700000001',
      paymentMethod: 'mobile_money' as const,
      mobileMoneyNumber: '+256772000001',
      tinNumber: '00123456',
      nssfNumber: '00998877',
    }
    const prepared = prepareEmployeesExportWorkbook([roundTripEmp])
    const written = XLSX.write(prepared.workbook, { type: 'array', bookType: 'xlsx' }) as Uint8Array
    const buf = new Uint8Array(written).slice().buffer
    const parsed = parseWorkbookBuffer(buf, { preferredSheetName: 'Employees' })

    const dataRow = parsed.rows[1] ?? []
    expect(dataRow).toContain('+256700000001')
    expect(dataRow).toContain('+256772000001')
    expect(dataRow).toContain('00123456')
    expect(dataRow.some((cell) => cell.startsWith("'"))).toBe(false)

    const reimported = parseEmployeeImportWorkbook(parsed.rows, [roundTripEmp], setup)
    expect(reimported.canCommit).toBe(true)
    expect(reimported.rows[0]?.action).toBe('update')
    expect(reimported.rows[0]?.changedFields).toEqual([])
    expect(reimported.rows[0]?.clearedFields).toEqual([])
    expect(reimported.rows[0]?.payload?.expected_version_token).toBe('1:false:1:1:ep1@1')
  })

  it('parses creates, detects changedFields and blank clearedFields on updates, and enforces exact matching', () => {
    const headers = [...EMPLOYEE_TEMPLATE_HEADERS]
    const createRow = makeBlankRow({
      'Employee Number': 'EMP-002',
      'Full Name': 'Brian Kato',
      Department: 'Engineering',
      'Job Title': 'Technician',
      'Pay Grade Code': 'PG-2',
      'Employment Type': 'full_time',
      'Contract Type': 'permanent',
      'Start Date (YYYY-MM-DD)': '2026-03-01',
      'Gross Salary (UGX)': '2500000',
    })
    const updateRowClearsTinAndUpdatesSalary = makeBlankRow({
      'Employee Number': 'EMP-001',
      'Full Name': 'Alice Namukasa',
      'Company Email': 'alice@example.com',
      'National ID': 'CM900011223344',
      'Work Phone': '+256700000001',
      Department: 'Engineering',
      'Job Title': 'Technician',
      'Pay Grade Code': 'PG-2',
      'Employment Type': 'full_time',
      'Contract Type': 'permanent',
      'Start Date (YYYY-MM-DD)': '2025-01-15',
      'Gross Salary (UGX)': '3500000',
      // 'TIN Number' intentionally left blank -> clears existing TIN!
    })

    const preview = parseEmployeeImportWorkbook(
      [headers, createRow, updateRowClearsTinAndUpdatesSalary],
      [existingActive],
      setup,
    )

    expect(preview.canCommit).toBe(true)
    expect(preview.createCount).toBe(1)
    expect(preview.updateCount).toBe(1)
    expect(preview.clearedFieldWarningCount).toBe(1)
    expect(preview.rows[0]?.action).toBe('create')
    expect(preview.rows[1]?.action).toBe('update')
    expect(preview.rows[1]?.changedFields).toContain('Gross Salary')
    expect(preview.rows[1]?.clearedFields).toContain('TIN Number')
  })

  it('rejects conflicting identifiers, duplicates within workbook, and archived matches', () => {
    const otherEmp: EmployeeSummary = {
      ...existingActive,
      id: 'e1000000-0000-4000-8000-000000000002',
      employeeNumber: 'EMP-009',
      companyEmail: 'other@example.com',
      nationalId: 'CM888888888888',
    }
    const headers = [...EMPLOYEE_TEMPLATE_HEADERS]

    const conflictRow = makeBlankRow({
      'Employee Number': 'EMP-001',
      'Full Name': 'Alice Namukasa',
      'Company Email': 'other@example.com', // points to EMP-009!
      'Employment Type': 'full_time',
      'Contract Type': 'permanent',
      'Start Date (YYYY-MM-DD)': '2026-01-01',
    })
    const archivedRow = makeBlankRow({
      'Employee Number': 'EMP-ARCH',
      'Full Name': 'Archived Worker',
      'Employment Type': 'full_time',
      'Contract Type': 'permanent',
      'Start Date (YYYY-MM-DD)': '2026-01-01',
    })
    const dupRow1 = makeBlankRow({
      'Employee Number': 'EMP-NEW',
      'Full Name': 'Dup One',
      'Employment Type': 'full_time',
      'Contract Type': 'permanent',
      'Start Date (YYYY-MM-DD)': '2026-01-01',
    })
    const dupRow2 = makeBlankRow({
      'Employee Number': 'EMP-NEW',
      'Full Name': 'Dup Two',
      'Employment Type': 'full_time',
      'Contract Type': 'permanent',
      'Start Date (YYYY-MM-DD)': '2026-01-01',
    })

    const preview = parseEmployeeImportWorkbook(
      [headers, conflictRow, archivedRow, dupRow1, dupRow2],
      [existingActive, otherEmp, existingArchived],
      setup,
    )

    expect(preview.canCommit).toBe(false)
    expect(preview.rows[0]?.errors.join(' ')).toMatch(/conflicting identifiers/i)
    expect(preview.rows[1]?.errors.join(' ')).toMatch(/archived/i)
    expect(preview.rows[3]?.errors.join(' ')).toMatch(/duplicate employee number/i)
  })
})
