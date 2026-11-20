import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resetProtectedSessionRegistryForTest } from '@/lib/idempotency/pendingOperations'
import MyPayslipsPage from './MyPayslipsPage'

const rpc = vi.fn()
const downloadPdf = vi.fn()
const actor = '91000000-0000-4000-8000-000000000001'
vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuth: () => ({ status: 'authenticated', session: { userId: actor }, authEpoch: 1 }),
}))
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => ({ rpc }) }))
vi.mock('@/modules/payroll/exports/payslip', () => ({
  downloadPayslip: (...args: unknown[]) => downloadPdf(...args) as unknown,
}))

const items = [{ id: 'item-1', employee_name: 'Engineer A', paye: 38250, salary_advance_deduction: 200000, net_pay: 361750 }]
const payload = {
  id: 'run-1',
  status: 'approved',
  run_type: 'regular',
  run_number: 1,
  payroll_periods: { period_start: '2026-07-01', label: 'July 2026' },
  payroll_items: items,
}

function openMyPay() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MyPayslipsPage />
  </QueryClientProvider>)
}

describe('My Pay', () => {
  beforeEach(() => {
    resetProtectedSessionRegistryForTest()
    rpc.mockReset()
    downloadPdf.mockReset()
  })

  it('shows one approved snapshot and audits download with the saved PAYE and net amounts', async () => {
    rpc.mockImplementation((name: string) => Promise.resolve({
      error: null,
      data: name === 'get_my_payslips'
        ? [
          { payload },
          { payload: { ...payload, id: 'draft', status: 'draft', payroll_periods: { label: 'Draft month' } } },
          { payload: { ...payload, id: 'shared', payroll_items: [...items, ...items], payroll_periods: { label: 'Shared run' } } },
        ]
        : null,
    }))
    openMyPay()
    fireEvent.click(await screen.findByRole('button', { name: 'Download PDF for July 2026 run 1' }))
    expect(screen.queryByText('Draft month')).not.toBeInTheDocument()
    expect(screen.queryByText('Shared run')).not.toBeInTheDocument()
    expect(screen.getByText('Net pay · UGX 361,750')).toBeInTheDocument()
    await waitFor(() => expect(downloadPdf).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'run-1' }),
      expect.objectContaining({ id: 'item-1', paye: 38250, salaryAdvanceDeduction: 200000, netPay: 361750 }),
      expect.any(Function),
    ))
    expect(rpc).toHaveBeenCalledWith('record_payroll_export', {
      target_run_id: 'run-1', target_item_id: 'item-1', export_kind: 'payslip',
    })
  })

  it('holds the download when the audit RPC rejects access', async () => {
    rpc.mockImplementation((name: string) => Promise.resolve(name === 'get_my_payslips'
      ? { data: [{ payload }], error: null }
      : { data: null, error: { code: '42501', message: 'permission denied' } }))
    openMyPay()
    fireEvent.click(await screen.findByRole('button', { name: /Download PDF/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The payslip could not download')
    expect(downloadPdf).not.toHaveBeenCalled()
  })
})
