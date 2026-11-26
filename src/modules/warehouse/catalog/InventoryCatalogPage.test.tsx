import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resetProtectedSessionRegistryForTest } from '@/lib/idempotency/pendingOperations'
import { InventoryCatalogPage } from './InventoryCatalogPage'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  toDataURL: vi.fn(),
}))

vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => mocks }))
vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuth: () => ({ status: 'authenticated', session: { userId: 'warehouse-reader' }, authEpoch: 1 }),
}))
vi.mock('qrcode', () => ({ default: { toDataURL: mocks.toDataURL } }))

function openCatalog(view: 'overview' | 'consumables' | 'equipment' | 'ledger') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><InventoryCatalogPage view={view} /></MemoryRouter>
    </QueryClientProvider>,
  )
}

function response(data: unknown, count?: number) {
  return { data, count: count ?? null, error: null }
}

function tableRequest(resolve: () => unknown) {
  const query = {
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    abortSignal: vi.fn(() => Promise.resolve(resolve())),
  }
  return query
}

describe('Inventory catalog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetProtectedSessionRegistryForTest()
  })

  it('counts only the matching equipment and requests returned by the scoped read', async () => {
    const warehouses = tableRequest(() => response(null, 2))
    const consumables = tableRequest(() => response(null, 7))
    const assets = tableRequest(() => response(null, 12))
    const availableAssets = tableRequest(() => response(null, 4))
    const ledger = tableRequest(() => response([], 0))
    const equipmentQueries = [assets, availableAssets]
    mocks.from.mockImplementation((name) => {
      if (name === 'warehouses') return warehouses
      if (name === 'consumable_items') return consumables
      if (name === 'stock_movements') return ledger
      return equipmentQueries.shift()
    })
    mocks.rpc.mockReturnValue(tableRequest(() => response([
      { status: 'pending_approval' }, { status: 'approved' }, { status: 'pending_approval' },
    ])))

    openCatalog('overview')

    expect(await screen.findByText('4 of 12')).toBeInTheDocument()
    expect(within(screen.getByText('Requests pending approval').parentElement!).getByText('2')).toBeInTheDocument()
    expect(availableAssets.eq).toHaveBeenCalledWith('status', 'available')
    expect(warehouses.eq).toHaveBeenCalledWith('status', 'active')
    expect(mocks.rpc).toHaveBeenCalledWith('rpc_list_stock_requests', { p_request_id: null })
    expect(screen.getByRole('link', { name: 'Stock ledger' })).toHaveAttribute('href', '/inventory/ledger')
  })

  it('totals all visible movements for a material, including those beyond the first response', async () => {
    const material = {
      id: 'material-1', name: 'Fiber cable', sku: 'FIBER-001', unit_of_measure: 'metres',
      reorder_level: 10, item_categories: { name: 'Fiber' },
    }
    const catalog = tableRequest(() => response([material], 1))
    const receipts = tableRequest(() => response([{ id: 'm1', consumable_item_id: material.id, quantity: 15 }]))
    const issues = tableRequest(() => response([{ id: 'm2', consumable_item_id: material.id, quantity: -9 }]))
    const last = tableRequest(() => response([]))
    const movements = [receipts, issues, last]
    mocks.from.mockImplementation((name) => name === 'consumable_items' ? catalog : movements.shift())

    openCatalog('consumables')

    const row = await screen.findByRole('row', { name: /Fiber cable.*FIBER-001/ })
    expect(within(row).getByText('6')).toBeInTheDocument()
    expect(within(row).getByText('Low stock')).toBeInTheDocument()
    expect(issues.gt).toHaveBeenCalledWith('id', 'm1')
    expect(last.gt).toHaveBeenCalledWith('id', 'm2')
    expect(receipts.in).toHaveBeenCalledWith('consumable_item_id', [material.id])
  })

  it('builds the catalogue asset label from the canonical UUID only when opened', async () => {
    const id = '215d53cc-4a63-4e68-940b-4861239222d0'
    mocks.from.mockReturnValue(tableRequest(() => response([{
      id, serial_number: 'SPL-103', model_name: 'Fiber splicer', status: 'available', is_sensitive: true,
      item_categories: { name: 'Tools' }, warehouses: { name: 'Main depot' },
    }], 1)))
    mocks.toDataURL.mockResolvedValue('data:image/png;base64,AA==')
    openCatalog('equipment')

    const row = await screen.findByRole('row', { name: /Fiber splicer.*SPL-103/ })
    expect(within(row).getByText('Main depot')).toBeInTheDocument()
    expect(mocks.toDataURL).not.toHaveBeenCalled()

    fireEvent.click(within(row).getByRole('button', { name: 'QR label for SPL-103' }))

    const dialog = await screen.findByRole('dialog', { name: 'Equipment QR label' })
    expect(within(dialog).getByText('EQPT:' + id)).toBeInTheDocument()
    expect(await within(dialog).findByRole('img', { name: 'QR code for SPL-103' })).toBeInTheDocument()
    expect(mocks.toDataURL.mock.calls[0][0]).toBe('EQPT:' + id)
  })

  it('keeps a failed movement read separate from an empty ledger', async () => {
    mocks.from.mockReturnValue(tableRequest(() => ({
      data: null, count: null, error: { code: '42501', message: 'Raw backend error' },
    })))
    openCatalog('ledger')

    expect(await screen.findByRole('alert')).toHaveTextContent('Stock ledger could not be loaded.')
    expect(screen.queryByText('No stock movements yet')).not.toBeInTheDocument()
    expect(screen.queryByText('Raw backend error')).not.toBeInTheDocument()
  })

  it('names routers in stock activity without showing its database reference', async () => {
    mocks.from.mockReturnValue(tableRequest(() => response([{
      id: 'movement-one', movement_type: 'return', created_at: '2026-11-20T13:00:00Z', quantity: 1,
      reference_id: '3d0816e1-e736-4e7d-bad6-2512adb732a8',
      warehouses: { name: 'Main depot' }, consumable_items: null,
      equipment_assets: { model_name: 'Huawei HG8245H5', serial_number: 'SN-01', asset_kind: 'cpe_router' },
      profiles_performed_by: null,
    }], 1)))
    openCatalog('ledger')

    const row = await screen.findByRole('row', { name: /Returned.*Huawei HG8245H5 Router/ })
    expect(within(row).getByText('SN-01')).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Reference' })).not.toBeInTheDocument()
  })

  it('shows clear movement labels and quantities on the paginated ledger', async () => {
    const movement = (id: string, kind: string, qty: number) => ({
      id, movement_type: kind, created_at: '2026-11-20T13:00:00Z', quantity: qty, reference_id: 'ref-' + id,
      warehouses: { name: 'Main depot' }, consumable_items: { name: 'Fiber cable', sku: 'FIBER-001' },
      equipment_assets: null, profiles_performed_by: { display_name: 'Warehouse manager' },
    })
    const first = tableRequest(() => response([movement('one', 'issue', -2)], 26))
    const second = tableRequest(() => response([movement('two', 'receipt', 5)], 26))
    mocks.from.mockReturnValueOnce(first).mockReturnValueOnce(second)
    openCatalog('ledger')

    const row = await screen.findByRole('row', { name: /Issue.*Fiber cable/ })
    expect(within(row).getByText('-2')).toBeInTheDocument()
    expect(within(row).queryByText('ref-one')).not.toBeInTheDocument()
    expect(first.range).toHaveBeenCalledWith(0, 24)

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByRole('row', { name: /Received.*Fiber cable/ })).toBeInTheDocument()
    expect(second.range).toHaveBeenCalledWith(25, 49)
  })
})
