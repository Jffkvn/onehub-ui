import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@/components/ui/Toast'
import { ServicesHomePage } from './ServicesHomePage'

const mockUseOverviewCounts = vi.fn()
const mockUseMyAssigned = vi.fn()

vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuth: () => ({
    status: 'authenticated',
    devPreviewRole: null,
    session: { userId: 'coord-1' },
    access: {
      profile: { id: 'coord-1', displayName: 'Coordinator', status: 'active' },
      roleKeys: ['coordinator'],
      permissionKeys: [
        'service_requests.read',
        'service_requests.intake',
        'service_visits.read_assigned',
      ],
    },
  }),
}))

vi.mock('../api/services', async () => {
  const actual = await vi.importActual<typeof import('../api/services')>('../api/services')
  return {
    ...actual,
    usePendingServiceOperations: () => [],
    useRetryPendingServiceOperation: () => ({ mutateAsync: vi.fn(), isPending: false, variables: undefined }),
    useDiscardPendingServiceOperation: () => vi.fn(),
    useServiceOverviewCounts: (...args: unknown[]) => mockUseOverviewCounts(...args) as unknown,
    useMyAssignedRequests: (...args: unknown[]) => mockUseMyAssigned(...args) as unknown,
  }
})

function renderHome() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/services']}>
          <ServicesHomePage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('ServicesHomePage', () => {
  beforeEach(() => {
    mockUseOverviewCounts.mockReset()
    mockUseMyAssigned.mockReset()
  })

  it('B5-02: renders uncapped server overview counts beyond 100 tickets and active assignment count beyond 50 jobs', () => {
    mockUseOverviewCounts.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        total_count: 192,
        installation: {
          total: 150,
          active: 145,
          submitted: 19,
          follow_up_required: 3,
          work_completed: 8,
          open_urgent_tickets: 4,
          open_urgent_flags: 7,
        },
        maintenance: {
          total: 42,
          active: 38,
          submitted: 5,
          follow_up_required: 2,
          work_completed: 4,
          open_urgent_tickets: 1,
          open_urgent_flags: 2,
        },
        queues: {
          intake_attention_count: 25,
          draft_count: 1,
          submitted_count: 24,
          assigned_count: 40,
          in_progress_count: 35,
          follow_up_required_count: 5,
          work_completed_count: 12,
          coordinator_reviewed_count: 6,
          reported_to_provider_count: 3,
          provider_confirmed_count: 55,
          cancelled_count: 11,
          open_urgent_tickets: 5,
          open_urgent_flags: 9,
        },
      },
    })
    mockUseMyAssigned.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { total_count: 62, active_count: 62, historical_count: 18, limit: 25, offset: 0, rows: [] },
    })

    renderHome()

    expect(screen.getByText('145 active')).toBeInTheDocument()
    expect(screen.getByText('19 awaiting dispatch')).toBeInTheDocument()
    expect(screen.getByText('7 urgent flag(s)')).toBeInTheDocument()
    expect(screen.getByText('38 active')).toBeInTheDocument()
    expect(screen.getByText('5 awaiting dispatch')).toBeInTheDocument()
    expect(screen.getByText('2 urgent flag(s)')).toBeInTheDocument()
    expect(screen.getByText('62 active assignment(s) ready for field execution.')).toBeInTheDocument()
  })

  it('B5-02: renders explicit error states instead of misleading zeroes when overview or my-jobs queries fail', () => {
    mockUseOverviewCounts.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new Error('Overview RPC timeout'),
    })
    mockUseMyAssigned.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new Error('Jobs RPC timeout'),
    })

    renderHome()

    expect(screen.getByText('Could not load service overview counts')).toBeInTheDocument()
    expect(screen.getByText('Overview RPC timeout')).toBeInTheDocument()
    expect(screen.queryByText('0 active')).not.toBeInTheDocument()
    expect(screen.getByText(/Could not load assigned crew jobs: Jobs RPC timeout/i)).toBeInTheDocument()
  })
})
