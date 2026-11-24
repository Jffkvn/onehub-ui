import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import UserAccessPage from './UserAccessPage'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  identity: '7f000000-0000-4000-8000-000000000001',
}))

vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => ({ rpc: mocks.rpc }) }))
vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuth: () => ({
    status: 'authenticated',
    authEpoch: 1,
    session: { userId: mocks.identity },
    access: { profile: { id: mocks.identity }, permissionKeys: ['users.read', 'users.manage'] },
    refreshSecurity: vi.fn(),
  }),
}))

describe('Batch 7F User Access', () => {
  it('honors the server role boundary and connects an invited field technician to the selected employee', async () => {
    const employeeId = '7f000000-0000-4000-8000-000000000003'
    const unselectableEmployeeId = '7f000000-0000-4000-8000-000000000009'
    mocks.rpc.mockImplementation((name: string) => {
      const records: Record<string, unknown> = {
        admin_list_users: [{
          profile_id: '7f000000-0000-4000-8000-000000000002',
          display_name: 'System administrator', email: 'system@example.invalid',
          status: 'active', deactivated_at: null, created_at: '2026-11-21T10:00:00Z',
          role_keys: ['super_admin'], employee: null, last_access_change_at: null, can_manage: false, is_self: false,
        }],
        admin_list_access_audit: [],
        admin_list_assignable_roles: [{
          id: '7f000000-0000-4000-8000-000000000006',
          key: 'service_technician', name: 'Service Technician', description: 'Assigned field visits',
        }],
        admin_list_employee_candidates: [
          { id: employeeId, employee_number: 'QA-7F', legal_name: 'Test Technician', linked_profile_id: null, available: true },
          { id: unselectableEmployeeId, employee_number: 'QA-BOUND', legal_name: 'Linked Elsewhere', linked_profile_id: mocks.identity, available: false },
        ],
        admin_connect_existing_user: {
          profile_id: '7f000000-0000-4000-8000-000000000004',
          display_name: 'Test Technician', status: 'active', role_keys: ['service_technician'],
          employee_id: employeeId,
        },
      }
      return Promise.resolve({ data: records[name], error: null })
    })

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <UserAccessPage />
      </QueryClientProvider>,
    )

    const protectedAccount = (await screen.findByRole('heading', { name: 'System administrator' })).closest('article')
    expect(protectedAccount).not.toBeNull()
    expect(within(protectedAccount!).queryByRole('button', { name: 'Edit access' })).not.toBeInTheDocument()
    expect(within(protectedAccount!).queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Connect Auth account' }))
    const form = within(screen.getByRole('dialog', { name: 'Connect an Auth account' }))
    const technician = await form.findByRole('checkbox', { name: 'Service Technician' })
    expect(form.queryByRole('checkbox', { name: 'Super Administrator' })).not.toBeInTheDocument()
    expect(form.queryByRole('option', { name: /Linked Elsewhere/ })).not.toBeInTheDocument()
    fireEvent.change(form.getByLabelText('Email'), { target: { value: 'TEST-7F@example.invalid' } })
    fireEvent.change(form.getByLabelText('Display name'), { target: { value: 'Test Technician' } })
    fireEvent.change(form.getByLabelText('Employee link'), { target: { value: employeeId } })
    fireEvent.click(technician)
    fireEvent.change(form.getByLabelText('Reason for change'), { target: { value: 'Batch 7F onboarding rehearsal' } })
    fireEvent.click(form.getByRole('button', { name: 'Connect an Auth account' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('admin_connect_existing_user', {
      target_email: 'test-7f@example.invalid', target_display_name: 'Test Technician', target_role_keys: ['service_technician'],
      target_employee_id: employeeId, change_reason: 'Batch 7F onboarding rehearsal',
    }))
    expect(await screen.findByText('User access saved.')).toBeInTheDocument()
  })

  it('keeps the existing employee linked when role editor options finish loading', async () => {
    const profileId = '7f000000-0000-4000-8000-000000000002'
    const employee = {
      id: '7f000000-0000-4000-8000-000000000003',
      employee_number: 'QA-7F',
      legal_name: 'Test Technician',
    }
    const candidate = { ...employee, linked_profile_id: profileId, available: false }
    let loadCandidates!: (response: { data: typeof candidate[]; error: null }) => void
    const pendingCandidates = new Promise<{ data: typeof candidate[]; error: null }>((resolve) => {
      loadCandidates = resolve
    })
    mocks.rpc.mockImplementation((name: string) => {
      if (name === 'admin_list_employee_candidates') return pendingCandidates
      const records: Record<string, unknown> = {
        admin_list_users: [{
          profile_id: profileId, display_name: 'Test Technician', email: 'test@example.invalid',
          status: 'active', deactivated_at: null, created_at: '2026-11-21T10:00:00Z',
          role_keys: ['employee'], employee, last_access_change_at: null, can_manage: true, is_self: false,
        }],
        admin_list_access_audit: [],
        admin_list_assignable_roles: [
          { id: '7f000000-0000-4000-8000-000000000005', key: 'employee', name: 'Employee', description: 'Self-service' },
          { id: '7f000000-0000-4000-8000-000000000006', key: 'service_technician', name: 'Service Technician', description: 'Assigned field visits' },
        ],
        admin_update_user_access: {
          profile_id: profileId, display_name: 'Test Technician', status: 'active',
          role_keys: ['service_technician'], employee_id: employee.id,
        },
      }
      return Promise.resolve({ data: records[name], error: null })
    })

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <UserAccessPage />
      </QueryClientProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Edit access' }))
    const form = within(screen.getByRole('dialog', { name: 'Edit access' }))
    expect(form.getByLabelText('Employee link')).toHaveValue(employee.id)
    expect(form.getByRole('button', { name: 'Save access' })).toBeDisabled()

    loadCandidates({ data: [candidate], error: null })
    await form.findByRole('option', { name: 'QA-7F · Test Technician' })
    expect(form.getByLabelText('Employee link')).toHaveValue(employee.id)
    fireEvent.click(form.getByRole('checkbox', { name: /^Employee$/ }))
    fireEvent.click(form.getByRole('checkbox', { name: 'Service Technician' }))
    fireEvent.change(form.getByLabelText('Reason for change'), { target: { value: 'Assign dedicated field role' } })
    fireEvent.click(form.getByRole('button', { name: 'Save access' }))

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('admin_update_user_access', {
      target_profile_id: profileId, target_display_name: 'Test Technician', target_role_keys: ['service_technician'],
      target_employee_id: employee.id, change_reason: 'Assign dedicated field role',
    }))
    expect(await screen.findByText('User access saved.')).toBeInTheDocument()
  })
})
