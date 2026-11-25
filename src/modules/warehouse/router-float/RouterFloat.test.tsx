import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ToastProvider } from '@/components/ui/Toast'
import { resetProtectedSessionRegistryForTest } from '@/lib/idempotency/pendingOperations'
import { MyRouterFloatPage } from './MyRouterFloatPage'
import { RouterFloatPage } from './RouterFloatPage'
import { parseRouterBatchText, parseRouterBatchWorkbookRows, validateRouterBatchDraft } from './routerFloatApi'
import { ServiceRequestRoutersPanel } from './ServiceRequestRoutersPanel'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  permissions: ['inventory.read', 'inventory.issue', 'inventory.receipt'] as string[],
  userId: '7f320000-0000-4000-8000-000000000001',
}))

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: () => ({ from: mocks.from, rpc: mocks.rpc }),
}))

vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuth: () => ({
    status: 'authenticated',
    authEpoch: 1,
    session: { userId: mocks.userId },
    access: {
      profile: { id: mocks.userId },
      permissionKeys: mocks.permissions,
    },
  }),
}))

function mountWithProviders(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>{ui}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

function tableQuery(rows: unknown[]) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    abortSignal: vi.fn(() => Promise.resolve({ data: rows, error: null })),
  }
}

function rpcResult(data: unknown, error: { code?: string; message?: string } | null = null) {
  return {
    data,
    error,
    abortSignal: vi.fn(() => Promise.resolve({ data, error })),
  }
}

describe('Router batch parser & inline duplicate validation', () => {
  it('parses mixed models and bare USB-scanner serial lines, then catches and clears duplicates after inline edit', () => {
    const raw = [
      'Model, SN, MAC, Price',
      'Huawei HG8245H5, SN-101, AA:BB:CC:00:00:01, 185000',
      'SN-102',
      'TP-Link Archer C6, SN-101, AA:BB:CC:00:00:02, 220000',
    ].join('\n')

    const parsed = parseRouterBatchText(raw, 'Huawei HG8245H5', '185000')
    expect(parsed).toHaveLength(3)
    expect(parsed[1]?.model_name).toBe('Huawei HG8245H5')
    expect(parsed[1]?.unit_price).toBe('185000')

    const initialValidation = validateRouterBatchDraft(parsed)
    expect(initialValidation.hasErrors).toBe(true)
    expect(initialValidation.rowErrors[parsed[0].id]?.[0]).toContain('Duplicate serial')
    expect(initialValidation.rowErrors[parsed[2].id]?.[0]).toContain('Duplicate serial')

    const fixed = parsed.map((row, idx) =>
      idx === 2 ? { ...row, serial_number: 'SN-103' } : row,
    )
    const cleanValidation = validateRouterBatchDraft(fixed)
    expect(cleanValidation.hasErrors).toBe(false)
    expect(cleanValidation.totalValue).toBe(590000)
  })

  it('maps Model, Unit Price, SN CSV and quoted fields by header with MAC omitted across CSV and workbook parsers', () => {
    const csv = [
      'Model,Unit Price,SN',
      'Huawei HG8245H5,185000,HW-SN-001',
      '"Huawei, HG8245H5","220,000","HW-SN-002"',
    ].join('\n')

    const csvRows = parseRouterBatchText(csv, 'Fallback Model', '0')
    expect(csvRows).toHaveLength(2)
    expect(csvRows[0]).toMatchObject({
      model_name: 'Huawei HG8245H5',
      unit_price: '185000',
      serial_number: 'HW-SN-001',
      mac_address: '',
    })
    expect(csvRows[1]).toMatchObject({
      model_name: 'Huawei, HG8245H5',
      unit_price: '220000',
      serial_number: 'HW-SN-002',
      mac_address: '',
    })
    expect(validateRouterBatchDraft(csvRows).totalValue).toBe(405000)

    const workbookRows = parseRouterBatchWorkbookRows(
      [
        ['Unit Price', 'SN', 'Model'],
        ['185,000', 'WB-SN-001', 'TP-Link C6'],
      ],
      'Fallback Model',
      '0',
    )
    expect(workbookRows[0]).toMatchObject({
      model_name: 'TP-Link C6',
      unit_price: '185000',
      serial_number: 'WB-SN-001',
      mac_address: '',
    })
  })

  it('parses headerless Model, Unit Price, SN and optional MAC pastes without swapping numeric serials for prices', () => {
    const threeCol = parseRouterBatchText(
      'Huawei HG8245H5, 185000, 2150084192001\nTP-Link Archer C6, 220000, 9988776655',
      'Fallback Model',
      '0',
    )
    expect(threeCol).toHaveLength(2)
    expect(threeCol[0]).toMatchObject({
      model_name: 'Huawei HG8245H5',
      unit_price: '185000',
      serial_number: '2150084192001',
      mac_address: '',
    })
    expect(threeCol[1]).toMatchObject({
      model_name: 'TP-Link Archer C6',
      unit_price: '220000',
      serial_number: '9988776655',
      mac_address: '',
    })

    const fourCol = parseRouterBatchText(
      'Huawei HG8245H5, 185000, 2150084192001, AA:BB:CC:11:22:33',
      'Fallback Model',
      '0',
    )
    expect(fourCol[0]).toMatchObject({
      model_name: 'Huawei HG8245H5',
      unit_price: '185000',
      serial_number: '2150084192001',
      mac_address: 'AA:BB:CC:11:22:33',
    })
    expect(validateRouterBatchDraft(fourCol).totalValue).toBe(185000)
  })
})

