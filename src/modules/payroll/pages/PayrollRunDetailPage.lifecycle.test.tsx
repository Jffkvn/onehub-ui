import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PayrollRunDetailPage } from './PayrollRunDetailPage'
import { payrollApi } from '../api/payroll'
import type { PayrollDraftItem, PayrollRun } from '@/_contract/types/payroll.types'

vi.mock('@/modules/auth/AuthProvider', () => ({
  useHasPermission: (key: string) =>
    key === 'payroll.prepare' || key === 'payroll.read' || key === 'payroll.approve',
}))

function createBaseRun(): PayrollRun {
  return {
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
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function renderWithQueryClient() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/finance/payroll/run-dec']}>
        <Routes>
          <Route path="/finance/payroll/:id" element={<PayrollRunDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('PayrollRunDetailPage delayed save & reconciliation lifecycle', () => {
  beforeEach(() => {
    vi.spyOn(payrollApi, 'eligibleEmployees').mockResolvedValue([])
    vi.spyOn(payrollApi, 'payeStatus').mockResolvedValue({
      effectiveFrom: '2026-07-01',
      appliedEffectiveFrom: '2026-07-01',
      refreshRequired: false,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('holds stale PAYE approval until an audited refresh reloads the run and its tax status', async () => {
    const initialRun = createBaseRun()
    let refreshed = false
    const refresh = deferred<boolean>()
    vi.spyOn(payrollApi, 'get').mockImplementation(() => Promise.resolve(
      refreshed ? { ...initialRun, items: initialRun.items.map((item) => ({ ...item, paye: 338250 })) } : initialRun,
    ))
    vi.spyOn(payrollApi, 'payeStatus').mockImplementation(() => Promise.resolve({
      effectiveFrom: '2026-07-01',
      appliedEffectiveFrom: refreshed ? '2026-07-01' : null,
      refreshRequired: !refreshed,
    }))
    const refreshSpy = vi.spyOn(payrollApi, 'refreshPaye').mockImplementation(async () => {
      await refresh.promise
      refreshed = true
      return true
    })

    renderWithQueryClient()
    const refreshButton = await screen.findByRole('button', { name: 'Refresh PAYE' })
    expect(screen.getByRole('button', { name: 'Approve Payroll Run' })).toBeDisabled()
    expect(refreshButton).toBeDisabled()
    fireEvent.change(screen.getByLabelText('PAYE refresh reason'), { target: { value: 'Apply July resident rates' } })
    fireEvent.click(refreshButton)
    await waitFor(() => expect(refreshSpy).toHaveBeenCalledWith(initialRun.id, 'Apply July resident rates'))
    expect(screen.getByRole('button', { name: 'Approve Payroll Run' })).toBeDisabled()
    await act(async () => { refresh.resolve(true); await refresh.promise })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Approve Payroll Run' })).toBeEnabled())
    expect(screen.getByText(/Applied since 1 July 2026/)).toBeInTheDocument()
  })

  it('retries the calculation status with the run after a confirmed PAYE change', async () => {
    const run = createBaseRun()
    let refreshed = false
    let failRead = true
    vi.spyOn(payrollApi, 'get').mockResolvedValue(run)
    const statusSpy = vi.spyOn(payrollApi, 'payeStatus').mockImplementation(() => {
      if (refreshed && failRead) return Promise.reject(new Error('Status unavailable'))
      return Promise.resolve({
        effectiveFrom: '2026-07-01',
        appliedEffectiveFrom: refreshed ? '2026-07-01' : null,
        refreshRequired: !refreshed,
      })
    })
    const refreshSpy = vi.spyOn(payrollApi, 'refreshPaye').mockImplementation(() => {
      refreshed = true
      return Promise.resolve(true)
    })

    renderWithQueryClient()
    const refreshButton = await screen.findByRole('button', { name: 'Refresh PAYE' })
    fireEvent.change(screen.getByLabelText('PAYE refresh reason'), {
      target: { value: 'Apply resident rates' },
    })
    fireEvent.click(refreshButton)
    const retry = await screen.findByRole('button', { name: 'Retry Refresh' })
    const requests = statusSpy.mock.calls.length
    failRead = false
    fireEvent.click(retry)
    await waitFor(() => expect(statusSpy.mock.calls.length).toBeGreaterThan(requests))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Approve Payroll Run' })).toBeEnabled())
    expect(refreshSpy).toHaveBeenCalledTimes(1)
  })

  it('locks editing and approval across pending save + delayed refresh and blocks repeated actions', async () => {
    let serverRun = createBaseRun()
    const replaceDeferred = deferred<void>()
    const refetchDeferred = deferred<PayrollRun>()
    let getCount = 0

    vi.spyOn(payrollApi, 'get').mockImplementation(() => {
      getCount += 1
      if (getCount === 1) return Promise.resolve(structuredClone(serverRun))
      return refetchDeferred.promise
    })

    const replaceSpy = vi.spyOn(payrollApi, 'replace').mockImplementation(
      (_id: string, items: PayrollDraftItem[]) => {
        serverRun = {
          ...structuredClone(serverRun),
          items: [
            {
              ...structuredClone(serverRun.items[0]),
              percentOfMonthWorked: items[0].percentOfMonthWorked,
              overtimeHours: items[0].overtimeHours,
            },
          ],
        }
        return replaceDeferred.promise
      },
    )

    renderWithQueryClient()

    fireEvent.click(await screen.findByRole('button', { name: /edit/i }))

    const [percentInput, overtimeInput] = screen.getAllByRole('spinbutton')
    const reasonInput = screen.getByPlaceholderText('Reason for changes (min 3 chars)...')
    const saveButton = screen.getByRole('button', { name: /Save Draft/i })
    const approveButton = screen.getByRole('button', { name: /Approve Payroll Run/i })
    const deferButton = screen.getByRole('button', { name: /Defer from run/i })
    const removeBonusButton = screen.getByRole('button', { name: /Remove Site Allowance/i })

    fireEvent.change(percentInput, { target: { value: '90' } })
    fireEvent.change(reasonInput, { target: { value: 'First save' } })
    expect(approveButton).toBeDisabled()
    expect(saveButton).toBeEnabled()

    // Click Save Draft twice rapidly while pending
    fireEvent.click(saveButton)
    fireEvent.click(saveButton)
    fireEvent.click(approveButton)

    await waitFor(() => {
      expect(replaceSpy).toHaveBeenCalledTimes(1)
    })

    // Editing, deferring, line-item removal, save, and approve must remain disabled while saving
    expect(percentInput).toBeDisabled()
    expect(overtimeInput).toBeDisabled()
    expect(reasonInput).toBeDisabled()
    expect(deferButton).toBeDisabled()
    expect(removeBonusButton).toBeDisabled()
    expect(saveButton).toBeDisabled()
    expect(approveButton).toBeDisabled()
    expect(screen.queryByRole('heading', { name: /Approve & Lock Payroll Run/i })).not.toBeInTheDocument()

    // Resolve the save mutation; delayed post-save refetch is still pending
    await act(async () => {
      replaceDeferred.resolve()
      await Promise.resolve()
    })

    // Still locked and still showing 90 (never flashes stale cached 100) while refetch is pending
    expect(percentInput).toHaveValue(90)
    expect(percentInput).toBeDisabled()
    expect(approveButton).toBeDisabled()
    expect(saveButton).toBeDisabled()

    // Resolve fresh server refresh with confirmed 90
    await act(async () => {
      refetchDeferred.resolve(structuredClone(serverRun))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(percentInput).toBeEnabled()
      expect(approveButton).toBeEnabled()
    })
    expect(percentInput).toHaveValue(90)
    expect(saveButton).toBeDisabled()
    expect(screen.getByText('Auto-calculated')).toBeInTheDocument()
  })

  it('surfaces post-save refetch failures clearly, keeps submitted display, blocks approval, and recovers on retry', async () => {
    let serverRun = createBaseRun()
    let getCount = 0

    vi.spyOn(payrollApi, 'get').mockImplementation(() => {
      getCount += 1
      if (getCount === 1) return Promise.resolve(structuredClone(serverRun))
      if (getCount === 2) return Promise.reject(new Error('Network timeout during refresh'))
      return Promise.resolve(structuredClone(serverRun))
    })

    vi.spyOn(payrollApi, 'replace').mockImplementation(
      (_id: string, items: PayrollDraftItem[]) => {
        serverRun = {
          ...structuredClone(serverRun),
          items: [
            {
              ...structuredClone(serverRun.items[0]),
              percentOfMonthWorked: items[0].percentOfMonthWorked,
            },
          ],
        }
        return Promise.resolve()
      },
    )

    renderWithQueryClient()

    fireEvent.click(await screen.findByRole('button', { name: /edit/i }))

    const [percentInput] = screen.getAllByRole('spinbutton')
    const reasonInput = screen.getByPlaceholderText('Reason for changes (min 3 chars)...')
    const saveButton = screen.getByRole('button', { name: /Save Draft/i })
    const approveButton = screen.getByRole('button', { name: /Approve Payroll Run/i })

    fireEvent.change(percentInput, { target: { value: '90' } })
    fireEvent.change(reasonInput, { target: { value: 'Prorate attendance' } })
    fireEvent.click(saveButton)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/saved on the server.*Network timeout during refresh/i)
    // Must not silently fall back to cached 100 or claim clean state
    expect(percentInput).toHaveValue(90)
    expect(percentInput).toBeDisabled()
    expect(approveButton).toBeDisabled()
    expect(saveButton).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /Retry Refresh/i }))

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(approveButton).toBeEnabled()
    })
    expect(percentInput).toHaveValue(90)
    expect(percentInput).toBeEnabled()
    expect(saveButton).toBeDisabled()
  })
})
