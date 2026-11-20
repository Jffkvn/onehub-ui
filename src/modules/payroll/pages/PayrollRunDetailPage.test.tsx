import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PayrollRunDetailPage } from './PayrollRunDetailPage'
import type { PayrollRun } from '@/_contract/types/payroll.types'

const mockReplaceMutateAsync = vi.fn()
let mockReplaceState: {
  mutateAsync: typeof mockReplaceMutateAsync
  isPending: boolean
  isError: boolean
  error: Error | null
} = {
  mutateAsync: mockReplaceMutateAsync,
  isPending: false,
  isError: false,
  error: null,
}

const draftRun: PayrollRun = {
  id: 'run-dec',
  periodId: 'period-dec',
  periodStart: '2026-12-01',
  periodEnd: '2026-12-31',
  periodLabel: 'December 2026',
  runNumber: 1,
  runType: 'regular',
  sourceRunId: null,
  status: 'draft',
  reason: 'Regular monthly payroll',
  totalGross: 1500000,
  totalPaye: 352000,
  totalNssfEmployee: 75000,
  totalNssfEmployer: 150000,
  totalWht: 0,
  totalDeductions: 527000,
  totalNet: 973000,
  approvedAt: null,
  payment: null,
  items: [
    {
      id: 'item-1',
      employeeId: 'emp-1',
      employeeNumber: 'EMP-QA-01',
      employeeName: 'Employee One',
      taxTreatment: 'local',
      nssfApplicable: true,
      percentOfMonthWorked: 100,
      contractualGross: 1500000,
      proratedGross: 1500000,
      overtimeHours: 0,
      overtimeRate: 0,
      overtimePay: 0,
      allowances: 0,
      taxableGross: 1500000,
      paye: 352000,
      nssfEmployee: 75000,
      nssfEmployer: 150000,
      wht: 0,
      salaryAdvanceDeduction: 100000,
      otherDeductions: 0,
      totalDeductions: 527000,
      netPay: 973000,
      tinNumber: '1001',
      nssfNumber: '2001',
      paymentMethod: 'bank',
      bankName: 'QA Bank',
      accountNumber: '10001',
      sortCode: '01',
      mobileMoneyNumber: null,
      lineItems: [
        {
          id: 'line-adv',
          kind: 'salary_advance',
          code: 'STAFF_ADVANCE',
          description: 'Scheduled staff advance repayment',
          amount: 100000,
        },
        {
          id: 'line-bonus',
          kind: 'allowance',
          code: 'BONUS',
          description: 'Site Allowance',
          amount: 50000,
        },
      ],
    },
  ],
}

vi.mock('@/modules/auth/AuthProvider', () => ({
  useHasPermission: (key: string) => key === 'payroll.prepare' || key === 'payroll.read',
}))

vi.mock('../api/payroll', () => ({
  usePayrollRun: () => ({ data: draftRun, isLoading: false }),
  useReplacePayrollDraft: () => mockReplaceState,
  usePayrollPayeStatus: () => ({ data: { refreshRequired: false }, isFetching: false, isError: false }),
  useRefreshPayrollPaye: () => ({ isPending: false }),
  useApprovePayrollRun: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false, error: null }),
  useRecordPayrollPayment: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false, error: null }),
  useCreatePayrollAmendment: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false, error: null }),
  useEligibleEmployees: () => ({ data: [], isLoading: false }),
}))

describe('PayrollRunDetailPage (DEF-10)', () => {
  beforeEach(() => {
    mockReplaceMutateAsync.mockReset()
    mockReplaceState = {
      mutateAsync: mockReplaceMutateAsync,
      isPending: false,
      isError: false,
      error: null,
    }
  })

  it('keeps STAFF_ADVANCE read-only (Auto-calculated) while manual lines stay removable, and displays draft save errors', () => {
    mockReplaceState = {
      mutateAsync: mockReplaceMutateAsync,
      isPending: false,
      isError: true,
      error: new Error('Draft update failed cleanly'),
    }

    render(
      <MemoryRouter initialEntries={['/finance/payroll/run-dec']}>
        <Routes>
          <Route path="/finance/payroll/:id" element={<PayrollRunDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: /edit/i }))

    expect(screen.getByText('Auto-calculated')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remove Scheduled staff advance repayment/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Remove Site Allowance/i })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Draft update failed cleanly')
  })
})
