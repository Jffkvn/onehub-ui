import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LeavePage from './LeavePage'
import { leavePendingStore, type LeaveRequest } from '../api/leave'
import { resetProtectedSessionRegistryForTest } from '@/lib/idempotency/pendingOperations'

const rpc = vi.fn<
  (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
>()
const upload = vi.fn<(...args: unknown[]) => Promise<{ error: unknown }>>()
const useAuth = vi.fn()
vi.mock('@/modules/auth/AuthProvider', () => ({ useAuth: () => useAuth() as unknown }))
vi.mock(
  '@/lib/supabase/client',
  () => ({ getSupabaseClient: () => ({ rpc, storage: { from: () => ({ upload }) } }) }),
)
const actor = '85000000-0000-4000-8000-000000000001'
const employee = '86000000-0000-4000-8000-000000000001'
const typeId = '86000000-0000-4000-8000-000000000002'
const requestId = '87000000-0000-4000-8000-000000000001'
const documentId = '87000000-0000-4000-8000-000000000002'
let requests: LeaveRequest[]
let documents: {
  id: string
  storage_path: string
  original_file_name: string
  mime_type: string
  size_bytes: number
  created_at: string
}[]
let requiresEvidence: boolean
function baseRequest(): LeaveRequest {
  return {
    id: requestId,
    employee_id: employee,
    employee_name: 'Amina Engineer',
    leave_type_id: typeId,
    leave_type_name: 'Annual leave',
    leave_type_code: 'annual',
    requires_evidence: false,
    start_date: '2026-12-21',
    end_date: '2026-12-21',
    day_portion: 'morning',
    total_days: 0.5,
    requested_minutes: null,
    scheduled_minutes: null,
    exact_start_at: null,
    exact_end_at: null,
    reason: 'Family appointment',
    status: 'pending',
    source: 'employee',
    created_at: '2026-11-17T08:00:00Z',
    allocations: [{ leave_date: '2026-12-21', days: 0.5 }],
  }
}
function workspace(manage: boolean) {
  return {
    employee_id: manage ? null : employee,
    gender: 'female',
    year: 2026,
    employees: manage ? [{ id: employee, name: 'Amina Engineer', gender: 'female' }] : [],
    types: [{
      id: typeId,
      code: 'annual',
      name: 'Annual leave',
      is_paid: true,
      requires_evidence: requiresEvidence,
      default_entitlement_days: 21,
    }],
    request_total: requests.length,
    summary: {
      pending: requests.filter((r) => r.status === 'pending').length,
      approved: 0,
      on_leave_today: 0,
      total: requests.length,
    },
    requests,
    balances: manage ? [] : [{
      leave_type_id: typeId,
      name: 'Annual leave',
      code: 'annual',
      entitled_days: 21,
      adjustment_days: 2,
      used_days: 1,
      pending_days: 0.5,
      available_days: 21.5,
    }],
    holidays: [],
  }
}
function show(manage = false, path = '/my/leave') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <LeavePage manage={manage} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
beforeEach(() => {
  cleanup()
  resetProtectedSessionRegistryForTest()
  sessionStorage.clear()
  vi.clearAllMocks()
  useAuth.mockReturnValue({
    status: 'authenticated',
    authEpoch: 1,
    session: { userId: actor },
    access: { profile: { id: actor } },
  })
  requests = [baseRequest()]
  documents = []
  requiresEvidence = false
  upload.mockResolvedValue({ error: null })
  rpc.mockImplementation((name, args) => {
    if (name === 'rpc_leave_workspace') {
      return Promise.resolve({ data: workspace(args.p_manage === true), error: null })
    }
    if (name === 'rpc_leave_detail') {
      return Promise.resolve({
        data: {
          documents,
          events: [{
            id: documentId,
            event_type: 'submitted',
            actor_name: 'Amina Engineer',
            occurred_at: '2026-11-17T08:00:00Z',
            reason: 'Family appointment',
          }],
        },
        error: null,
      })
    }
    if (name === 'rpc_leave_preview') {
      return Promise.resolve({
        data: {
          allocations: [{
            leave_date: args.p_start_date,
            days: args.p_day_portion === 'exact' ? 0.25 : args.p_day_portion === 'full' ? 1 : 0.5,
          }],
          schedule: {
            is_workday: true,
            timezone: 'Africa/Kampala',
            start_at: '2026-12-21T05:00:00Z',
            end_at: '2026-12-21T13:00:00Z',
            local_end: '16:00:00',
            scheduled_minutes: 480,
          },
        },
        error: null,
      })
    }
    const payload = args.p_payload as Record<string, unknown>
    if (args.p_action === 'withdraw') {
      requests = requests.map((r) => ({ ...r, status: 'withdrawn' }))
    }
    if (args.p_action === 'approve') requests = requests.map((r) => ({ ...r, status: 'approved' }))
    if (args.p_action === 'attach') {
      documents = [{
        id: documentId,
        storage_path: String(payload.storage_path),
        original_file_name: String(payload.file_name),
        mime_type: String(payload.mime_type),
        size_bytes: Number(payload.size_bytes),
        created_at: '2026-11-17T08:00:00Z',
      }]
    }
    return Promise.resolve({
      data: {
        request_id: args.p_request_id,
        replayed: false,
        result: args.p_action === 'reminders' ? { sent: 2, skipped: 1 } : { id: requestId },
      },
      error: null,
    })
  })
})
describe('employee and HR leave journeys', () => {
  it('shows effective balance and a focused own request, then withdraws it with a reason', async () => {
    show()
    expect(await screen.findByText('21.5 days')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /2026-12-21.*Annual leave/ }))
    expect(await screen.findByRole('heading', { name: 'History' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw request' }))
    fireEvent.change(screen.getByLabelText('Action reason'), { target: { value: 'Plans changed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm withdraw' }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Withdraw request' })).not.toBeInTheDocument()
    )
    expect(rpc.mock.calls.find(([, args]) => args.p_action === 'withdraw')?.[1].p_payload).toEqual({
      id: requestId,
      reason: 'Plans changed',
    })
  })
  it('submits schedule-aware rest-of-shift with a locked end date and backend preview', async () => {
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Request leave' }))
    fireEvent.click(screen.getByLabelText('Rest of my shift'))
    expect(screen.getByLabelText('End date')).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Leaving at'), { target: { value: '14:00' } })
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Family appointment' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send to HR' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Send to HR' }))
    await waitFor(() =>
      expect(rpc.mock.calls.some(([, args]) => args.p_action === 'submit')).toBe(true)
    )
    const sent = rpc.mock.calls.find(([, args]) => args.p_action === 'submit')?.[1]
      .p_payload as Record<string, unknown>
    expect(sent.day_portion).toBe('exact')
    expect(sent.leaving_time).toBe('14:00')
    expect(sent.end_date).toBe(sent.start_date)
    expect(sent).not.toHaveProperty('total_days')
  })
  it('opens an HR notification deep link, gates approval on evidence and accepts a private PDF before approval', async () => {
    requiresEvidence = true
    requests[0].requires_evidence = true
    show(true, `/people/leave?request=${requestId}`)
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeDisabled()
    expect(screen.getByText('Evidence is required before this request can be approved.'))
      .toBeInTheDocument()
    await screen.findByText('No documents attached yet.')
    const bytes = new TextEncoder().encode('%PDF-1.7')
    const file = new File([bytes], 'clinic.pdf', { type: 'application/pdf' })
    Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(bytes.buffer) })
    fireEvent.change(screen.getByLabelText('Attach a document'), { target: { files: [file] } })
    expect(await screen.findByText('clinic.pdf')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approve' }))
    await waitFor(() => expect(screen.getByText('approved')).toBeInTheDocument())
    expect(upload).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Evidence is required before this request can be approved.'))
      .not.toBeInTheDocument()
  })
  it('shows a recorded cancellation even while the workspace still returns the approved status', async () => {
    requests[0].status = 'approved'
    let cancellationRecorded = false
    rpc.mockImplementation((name, args) => {
      if (name === 'rpc_leave_workspace') {
        return Promise.resolve({ data: workspace(true), error: null })
      }
      if (name === 'rpc_leave_detail') {
        return Promise.resolve({
          data: {
            documents: [],
            events: [{
              id: documentId,
              event_type: cancellationRecorded ? 'cancelled' : 'approved',
              actor_name: 'HR Admin',
              occurred_at: '2026-11-18T08:00:00Z',
              reason: cancellationRecorded ? 'Tagged test cancellation' : null,
            }],
          },
          error: null,
        })
      }
      expect(args.p_action).toBe('cancel')
      cancellationRecorded = true
      return Promise.resolve({
        data: { request_id: args.p_request_id, replayed: false, result: {} },
        error: null,
      })
    })

    show(true, `/people/leave?request=${requestId}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel approved leave' }))
    fireEvent.change(screen.getByLabelText('Action reason'), {
      target: { value: 'Tagged test cancellation' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm cancel' }))

    expect(await screen.findByText('cancelled', { selector: 'span' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel approved leave' })).not.toBeInTheDocument()
  })

  it('has an actionable error for an unlinked employee instead of pretending the list is empty', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'An active linked employee is required.' },
    })
    show()
    expect(await screen.findByText('Ask HR to link your account to an active employee record.'))
      .toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Request leave' })).not.toBeInTheDocument()
  })
  it('can retry a stored in-flight action after a page reload', async () => {
    leavePendingStore.write({
      profileId: actor,
      intentKey: 'leave:command',
      operationType: 'submit',
      rpcName: 'rpc_leave_execute',
      requestId: documentId,
      instanceId: documentId,
      payload: { p_action: 'submit', p_payload: { reason: 'Original saved reason' } },
      payloadCanonical: '{}',
      createdAt: '2026-11-17T08:00:00Z',
      status: 'in_flight',
      label: 'Leave submit',
    })
    show()
    const retry = await screen.findByRole('button', { name: 'Retry saved action' })
    expect(retry).toBeEnabled()
    fireEvent.click(retry)
    await waitFor(() =>
      expect(rpc.mock.calls.some(([, args]) => args.p_request_id === documentId)).toBe(true)
    )
  })
  it.each(['entitlement', 'adjust'])(
    'uses the displayed leave type for %s after switching from a new type',
    async (task) => {
      show(true)
      fireEvent.click(await screen.findByRole('button', { name: 'Setup' }))
      const existingType = screen.getByLabelText('Existing leave type')
      fireEvent.change(existingType, { target: { value: typeId } })
      fireEvent.change(existingType, { target: { value: '' } })

      fireEvent.change(screen.getByLabelText('Setup task'), { target: { value: task } })
      expect(screen.getByLabelText('Setup leave type')).toHaveValue(typeId)
      fireEvent.change(screen.getByLabelText('Setup employee'), { target: { value: employee } })
      fireEvent.change(screen.getByLabelText('Days'), { target: { value: '1' } })
      if (task === 'adjust') {
        fireEvent.change(screen.getByLabelText('Adjustment reason'), {
          target: { value: 'Approved carryover' },
        })
      }
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

      expect(await screen.findByText('Leave setup saved.')).toBeInTheDocument()
      expect(rpc.mock.calls.find(([, args]) => args.p_action === task)?.[1].p_payload)
        .toMatchObject({ leave_type_id: typeId })
    },
  )
  it('provides HR entitlement setup and audited reminder results without claiming email delivery', async () => {
    show(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Setup' }))
    fireEvent.change(screen.getByLabelText('Setup task'), { target: { value: 'entitlement' } })
    fireEvent.change(screen.getByLabelText('Setup employee'), { target: { value: employee } })
    fireEvent.change(screen.getByLabelText('Days'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Leave setup saved.')).toBeInTheDocument()
    expect(rpc.mock.calls.find(([, args]) => args.p_action === 'entitlement')?.[1].p_payload)
      .toMatchObject({ days: 0 })
    fireEvent.change(screen.getByLabelText('Setup task'), { target: { value: 'reminders' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send in-app reminders' }))
    expect(
      await screen.findByText(
        '2 in-app reminders sent. 1 skipped (no available balance or recent reminder).',
      ),
    ).toBeInTheDocument()
  })
})
