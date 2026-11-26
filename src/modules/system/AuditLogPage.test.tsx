import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import { resetProtectedSessionRegistryForTest } from '@/lib/idempotency/pendingOperations'
import AuditLogPage from './AuditLogPage'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  userId: '76000000-0000-4000-8000-000000000001',
}))

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: () => ({ from: mocks.from }),
}))

vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuth: () => ({
    status: 'authenticated',
    authEpoch: 1,
    session: { userId: mocks.userId },
    access: { profile: { id: mocks.userId }, isActive: true, mfaRequired: false },
  }),
}))

it('shows readable activity, keeps the ID in details, and searches visible labels and keywords', async () => {
  resetProtectedSessionRegistryForTest()
  const entityId = '76000000-0000-4000-8000-000000000002'
  const row = {
    id: '76000000-0000-4000-8000-000000000003',
    actor_profile_id: mocks.userId,
    actor: { display_name: 'Diana Nansubuga' },
    occurred_at: '2026-11-24T10:00:00Z',
    event_type: 'inventory.router_float_issued',
    entity_type: 'asset_custody',
    entity_id: entityId,
    reason: null,
  }
  const ilike = vi.fn().mockReturnThis()
  mocks.from.mockReturnValue({
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    ilike,
    abortSignal: vi.fn(() => Object.assign(Promise.resolve({ data: [row], error: null }), {
      single: () => Promise.resolve({ data: { previous_values: null, new_values: {} }, error: null }),
    })),
  })

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><AuditLogPage /></QueryClientProvider>)
  expect(await screen.findByRole('heading', { name: 'Router issued to technician' })).toBeInTheDocument()
  expect(screen.getByText('Asset custody')).toBeInTheDocument()
  expect(screen.queryByText(new RegExp(entityId))).not.toBeInTheDocument()

  const field = screen.getByRole('searchbox', { name: 'Search activity' })
  fireEvent.change(field, { target: { value: 'Router issued to technician' } })
  fireEvent.click(screen.getByRole('button', { name: 'Search' }))
  expect(await screen.findByRole('heading', { name: 'Router issued to technician' })).toBeInTheDocument()
  expect(ilike).toHaveBeenCalledWith('event_type', 'inventory.router\\_float\\_issued')

  fireEvent.change(field, { target: { value: 'router' } })
  fireEvent.click(screen.getByRole('button', { name: 'Search' }))
  expect(await screen.findByRole('heading', { name: 'Router issued to technician' })).toBeInTheDocument()
  expect(ilike).toHaveBeenCalledWith('event_type', '%router%')

  fireEvent.click(screen.getByRole('button', { name: 'View details' }))
  expect(within(await screen.findByRole('dialog')).getByText(new RegExp(entityId))).toBeInTheDocument()
})
