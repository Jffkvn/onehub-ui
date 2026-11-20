import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EmployeeDetailPage } from './EmployeeDetailPage'
import type { EmployeeSummary } from '../api/employees'
import { resetProtectedSessionRegistryForTest } from '@/lib/idempotency/pendingOperations'

const mockPermissions = vi.fn<() => string[]>()
const mockUpdate = vi.fn()
const mockOffboard = vi.fn()
const mockArchive = vi.fn()
const mockRpc = vi.fn<(name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>>()

const sampleEmployee: EmployeeSummary = {
  id: 'emp-1',
  employeeNumber: 'EMP-001',
  legalName: 'Amina Nsubuga',
  companyEmail: 'amina@egypro.test',
  workPhone: '+256700000001',
  active: true,
  archivedAt: null,
  departmentId: 'dept-1',
  departmentName: 'Operations',
  jobTitleId: 'jt-1',
  jobTitleName: 'Technician',
  payGradeId: 'pg-1',
  payGradeName: 'Grade One',
  startDate: '2025-01-10',
  endDate: null,
  grossSalary: 2500000,
  currency: 'UGX',
  paymentMethod: 'bank',
  bankName: 'Stanbic Bank',
  accountNumber: '9030001111222',
  tinNumber: '1001234567',
  nssfNumber: 'NS10001',
  employeeTaxType: 'local',
  pctMonthWorked: 100,
  whtRate: 6,
}

vi.mock('@/modules/auth/AuthProvider', () => ({
  useHasPermission: (key: string) => mockPermissions().includes(key),
  useAuth: () => ({ status: 'authenticated', session: { userId: 'hr-fixture' }, authEpoch: 1 }),
}))

vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => ({ rpc: mockRpc }) }))

vi.mock('../api/employees', () => ({
  useEmployee: () => ({
    data: sampleEmployee,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useEmployeeSetup: () => ({
    data: { departments: [], jobTitles: [], payGrades: [] },
  }),
  useCreateEmployee: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateEmployee: () => ({ mutateAsync: mockUpdate, isPending: false }),
  useOffboardEmployee: () => ({ mutateAsync: mockOffboard, isPending: false }),
  useArchiveEmployee: () => ({ mutateAsync: mockArchive, isPending: false }),
}))

function renderDetail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/people/employees/emp-1']}>
        <Routes>
          <Route path="/people/employees/:id" element={<EmployeeDetailPage />} />
          <Route path="/people/employees" element={<h1>Employees Directory</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('EmployeeDetailPage', () => {
  beforeEach(() => {
    resetProtectedSessionRegistryForTest()
    mockRpc.mockReset()
    mockRpc.mockResolvedValue({ data: { version: 0, records: [] }, error: null })
    mockPermissions.mockReturnValue(['employees.read', 'employees.update', 'employees.archive'])
    mockUpdate.mockReset()
    mockOffboard.mockReset()
    mockArchive.mockReset()
  })

  it('displays salary & statutory payroll details read-only and triggers validated exit and archive RPCs', async () => {
    mockOffboard.mockResolvedValue(undefined)
    mockArchive.mockResolvedValue(undefined)
    renderDetail()

    expect(screen.getByRole('heading', { name: 'Amina Nsubuga' })).toBeInTheDocument()
    expect(screen.getByText('UGX 2,500,000')).toBeInTheDocument()
    expect(screen.getByText('Grade One')).toBeInTheDocument()
    expect(screen.getByText('1001234567')).toBeInTheDocument()

    // Record exit workflow
    fireEvent.click(screen.getByRole('button', { name: /Record Exit/i }))
    fireEvent.change(screen.getByLabelText(/Last Working Day/i), {
      target: { value: '2026-12-31' },
    })
    fireEvent.change(screen.getByLabelText(/Exit Reason/i), {
      target: { value: 'Contract completed' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Confirm Exit/i }))

    await waitFor(() => {
      expect(mockOffboard).toHaveBeenCalledWith({
        id: 'emp-1',
        values: {
          endDate: '2026-12-31',
          exitReason: 'Contract completed',
          exitNotes: '',
          finalPayStatus: 'pending',
        },
      })
    })

    // Archive requires min 3 chars before submitting
    fireEvent.click(screen.getByRole('button', { name: /^Archive$/i }))
    fireEvent.click(screen.getByRole('button', { name: /Archive Employee/i }))
    expect(await screen.findByText(/at least 3 characters/i)).toBeInTheDocument()
    expect(mockArchive).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(/Archive Reason/i), {
      target: { value: 'Duplicate QA profile' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Archive Employee/i }))

    await waitFor(() => {
      expect(mockArchive).toHaveBeenCalledWith({
        id: 'emp-1',
        reason: 'Duplicate QA profile',
      })
    })
  })

  it('blocks edits only on the dossier section that could not load', async () => {
    mockRpc.mockImplementation((_name, args) => Promise.resolve(
      args.p_section === 'emergency_contacts'
        ? { data: null, error: { code: 'network', message: 'Connection lost' } }
        : { data: { version: 0, records: [] }, error: null },
    ))
    renderDetail()

    const contacts = screen.getByRole('region', { name: 'Emergency Contacts' })
    const history = screen.getByRole('region', { name: 'Previous Employment' })
    expect(await within(contacts).findByText('Emergency contacts could not load.')).toBeInTheDocument()
    expect(within(contacts).queryByRole('button', { name: 'Edit emergency contacts' })).not.toBeInTheDocument()
    expect(await within(history).findByRole('button', { name: 'Edit previous employment' })).toBeEnabled()
  })

  it('saves the loaded contact slots against their original version', async () => {
    mockRpc.mockImplementation((name, args) => {
      if (name === 'rpc_save_employee_dossier_section') return Promise.resolve({ data: 2, error: null })
      return Promise.resolve({
        data: {
          version: args.p_section === 'emergency_contacts' ? 1 : 0,
          records: args.p_section === 'emergency_contacts'
            ? [{ position: 2, full_name: 'Fixture Contact', relationship: 'Sibling', phone: '+256700000049', alt_phone: null }]
            : [],
        },
        error: null,
      })
    })
    renderDetail()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit emergency contacts' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit emergency contacts' })
    fireEvent.change(within(dialog).getByLabelText('Phone', { exact: true }), { target: { value: '+256700000099' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save contacts' }))

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('rpc_save_employee_dossier_section', {
        p_employee_id: 'emp-1',
        p_section: 'emergency_contacts',
        p_expected_version: 1,
        p_records: [{ position: 2, full_name: 'Fixture Contact', relationship: 'Sibling', phone: '+256700000099', alt_phone: null }],
      })
    })
  })

  it('hides Edit, Record Exit, and Archive buttons when caller only has employees.read', () => {
    mockPermissions.mockReturnValue(['employees.read'])
    renderDetail()

    expect(screen.getByRole('heading', { name: 'Amina Nsubuga' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Edit Employee/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Record Exit/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Archive$/i })).not.toBeInTheDocument()
  })
})
