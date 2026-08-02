import { describe, expect, it } from 'vitest'
import { buildMasterPayrollRows } from './masterPayroll'
import type { PayrollRun } from '@/_contract/types/payroll.types'

const fakeRun: PayrollRun = {
  id: 'r_1',
  periodId: 'p_1',
  periodStart: '2026-07-01',
  periodEnd: '2026-07-31',
  periodLabel: 'July 2026',
  runNumber: 1,
  runType: 'regular',
  sourceRunId: null,
  status: 'approved',
  reason: 'Regular run',
  totalGross: 5000000,
  totalPaye: 500000,
  totalNssfEmployee: 250000,
  totalNssfEmployer: 500000,
  totalWht: 0,
  totalDeductions: 750000,
  totalNet: 4250000,
  approvedAt: '2026-07-28T10:00:00Z',
  items: [
    {
      id: 'i_1',
      employeeId: 'e_1',
      employeeNumber: 'EMP001',
      employeeName: 'Kato Mukasa',
      taxTreatment: 'local',
      nssfApplicable: true,
      percentOfMonthWorked: 100,
      contractualGross: 5000000,
      proratedGross: 5000000,
      overtimeHours: 0,
      overtimeRate: 0,
      overtimePay: 0,
      allowances: 0,
      taxableGross: 5000000,
      paye: 500000,
      nssfEmployee: 250000,
      nssfEmployer: 500000,
      wht: 0,
      salaryAdvanceDeduction: 0,
      otherDeductions: 0,
      totalDeductions: 750000,
      netPay: 4250000,
      tinNumber: '1001234567',
      nssfNumber: 'NS10002000',
      paymentMethod: 'bank',
      bankName: 'Stanbic Bank',
      accountNumber: '9030001234567',
      sortCode: '0401',
      mobileMoneyNumber: null,
      lineItems: [],
    },
  ],
  payment: null,
}

describe('Master Payroll Export', () => {
  it('builds rows with correct columns and totals row', () => {
    const rows = buildMasterPayrollRows(fakeRun)
    expect(rows.length).toBe(2)
    expect(rows[0]['Employee Name']).toBe('Kato Mukasa')
    expect(rows[1]['Employee Name']).toBe('TOTALS')
    expect(rows[1]['Net Pay']).toBe(4250000)
  })
})
