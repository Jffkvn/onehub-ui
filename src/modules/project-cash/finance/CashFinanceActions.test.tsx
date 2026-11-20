import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import { resetProtectedSessionRegistryForTest, type IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import { CashFinanceActions } from './CashFinanceActions'

const advanceId = '8ca102db-e7a3-403d-9f88-a8a3565fbead'
const recipientId = '738c0c84-228f-48a5-b607-0bc035dd4366'
const managerId = '4e3a98da-0d22-4d48-b42c-92e0811261f6'
const amountRequested = 500000

const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => ({ rpc, from }) }))

let currentStatus: string
let outstanding: boolean | null
let balance: string | null
let pendingCount: number | null
let failingRpc: string

function renderActions(status = 'pending_approval') {
  currentStatus = status
  const latest = { identityKey: managerId, authEpoch: 2, isAuthReady: true }
  const scope: IdentityScopeRef = { ...latest, latestRef: { current: latest } }
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <CashFinanceActions scope={scope} status={status} advanceId={advanceId}
      recipientId={recipientId} amountRequested={amountRequested} />
  </QueryClientProvider>)
}

function open(action: string) {
  fireEvent.click(screen.getByRole('button', { name: action }))
  return within(screen.getByRole('dialog'))
}

beforeEach(() => {
  resetProtectedSessionRegistryForTest()
  outstanding = false
  balance = '0.00'
  pendingCount = 0
  failingRpc = ''
  rpc.mockImplementation((name: string) => {
    if (name === failingRpc) return Promise.resolve({ data: null, status: 503, error: { code: 'PGRST000' } })
    const data = name === 'has_outstanding_advances' ? outstanding
      : name === 'get_cash_advance_balance' ? balance
      : name === 'rpc_list_cash_advances'
        ? [{ id: advanceId, user_id: recipientId, amount_requested: amountRequested, status: currentStatus }]
        : null
    return Promise.resolve({ data, status: 200, error: null })
  })
  from.mockImplementation(() => {
    const result = Promise.resolve({ data: null, count: pendingCount, error: null })
    const builder = { select: () => builder, eq: () => builder, then: result.then.bind(result) }
    return builder
  })
  vi.clearAllMocks()
})

it('requires an explicit override reason when the recipient has an outstanding advance', async () => {
  outstanding = true
  renderActions()
  const dialog = open('Approve request')
  await dialog.findByText('This recipient has an outstanding cash advance.')
  const confirm = dialog.getByRole('button', { name: 'Confirm approval' })
  expect(confirm).toBeDisabled()
  fireEvent.change(dialog.getByLabelText('Override reason'), { target: { value: '  Emergency tower work  ' } })
  fireEvent.click(confirm)
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('rpc_approve_cash_advance', {
    p_advance_id: advanceId, p_override_reason: 'Emergency tower work',
  }))
})

it('blocks approval when the outstanding check fails or has no result', async () => {
  outstanding = null
  renderActions()
  const dialog = open('Approve request')
  await dialog.findByText('Could not verify outstanding advances for the recipient.')
  expect(dialog.getByRole('button', { name: 'Confirm approval' })).toBeDisabled()
  expect(rpc).not.toHaveBeenCalledWith('rpc_approve_cash_advance', expect.anything())
})

it('stops a stale approval if another advance opens before confirmation', async () => {
  renderActions()
  const dialog = open('Approve request')
  await dialog.findByText('The recipient has no outstanding cash advances.')
  outstanding = true
  fireEvent.click(dialog.getByRole('button', { name: 'Confirm approval' }))
  expect(await dialog.findByRole('alert')).toHaveTextContent(/enter an override reason/i)
  expect(rpc).not.toHaveBeenCalledWith('rpc_approve_cash_advance', expect.anything())
})

it('requires rejection confirmation and sends the canonical no-reason payload', async () => {
  renderActions()
  const dialog = open('Reject request')
  expect(rpc).not.toHaveBeenCalled()
  fireEvent.click(dialog.getByRole('button', { name: 'Confirm rejection' }))
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('rpc_reject_cash_advance', { p_advance_id: advanceId }))
})

