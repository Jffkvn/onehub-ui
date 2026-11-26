import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@/components/ui/Toast'
import { MyServiceJobsPage } from './MyServiceJobsPage'

const mockUseMyAssigned = vi.fn()

vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuth: () => ({
    status: 'authenticated',
    session: { userId: 'eng-1' },
    access: { profile: { id: 'eng-1' }, roleKeys: ['employee'], permissionKeys: ['service_visits.read_assigned'] },
  }),
}))

vi.mock('../api/services', async () => {
  const actual = await vi.importActual<typeof import('../api/services')>('../api/services')
  return {
    ...actual,
    usePendingServiceOperations: () => [],
    useRetryPendingServiceOperation: () => ({ mutateAsync: vi.fn(), isPending: false, variables: undefined }),
    useDiscardPendingServiceOperation: () => vi.fn(),
    useMyAssignedRequests: (...args: unknown[]) => mockUseMyAssigned(...args) as unknown,
  }
})

function LocationEcho() {
  const loc = useLocation()
  return <span data-testid="my-jobs-loc">{`${loc.pathname}${loc.search}`}</span>
}

function renderMyJobs(path = '/services/my-jobs') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <MyServiceJobsPage />
          <LocationEcho />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('MyServiceJobsPage', () => {
  beforeEach(() => {
    mockUseMyAssigned.mockReset()
  })

  it('separates active crew assignments cleanly from historical participation records', () => {
    mockUseMyAssigned.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        total_count: 1,
        active_count: 1,
        historical_count: 1,
        limit: 25,
        offset: 0,
        rows: [
          {
            id: 'req-active',
            internal_code: 'SRV-2026-00010',
            request_type: 'installation',
            priority: 'urgent',
            site_name: 'Horizon Plaza',
            area_label: 'Nakasero',
            status: 'in_progress',
            provider_name: 'Zuku Fiber',
            provider_deadline_at: '2026-11-18T12:00:00Z',
            is_active_assignment: true,
            my_role: 'lead',
            open_visit_id: 'visit-open-1',
            open_urgent_count: 1,
            version: 3,
          },
          {
            id: 'req-past',
            internal_code: 'SRV-2026-00004',
            request_type: 'maintenance',
            priority: 'normal',
            site_name: 'Old Tower',
            area_label: 'Bugolobi',
            status: 'assigned',
            provider_name: 'SimbaNet',
            provider_deadline_at: null,
            is_active_assignment: false,
            my_role: null,
            open_visit_id: null,
            open_urgent_count: 0,
            version: 5,
          },
        ],
      },
    })

    renderMyJobs()

    expect(screen.getByText('SRV-2026-00010')).toBeInTheDocument()
    expect(screen.getByText('Lead Engineer')).toBeInTheDocument()
    expect(screen.getByText(/Visit in progress/i)).toBeInTheDocument()
    expect(screen.getByText(/1 urgent flag\(s\)/i)).toBeInTheDocument()
    expect(screen.getByText(/Past \/ Historical Participation \(1\)/i)).toBeInTheDocument()
    expect(screen.getByText('SRV-2026-00004')).toBeInTheDocument()
  })

  it('B5-02: supports independent active & historical server pagination beyond 50 jobs and preserves query params', () => {
    mockUseMyAssigned.mockImplementation(
      (
        limit: number,
        offset: number,
        opts?: { assignmentScope?: 'active' | 'awaiting_review' | 'historical' | null },
      ) => {
        if (opts?.assignmentScope === 'active') {
          return {
            isLoading: false,
            isError: false,
            data: {
              total_count: 60,
              active_count: 60,
              awaiting_review_count: 0,
              historical_count: 35,
              limit,
              offset,
              rows: [
                {
                  id: offset === 25 ? 'act-26' : 'act-1',
                  internal_code: offset === 25 ? 'SRV-ACT-026' : 'SRV-ACT-001',
                  request_type: 'installation',
                  priority: 'normal',
                  site_name: offset === 25 ? 'Active Site 26' : 'Active Site 1',
                  area_label: 'Kololo',
                  status: 'assigned',
                  provider_name: 'Roke Telkom',
                  provider_deadline_at: null,
                  is_active_assignment: true,
                  my_role: 'lead',
                  open_visit_id: null,
                  open_urgent_count: 0,
                  version: 1,
                },
              ],
            },
          }
        }
        if (opts?.assignmentScope === 'awaiting_review') {
          return {
            isLoading: false,
            isError: false,
            data: {
              total_count: 0,
              active_count: 60,
              awaiting_review_count: 0,
              historical_count: 35,
              limit,
              offset,
              rows: [],
            },
          }
        }
        return {
          isLoading: false,
          isError: false,
          data: {
            total_count: 35,
            active_count: 60,
            awaiting_review_count: 0,
            historical_count: 35,
            limit,
            offset,
            rows: [
              {
                id: offset === 25 ? 'hist-26' : 'hist-1',
                internal_code: offset === 25 ? 'SRV-HIST-026' : 'SRV-HIST-001',
                request_type: 'maintenance',
                priority: 'normal',
                site_name: offset === 25 ? 'Past Site 26' : 'Past Site 1',
                area_label: 'Ntinda',
                status: 'provider_confirmed',
                provider_name: 'SimbaNet',
                provider_deadline_at: null,
                is_active_assignment: false,
                my_role: null,
                open_visit_id: null,
                open_urgent_count: 0,
                version: 4,
              },
            ],
          },
        }
      },
    )

    renderMyJobs('/services/my-jobs')

    expect(screen.getByText(/Active Crew Assignments \(60\)/i)).toBeInTheDocument()
    expect(screen.getByText(/Past \/ Historical Participation \(35\)/i)).toBeInTheDocument()
    expect(screen.getByText('SRV-ACT-001')).toBeInTheDocument()
    expect(screen.getByText('SRV-HIST-001')).toBeInTheDocument()

    const nextButtons = screen.getAllByRole('button', { name: /Next/i })
    expect(nextButtons).toHaveLength(2)

    fireEvent.click(nextButtons[1])
    expect(screen.getByText('SRV-HIST-026')).toBeInTheDocument()
    expect(screen.getByText('SRV-ACT-001')).toBeInTheDocument()
    expect(screen.getByTestId('my-jobs-loc')).toHaveTextContent('/services/my-jobs?pastPage=2')

    const link = screen.getByText('SRV-HIST-026').closest('a')
    expect(link).toHaveAttribute(
      'href',
      `/services/requests/hist-26?from=${encodeURIComponent('/services/my-jobs?pastPage=2')}`,
    )
  })

  it('keeps provider-confirmed tickets with retained assignments out of Active and separates Awaiting Review', () => {
    mockUseMyAssigned.mockImplementation(
      (limit: number, offset: number, opts?: { assignmentScope?: 'active' | 'awaiting_review' | 'historical' | null }) => {
        if (opts?.assignmentScope === 'active') {
          return {
            isLoading: false,
            isError: false,
            data: {
              total_count: 1,
              active_count: 1,
              awaiting_review_count: 1,
              historical_count: 1,
              limit,
              offset,
              rows: [
                {
                  id: 'act-in-prog',
                  internal_code: 'SRV-2026-INPROG',
                  request_type: 'maintenance',
                  priority: 'high',
                  site_name: 'Ntinda Active',
                  area_label: 'Ntinda',
                  status: 'in_progress',
                  provider_name: 'Roke Telkom',
                  provider_deadline_at: null,
                  is_active_assignment: true,
                  my_role: 'lead',
                  open_visit_id: 'visit-1',
                  open_urgent_count: 0,
                  version: 1,
                },
                {
                  // Simulates legacy/stale retained assignment on a closed ticket
                  id: 'closed-retained',
                  internal_code: 'SRV-2026-CLOSED',
                  request_type: 'installation',
                  priority: 'normal',
                  site_name: 'Bugolobi Confirmed',
                  area_label: 'Bugolobi',
                  status: 'provider_confirmed',
                  provider_name: 'Roke Telkom',
                  provider_deadline_at: null,
                  is_active_assignment: true,
                  my_role: 'lead',
                  open_visit_id: null,
                  open_urgent_count: 0,
                  version: 6,
                },
              ],
            },
          }
        }
        if (opts?.assignmentScope === 'awaiting_review') {
          return {
            isLoading: false,
            isError: false,
            data: {
              total_count: 1,
              active_count: 1,
              awaiting_review_count: 1,
              historical_count: 1,
              limit,
              offset,
              rows: [
                {
                  id: 'rev-1',
                  internal_code: 'SRV-2026-REVIEW',
                  request_type: 'installation',
                  priority: 'normal',
                  site_name: 'Kololo Review',
                  area_label: 'Kololo',
                  status: 'work_completed',
                  provider_name: 'Roke Telkom',
                  provider_deadline_at: null,
                  is_active_assignment: false,
                  assignment_bucket: 'awaiting_review',
                  my_role: 'lead',
                  open_visit_id: null,
                  open_urgent_count: 0,
                  version: 3,
                },
              ],
            },
          }
        }
        return {
          isLoading: false,
          isError: false,
          data: {
            total_count: 1,
            active_count: 1,
            awaiting_review_count: 1,
            historical_count: 1,
            limit,
            offset,
            rows: [],
          },
        }
      },
    )

    renderMyJobs('/services/my-jobs?section=active')

    expect(screen.getByText('SRV-2026-INPROG')).toBeInTheDocument()
    expect(screen.queryByText('SRV-2026-CLOSED')).not.toBeInTheDocument()
    expect(screen.queryByText('SRV-2026-REVIEW')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Awaiting Review \(1\)/i }))
    expect(screen.getByText('SRV-2026-REVIEW')).toBeInTheDocument()
    expect(screen.getByTestId('my-jobs-loc')).toHaveTextContent('/services/my-jobs?section=awaiting_review')

    fireEvent.click(screen.getByRole('button', { name: /Past Jobs \(1\)/i }))
    expect(screen.getByText('SRV-2026-CLOSED')).toBeInTheDocument()
  })
})
