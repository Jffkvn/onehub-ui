import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'

import type { UserRole } from '@/config/modules'
import { resetProtectedSessionRegistryForTest } from '@/lib/idempotency/pendingOperations'
import { ProjectCashDetailPage, ProjectCashListPage } from './ProjectCashPages'

const advanceId = 'a7c00000-0000-4000-8000-000000000001'
const userId = 'a7c00000-0000-4000-8000-000000000002'
const projectId = 'a7c00000-0000-4000-8000-000000000003'
const otherProjectId = 'a7c00000-0000-4000-8000-000000000004'
const row = {
  id: advanceId, project_id: projectId, user_id: userId, entered_by: userId, status: 'pending_approval',
  purpose: 'Transport and materials', amount_requested: 150000, amount_disbursed: null,
  requested_at: '2026-11-20T08:00:00+03:00', projects: { name: 'Kampala site' },
  profiles_user: { display_name: 'QA Coordinator' }, profiles_entered_by: { display_name: 'QA Coordinator' },
}

const { rpc, from, assignmentUser } = vi.hoisted(() => ({
  rpc: vi.fn<(name: string, args: Record<string, unknown>) => Promise<{data:unknown; error: {code:string; message:string} | null; status:number}>>(),
  from: vi.fn(), assignmentUser: vi.fn(),
}))
let role: UserRole
let permissions: string[]
let visible: boolean
let status: string

vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuth: () => ({
    status: 'authenticated', authEpoch: 1, session: { userId },
    access: { profile: { id: userId, displayName: 'QA Coordinator' }, roleKeys: [role], permissionKeys: permissions },
  }),
}))
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => ({ rpc, from }) }))
vi.mock('./finance/CashFinanceActions', () => ({ CashFinanceActions: () => <h2>Finance actions</h2> }))
vi.mock('./accountability/CashAccountabilityPanel', () => ({ CashAccountabilityPanel: () => <h2>Accountability ledger</h2> }))

function mount(path: string) {
  render(<QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={[path]}><Routes>
      <Route path="/ops/cash" element={<ProjectCashListPage />} />
      <Route path="/ops/cash/:advanceId" element={<ProjectCashDetailPage />} />
    </Routes></MemoryRouter>
  </QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  resetProtectedSessionRegistryForTest()
  role = 'coordinator'
  permissions = ['cash_advances.request', 'cash_advances.view_own']
  visible = true
  status = 'pending_approval'
  rpc.mockImplementation((name) => Promise.resolve({ status: 200, error: null,
    data: name === 'rpc_list_cash_advances' ? (visible ? [{ ...row, status }] : [])
      : name === 'get_cash_advance_balance' ? 0
        : name === 'has_outstanding_advances' ? false : advanceId }))
  from.mockImplementation((table: string) => {
    const project = { id: projectId, project_code: 'UG-101', name: 'Kampala site' }
    const data = table === 'project_assignments'
      ? [{ projects: project }, { projects: project }]
      : table === 'projects'
        ? [project, { id: otherProjectId, project_code: 'UG-102', name: 'Outside project' }]
        : [{ id: userId, display_name: 'QA Coordinator' }]
    const response = Promise.resolve({ data, error: null })
    const query = {
      select: () => query, order: () => query, abortSignal: () => query, in: () => query,
      is: () => query, range: () => query, eq: (name: string, value: unknown) => {
        if (table === 'project_assignments' && name === 'user_id') assignmentUser(value)
        return query
      }, then: response.then.bind(response),
    }
    return query
  })
})

