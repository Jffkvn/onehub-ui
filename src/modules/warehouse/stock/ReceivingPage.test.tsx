import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'

import { resetProtectedSessionRegistryForTest } from '@/lib/idempotency/pendingOperations'
import { ReceivingPage } from './ReceivingPage'
import { StockAdjustmentPage } from './StockAdjustmentPage'

const warehouse = { id: 'a9000000-0000-4000-8000-000000000001', name: 'Main depot', code: 'HQ-01' }
const category = { id: 'a9000000-0000-4000-8000-000000000002', name: 'Tools' }
const item = { id: 'a9000000-0000-4000-8000-000000000003', sku: 'CAB-1', name: 'Cable' }
const receiptId = 'a9000000-0000-4000-8000-000000000004'

const { from, rpc } = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn<(name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null; status: number }>>(),
}))

let permissionKeys: string[]
vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuth: () => ({
    status: 'authenticated',
    authEpoch: 1,
    session: { userId: 'qa-warehouse' },
    access: { profile: { id: 'qa-warehouse' }, permissionKeys },
  }),
}))
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => ({ from, rpc }) }))

function mount() {
  render(<QueryClientProvider client={new QueryClient()}>
    <MemoryRouter><ReceivingPage /></MemoryRouter>
  </QueryClientProvider>)
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

async function fillReceipt() {
  await screen.findByRole('option', { name: 'HQ-01 · Main depot' })
  fill('Warehouse', warehouse.id)
  fill('Supplier', ' Test Supplier ')
  fill('Delivery note / GRN', 'GRN-001')
  fill('Invoice number', 'INV-001')
  fill('Received date', '2025-11-18')
}

beforeEach(() => {
  permissionKeys = ['inventory.read', 'inventory.receipt']
  resetProtectedSessionRegistryForTest()
  from.mockReset()
  rpc.mockReset()
  from.mockImplementation((table: string) => {
    const records: Record<string, unknown[]> = {
      warehouses: [warehouse], item_categories: [category], consumable_items: [item], stock_receipts: [],
    }
    const response = Promise.resolve({ data: records[table], error: null })
    const builder = { select: () => builder, eq: () => builder, order: () => builder, range: () => builder,
      limit: () => builder, abortSignal: () => builder, then: response.then.bind(response) }
    return builder
  })
  rpc.mockResolvedValue({ data: { receipt_id: receiptId }, error: null, status: 200 })
})

it('records an existing material delivery with supplier evidence', async () => {
  mount()
  await fillReceipt()
  fill('Existing material', item.id)
  fill('Quantity', '8')
  fill('Unit price (UGX)', '1200')
  fireEvent.click(screen.getByRole('button', { name: 'Record receipt' }))

  await screen.findByText('Receipt recorded for GRN-001.')
  expect(rpc).toHaveBeenCalledOnce()
  expect(rpc).toHaveBeenCalledWith('rpc_receive_consumable_inline', expect.objectContaining({
    p_item_id: item.id, p_category_id: null, p_warehouse_id: warehouse.id,
    p_supplier_name: 'Test Supplier', p_grn_number: 'GRN-001', p_invoice_number: 'INV-001',
    p_received_date: '2025-11-18', p_quantity: 8, p_unit_price: 1200,
  }))
})

it('creates a serialized sensitive asset and new category in the same receipt', async () => {
  mount()
  fireEvent.click(screen.getByRole('button', { name: 'New equipment' }))
  await fillReceipt()
  fill('Category', 'new')
  fill('New category name', 'Fiber tools')
  fill('Model name', 'Fusion splicer')
  fill('Serial number', 'FS-001')
  fill('Condition on receipt', 'New and inspected')
  fireEvent.click(screen.getByLabelText('Sensitive equipment'))
  fill('Purchase value (UGX)', '520000')
  fireEvent.click(screen.getByRole('button', { name: 'Record receipt' }))

  await waitFor(() => expect(rpc).toHaveBeenCalledWith('rpc_receive_new_equipment_inline', expect.objectContaining({
    p_category_id: null, p_category_name: 'Fiber tools', p_warehouse_id: warehouse.id,
    p_model_name: 'Fusion splicer', p_serial_number: 'FS-001', p_is_sensitive: true,
    p_condition_notes: 'New and inspected', p_purchase_value: 520000,
  })))
})

it('stops a second submission when the receipt result is unknown', async () => {
  rpc.mockResolvedValue({ data: null, error: {}, status: 503 })
  mount()
  await fillReceipt()
  fill('Existing material', item.id)
  fill('Quantity', '2')
  fill('Unit price (UGX)', '1200')
  fireEvent.click(screen.getByRole('button', { name: 'Record receipt' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('Check the stock ledger')
  expect(screen.getByRole('button', { name: 'Record receipt' })).toBeDisabled()
  expect(rpc).toHaveBeenCalledOnce()
})

it('does not fetch receipt or stock data for a read-only role', () => {
  permissionKeys = ['inventory.read']
  mount()
  expect(screen.getByRole('heading', { name: /permission denied/i })).toBeInTheDocument()
  expect(from).not.toHaveBeenCalled()
})

it('records a signed consumable adjustment with its reason', async () => {
  permissionKeys = ['inventory.read', 'inventory.adjust']
  render(<QueryClientProvider client={new QueryClient()}>
    <MemoryRouter><StockAdjustmentPage /></MemoryRouter>
  </QueryClientProvider>)
  await screen.findByRole('option', { name: 'HQ-01 · Main depot' })
  fill('Warehouse', warehouse.id)
  fill('Material', item.id)
  fill('Quantity change', '-2')
  fill('Reason', 'Damaged packaging')
  fireEvent.click(screen.getByRole('button', { name: 'Save adjustment' }))
  expect(await screen.findByText('Stock adjustment recorded.')).toBeInTheDocument()
  expect(rpc).toHaveBeenCalledWith('rpc_adjust_stock', {
    p_warehouse_id: warehouse.id, p_consumable_item_id: item.id, p_equipment_asset_id: null,
    p_quantity: -2, p_reason: 'Damaged packaging',
  })
})