describe('RouterFloatPage warehouse workflow', () => {
  const whId = '11111111-1111-4111-8111-111111111111'
  const techId = '22222222-2222-4222-8222-222222222222'
  const asset1 = '33333333-3333-4333-8333-333333333331'
  const asset2 = '33333333-3333-4333-8333-333333333332'
  const custodyPending = '44444444-4444-4444-8444-444444444441'
  const custodyFaulty = '44444444-4444-4444-8444-444444444442'

  beforeEach(() => {
    vi.clearAllMocks()
    resetProtectedSessionRegistryForTest()
    mocks.permissions = ['inventory.read', 'inventory.issue', 'inventory.receipt', 'router_float.read']
    mocks.userId = '7f320000-0000-4000-8000-000000000001'

    mocks.from.mockImplementation((table: string) => {
      if (table === 'warehouses') {
        return tableQuery([{ id: whId, code: 'HQ-01', name: 'HQ Depot' }])
      }
      return tableQuery([{ id: 'cat-1', name: 'Fixed-Internet CPE Routers' }])
    })
  })

  it('enforces remaining cap slots during issuance, cancels pending handover, and confirms faulty return', async () => {
    mocks.rpc.mockImplementation((name: string) => {
      if (name === 'rpc_list_router_float_overview') {
        return rpcResult({
          cap: 5,
          technicians: [
            {
              profile_id: techId,
              display_name: 'Kato Brian',
              employee_number: 'EMP-09',
              pending_count: 1,
              confirmed_count: 2,
              faulty_count: 1,
              active_total: 4,
              remaining_slots: 1,
            },
          ],
          available_routers: [
            {
              id: asset1,
              model_name: 'Huawei HG8245H5',
              serial_number: 'HW-NEW-01',
              mac_address: 'AA:11:22:33:44:01',
              warehouse_id: whId,
              warehouse_name: 'HQ Depot',
            },
            {
              id: asset2,
              model_name: 'Huawei HG8245H5',
              serial_number: 'HW-NEW-02',
              mac_address: 'AA:11:22:33:44:02',
              warehouse_id: whId,
              warehouse_name: 'HQ Depot',
            },
          ],
          active_float: [
            {
              custody_id: custodyPending,
              equipment_asset_id: '33333333-3333-4333-8333-333333333338',
              model_name: 'Huawei HG8245H5',
              serial_number: 'HW-PND-08',
              mac_address: null,
              float_state: 'pending_handover',
              custodian_profile_id: techId,
              custodian_name: 'Kato Brian',
              warehouse_id: whId,
              warehouse_name: 'HQ Depot',
              issued_at: '2026-11-25T07:00:00Z',
              confirmed_at: null,
              faulty_reported_at: null,
              faulty_notes: null,
            },
            {
              custody_id: custodyFaulty,
              equipment_asset_id: '33333333-3333-4333-8333-333333333339',
              model_name: 'TP-Link C6',
              serial_number: 'TP-FLT-09',
              mac_address: 'BB:11:22:33:44:09',
              float_state: 'faulty_to_return',
              custodian_profile_id: techId,
              custodian_name: 'Kato Brian',
              warehouse_id: whId,
              warehouse_name: 'HQ Depot',
              issued_at: '2026-11-24T07:00:00Z',
              confirmed_at: '2026-11-24T07:05:00Z',
              faulty_reported_at: '2026-11-25T06:00:00Z',
              faulty_notes: 'No PON link',
            },
          ],
        })
      }
      return rpcResult({ issued_count: 1, active_total: 5, remaining_slots: 0, custody_ids: [] })
    })

    mountWithProviders(<RouterFloatPage />)

    expect(await screen.findByText('4 / 5')).toBeInTheDocument()
    expect(screen.getAllByText('Kato Brian').length).toBeGreaterThanOrEqual(1)

    // Select technician with 1 remaining slot
    fireEvent.change(screen.getByLabelText(/^Service Technician/i), { target: { value: techId } })
    expect(screen.getByText('Selected 0 of 1 remaining slot(s)')).toBeInTheDocument()

    const firstBox = screen.getByLabelText(/HW-NEW-01/)
    const secondBox = screen.getByLabelText(/HW-NEW-02/)
    fireEvent.click(firstBox)
    expect(firstBox).toBeChecked()
    expect(secondBox).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /Issue 1 router\(s\) to float/i }))
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith('rpc_issue_router_float', {
        p_technician_profile_id: techId,
        p_warehouse_id: whId,
        p_equipment_asset_ids: [asset1],
        p_issue_condition: 'Good working order',
      }),
    )

    // Cancel pending handover
    fireEvent.click(screen.getByRole('button', { name: 'Cancel handover' }))
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith('rpc_cancel_router_handover', {
        p_custody_id: custodyPending,
        p_reason: 'Cancelled at depot counter',
      }),
    )

    // Confirm faulty return via dialog — faulty_to_return locks strictly to Damaged / RMA and requires warehouse inspection note
    fireEvent.click(screen.getByRole('button', { name: 'Confirm return' }))
    const dialog = await screen.findByRole('dialog', { name: 'Confirm router float return' })
    expect(within(dialog).getByText('No PON link')).toBeInTheDocument()
    const conditionSelect = within(dialog).getByLabelText(/^Return condition/i)
    expect(conditionSelect).toHaveValue('damaged')
    expect(conditionSelect).toBeDisabled()
    expect(within(dialog).queryByRole('option', { name: /Good/i })).not.toBeInTheDocument()

    const notesInput = within(dialog).getByLabelText(/Warehouse inspection notes/i)
    expect(notesInput).toHaveValue('')
    const confirmReturnBtn = within(dialog).getByRole('button', { name: 'Confirm physical return' })
    expect(confirmReturnBtn).toBeDisabled()

    fireEvent.change(notesInput, { target: { value: 'Confirmed dead optical transceiver at depot' } })
    expect(confirmReturnBtn).toBeEnabled()
    fireEvent.click(confirmReturnBtn)

    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith('rpc_receive_router_float_return', {
        p_custody_id: custodyFaulty,
        p_warehouse_id: whId,
        p_condition: 'damaged',
        p_notes: 'Confirmed dead optical transceiver at depot',
      }),
    )
  })

  it('blocks Tower staff with inventory.read and service_requests.read when router_float.read is absent', async () => {
    mocks.permissions = ['inventory.read', 'inventory.request', 'service_requests.read']
    mountWithProviders(<RouterFloatPage />)
    expect(await screen.findByText('Router float access required')).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('flags existing inventory serials inline for a different delivery, while allowing an exact re-upload to reopen the original receipt', async () => {
    mocks.rpc.mockImplementation((name: string, args?: Record<string, unknown>) => {
      if (name === 'rpc_list_router_float_overview') {
        return rpcResult({ cap: 5, technicians: [], available_routers: [], active_float: [] })
      }
      if (name === 'rpc_check_existing_cpe_identifiers') {
        const serials = (args?.p_serial_numbers as string[]) ?? []
        const grn = typeof args?.p_grn_number === 'string' ? args.p_grn_number : ''
        if (grn === 'GRN-EXACT-REPLAY' && serials.some((s) => s.toLowerCase() === 'hw-existing-1')) {
          return rpcResult({
            existing_serials: [],
            existing_macs: [],
            replays_existing_receipt: true,
            grn_conflict: false,
            existing_receipt_id: '99999999-9999-4999-8999-999999999999',
            existing_asset_count: 1,
            existing_total_value: 185000,
          })
        }
        return rpcResult({
          existing_serials: serials.some((s) => s.toLowerCase() === 'hw-existing-1') ? ['hw-existing-1'] : [],
          existing_macs: [],
          replays_existing_receipt: false,
          grn_conflict: false,
          existing_receipt_id: null,
          existing_asset_count: null,
          existing_total_value: null,
        })
      }
      if (name === 'rpc_receive_cpe_router_batch') {
        return rpcResult({
          receipt_id: '99999999-9999-4999-8999-999999999999',
          asset_count: 1,
          total_value: 185000,
          replayed: true,
        })
      }
      return rpcResult({ receipt_id: '99999999-9999-4999-8999-999999999999', asset_count: 1, total_value: 185000, replayed: false })
    })

    mountWithProviders(<RouterFloatPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Receive Router Delivery/i }))

    fireEvent.change(screen.getByRole('textbox', { name: /^Supplier/i }), { target: { value: 'Huawei UG' } })
    fireEvent.change(screen.getByRole('textbox', { name: /^GRN reference/i }), { target: { value: 'GRN-NEW-CONFLICT' } })
    fireEvent.change(screen.getByRole('textbox', { name: /^Invoice number/i }), { target: { value: 'INV-100' } })

    fireEvent.change(screen.getByLabelText(/Paste lines or scan directly/i), {
      target: { value: 'Model,Unit Price,SN\nHuawei HG8245H5,185000,HW-EXISTING-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add lines to preview' }))

    expect(await screen.findByText('Serial "HW-EXISTING-1" already exists in inventory.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Receive 1 router\(s\)/i })).toBeDisabled()

    // Exact match with the saved delivery GRN clears the blocker and reopens the receipt cleanly
    fireEvent.change(screen.getByRole('textbox', { name: /^GRN reference/i }), { target: { value: 'GRN-EXACT-REPLAY' } })

    const reopenBtn = await screen.findByRole('button', { name: /Reopen recorded delivery receipt/i })
    await waitFor(() => expect(reopenBtn).toBeEnabled())
    fireEvent.click(reopenBtn)

    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith('rpc_receive_cpe_router_batch', expect.objectContaining({
        p_grn_number: 'GRN-EXACT-REPLAY',
      })),
    )
    expect(await screen.findByText(/Replayed idempotent delivery: 1 router\(s\)/i)).toBeInTheDocument()
  })
})

