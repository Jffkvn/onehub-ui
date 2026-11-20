import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resetProtectedSessionRegistryForTest } from '@/lib/idempotency/pendingOperations'
import StaffAdvancesPage from './StaffAdvancesPage'
import type { StaffAdvance } from './api'

const rpc = vi.fn<(name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>>()
const actor = '91000000-0000-4000-8000-000000000001'
const advanceId = '92000000-0000-4000-8000-000000000001'
vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuth: () => ({ status: 'authenticated', session: { userId: actor }, authEpoch: 1 }),
}))
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => ({ rpc }) }))

function record(status: StaffAdvance['status']): StaffAdvance {
  return {
    id: advanceId,
    employee_id: '93000000-0000-4000-8000-000000000001',
    employee_name: 'Engineer A',
    employee_number: 'EMP-012',
    amount: 600000,
    reason: 'School fees',
    date_issued: '2026-11-18',
    deduction_start_month: '2026-12-01',
    num_instalments: 3,
    monthly_deduction: 200000,
    balance_remaining: 600000,
    status,
    notes: null,
  }
}

function openPage(path: string, manage = false) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[path]}><StaffAdvancesPage manage={manage} /></MemoryRouter>
  </QueryClientProvider>)
}

describe('Staff advances workspace', () => {
  beforeEach(() => {
    resetProtectedSessionRegistryForTest()
    sessionStorage.clear()
    rpc.mockReset()
  })

  it('opens only advances from the authorized employee list', async () => {
    rpc.mockResolvedValue({ data: [record('pending')], error: null })
    openPage('/my/advances?advance=92000000-0000-4000-8000-000000000002')
    expect(await screen.findByText('This advance is unavailable.')).toBeInTheDocument()
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['rpc_list_my_staff_advances'])
  })

  it('submits a request and opens its employee history from the confirmed result', async () => {
    let requested = false
    rpc.mockImplementation((name, args) => {
      if (name === 'rpc_execute_staff_advance') {
        requested = true
        return Promise.resolve({ data: { request_id: args?.p_request_id, result_id: advanceId }, error: null })
      }
      const data = name === 'rpc_list_my_staff_advances' && requested ? [record('pending')] : []
      return Promise.resolve({ data, error: null })
    })
    openPage('/my/advances')
    fireEvent.click(await screen.findByRole('button', { name: 'Request advance' }))
    fireEvent.change(screen.getByLabelText('Amount (UGX)'), { target: { value: '600000' } })
    fireEvent.change(screen.getByLabelText('Instalments'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('First deduction month'), { target: { value: '2026-12' } })
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'School fees' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }))
    expect(await screen.findByRole('heading', { name: 'Advance details' })).toBeInTheDocument()
    expect(screen.getByText('Awaiting review')).toBeInTheDocument()
    const request = rpc.mock.calls.find(([name]) => name === 'rpc_execute_staff_advance')?.[1]
    expect(typeof request?.p_request_id).toBe('string')
    expect(request).toMatchObject({
      p_action: 'submit',
      p_payload: { amount: 600000, reason: 'School fees', instalments: 3, deduction_start: '2026-12-01' },
    })
    expect(rpc).toHaveBeenCalledWith('rpc_list_staff_advance_events', { p_advance_id: advanceId })
  })

  it('retries an unconfirmed manual repayment using the exact saved request', async () => {
    let calls = 0
    rpc.mockImplementation((name, args) => {
      if (name === 'rpc_execute_staff_advance') {
        calls += 1
        return Promise.resolve({
          data: calls === 1 ? null : { request_id: args?.p_request_id, result_id: advanceId },
          error: null,
        })
      }
      return Promise.resolve({
        data: name === 'rpc_list_hr_staff_advances'
          ? [{ ...record('active'), balance_remaining: calls >= 1 ? 500000 : 600000 }]
          : [],
        error: null,
      })
    })
    openPage('/finance/advances?advance=' + advanceId, true)
    fireEvent.change(await screen.findByLabelText('Action'), { target: { value: 'repay' } })
    fireEvent.change(screen.getByLabelText('Repayment amount (UGX)'), { target: { value: '100000' } })
    fireEvent.change(screen.getByLabelText('Repayment month'), { target: { value: '2026-12' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record repayment' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Retry saved action' }))
    expect(await screen.findByText('Repayment recorded.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('UGX 500,000')).toBeInTheDocument())
    const commands = rpc.mock.calls.filter(([name]) => name === 'rpc_execute_staff_advance')
    expect(commands).toHaveLength(2)
    expect(commands[0]).toEqual(commands[1])
    expect(commands[0][1]).toMatchObject({
      p_action: 'repay',
      p_payload: { advance_id: advanceId, amount: 100000, period: '2026-12-01', source: 'manual' },
    })
  })
})
