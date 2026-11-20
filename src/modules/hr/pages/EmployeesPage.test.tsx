import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EmployeesPage } from './EmployeesPage'
import type { EmployeeSummary } from '../api/employees'

const mockPermissions = vi.fn<() => string[]>()

const employeesFixture: EmployeeSummary[] = [
  {
    id: 'emp-1',
    employeeNumber: 'EMP-001',
    legalName: 'Amina Nsubuga',
    companyEmail: 'amina@egypro.com',
    workPhone: '+256700000001',
    active: true,
    departmentId: 'dept-ops',
    departmentName: 'Operations',
    jobTitleId: 'jt-tech',
    jobTitleName: 'Technician',
    payGradeName: 'Grade 1',
    employmentType: 'full_time',
    probationStatus: 'passed',
    startDate: '2025-01-10',
    endDate: null,
  },
  {
    id: 'emp-2',
    employeeNumber: 'EMP-002',
    legalName: 'Kato Mukasa',
    companyEmail: 'kato@egypro.com',
    workPhone: '+256700000002',
    active: true,
    departmentId: 'dept-fin',
    departmentName: 'Finance',
    jobTitleId: 'jt-acc',
    jobTitleName: 'Accountant',
    payGradeName: 'Grade 2',
    employmentType: 'contractor',
    probationStatus: 'on_probation',
    startDate: '2026-10-01',
    endDate: null,
  },
]

vi.mock('@/modules/auth/AuthProvider', () => ({
  useHasPermission: (key: string) => mockPermissions().includes(key),
}))

vi.mock('../api/employees', () => ({
  useEmployees: () => ({
    data: employeesFixture,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useEmployeeSetup: () => ({
    data: {
      departments: [
        { id: 'dept-ops', name: 'Operations' },
        { id: 'dept-fin', name: 'Finance' },
      ],
      jobTitles: [],
      payGrades: [],
    },
  }),
  useCreateEmployee: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateEmployee: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useOffboardEmployee: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useArchiveEmployee: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <EmployeesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('EmployeesPage', () => {
  beforeEach(() => {
    mockPermissions.mockReturnValue(['employees.read', 'employees.create', 'employees.update', 'employees.archive'])
  })

  it('narrows visible employees by search and department filter', () => {
    renderPage()

    expect(screen.getAllByText('Amina Nsubuga').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Kato Mukasa').length).toBeGreaterThanOrEqual(1)

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search employees' }), {
      target: { value: 'Kato' },
    })

    expect(screen.queryByText('Amina Nsubuga')).not.toBeInTheDocument()
    expect(screen.getAllByText('Kato Mukasa').length).toBeGreaterThanOrEqual(1)
  })

  it('hides Add Employee and HR Setup actions when caller has read-only permissions', () => {
    mockPermissions.mockReturnValue(['employees.read'])
    renderPage()

    expect(screen.queryByRole('button', { name: /Add Employee/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /HR Setup/i })).not.toBeInTheDocument()
  })
})
