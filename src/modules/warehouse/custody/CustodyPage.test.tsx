import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { resetProtectedSessionRegistryForTest, syncProtectedAuthSessionFromProvider } from '@/lib/idempotency/pendingOperations'
import { CustodyPage } from './CustodyPage'

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => ({ from, rpc }) }))
vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuth: () => ({
    status: 'authenticated', authEpoch: 1, session: { userId: 'warehouse-user' },
    access: { permissionKeys: ['inventory.read', 'inventory.issue'] },
  }),
}))

const assetId = '47100996-5bf1-4c0c-8aa2-7c06e1fbbd84'
const activeRow = {
  id: 'custody-legacy', equipment_asset_id: assetId, stock_request_id: 'request-001',
  project_name: 'CBD Tower', issued_from_warehouse_id: 'warehouse-main',
  issue_condition: 'Working', issued_at: '2025-01-10T11:00:00Z', expected_return_date: '2025-01-11',
  equipment: { serial_number: 'FBR-001', model_name: 'Fusion splicer' },
  custodian: { display_name: 'James K.' }, source_warehouse: { name: 'Main store' },
}

let lookup: ReturnType<typeof vi.fn>

function mount(mode: 'issued' | 'returns') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter><CustodyPage mode={mode} /></MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  resetProtectedSessionRegistryForTest()
  rpc.mockReset()
  rpc.mockResolvedValue({ data: null, error: null })
  lookup = vi.fn().mockResolvedValue({ data: { id: activeRow.id }, error: null })
  from.mockImplementation((table: string) => {
    const query = {
      select: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      maybeSingle: lookup,
      abortSignal: () => Promise.resolve({
        data: table === 'warehouses'
          ? [{ id: 'warehouse-main', name: 'Main store' }]
          : [activeRow, {
            ...activeRow, id: 'no-date', expected_return_date: null,
            equipment_asset_id: '6511d8fd-3d92-4268-93ca-62acc782430b',
            equipment: { serial_number: 'LDR-001', model_name: 'Ladder' },
          }],
        error: null,
      }),
    }
    return query
  })
})

it('lists active custody, links the original request, and finds equipment by label', async () => {
  mount('issued')
  expect(await screen.findByText('Fusion splicer')).toBeInTheDocument()
  expect(screen.getByText('Overdue')).toBeInTheDocument()
  expect(screen.getAllByRole('link', { name: 'Open request' })[0]).toHaveAttribute('href', '/inventory/requests/request-001')

  const search = screen.getByRole('searchbox', { name: 'Find equipment' })
  fireEvent.change(search, { target: { value: `EQPT:${assetId}` } })
  fireEvent.submit(search.closest('form')!)
  expect(screen.getByText('Fusion splicer')).toBeInTheDocument()
  expect(screen.queryByText('Ladder')).not.toBeInTheDocument()
})

it('records one return with the selected condition, warehouse, and trimmed notes', async () => {
  mount('returns')
  await screen.findByText('Fusion splicer')
  fireEvent.click(screen.getByRole('button', { name: 'Record return for Fusion splicer' }))
  fireEvent.change(screen.getByLabelText(/^Condition/u), { target: { value: 'damaged' } })
  await screen.findByRole('option', { name: 'Main store' })
  fireEvent.change(screen.getByLabelText(/^Return warehouse/u), { target: { value: 'warehouse-main' } })
  fireEvent.change(screen.getByLabelText('Notes'), { target: { value: '  Needs a replacement case  ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Confirm return' }))

  await waitFor(() => expect(rpc).toHaveBeenCalledExactlyOnceWith('rpc_return_asset', {
    p_equipment_asset_id: assetId, p_condition: 'damaged',
    p_warehouse_id: 'warehouse-main', p_notes: 'Needs a replacement case',
  }))
  expect(await screen.findByText('Return recorded for Fusion splicer.')).toBeInTheDocument()
})

it('blocks a return after the original custody closes', async () => {
  lookup.mockResolvedValueOnce({ data: null, error: null })
  mount('returns')
  await screen.findByText('Fusion splicer')
  fireEvent.click(screen.getByRole('button', { name: 'Record return for Fusion splicer' }))
  fireEvent.change(screen.getByLabelText(/^Condition/u), { target: { value: 'good' } })
  await screen.findByRole('option', { name: 'Main store' })
  fireEvent.change(screen.getByLabelText(/^Return warehouse/u), { target: { value: 'warehouse-main' } })
  fireEvent.click(screen.getByRole('button', { name: 'Confirm return' }))

  expect(await screen.findByText('This custody record has changed. Close this form and reopen the current record.')).toBeInTheDocument()
  expect(rpc).not.toHaveBeenCalled()
})

it('does not submit when the signed-in account changes during the return check', async () => {
  let finishLookup!: (value: { data: { id: string }; error: null }) => void
  lookup.mockReturnValueOnce(new Promise((resolve) => { finishLookup = resolve }))
  mount('returns')
  await screen.findByText('Fusion splicer')
  fireEvent.click(screen.getByRole('button', { name: 'Record return for Fusion splicer' }))
  fireEvent.change(screen.getByLabelText(/^Condition/u), { target: { value: 'lost' } })
  await screen.findByRole('option', { name: 'Main store' })
  fireEvent.change(screen.getByLabelText(/^Return warehouse/u), { target: { value: 'warehouse-main' } })
  fireEvent.click(screen.getByRole('button', { name: 'Confirm return' }))
  await waitFor(() => expect(lookup).toHaveBeenCalledTimes(1))

  act(() => {
    syncProtectedAuthSessionFromProvider({ identityKey: 'another-user', authEpoch: 2, isReady: true })
    finishLookup({ data: { id: activeRow.id }, error: null })
  })

  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm return' })).toBeEnabled())
  expect(rpc).not.toHaveBeenCalled()
})
