import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resetProtectedSessionRegistryForTest, type IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import { CashAccountabilityPanel } from './CashAccountabilityPanel'

const { from, rpc, storageFrom, upload, remove, createSignedUrl } = vi.hoisted(() => ({
  from: vi.fn(), rpc: vi.fn(), storageFrom: vi.fn(), upload: vi.fn(), remove: vi.fn(), createSignedUrl: vi.fn(),
}))
vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: () => ({ from, rpc, storage: { from: storageFrom } }),
}))

const recipientId = '91000000-0000-4000-8000-000000000001'
const managerId = '91000000-0000-4000-8000-000000000002'
const advanceId = '91000000-0000-4000-8000-000000000010'
const receiptId = '91000000-0000-4000-8000-000000000020'
const expenseId = '91000000-0000-4000-8000-000000000030'
const receiptPath = recipientId + '/cash-receipts/' + advanceId + '/' + receiptId + '.pdf'
const expense = {
  id: expenseId,
  cash_advance_id: advanceId,
  expense_date: '2026-11-18',
  category: 'transport',
  amount: 50000,
  vendor: 'Site transport',
  explanation: 'Delivery of site supplies',
  receipt_url: receiptPath,
  receipt_unavailable: false,
  receipt_unavailable_explanation: null,
  status: 'pending_review',
  rejection_reason: null,
  reversal_reason: null,
}

let expenses: unknown[]

function mount({ actor = recipientId, canManage = false, status = 'disbursed' } = {}) {
  const scope: IdentityScopeRef = {
    identityKey: actor, authEpoch: 1, isAuthReady: true,
    latestRef: { current: { identityKey: actor, authEpoch: 1, isAuthReady: true } },
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}>
    <CashAccountabilityPanel advanceId={advanceId} recipientId={recipientId} status={status} canManage={canManage} scope={scope} />
  </QueryClientProvider>)
}

function attachPdf(text: string) {
  const bytes = new TextEncoder().encode(text)
  const file = new File([bytes], 'receipt.pdf', { type: 'application/pdf' })
  Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(bytes.buffer) })
  fireEvent.change(screen.getByLabelText('Receipt document'), { target: { files: [file] } })
}

function enterExpense() {
  fireEvent.click(screen.getByRole('button', { name: 'Add expense' }))
  fireEvent.change(screen.getByLabelText('Expense date'), { target: { value: '2026-11-18' } })
  fireEvent.change(screen.getByLabelText('Amount (UGX)'), { target: { value: '50000' } })
  fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'Site transport' } })
  fireEvent.change(screen.getByLabelText('Expense explanation'), { target: { value: 'Delivery of site supplies' } })
}

