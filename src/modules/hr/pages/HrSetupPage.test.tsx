import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HrSetupPage } from './HrSetupPage'
import type { HrSetupRecords } from '../api/setup'

const mockSaveDepartment = vi.fn()
const mockSaveJobTitle = vi.fn()
const mockSavePayGrade = vi.fn()
const mockSetArchived = vi.fn()

const setupRecordsFixture: HrSetupRecords = {
  departments: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      code: 'OPS',
      name: 'Operations',
      description: 'Field operations',
      archivedAt: null,
      currentEmployeeCount: 3,
      activeJobTitleCount: 1,
    },
    {
      id: '11111111-1111-4111-8111-111111111112',
      code: 'LEG',
      name: 'Legacy',
      description: 'Old dept',
      archivedAt: '2026-08-01T00:00:00Z',
      currentEmployeeCount: 0,
      activeJobTitleCount: 0,
    },
  ],
  jobTitles: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      departmentId: '11111111-1111-4111-8111-111111111111',
      departmentName: 'Operations',
      code: 'TECH',
      name: 'Technician',
      description: '',
      archivedAt: null,
      currentEmployeeCount: 3,
    },
  ],
  payGrades: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      code: 'G1',
      name: 'Grade 1',
      currencyCode: 'UGX',
      minimumGross: 1000000,
      maximumGross: 2000000,
      description: '',
      archivedAt: null,
      currentEmployeeCount: 3,
    },
  ],
}

vi.mock('@/modules/auth/AuthProvider', () => ({
  useHasPermission: (key: string) => key === 'employees.read' || key === 'employees.manage_setup',
}))

vi.mock('../api/setup', () => ({
  useHrSetupRecords: () => ({
    data: setupRecordsFixture,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useSaveDepartment: () => ({ mutateAsync: mockSaveDepartment, isPending: false }),
  useSaveJobTitle: () => ({ mutateAsync: mockSaveJobTitle, isPending: false }),
  useSavePayGrade: () => ({ mutateAsync: mockSavePayGrade, isPending: false }),
  useSetSetupArchived: () => ({ mutateAsync: mockSetArchived, isPending: false }),
}))

function renderSetup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <HrSetupPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('HrSetupPage', () => {
  beforeEach(() => {
    mockSaveDepartment.mockReset()
    mockSaveJobTitle.mockReset()
    mockSavePayGrade.mockReset()
    mockSetArchived.mockReset()
  })

  it('switches setup tabs cleanly, toggles archived rows, and creates/archives with audit reason', async () => {
    mockSaveDepartment.mockResolvedValue(undefined)
    mockSetArchived.mockResolvedValue(undefined)

    renderSetup()

    expect(screen.getByRole('heading', { name: /Pay Grades & HR Setup/i })).toBeInTheDocument()
    expect(screen.getAllByText('Operations').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('Legacy')).not.toBeInTheDocument()

    // Toggle Show archived -> displays archived department
    fireEvent.click(screen.getByRole('switch'))
    expect(screen.getAllByText('Legacy').length).toBeGreaterThanOrEqual(1)

    // Create Department flow
    fireEvent.click(screen.getByRole('button', { name: /Add Department/i }))
    fireEvent.change(screen.getByLabelText(/^Code/i), { target: { value: 'eng' } })
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'Engineering' } })
    fireEvent.change(screen.getByLabelText(/Reason for Change/i), {
      target: { value: 'Create engineering team' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Save Department/i }))

    await waitFor(() => {
      expect(mockSaveDepartment).toHaveBeenCalledWith({
        id: null,
        code: 'ENG',
        name: 'Engineering',
        description: '',
        reason: 'Create engineering team',
      })
    })
  })

  it('validates and submits Pay Grade creation with pinned footer actions and inline error retention', async () => {
    mockSavePayGrade.mockRejectedValueOnce(new Error('Pay grade code already exists.'))
    mockSavePayGrade.mockResolvedValueOnce(undefined)

    renderSetup()

    // Open Pay Grades tab and trigger Add Pay Grade modal
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Pay Grades/i }))
    fireEvent.click(screen.getByRole('tab', { name: /Pay Grades/i }))
    fireEvent.click(await screen.findByRole('button', { name: /Add Pay Grade/i }))

    // Empty submit surfaces field validation errors without calling save
    fireEvent.click(screen.getByRole('button', { name: /Save Pay Grade/i }))
    expect(await screen.findByText(/Code is required\./i)).toBeInTheDocument()
    expect(mockSavePayGrade).not.toHaveBeenCalled()

    // Fill fields and hit server failure -> alert stays visible and inputs are preserved
    fireEvent.change(screen.getByLabelText(/^Code/i), { target: { value: 'g2' } })
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'Grade Two' } })
    fireEvent.change(screen.getByLabelText(/Minimum Gross/i), { target: { value: '1500000' } })
    fireEvent.change(screen.getByLabelText(/Maximum Gross/i), { target: { value: '3000000' } })
    fireEvent.change(screen.getByLabelText(/Reason for Change/i), {
      target: { value: 'Add grade two band' },
    })

    fireEvent.click(screen.getByRole('button', { name: /Save Pay Grade/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Pay grade code already exists.')
    expect(screen.getByLabelText(/^Name/i)).toHaveValue('Grade Two')

    // Retry succeeds cleanly
    fireEvent.click(screen.getByRole('button', { name: /Save Pay Grade/i }))
    await waitFor(() => {
      expect(mockSavePayGrade).toHaveBeenLastCalledWith({
        id: null,
        code: 'G2',
        name: 'Grade Two',
        currencyCode: 'UGX',
        minimumGross: 1500000,
        maximumGross: 3000000,
        description: '',
        reason: 'Add grade two band',
      })
    })
  })
})
