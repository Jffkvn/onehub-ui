import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/ui/Toast'
import ReimbursementsPage from './ReimbursementsPage'

const { rpc } = vi.hoisted(() => ({
  rpc: vi.fn(),
}))

let currentPermissions: string[] = []

vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuth: () => ({
    status: 'authenticated',
    session: { userId: 'u-1', email: 'staff@example.com' },
    access: {
      profile: { id: 'u-1', displayName: 'Staff User', status: 'active' },
      roleKeys: [],
      permissionKeys: currentPermissions,
    },
    authEpoch: 1,
    devPreviewRole: null,
  }),
  useHasPermission: (key: string) => currentPermissions.includes(key),
}))

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: () => ({
    rpc,
    storage: {
      from: () => ({
        upload: vi.fn(),
        remove: vi.fn(),
        createSignedUrl: vi.fn().mockResolvedValue({
          data: { signedUrl: 'https://example.supabase.co/storage/v1/object/sign/reimbursement-receipts/x' },
          error: null,
        }),
      }),
    },
  }),
}))

function renderReimbursements(manage = false, initialEntry = '/') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <ReimbursementsPage manage={manage} />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

const ownPendingClaim = {
  id: 'c1000000-0000-4000-8000-000000000001',
  employee_id: 'e1000000-0000-4000-8000-000000000001',
  employee_number: 'EMP-01',
  employee_name: 'CFO Claimant',
  is_own_claim: true,
  can_self_handle: true,
  category: 'travel' as const,
  amount: 45000,
  currency_code: 'UGX' as const,
  spent_on: '2026-11-10',
  description: 'Client visit taxi fare',
  status: 'pending' as const,
  reviewed_by: null,
  reviewed_by_name: null,
  reviewed_at: null,
  review_note: null,
  paid_by: null,
  paid_by_name: null,
  paid_at: null,
  payment_method: null,
  payment_reference: null,
  created_at: '2026-11-11T10:00:00Z',
  version: 1,
  receipts: [],
  events: [],
}

