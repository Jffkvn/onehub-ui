import { describe, expect, it } from 'vitest'
import { payslipFileName } from './payslip'
import type { PayrollItem, PayrollRun } from '../types'

const mockRun: PayrollRun = {
  id: 'run-1',
  periodId: 'period-1',
  periodStart: '2026-07-01',
  periodEnd: '2026-07-31',
  periodLabel: 'July 2026',
  runNumber: 1,
  runType: 'regular',
  sourceRunId: null,
  status: 'approved',
  reason: null,
  totalGross: 1000000,
  totalPaye: 100000,
  totalNssfEmployee: 50000,
  totalNssfEmployer: 100000,
  totalWht: 0,
  totalDeductions: 150000,
  totalNet: 850000,
  approvedAt: '2026-07-31T10:00:00Z',
  items: [],
  payment: null,
}

const mockItem: PayrollItem = {
  id: 'item-1',
  employeeId: 'emp-1',
  employeeNumber: 'EMP-001',
  employeeName: 'Ben Ten',
  taxTreatment: 'local',
  nssfApplicable: true,
  percentOfMonthWorked: 100,
  contractualGross: 1000000,
  proratedGross: 1000000,
  overtimeHours: 0,
  overtimeRate: 0,
  overtimePay: 0,
  allowances: 0,
  taxableGross: 1000000,
  paye: 100000,
  nssfEmployee: 50000,
  nssfEmployer: 100000,
  wht: 0,
  salaryAdvanceDeduction: 0,
  otherDeductions: 0,
  totalDeductions: 150000,
  netPay: 850000,
  tinNumber: null,
  nssfNumber: null,
  paymentMethod: 'cash',
  bankName: null,
  accountNumber: null,
  sortCode: null,
  mobileMoneyNumber: null,
  lineItems: [],
}

describe('payslipFileName', () => {
  it('formats regular first run as FirstName_LastName_Month_Year_Payslip.pdf', () => {
    expect(payslipFileName(mockRun, mockItem)).toBe('Ben_Ten_July_2026_Payslip.pdf')
  })

  it('sanitizes names with punctuation, apostrophes, and extra spaces', () => {
    const item = { ...mockItem, employeeName: "Bin'Latif  Magola" }
    expect(payslipFileName(mockRun, item)).toBe('Bin_Latif_Magola_July_2026_Payslip.pdf')
  })

  it('preserves Unicode letters in staff names', () => {
    const item = { ...mockItem, employeeName: 'Akello Grace Ødegård' }
    expect(payslipFileName(mockRun, item)).toBe('Akello_Grace_Ødegård_July_2026_Payslip.pdf')
  })

  it('appends disambiguating suffix for non-regular or runNumber > 1', () => {
    const run: PayrollRun = { ...mockRun, runType: 'correction', runNumber: 2 }
    expect(payslipFileName(run, mockItem)).toBe('Ben_Ten_July_2026_Payslip_correction-Run-2.pdf')
  })

  it('falls back to periodStart YYYY-MM if periodLabel is empty', () => {
    const run: PayrollRun = { ...mockRun, periodLabel: '' }
    expect(payslipFileName(run, mockItem)).toBe('Ben_Ten_2026-07_Payslip.pdf')
  })
})
