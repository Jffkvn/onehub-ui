import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { resetProtectedSessionRegistryForTest } from '@/lib/idempotency/pendingOperations'
import EmployeeEquipmentPage from './EmployeeEquipmentPage'

const actor = '71290000-0000-4000-8000-000000000001'
const requestId = '71290000-0000-4000-8000-000000000031'
const toolId = '71290000-0000-4000-8000-000000000023'
const stockId = '71290000-0000-4000-8000-000000000041'
const { rpc, storageFrom, from } = vi.hoisted(() => ({ rpc: vi.fn(), storageFrom: vi.fn(), from: vi.fn() }))
let permissions: string[]
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => ({ rpc, from, storage: { from: storageFrom } }) }))
vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuth: () => ({
    status: 'authenticated', authEpoch: 1, session: { userId: actor },
    access: { permissionKeys: permissions },
  }),
}))

const request = {
  id: requestId, category: 'Meters', description: 'Optical meter', business_reason: 'Inspection on site',
  urgency: 'normal', status: 'pending', version: 3, review_note: null, attachments: [],
  employee_name: 'QA Employee', own_request: false, stock_request_id: null, equipment_asset_id: null, expected_return_date: null,
}
const stockPage = <h1>Existing stock request details</h1>

function mount(manage = false) {
  render(<QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={['/equipment']}>
      <Routes>
        <Route path="/equipment" element={<EmployeeEquipmentPage manage={manage} />} />
        <Route path={'/inventory/requests/' + stockId} element={stockPage} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>)
}

beforeEach(() => {
  resetProtectedSessionRegistryForTest()
  permissions = ['equipment_requests.read_self']
  rpc.mockReset()
  from.mockReset()
  storageFrom.mockReset()
  vi.stubGlobal('crypto', { randomUUID: () => requestId })
  rpc.mockImplementation((name: string) => {
    if (name === 'rpc_list_employee_equipment') return { abortSignal: () => Promise.resolve({
      error: null, data: { linked: true, requests: [], issued: [], total: 0 },
    }) }
    if (name === 'rpc_save_employee_equipment_request') return Promise.resolve({ error: null, data: requestId })
    return Promise.resolve({ error: null, data: stockId })
  })
})

afterEach(() => vi.unstubAllGlobals())

it('lets an employee submit a tool request without a project or stock permission', async () => {
  mount()
  fireEvent.click(await screen.findByRole('button', { name: 'New equipment request' }))
  const form = within(screen.getByRole('dialog'))
  fireEvent.change(form.getByLabelText('Category'), { target: { value: 'Meters' } })
  fireEvent.change(form.getByLabelText('Equipment needed'), { target: { value: 'Optical meter' } })
  fireEvent.change(form.getByLabelText('Business reason'), { target: { value: 'Inspection on site' } })
  fireEvent.click(form.getByRole('button', { name: 'Submit request' }))

  await screen.findByText('Equipment request updated.')
  expect(rpc).toHaveBeenCalledWith('rpc_save_employee_equipment_request', {
    p_request_id: requestId, p_expected_version: null, p_category: 'Meters',
    p_description: 'Optical meter', p_business_reason: 'Inspection on site', p_urgency: 'normal', p_attachments: [],
  })
})

it('hands warehouse staff off to the existing stock request for approval and issue', async () => {
  permissions = ['inventory.issue']
  rpc.mockImplementation((name: string) => name === 'rpc_list_employee_equipment'
    ? { abortSignal: () => Promise.resolve({ error: null, data: { linked: false, requests: [request], issued: [], total: 1 } }) }
    : Promise.resolve({ error: null, data: stockId }))
  const eqCalls: unknown[][] = []
  from.mockImplementation(() => {
    const find = { select: () => find, eq: (col: string, val: unknown) => { eqCalls.push([col, val]); return find },
      not: () => find, order: () => find, limit: () => find,
      abortSignal: () => Promise.resolve({ error: null, data: [{ id: toolId, model_name: 'QA Optical Meter', serial_number: 'QA-METER-001' }] }) }
    return find
  })

  mount(true)
  fireEvent.click(await screen.findByRole('button', { name: 'Prepare stock request' }))
  const form = within(screen.getByRole('dialog'))
  await form.findByRole('option', { name: 'QA-METER-001 · QA Optical Meter' })
  expect(eqCalls).toContainEqual(['asset_kind', 'general'])
  fireEvent.change(form.getByLabelText('Available equipment'), { target: { value: toolId } })
  fireEvent.change(form.getByLabelText('Expected return date'), { target: { value: '2099-01-01' } })
  fireEvent.click(form.getByRole('button', { name: 'Prepare stock request' }))

  await screen.findByRole('heading', { name: 'Existing stock request details' })
  expect(rpc).toHaveBeenCalledWith('rpc_prepare_employee_equipment_request', {
    p_request_id: requestId, p_expected_version: 3, p_equipment_asset_id: toolId, p_return_by: '2099-01-01',
  })
})
