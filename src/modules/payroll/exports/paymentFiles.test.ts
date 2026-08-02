import { describe, expect, it } from 'vitest'
import { bankPaymentCsv, mtnBulkPayCsv, nssfCsv, payeCsv } from './paymentFiles'
import type { PayrollRun } from '@/_contract/types/payroll.types'

const approvedRun: PayrollRun = {
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
    {
      id: 'i_2',
      employeeId: 'e_2',
      employeeNumber: 'EMP002',
      employeeName: 'Mbabazi Sarah',
      taxTreatment: 'local',
      nssfApplicable: true,
      percentOfMonthWorked: 100,
      contractualGross: 3000000,
      proratedGross: 3000000,
      overtimeHours: 0,
      overtimeRate: 0,
      overtimePay: 0,
      allowances: 0,
      taxableGross: 3000000,
      paye: 250000,
      nssfEmployee: 150000,
      nssfEmployer: 300000,
      wht: 0,
      salaryAdvanceDeduction: 0,
      otherDeductions: 0,
      totalDeductions: 400000,
      netPay: 2600000,
      tinNumber: '1007654321',
      nssfNumber: 'NS10002001',
      paymentMethod: 'mobile_money',
      bankName: null,
      accountNumber: null,
      sortCode: null,
      mobileMoneyNumber: '256770000111',
      lineItems: [],
    },
  ],
  payment: null,
}

describe('Statutory Payment CSV Exports', () => {
  it('generates bank CSV correctly', () => {
    const csv = bankPaymentCsv(approvedRun)
    expect(csv).toContain('Kato Mukasa')
    expect(csv).toContain('Stanbic Bank')
    expect(csv).toContain('4250000')
  })

  it('generates MTN bulk pay CSV correctly', () => {
    const csv = mtnBulkPayCsv(approvedRun)
    expect(csv).toContain('256770000111,2600000,UGX,SAL-2026-07-EMP002')
  })

  it('generates NSSF CSV correctly', () => {
    const csv = nssfCsv(approvedRun)
    expect(csv).toContain('Employee NSSF (5%),Employer NSSF (10%)')
    expect(csv).toContain('NS10002000')
  })

  it('generates PAYE CSV correctly', () => {
    const csv = payeCsv(approvedRun)
    expect(csv).toContain('1001234567')
    expect(csv).toContain('500000')
  })

  it('throws error if run is not approved', () => {
    const draftRun = { ...approvedRun, status: 'draft' as const }
    expect(() => bankPaymentCsv(draftRun)).toThrow('Payroll must be approved before export')
  })
})
