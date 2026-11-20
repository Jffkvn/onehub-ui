import { expect, it, vi } from 'vitest'
import { fetchEmployeesForImport } from './employeeImports'

const { from, select, order, rpc } = vi.hoisted(() => ({
  from: vi.fn(), select: vi.fn(), order: vi.fn(), rpc: vi.fn(),
}))
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => ({ from, rpc }) }))

it('derives the token from the exact employee, confidential and period rows returned in one read', async () => {
  from.mockReturnValue({ select })
  select.mockReturnValue({ order })
  const newestId = 'd0000000-0000-4000-8000-000000000010'
  order.mockResolvedValue({ error: null, data: [{
    id: 'd0000000-0000-4000-8000-000000000001',
    version: 7,
    archived_at: null,
    legal_name: 'Synthetic employee',
    employee_confidential_profiles: { version: 9, gross_salary: 1500000 },
    employment_periods: [
      { id: 'd0000000-0000-4000-8000-000000000009', version: 4, start_date: '2024-01-01', end_date: '2025-12-31' },
      { id: newestId, version: 6, start_date: '2026-01-01', end_date: null },
    ],
  }] })
  rpc.mockResolvedValue({ error: null, data: [] })

  expect(await fetchEmployeesForImport()).toEqual([expect.objectContaining({
    importVersionToken: `7:false:9:2:${newestId}@6`,
    grossSalary: 1500000,
    startDate: '2026-01-01',
  })])
  expect(rpc).not.toHaveBeenCalled()
  expect(from).toHaveBeenCalledTimes(1)
  expect(select).toHaveBeenCalledWith(expect.stringMatching(/version[\s\S]+employee_confidential_profiles\(\s*version[\s\S]+employment_periods\(\s*id, version/u))
})
