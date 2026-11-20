import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MyWorkspacePage } from './MyWorkspacePage'
import type { SelfServiceProfile } from '../api/selfService'

const mockProfileQuery = vi.fn()

vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuth: () => ({
    session: { userId: 'u-1', email: 'emp1@egypro.test' },
  }),
}))

vi.mock('../api/selfService', () => ({
  useMyProfile: () => mockProfileQuery() as unknown,
}))

const linkedProfile: SelfServiceProfile = {
  id: 'emp-1',
  employeeNumber: 'EMP-QA-01',
  legalName: 'Amina Nsubuga',
  companyEmail: 'amina@egypro.test',
  personalEmail: 'amina.personal@example.test',
  workPhone: '+256700000001',
  active: true,
  departmentName: 'Operations',
  jobTitleName: 'Field Technician',
  payGradeName: 'Grade One',
  startDate: '2025-01-10',
  endDate: null,
  employmentType: 'full_time',
  contractType: 'permanent',
  probationEndDate: null,
  probationStatus: 'passed',
}

describe('MyWorkspacePage', () => {
  beforeEach(() => {
    mockProfileQuery.mockReset()
  })

  it('shows linked employee profile and excludes HR confidential fields', () => {
    mockProfileQuery.mockReturnValue({
      data: linkedProfile,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })

    render(
      <MemoryRouter initialEntries={['/my']}>
        <MyWorkspacePage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'My Workspace' })).toBeInTheDocument()
    expect(screen.getAllByText('Amina Nsubuga').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('EMP-QA-01').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Grade One').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('amina@egypro.test').length).toBeGreaterThanOrEqual(1)

    // Strict confidential information boundary
    expect(screen.queryByText(/gross monthly salary/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/\bTIN\b/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/\bNSSF\b/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/bank/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/\bNIN\b|\bPassport\b/i)).not.toBeInTheDocument()
  })

  it('renders a clear unlinked guidance state when the user has no linked employee record', () => {
    mockProfileQuery.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })

    render(
      <MemoryRouter initialEntries={['/my/profile']}>
        <MyWorkspacePage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'My Profile' })).toBeInTheDocument()
    expect(screen.getByText(/Your employee profile is not linked yet/i)).toBeInTheDocument()
  })
})
