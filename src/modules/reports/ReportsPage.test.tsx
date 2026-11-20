import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkBook } from 'xlsx'

import { resetProtectedSessionRegistryForTest } from '@/lib/idempotency/pendingOperations'
import ReportsPage from './ReportsPage'

const { rpc, download } = vi.hoisted(() => ({
  rpc: vi.fn<(name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>>(),
  download: vi.fn<(workbook: WorkBook, filename: string) => void>(),
}))

let identity: string
let permissions: string[]
vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuth: () => ({
    status: 'authenticated',
    session: { userId: identity },
    access: { profile: { id: identity }, permissionKeys: permissions },
    authEpoch: 1,
  }),
}))
vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: () => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      const response = rpc(name, args)
      return Object.assign(response, { abortSignal: () => response })
    },
  }),
}))
vi.mock('xlsx', async (importOriginal) => ({
  ...await importOriginal<typeof import('xlsx')>(),
  writeFile: download,
}))

const baseline = {
  fromDate: '2026-01-01',
  toDate: '2026-10-31',
  headcount: 12,
  hires: 2,
  exits: 1,
  averageHeadcount: 11.5,
  turnoverRate: 8.7,
  monthly: [{ month: '2026-10-01', headcount: 12, hires: 2, exits: 1 }],
  departments: [{ label: 'Field Services', count: 12 }],
  genders: [{ label: 'Female', count: 6 }],
  ageBands: [{ label: '25–34', count: 9 }],
  employmentTypes: [{ label: 'Full time', count: 12 }],
  exitReasons: [{ label: 'Resigned', count: 1 }],
  departmentOptions: [{ id: 'a0000000-0000-4000-8000-000000000001', label: 'Field Services' }],
  coverage: { missingBirthdate: 0, missingGender: 0, missingEmploymentPeriods: 0 },
}

function bootstrap(search = '', client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const tree = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/system/reports' + search]}><ReportsPage /></MemoryRouter>
    </QueryClientProvider>
  )
  const view = render(tree())
  return () => view.rerender(tree())
}

function openWorkforce() {
  return bootstrap('?report=workforce&from=2026-01-01&to=2026-10-31')
}