describe('Project cash accountability', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.restoreAllMocks()
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    resetProtectedSessionRegistryForTest()
    expenses = []
    from.mockImplementation((table: string) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: () => Promise.resolve({ data: table === 'cash_advance_expenses' ? expenses : [], error: null }),
    }))
    storageFrom.mockReturnValue({ upload, remove, createSignedUrl })
    upload.mockResolvedValue({ data: { path: receiptPath }, error: null })
    remove.mockResolvedValue({ data: [], error: null })
    rpc.mockResolvedValue({ data: expenseId, error: null, status: 200 })
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(receiptId)
  })

  it('rejects a fake PDF inside the expense dialog before uploading or submitting', async () => {
    mount()
    enterExpense()
    attachPdf('This is not a PDF')
    fireEvent.click(screen.getByRole('button', { name: 'Submit expense' }))

    const dialog = screen.getByRole('dialog')
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Choose a valid PDF, JPG, PNG or WebP receipt up to 10 MB.')
    expect(upload).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('uploads a private PDF and records the resulting receipt path with the expense', async () => {
    mount()
    enterExpense()
    attachPdf('%PDF-1.7')
    fireEvent.click(screen.getByRole('button', { name: 'Submit expense' }))

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('rpc_submit_cash_expense', {
      p_advance_id: advanceId, p_date: '2026-11-18', p_category: 'transport', p_amount: 50000,
      p_vendor: 'Site transport', p_explanation: 'Delivery of site supplies', p_receipt_url: receiptPath,
      p_receipt_unavailable: false, p_receipt_unavailable_explanation: null,
    }))
    expect(storageFrom).toHaveBeenCalledWith('private-files')
    expect(upload).toHaveBeenCalledWith(receiptPath, expect.any(File), { contentType: 'application/pdf', upsert: false })
    expect(await screen.findByText('Expense submitted for review.')).toBeInTheDocument()
  })

  it('records a receipt exception without uploading a file', async () => {
    mount()
    enterExpense()
    fireEvent.click(screen.getByLabelText('Receipt unavailable'))
    fireEvent.change(screen.getByLabelText('Why the receipt is unavailable'), { target: { value: 'The vendor did not issue one.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit expense' }))

    expect(await screen.findByText('Expense submitted for review.')).toBeInTheDocument()
    expect(upload).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledWith('rpc_submit_cash_expense', expect.objectContaining({
      p_receipt_unavailable: true, p_receipt_unavailable_explanation: 'The vendor did not issue one.', p_receipt_url: null,
    }))
  })

  it('preserves the private receipt and blocks another submission when the ledger result is unknown', async () => {
    rpc.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    mount()
    enterExpense()
    attachPdf('%PDF-1.7')
    fireEvent.click(screen.getByRole('button', { name: 'Submit expense' }))

    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('The ledger change could not be confirmed.')
    expect(screen.getByRole('button', { name: 'Submit expense' })).toBeDisabled()
    expect(remove).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('allows finance to reject a pending expense with a reason and record a returned cash reference', async () => {
    expenses = [expense]
    mount({ canManage: true, actor: managerId })
    fireEvent.click(await screen.findByRole('button', { name: 'Reject expense for Site transport' }))
    fireEvent.change(screen.getByLabelText('Rejection reason'), { target: { value: 'Description mismatch' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reject expense' }))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('rpc_review_cash_expense', {
      p_expense_id: expenseId, p_accept: false, p_rejection_reason: 'Description mismatch',
    }))
    expect(await screen.findByText('Expense rejected.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Record cash return' }))
    fireEvent.change(screen.getByLabelText('Return date'), { target: { value: '2026-11-19' } })
    fireEvent.change(screen.getByLabelText('Amount (UGX)'), { target: { value: '120000' } })
    fireEvent.change(screen.getByLabelText('Receipt reference'), { target: { value: 'RETURN-007' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Record return' }))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('rpc_return_cash', {
      p_advance_id: advanceId, p_date: '2026-11-19', p_amount: 120000, p_reference: 'RETURN-007', p_notes: null,
    }))
  })

  it('keeps a completed advance read-only even for its recipient and finance', async () => {
    expenses = [{ ...expense, status: 'accepted' }]
    mount({ canManage: true, status: 'completed' })
    expect(await screen.findByText('Site transport')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add expense' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Record cash return' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Reject expense/ })).toBeNull()
  })

  it('only opens a short-lived signed receipt URL on the configured storage origin', async () => {
    expenses = [expense]
    const signedUrl = 'https://example.supabase.co/storage/v1/object/sign/private-files/receipt.pdf?token=test'
    createSignedUrl.mockResolvedValue({ data: { signedUrl }, error: null })
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    mount({ status: 'completed' })
    fireEvent.click(await screen.findByRole('button', { name: 'Open receipt for Site transport' }))
    await waitFor(() => expect(open).toHaveBeenCalledWith(signedUrl, '_blank', 'noopener,noreferrer'))
    expect(createSignedUrl).toHaveBeenCalledWith(receiptPath, 60)
  })

  it('does not sign a receipt path from a different advance', async () => {
    expenses = [{ ...expense, receipt_url: receiptPath.replace(advanceId, expenseId) }]
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Open receipt for Site transport' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The private receipt could not be opened.')
    expect(createSignedUrl).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })

})
