import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'

import { resetProtectedSessionRegistryForTest } from '@/lib/idempotency/pendingOperations'
import { BulkStockPage } from './BulkStockPage'

const { readWorkbookFile, rpc } = vi.hoisted(() => ({ readWorkbookFile: vi.fn(), rpc: vi.fn() }))
let permissions: string[]

vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuth: () => ({
    status: 'authenticated', authEpoch: 1, session: { userId: 'qa-warehouse' },
    access: { profile: { id: 'qa-warehouse' }, permissionKeys: permissions },
  }),
}))
vi.mock('@/lib/security/workbookReader', () => ({ readWorkbookFile }))
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => ({ rpc }) }))

function mount() {
  return render(<QueryClientProvider client={new QueryClient()}>
    <MemoryRouter><BulkStockPage /></MemoryRouter>
  </QueryClientProvider>)
}

function upload() {
  fireEvent.change(screen.getByLabelText('Choose Excel file'), {
    target: { files: [new File(['example'], 'opening.xlsx')] },
  })
}

beforeEach(() => {
  resetProtectedSessionRegistryForTest()
  permissions = ['inventory.receipt']
  rpc.mockReset()
  rpc.mockResolvedValue({ data: null, error: null, status: 204 })
  readWorkbookFile.mockReset()
  readWorkbookFile.mockResolvedValue({
    sheetName: 'Opening Stock Upload',
    rows: [['Warehouse Name', 'SKU', 'Quantity'], ['Main depot', 'CAB-1', '8']],
  })
})

it('requires preview and a separate confirmation before importing', async () => {
  mount()
  expect(screen.queryByRole('button', { name: 'Stock adjustments' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Opening stock' }))
  upload()
  const preview = await screen.findByRole('table', { name: 'Inventory workbook preview' })
  expect(within(preview).getByText('CAB-1')).toBeInTheDocument()
  expect(rpc).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Review import' }))
  expect(rpc).not.toHaveBeenCalled()
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Import records' }))
  expect(await screen.findByText('1 record imported.')).toBeInTheDocument()
  expect(rpc).toHaveBeenCalledOnce()
  expect(rpc).toHaveBeenCalledWith('rpc_bulk_opening_stock', {
    p_rows: [{ warehouse_name: 'Main depot', sku: 'CAB-1', quantity: 8 }],
  })
})

it('exposes row errors and prevents import of an invalid workbook', async () => {
  readWorkbookFile.mockResolvedValue({
    sheetName: 'Opening Stock Upload',
    rows: [['Warehouse Name', 'SKU', 'Quantity'], ['Main depot', 'CAB-1', '0']],
  })
  mount()
  fireEvent.click(screen.getByRole('button', { name: 'Opening stock' }))
  upload()
  expect(await screen.findByText(/Row 2 · Enter a positive whole number/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Review import' })).toBeDisabled()
  expect(rpc).not.toHaveBeenCalled()
})