it('blocks a disbursement above the request amount and records a valid amount and reference', async () => {
  renderActions('approved')
  const dialog = open('Record disbursement')
  const amount = dialog.getByLabelText('Amount disbursed (UGX)')
  const confirm = dialog.getByRole('button', { name: 'Confirm disbursement' })
  fireEvent.change(dialog.getByLabelText('Payment reference'), { target: { value: '  EFT-1402  ' } })
  fireEvent.change(amount, { target: { value: '500000.01' } })
  expect(confirm).toBeDisabled()
  fireEvent.change(amount, { target: { value: '200000.50' } })
  fireEvent.click(confirm)
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('rpc_disburse_cash_advance', {
    p_advance_id: advanceId, p_amount: 200000.5, p_reference: 'EFT-1402',
  }))
})

it('withholds closure while the journal has pending reviews even when the balance is zero', async () => {
  pendingCount = 1
  renderActions('disbursed')
  const dialog = open('Close advance')
  await dialog.findByText('1 expense is awaiting review.')
  expect(dialog.getByRole('button', { name: 'Confirm closure' })).toBeDisabled()
  expect(rpc).not.toHaveBeenCalledWith('rpc_close_cash_advance', expect.anything())
})

it('keeps closure blocked on a missing balance', async () => {
  balance = null
  renderActions('disbursed')
  const dialog = open('Close advance')
  await dialog.findByText('Could not verify the ledger balance and pending expenses.')
  expect(dialog.getByRole('button', { name: 'Confirm closure' })).toBeDisabled()
})

it('closes a fully reconciled, current advance', async () => {
  renderActions('disbursed')
  const dialog = open('Close advance')
  await dialog.findByText('All submitted expenses have been reviewed.')
  fireEvent.click(dialog.getByRole('button', { name: 'Confirm closure' }))
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('rpc_close_cash_advance', { p_advance_id: advanceId }))
})

it('rechecks ledger reconciliation before a closure write', async () => {
  renderActions('disbursed')
  const dialog = open('Close advance')
  await dialog.findByText('All submitted expenses have been reviewed.')
  balance = '25.00'
  fireEvent.click(dialog.getByRole('button', { name: 'Confirm closure' }))
  expect(await dialog.findByRole('alert')).toHaveTextContent(/resolve the balance/i)
  expect(rpc).not.toHaveBeenCalledWith('rpc_close_cash_advance', expect.anything())
})

it('stops when the request changed status after the page was loaded', async () => {
  renderActions('approved')
  const dialog = open('Record disbursement')
  fireEvent.change(dialog.getByLabelText('Payment reference'), { target: { value: 'EFT-1402' } })
  currentStatus = 'disbursed'
  fireEvent.click(dialog.getByRole('button', { name: 'Confirm disbursement' }))
  expect(await dialog.findByRole('alert')).toHaveTextContent('This advance changed')
  expect(rpc).not.toHaveBeenCalledWith('rpc_disburse_cash_advance', expect.anything())
})

it('prevents retries within the view after an unconfirmed disbursement', async () => {
  renderActions('approved')
  const dialog = open('Record disbursement')
  fireEvent.change(dialog.getByLabelText('Payment reference'), { target: { value: 'EFT-1402' } })
  failingRpc = 'rpc_disburse_cash_advance'
  fireEvent.click(dialog.getByRole('button', { name: 'Confirm disbursement' }))
  expect(await dialog.findByRole('alert')).toHaveTextContent('could not confirm')
  expect(dialog.getByRole('button', { name: 'Confirm disbursement' })).toBeDisabled()
  fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByRole('button', { name: 'Record disbursement' })).toBeDisabled()
  expect(rpc.mock.calls.filter(([name]) => name === 'rpc_disburse_cash_advance')).toHaveLength(1)
})

it('renders no mutation controls once an advance has been completed', () => {
  renderActions('completed')
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  expect(rpc).not.toHaveBeenCalled()
})