describe('Batch 7D reports', () => {
  beforeEach(() => {
    resetProtectedSessionRegistryForTest()
    identity = 'a1000000-0000-4000-8000-000000000001'
    permissions = ['reports.view']
    rpc.mockReset()
    download.mockReset()
    rpc.mockResolvedValue({ data: baseline, error: null })
  })

  it('opens report questions without fetching any figures on the hub', () => {
    bootstrap()
    expect(screen.getByRole('heading', { name: 'Reports' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /How is our workforce changing/u })).toHaveAttribute('href', '/system/reports?report=workforce')
    expect(screen.getByRole('link', { name: /What are our payroll and staff advance figures/u })).toHaveAttribute('href', '/system/reports?report=payroll')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('blocks an account without the underlying report permission', () => {
    permissions = []
    openWorkforce()
    expect(screen.getByText(/permission denied/iu)).toBeInTheDocument()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('reloads the workforce report with the exact applied dates and filters', async () => {
    openWorkforce()
    await screen.findByRole('heading', { name: 'Monthly workforce movement' })
    const department = screen.getByLabelText('Department')
    fireEvent.change(department, { target: { value: baseline.departmentOptions[0].id } })
    fireEvent.change(screen.getByLabelText('Employment type'), { target: { value: 'full_time' } })
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-02-01' } })
    expect(rpc).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
    await waitFor(() => expect(rpc).toHaveBeenLastCalledWith('rpc_get_hr_workforce_report', {
      p_from: '2026-02-01',
      p_to: '2026-10-31',
      p_department_id: baseline.departmentOptions[0].id,
      p_employment_type: 'full_time',
    }))
  })

  it('distinguishes a payroll permission restriction from an empty authorized run list', async () => {
    rpc.mockResolvedValue({
      data: { fromDate: baseline.fromDate, toDate: baseline.toDate, payroll: { runs: [] }, advances: null },
      error: null,
    })
    bootstrap('?report=payroll&from=2026-01-01&to=2026-10-31')
    expect(await screen.findByText('No approved payroll runs in this period.')).toBeInTheDocument()
    expect(screen.getByText('Staff advance figures require additional access.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Export Excel' })).not.toBeInTheDocument()
  })

  it('shows a retry after a report load failure', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Private backend detail' } })
    openWorkforce()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load this report.')
    expect(screen.queryByText('Private backend detail')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: 'Monthly workforce movement' })).toBeInTheDocument()
  })

  it('records the exact report export before downloading the workbook', async () => {
    permissions.push('reports.export')
    rpc.mockImplementation((name) => Promise.resolve({
      data: name === 'record_report_export' ? null : baseline,
      error: null,
    }))
    openWorkforce()
    fireEvent.click(await screen.findByRole('button', { name: 'Export Excel' }))
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1))
    expect(rpc).toHaveBeenLastCalledWith('record_report_export', {
      p_report_name: 'hr-workforce',
      p_format: 'excel',
    })
    expect(rpc.mock.invocationCallOrder[1]).toBeLessThan(download.mock.invocationCallOrder[0])
    const [book, filename] = download.mock.calls[0]
    expect(book.Sheets['Monthly movement'].B2).toMatchObject({ t: 'n', v: 12 })
    expect(filename).toBe('OneHub-Workforce-2026-01-01-to-2026-10-31.xlsx')
  })

  it('shows approved dated leave allocations only to the leave reporting role', async () => {
    permissions.push('leave.manage')
    rpc.mockResolvedValue({ data: {
      ...baseline,
      rows: [{ label: 'Annual', days: 1.5, requests: 2 }],
    }, error: null })
    bootstrap('?report=leave&from=2026-01-01&to=2026-10-31')
    expect(await screen.findByRole('heading', { name: 'Leave utilization' })).toBeInTheDocument()
    expect(await screen.findByRole('cell', { name: '1.5' })).toBeInTheDocument()
    expect(rpc).toHaveBeenCalledWith('rpc_get_hr_leave_utilization', {
      p_from: '2026-01-01', p_to: '2026-10-31', p_department_id: null,
    })
  })

  it('keeps organization-wide attendance reports out of team-only access', () => {
    permissions.push('attendance.team_review')
    bootstrap('?report=department-attendance')
    expect(screen.getByText(/permission denied/iu)).toBeInTheDocument()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('keeps salary bands behind payroll access and consumes current snapshot counts', async () => {
    permissions.push('payroll.read')
    rpc.mockResolvedValue({ data: {
      ...baseline, rows: [{ label: '1M to under 3M', people: 4 }, { label: 'No UGX salary recorded', people: 1 }],
    }, error: null })
    bootstrap('?report=salary-spread')
    expect(await screen.findByRole('rowheader', { name: '1M to under 3M' })).toBeInTheDocument()
    expect(screen.queryByLabelText('From date')).not.toBeInTheDocument()
    expect(rpc).toHaveBeenCalledWith('rpc_get_hr_workforce_detail', expect.objectContaining({
      p_kind: 'salary-spread', p_from: null, p_to: null,
    }))
  })

  it('renders named record completeness only for an employee records reader', () => {
    bootstrap('?report=record-completeness')
    expect(screen.getByText(/permission denied/iu)).toBeInTheDocument()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('sends reminders to the selected employees only and reloads the report', async () => {
    permissions.push('leave.manage')
    const data = { ...baseline, weeksLeft: 6, weekdaysLeft: 30, rows: [
      { id: identity, label: 'QA Person', department: 'Field Services', entitled: 21,
        taken: 5, booked: 2, remaining: 14, pending: 0, flagged: true, lastReminded: null, canRemind: true },
      { id: 'a1000000-0000-4000-8000-000000000002', label: 'QA Other', department: 'Field Services', entitled: 21,
        taken: 5, booked: 2, remaining: 14, pending: 0, flagged: true, lastReminded: null, canRemind: true },
    ] }
    rpc.mockImplementation((name) => Promise.resolve({
      data: name === 'rpc_send_hr_leave_year_end_reminders' ? { sent: 1, skipped: 0 } : data,
      error: null,
    }))
    bootstrap('?report=leave-year-end')
    const send = await screen.findByRole('button', { name: 'Send in-app reminders' })
    expect(send).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Remind QA Person' }))
    fireEvent.click(send)
    expect(await screen.findByText('1 sent · 0 skipped')).toBeInTheDocument()
    expect(rpc).toHaveBeenCalledWith('rpc_send_hr_leave_year_end_reminders', { p_employee_ids: [identity] })
    expect(rpc.mock.calls.filter(([name]) => name === 'rpc_get_hr_leave_year_end')).toHaveLength(2)
  })

  it('withholds the file after an audit response for a previous account', async () => {
    permissions.push('reports.export')
    let finishAudit: (result: { data: unknown; error: unknown }) => void = () => undefined
    const pending = new Promise<{ data: unknown; error: unknown }>((resolve) => {
      finishAudit = resolve
    })
    rpc.mockImplementation((name) => name === 'record_report_export'
      ? pending
      : Promise.resolve({ data: baseline, error: null }))
    const rerender = openWorkforce()
    fireEvent.click(await screen.findByRole('button', { name: 'Export Excel' }))
    await waitFor(() => expect(rpc).toHaveBeenLastCalledWith('record_report_export', {
      p_report_name: 'hr-workforce',
      p_format: 'excel',
    }))
    act(() => {
      identity = 'a2000000-0000-4000-8000-000000000001'
      permissions = []
      rerender()
    })
    await act(async () => {
      finishAudit({ data: null, error: null })
      await pending
    })
    expect(screen.getByText(/permission denied/iu)).toBeInTheDocument()
    expect(within(document.body).queryByRole('button', { name: 'Export Excel' })).not.toBeInTheDocument()
    expect(download).not.toHaveBeenCalled()
  })
})