describe('ReimbursementsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('handles unlinked self-service state and lets employees submit and withdraw claims', async () => {
    currentPermissions = ['reimbursements.read_self']
    rpc.mockResolvedValueOnce({
      data: { linked: false, summary: null, items: [] },
      error: null,
    })

    const unlinkedRender = renderReimbursements(false)
    expect(await screen.findByText(/employee dossier not linked/i)).toBeInTheDocument()
    unlinkedRender.unmount()

    rpc.mockImplementation((fn: string) => {
      if (fn === 'rpc_list_reimbursement_claims') {
        return Promise.resolve({
          data: { linked: true, summary: null, items: [ownPendingClaim] },
          error: null,
        })
      }
      if (fn === 'rpc_submit_reimbursement_claim') {
        return Promise.resolve({ data: 'c1000000-0000-4000-8000-000000000099', error: null })
      }
      if (fn === 'rpc_withdraw_reimbursement_claim') {
        return Promise.resolve({ data: null, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    })

    renderReimbursements(false)
    expect(await screen.findByText(/client visit taxi fare/i)).toBeInTheDocument()
    expect(screen.getByText(/strictly separate from project cash/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^submit claim$/i }))
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '55000' } })
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: 'Site bus ticket' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: /^submit claim$/i }).at(-1)!)

    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith(
        'rpc_submit_reimbursement_claim',
        expect.objectContaining({
          p_amount: 55000,
          p_description: 'Site bus ticket',
        }),
      )
    })
  })

  it('enforces executive self-review & self-payment note, blocks non-exec own claims, supports ?claim=, and keeps read_all read-only', async () => {
    const approvedOwnExecClaim = {
      ...ownPendingClaim,
      id: 'c1000000-0000-4000-8000-000000000002',
      employee_name: 'CFO Approved Own',
      status: 'approved' as const,
      is_own_claim: true,
      can_self_handle: true,
    }
    const blockedNonExecPending = {
      ...ownPendingClaim,
      id: 'c1000000-0000-4000-8000-000000000003',
      employee_name: 'Admin Own Pending',
      status: 'pending' as const,
      is_own_claim: true,
      can_self_handle: false,
    }
    const blockedNonExecApproved = {
      ...ownPendingClaim,
      id: 'c1000000-0000-4000-8000-000000000004',
      employee_name: 'Admin Own Approved',
      status: 'approved' as const,
      is_own_claim: true,
      can_self_handle: false,
    }
    const queueData = {
      linked: true,
      summary: {
        pendingCount: 2,
        pendingAmountUgx: 90000,
        approvedUnpaidCount: 2,
        approvedUnpaidAmountUgx: 90000,
        needsInfoCount: 0,
        paidThisYearUgx: 0,
        paidCountThisYear: 0,
      },
      items: [ownPendingClaim, approvedOwnExecClaim],
    }

    currentPermissions = ['reimbursements.read_all']
    rpc.mockResolvedValueOnce({ data: queueData, error: null })
    const mdRender = renderReimbursements(true)

    expect(await screen.findByText('CFO Claimant')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^mark paid$/i })).not.toBeInTheDocument()
    mdRender.unmount()

    currentPermissions = ['reimbursements.read_all', 'reimbursements.review', 'reimbursements.pay']
    rpc.mockImplementation((fn: string) => {
      if (fn === 'rpc_list_reimbursement_claims') {
        return Promise.resolve({ data: queueData, error: null })
      }
      if (fn === 'rpc_decide_reimbursement_claim') {
        return Promise.resolve({ data: 2, error: null })
      }
      if (fn === 'rpc_mark_reimbursement_paid') {
        return Promise.resolve({ data: 3, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    })

    const execRender = renderReimbursements(true, `/finance/reimbursements?claim=${ownPendingClaim.id}`)
    expect(await screen.findByText(/your claim/i)).toBeInTheDocument()
    const closeButtons = screen.getAllByRole('button', { name: /^close$/i })
    if (closeButtons[0]) fireEvent.click(closeButtons[0])

    // Executive self-approval requires note
    fireEvent.click(screen.getByRole('button', { name: /^approve$/i }))
    expect(screen.getByText(/executive self-review note required/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /confirm approval/i }))
    expect(await screen.findByText(/own-claim review requires an explanatory note/i)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/review note/i), {
      target: { value: 'Sole finance reviewer authorized' },
    })
    fireEvent.click(screen.getByRole('button', { name: /confirm approval/i }))

    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith('rpc_decide_reimbursement_claim', {
        p_claim_id: ownPendingClaim.id,
        p_expected_version: 1,
        p_decision: 'approved',
        p_note: 'Sole finance reviewer authorized',
      })
    })

    // Executive self-payment requires self-payment note
    fireEvent.click(screen.getByRole('button', { name: /^mark paid$/i }))
    expect(screen.getByText(/executive self-payment note required/i)).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: /^mark paid$/i }).at(-1)!)
    expect(await screen.findByText(/recording payment on your own claim requires a note/i)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/self-payment note/i), {
      target: { value: 'EFT voucher PV-992 settled by CFO' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: /^mark paid$/i }).at(-1)!)

    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith(
        'rpc_mark_reimbursement_paid',
        expect.objectContaining({
          p_claim_id: approvedOwnExecClaim.id,
          p_self_payment_note: 'EFT voucher PV-992 settled by CFO',
        }),
      )
    })
    execRender.unmount()

    // Non-executive reviewer/payer is blocked from approving or paying own claim
    rpc.mockResolvedValueOnce({
      data: {
        ...queueData,
        items: [blockedNonExecPending, blockedNonExecApproved],
      },
      error: null,
    })
    renderReimbursements(true)
    expect(await screen.findByText('Separate reviewer required')).toBeInTheDocument()
    expect(screen.getByText('Separate payer required')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^mark paid$/i })).not.toBeInTheDocument()
  })
})
