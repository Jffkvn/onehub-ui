import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resetProtectedSessionRegistryForTest } from '@/lib/idempotency/pendingOperations'
import { WarehouseRequestDetailPage, WarehouseRequestsPage } from './WarehouseRequests'

const fixtures = {
  request: 'a9000000-0000-4000-8000-000000000001',
  project: 'a9000000-0000-4000-8000-000000000002',
  asset: 'a9000000-0000-4000-8000-000000000003',
  warehouse: 'a9000000-0000-4000-8000-000000000004',
  row: 'a9000000-0000-4000-8000-000000000005',
  profile: 'a9000000-0000-4000-8000-000000000006',
  unrelated: 'a9000000-0000-4000-8000-000000000007',
}
const { rpc, from } = vi.hoisted(() => ({
  rpc: vi.fn<(name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: null }>>(),
  from: vi.fn(),
}))

let permissions: string[]
let role: string
let status: string
let escalated: boolean
let issuedQuantity: number
let includeEquipment: boolean
let includeConsumables: boolean

vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuth: () => ({
    status: 'authenticated',
    authEpoch: 1,
    session: { userId: fixtures.profile },
    access: { profile: { id: fixtures.profile }, permissionKeys: permissions, roleKeys: [role] },
  }),
}))
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => ({ rpc, from }) }))