describe('Technician MyRouterFloatPage & ServiceRequestRoutersPanel', () => {
  const custodyPending = '55555555-5555-4555-8555-555555555551'
  const custodyReady = '55555555-5555-4555-8555-555555555552'
  const assetReady = '66666666-6666-4666-8666-666666666662'
  const reqId = '77777777-7777-4777-8777-777777777771'
  const visitId = '88888888-8888-4888-8888-888888888881'

  beforeEach(() => {
    vi.clearAllMocks()
    resetProtectedSessionRegistryForTest()
    mocks.permissions = ['service_visits.read_assigned', 'service_visits.work_assigned']
  })

  it('lets a technician confirm counter pickup and flag a faulty float unit', async () => {
    mocks.rpc.mockImplementation((name: string) => {
      if (name === 'rpc_list_my_router_float') {
        return rpcResult({
          cap: 5,
          pending_count: 1,
          confirmed_count: 1,
          faulty_count: 0,
          active_total: 2,
          remaining_slots: 3,
          items: [
            {
              custody_id: custodyPending,
              equipment_asset_id: '66666666-6666-4666-8666-666666666661',
              model_name: 'Huawei HG8245H5',
              serial_number: 'HW-PICK-01',
              mac_address: 'AA:00:00:00:00:01',
              float_state: 'pending_handover',
              warehouse_name: 'HQ Depot',
              issued_at: '2026-11-25T07:00:00Z',
              confirmed_at: null,
              faulty_reported_at: null,
              faulty_notes: null,
            },
            {
              custody_id: custodyReady,
              equipment_asset_id: assetReady,
              model_name: 'Huawei HG8245H5',
              serial_number: 'HW-RDY-02',
              mac_address: 'AA:00:00:00:00:02',
              float_state: 'with_technician',
              warehouse_name: 'HQ Depot',
              issued_at: '2026-11-24T07:00:00Z',
              confirmed_at: '2026-11-24T07:05:00Z',
              faulty_reported_at: null,
              faulty_notes: null,
            },
          ],
        })
      }
      return rpcResult({ confirmed_count: 1 })
    })

    mountWithProviders(<MyRouterFloatPage />)

    expect(await screen.findByText('2 / 5')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Received' }))
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith('rpc_confirm_router_handover', {
        p_custody_ids: [custodyPending],
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Report Faulty' }))
    const dialog = await screen.findByRole('dialog', { name: 'Report faulty float router' })
    fireEvent.change(within(dialog).getByLabelText(/Fault description/i), {
      target: { value: 'Power adapter dead on arrival' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Flag as faulty' }))

    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith('rpc_report_router_faulty', {
        p_custody_id: custodyReady,
        p_faulty_notes: 'Power adapter dead on arrival',
      }),
    )
  })

  it('displays installed routers on a service ticket and records a 1-tap install from confirmed float', async () => {
    mocks.rpc.mockImplementation((name: string) => {
      if (name === 'rpc_list_service_request_routers') {
        return rpcResult([
          {
            custody_id: '99999999-9999-4999-8999-999999999991',
            equipment_asset_id: '99999999-9999-4999-8999-999999999992',
            model_name: 'TP-Link Archer C6',
            serial_number: 'TP-INST-99',
            mac_address: 'CC:00:00:00:00:99',
            installed_at: '2026-11-25T06:00:00Z',
            installed_by_name: 'Kato Brian',
            installed_service_visit_id: visitId,
            installed_site_name: 'Ntinda Complex',
            installed_area_label: 'Ntinda',
          },
        ])
      }
      if (name === 'rpc_list_my_router_float') {
        return rpcResult({
          cap: 5,
          pending_count: 0,
          confirmed_count: 1,
          faulty_count: 0,
          active_total: 1,
          remaining_slots: 4,
          items: [
            {
              custody_id: custodyReady,
              equipment_asset_id: assetReady,
              model_name: 'Huawei HG8245H5',
              serial_number: 'HW-RDY-02',
              mac_address: 'AA:00:00:00:00:02',
              float_state: 'with_technician',
              warehouse_name: 'HQ Depot',
              issued_at: '2026-11-24T07:00:00Z',
              confirmed_at: '2026-11-24T07:05:00Z',
              faulty_reported_at: null,
              faulty_notes: null,
            },
          ],
        })
      }
      return rpcResult({ custody_id: custodyReady })
    })

    mountWithProviders(
      <ServiceRequestRoutersPanel
        serviceRequestId={reqId}
        status="in_progress"
        openVisitId={visitId}
        isActiveCrewMember
      />,
    )

    expect(await screen.findByText(/TP-INST-99/)).toBeInTheDocument()
    const select = await screen.findByLabelText('Select router from my float')
    fireEvent.change(select, { target: { value: assetReady } })
    fireEvent.click(screen.getByRole('button', { name: 'Record Installed Router' }))

    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith('rpc_install_router_on_service_request', {
        p_equipment_asset_id: assetReady,
        p_service_request_id: reqId,
        p_service_visit_id: visitId,
      }),
    )
  })
})