it('opens a request with the project from the project workspace and only submits to its assigned recipient', async () => {
  mount('/ops/cash?project=' + projectId)
  fireEvent.click(screen.getByRole('button', { name: 'Request cash advance' }))
  const modal = within(screen.getByRole('dialog'))
  expect(await modal.findByRole('option', { name: 'UG-101 · Kampala site' })).toBeInTheDocument()
  expect(modal.getByLabelText('Project')).toHaveValue(projectId)
  expect(modal.queryByRole('option', { name: /Outside project/ })).not.toBeInTheDocument()
  expect(modal.queryByLabelText('Recipient')).not.toBeInTheDocument()
  expect(assignmentUser).toHaveBeenCalledExactlyOnceWith(userId)
  fireEvent.change(modal.getByLabelText('Amount (UGX)'), { target: { value: '150000' } })
  fireEvent.change(modal.getByLabelText('Purpose'), { target: { value: 'Site transport' } })
  fireEvent.click(modal.getByRole('button', { name: 'Submit request' }))
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('rpc_request_cash_advance', {
    p_project_id: projectId, p_user_id: userId, p_amount: 150000, p_purpose: 'Site transport',
  }))
  expect(await screen.findByRole('heading', { name: 'Transport and materials' })).toBeInTheDocument()
})

it('shows a filtered empty result and lets the user clear the project filter', async () => {
  mount('/ops/cash?project=' + otherProjectId)
  expect(await screen.findByText('No requests match the filters.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
  expect(await screen.findByRole('link', { name: /Transport and materials/ })).toHaveAttribute('href', '/ops/cash/' + advanceId)
})

it('denies unrelated records before loading finance actions or the ledger', async () => {
  visible = false
  mount('/ops/cash/' + advanceId)
  expect(await screen.findByRole('heading', { name: 'Cash advance unavailable' })).toBeInTheDocument()
  expect(screen.queryByText('Accountability ledger')).not.toBeInTheDocument()
  expect(rpc).not.toHaveBeenCalledWith('get_cash_advance_balance', { p_advance_id: advanceId })
})

it('gives the director a read-only view of the visible advance', async () => {
  role = 'managing_director'
  permissions = ['cash_advances.view_all']
  status = 'completed'
  mount('/ops/cash/' + advanceId)
  expect(await screen.findByText('Accountability ledger')).toBeInTheDocument()
  expect(screen.queryByText('Finance actions')).not.toBeInTheDocument()
})

it('keeps the list and detail closed to provisional super admin access', () => {
  role = 'super_admin'
  permissions = ['cash_advances.manage', 'cash_advances.view_all']
  mount('/ops/cash/' + advanceId)
  expect(screen.getByRole('heading', { name: /Permission Denied/i })).toBeInTheDocument()
  expect(rpc).not.toHaveBeenCalled()
})

it('lets finance choose an active recipient through the cash-specific lookup', async () => {
  role = 'cfo'
  permissions = ['cash_advances.request', 'cash_advances.manage', 'cash_advances.view_all']
  const recipient = 'a7c00000-0000-4000-8000-000000000005'
  rpc.mockImplementation((name) => {
    const response = Promise.resolve({ status: 200, error: null, data:
      name === 'rpc_list_cash_request_recipients' ? [{ id: recipient, display_name: 'Eligible recipient' }]
        : name === 'has_outstanding_advances' ? false
          : name === 'rpc_list_cash_advances' ? [row] : advanceId })
    const query = Object.assign(response, { order: () => query, range: () => query, abortSignal: () => query })
    return query
  })
  mount('/ops/cash?project=' + projectId)
  fireEvent.click(screen.getByRole('button', { name: 'Request cash advance' }))
  const form = within(screen.getByRole('dialog'))
  await form.findByRole('option', { name: 'Eligible recipient' })
  fireEvent.change(form.getByLabelText('Recipient'), { target: { value: recipient } })
  fireEvent.change(form.getByLabelText('Amount (UGX)'), { target: { value: '50000' } })
  fireEvent.change(form.getByLabelText('Purpose'), { target: { value: 'Transport costs' } })
  fireEvent.click(form.getByRole('button', { name: 'Submit request' }))
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('rpc_request_cash_advance', {
    p_project_id: projectId, p_user_id: recipient, p_amount: 50000, p_purpose: 'Transport costs',
  }))
  expect(from).not.toHaveBeenCalledWith('profiles')
})
