import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import { resetProtectedSessionRegistryForTest } from '@/lib/idempotency/pendingOperations'
import WarehouseSettingsPage from './WarehouseSettingsPage'

const version = '2026-11-21T08:00:00.123456+00:00'
const current = {
  approval_mode: 'threshold_escalation',
  cfo_threshold: 2000000,
  critical_stock_escalation: false,
  updated_at: version,
}
const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => ({ from, rpc }) }))
vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuth: () => ({ status: 'authenticated', authEpoch: 1, session: { userId: 'warehouse-admin' } }),
}))

beforeEach(() => {
  resetProtectedSessionRegistryForTest()
  rpc.mockReset()
  from.mockReset()
  from.mockImplementation(() => {
    const query = { select: () => query, eq: () => query, abortSignal: () => query,
      single: () => Promise.resolve({ data: current, error: null }) }
    return query
  })
})

async function renderEditor() {
  render(<QueryClientProvider client={new QueryClient()}>
    <WarehouseSettingsPage />
  </QueryClientProvider>)
  await screen.findByRole('button', { name: 'Save approval settings' })
}

it('saves the chosen routing rules and the exact version that was edited', async () => {
  rpc.mockResolvedValue({ data: { ...current, approval_mode: 'cfo_approval_all', cfo_threshold: 1750000.5,
    critical_stock_escalation: true, updated_at: '2026-11-21T09:00:00.234567+00:00' }, error: null })
  await renderEditor()

  fireEvent.change(screen.getByLabelText('Approval mode'), { target: { value: 'cfo_approval_all' } })
  fireEvent.change(screen.getByLabelText('CFO escalation threshold (UGX)'), { target: { value: '1750000.5' } })
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Save approval settings' }))

  await screen.findByText('Warehouse approval settings saved.')
  expect(rpc).toHaveBeenCalledExactlyOnceWith('rpc_update_inventory_settings', {
    p_approval_mode: 'cfo_approval_all',
    p_cfo_threshold: 1750000.5,
    p_critical_stock_escalation: true,
    p_expected_updated_at: version,
  })
})

it('asks an editor with a stale version to reload before saving again', async () => {
  rpc.mockResolvedValue({ error: { code: '40001' } })
  await renderEditor()

  fireEvent.click(screen.getByRole('button', { name: 'Save approval settings' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('Someone else changed these settings')
  expect(screen.getByRole('button', { name: 'Save approval settings' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Reload saved settings' })).toBeEnabled()
})