function mount(id?: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/inventory/requests' + (id ? '/' + id : '')]}>
        <Routes>
          <Route path="/inventory/requests" element={<WarehouseRequestsPage />} />
          <Route path="/inventory/requests/:requestId" element={<WarehouseRequestDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('warehouse requests', () => {
  beforeEach(() => {
    resetProtectedSessionRegistryForTest()
    status = 'pending_approval'
    issuedQuantity = 0
    includeEquipment = true
    includeConsumables = false
    escalated = false
    role = 'coordinator'
    permissions = ['inventory.read', 'inventory.request']
    rpc.mockReset()
    from.mockReset()
    rpc.mockImplementation((name) => Promise.resolve({
      error: null,
      data: name === 'rpc_list_stock_requests' ? [{
        id: fixtures.request, project_name: 'Tower 4', requester_name: 'QA Coordinator',
        requester_role: 'Coordinator', status, escalated_to_cfo: escalated, total_estimated_value: 100000,
        created_at: '2026-11-15T13:00:00+03:00',
      }] : name === 'rpc_request_stock' ? fixtures.request : null,
    }))
    from.mockImplementation((table: string) => {
      const records: Record<string, unknown[]> = {
        projects: [{ id: fixtures.project, name: 'Tower 4' }, { id: fixtures.unrelated, name: 'Unassigned Tower' }],
        project_assignments: [{ project_id: fixtures.project }],
        equipment_assets: [{ id: fixtures.asset, model_name: 'Splicer', serial_number: 'SP-1', is_sensitive: true }],
        consumable_items: [],
        warehouses: [{ id: fixtures.warehouse, name: 'Main depot' }],
        stock_request_items: [
          ...(includeEquipment ? [{
            id: fixtures.row, quantity: 1, quantity_issued: issuedQuantity, estimated_unit_price: 100000,
            expected_return_date: '2027-01-01', consumable_items: null,
            equipment_assets: { model_name: 'Splicer', serial_number: 'SP-1' },
          }] : []),
          ...(includeConsumables ? [{
            id: 'a9000000-0000-4000-8000-000000000008', quantity: 5, quantity_issued: 0, estimated_unit_price: 2000,
            expected_return_date: null, consumable_items: { name: 'Cable ties', sku: 'CT-1', unit_of_measure: 'pack' },
            equipment_assets: null,
          }] : []),
        ],
      }
      const response = Promise.resolve({ data: records[table], error: null })
      ;(from as unknown as { eqCalls?: unknown[][] }).eqCalls ??= []
      const eq = vi.fn((col: string, val: unknown) => {
        if (table === 'equipment_assets') {
          ;(from as unknown as { eqCalls: unknown[][] }).eqCalls.push([col, val])
        }
        return builder
      })
      const builder = { select: () => builder, eq, in: () => builder, is: () => builder,
        order: () => builder, then: response.then.bind(response) }
      return builder
    })
  })

  it('submits a serialized equipment request only for an assigned project', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'New stock request' }))
    const form = within(screen.getByRole('dialog'))
    await form.findByRole('option', { name: 'Tower 4' })
    expect(form.queryByRole('option', { name: 'Unassigned Tower' })).not.toBeInTheDocument()
    fireEvent.change(form.getByLabelText('Project'), { target: { value: fixtures.project } })
    fireEvent.change(form.getByLabelText('Item type'), { target: { value: 'equipment' } })
    fireEvent.change(form.getByLabelText('Item'), { target: { value: fixtures.asset } })
    fireEvent.change(form.getByLabelText('Expected return date'), { target: { value: '2027-01-01' } })
    fireEvent.click(form.getByRole('button', { name: 'Add item' }))
    fireEvent.click(form.getByRole('button', { name: 'Submit request' }))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('rpc_request_stock', {
      p_project_id: fixtures.project,
      p_items: [{ consumable_item_id: null, equipment_asset_id: fixtures.asset, quantity: 1, expected_return_date: '2027-01-01' }],
    }))
    expect((from as unknown as { eqCalls?: unknown[][] }).eqCalls).toContainEqual(['asset_kind', 'general'])
  })

  it('keeps escalated approval with the finance permission', async () => {
    permissions = ['inventory.read', 'inventory.issue']
    role = 'warehouse_manager'
    escalated = true
    mount(fixtures.request)
    expect(await screen.findByText('CFO approval required')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve request' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Issue remaining items' })).not.toBeInTheDocument()
  })

  it('lets finance approve an escalated request without issuing stock', async () => {
    permissions = ['inventory.read', 'inventory.approve']
    role = 'cfo'
    escalated = true
    mount(fixtures.request)
    fireEvent.click(await screen.findByRole('button', { name: 'Approve request' }))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('rpc_approve_stock_request', { p_request_id: fixtures.request }))
    expect(screen.queryByRole('button', { name: 'Issue remaining items' })).not.toBeInTheDocument()
  })

  it('uses the canonical per-item issue path for an approved request', async () => {
    permissions = ['inventory.read', 'inventory.issue']
    role = 'warehouse_manager'
    status = 'approved'
    mount(fixtures.request)
    await screen.findByRole('option', { name: 'Main depot' })
    fireEvent.change(screen.getByLabelText('Issue from warehouse'), { target: { value: fixtures.warehouse } })
    fireEvent.change(screen.getByLabelText('Issue condition'), { target: { value: 'Inspected and working' } })
    fireEvent.click(screen.getByRole('button', { name: 'Issue Splicer' }))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('rpc_issue_request_item', {
      p_request_item_id: fixtures.row, p_warehouse_id: fixtures.warehouse, p_issue_condition: 'Inspected and working',
    }))
  })

  it('offers per-line issue for equipment only on a mixed request', async () => {
    permissions = ['inventory.read', 'inventory.issue']
    role = 'warehouse_manager'
    status = 'approved'
    includeConsumables = true
    mount(fixtures.request)

    expect(await screen.findByRole('button', { name: 'Issue Splicer' })).toBeInTheDocument()
    expect(screen.getByText('Cable ties')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Issue Cable ties' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Issue condition')).toBeInTheDocument()
  })

  it('issues a consumables-only request with the remaining-items action', async () => {
    permissions = ['inventory.read', 'inventory.issue']
    role = 'warehouse_manager'
    status = 'approved'
    includeEquipment = false
    includeConsumables = true
    mount(fixtures.request)

    await screen.findByRole('option', { name: 'Main depot' })
    expect(screen.queryByLabelText('Issue condition')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Issue from warehouse'), { target: { value: fixtures.warehouse } })
    fireEvent.click(screen.getByRole('button', { name: 'Issue remaining items' }))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('rpc_issue_stock', {
      p_request_id: fixtures.request,
      p_warehouse_id: fixtures.warehouse,
    }))
    expect(rpc.mock.calls.some(([name]) => name === 'rpc_issue_request_item')).toBe(false)
  })

  it('keeps an inaccessible request out of view and skips its item query', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    mount(fixtures.request)
    expect(await screen.findByText('Stock request unavailable')).toBeInTheDocument()
    expect(from).not.toHaveBeenCalled()
  })
})
