import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { formatServiceActivitySummary } from '@/modules/field-services/api/services'
import DashboardPage from './DashboardPage'

const mockUseAuth = vi.fn()
const mockUseServiceOverviewCounts = vi.fn()
const mockUseServiceMonitorSnapshot = vi.fn()
const mockUseServiceRequests = vi.fn()
const mockUseMyAssignedRequests = vi.fn()
const mockUseServiceActivityWindow = vi.fn()
const mockReadMyRouterFloat = vi.fn()
const mockReadRouterFloatOverview = vi.fn()

vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuth: () => mockUseAuth() as unknown,
}))

vi.mock('@/modules/notifications/api/notifications', () => ({
  isSafeNotificationPath: () => true,
  useMarkNotificationRead: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }),
  useNotificationBellState: () => ({ data: { rows: [] }, isPending: false, isError: false, refetch: vi.fn() }),
}))

vi.mock('@/modules/projects/projectApi', () => ({
  listProjects: vi.fn().mockResolvedValue({ count: 0, rows: [] }),
}))

vi.mock('@/modules/warehouse/catalog/catalogApi', () => ({
  readInventoryOverview: vi.fn().mockResolvedValue({
    activeWarehouses: 1,
    consumableTypes: 1,
    totalEquipment: 1,
    availableEquipment: 1,
    requestsPendingApproval: 0,
  }),
}))

vi.mock('@/modules/warehouse/router-float/routerFloatApi', () => ({
  readMyRouterFloat: (...args: unknown[]) => mockReadMyRouterFloat(...args) as unknown,
  readRouterFloatOverview: (...args: unknown[]) => mockReadRouterFloatOverview(...args) as unknown,
}))

vi.mock('@/modules/field-services/api/services', async () => {
  const actual = await vi.importActual<typeof import('@/modules/field-services/api/services')>(
    '@/modules/field-services/api/services',
  )
  return {
    ...actual,
    useServiceOverviewCounts: (...args: unknown[]) => mockUseServiceOverviewCounts(...args) as unknown,
    useServiceMonitorSnapshot: (...args: unknown[]) => mockUseServiceMonitorSnapshot(...args) as unknown,
    useServiceRequests: (...args: unknown[]) => mockUseServiceRequests(...args) as unknown,
    useMyAssignedRequests: (...args: unknown[]) => mockUseMyAssignedRequests(...args) as unknown,
    useServiceActivityWindow: (...args: unknown[]) => mockUseServiceActivityWindow(...args) as unknown,
  }
})

function makeAuth(roleKey: string, permissions: string[], displayName = 'Demo User') {
  return {
    status: 'authenticated',
    devPreviewRole: null,
    authEpoch: 1,
    session: { userId: `${roleKey}-1` },
    access: {
      profile: { id: `${roleKey}-1`, displayName, status: 'active' },
      isActive: true,
      roleKeys: [roleKey],
      permissionKeys: permissions,
    },
  }
}

function renderDashboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Fixed Internet Dashboards & Activity Summary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseServiceMonitorSnapshot.mockReturnValue({ data: undefined, isError: false, refetch: vi.fn() })
    mockUseServiceRequests.mockReturnValue({
      data: { total_count: 0, limit: 10, offset: 0, rows: [] },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    })
    mockUseMyAssignedRequests.mockReturnValue({
      data: {
        total_count: 0,
        active_count: 0,
        awaiting_review_count: 0,
        historical_count: 0,
        limit: 6,
        offset: 0,
        rows: [],
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    })
    mockUseServiceActivityWindow.mockReturnValue({
      isPending: false,
      isError: false,
      refetch: vi.fn(),
      data: {
        today: '2026-11-26',
        yesterday: {
          fromDate: '2026-11-25',
          toDate: '2026-11-25',
          label: '25 Nov',
          submittedCount: 0,
          visitsCompletedCount: 2,
          providerConfirmedCount: 0,
        },
        last7Days: {
          fromDate: '2026-11-20',
          toDate: '2026-11-26',
          label: '20 Nov – 26 Nov',
          submittedCount: 4,
          visitsCompletedCount: 5,
          providerConfirmedCount: 3,
        },
      },
    })
  })

  it.each([
    ['2026-11-28T08:59:00Z', 'morning', 'Saturday, 28 November 2026', '2026-11-28'],
    ['2026-11-28T09:00:00Z', 'afternoon', 'Saturday, 28 November 2026', '2026-11-28'],
    ['2026-11-28T15:00:00Z', 'evening', 'Saturday, 28 November 2026', '2026-11-28'],
    ['2026-11-28T21:00:00Z', 'morning', 'Sunday, 29 November 2026', '2026-11-29'],
  ])('greets the signed-in employee using Kampala time at %s', (instant, period, label, day) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date(instant))
      mockUseAuth.mockReturnValue(makeAuth('employee', [], ' Olivia Pope '))
      const { unmount } = renderDashboard()

      expect(screen.getByText('Good ' + period + ', Olivia')).toBeInTheDocument()
      expect(screen.getByText(label + ' · Kampala')).toHaveAttribute('datetime', day)
      unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('puts permitted finance work first on the CFO dashboard', () => {
    mockUseAuth.mockReturnValue(makeAuth('cfo', ['payroll.read', 'cash_advances.view_all']))
    renderDashboard()

    const actions = within(screen.getByRole('region', { name: 'Quick actions' }))
    expect(actions.getAllByRole('link')[0]).toHaveAttribute('href', '/finance/payroll')
    expect(actions.getByRole('link', { name: 'Project Cash' })).toHaveAttribute('href', '/ops/cash')
    expect(actions.queryByRole('link', { name: 'Staff Advances' })).not.toBeInTheDocument()
  })

  it('renders Service Desk cards strictly matching intake queues without calling monitor snapshot', () => {
    mockUseAuth.mockReturnValue(
      makeAuth('service_desk', ['service_requests.intake', 'service_requests.read', 'service_requests.report_provider']),
    )
    mockUseServiceOverviewCounts.mockReturnValue({
      isError: false,
      refetch: vi.fn(),
      data: {
        total_count: 24,
        installation: { total: 12, active: 5, submitted: 1, follow_up_required: 0, work_completed: 1, open_urgent_tickets: 0, open_urgent_flags: 0 },
        maintenance: { total: 12, active: 4, submitted: 1, follow_up_required: 1, work_completed: 1, open_urgent_tickets: 1, open_urgent_flags: 1 },
        queues: {
          intake_attention_count: 4,
          draft_count: 2,
          submitted_count: 2,
          assigned_count: 4,
          in_progress_count: 3,
          follow_up_required_count: 1,
          work_completed_count: 2,
          coordinator_reviewed_count: 3,
          reported_to_provider_count: 1,
          provider_confirmed_count: 6,
          cancelled_count: 0,
          open_urgent_tickets: 1,
          open_urgent_flags: 1,
        },
      },
    })

    renderDashboard()

    expect(screen.getByText(/^Good (morning|afternoon|evening), Demo$/)).toBeInTheDocument()
    expect(mockUseServiceMonitorSnapshot).toHaveBeenCalledWith(false)
    expect(screen.getByRole('link', { name: /Drafts to Submit.*2/i })).toHaveAttribute(
      'href',
      '/services/intake?queue=draft',
    )
    expect(screen.getByRole('link', { name: /Ready to Report to Provider.*3/i })).toHaveAttribute(
      'href',
      '/services/intake?queue=ready_to_report',
    )
    expect(screen.getByRole('link', { name: /Awaiting Provider Confirmation.*1/i })).toHaveAttribute(
      'href',
      '/services/intake?queue=reported_to_provider',
    )

    expect(screen.getByRole('link', { name: 'Log a ticket' })).toHaveAttribute('href', '/services/intake/new')
    expect(screen.getByRole('link', { name: '2 awaiting assignment' })).toHaveAttribute('href', '/services/intake?queue=queued')
    expect(screen.getByRole('link', { name: '7 with the field team' })).toHaveAttribute('href', '/services/intake?queue=ongoing')
    expect(screen.getByText('Yesterday · 25 Nov')).toBeInTheDocument()
  })

  it('includes overdue in-progress non-urgent tickets in Coordinator Needs attention now', async () => {
    mockUseAuth.mockReturnValue(
      makeAuth(
        'service_coordinator',
        [
          'service_requests.read',
          'service_requests.dispatch',
          'service_requests.review',
          'service_requests.monitor',
          'router_float.read',
        ],
        'Sarah Nakato',
      ),
    )
    mockUseServiceOverviewCounts.mockReturnValue({
      isError: false,
      refetch: vi.fn(),
      data: {
        total_count: 24,
        installation: { total: 12, active: 5, submitted: 2, follow_up_required: 0, work_completed: 1, open_urgent_tickets: 1, open_urgent_flags: 1 },
        maintenance: { total: 12, active: 4, submitted: 0, follow_up_required: 1, work_completed: 2, open_urgent_tickets: 0, open_urgent_flags: 0 },
        queues: {
          intake_attention_count: 2,
          draft_count: 1,
          submitted_count: 2,
          assigned_count: 5,
          in_progress_count: 2,
          follow_up_required_count: 1,
          work_completed_count: 3,
          coordinator_reviewed_count: 4,
          reported_to_provider_count: 2,
          provider_confirmed_count: 4,
          cancelled_count: 0,
          open_urgent_tickets: 1,
          open_urgent_flags: 1,
        },
      },
    })
    mockUseServiceMonitorSnapshot.mockReturnValue({
      isError: false,
      refetch: vi.fn(),
      data: {
        generated_at: '2026-11-26T08:00:00Z',
        unassigned_count: 2,
        assigned_count: 5,
        in_progress_count: 2,
        follow_up_count: 1,
        review_pending_count: 3,
        reported_pending_confirm_count: 6,
        overdue_count: 1,
        open_urgent_flags_count: 1,
        acknowledged_urgent_flags_count: 0,
      },
    })
    mockUseServiceRequests.mockImplementation((filters: { overdueOnly?: boolean } = {}) => {
      if (filters.overdueOnly) {
        return {
          isPending: false,
          isError: false,
          refetch: vi.fn(),
          data: {
            total_count: 1,
            limit: 6,
            offset: 0,
            rows: [
              {
                id: '00000000-0000-4000-8000-000000000999',
                internal_code: 'SRV-2026-OVERDUE',
                provider_name: 'Liquid Fiber',
                provider_reference: 'LF-OVD-99',
                request_type: 'maintenance',
                priority: 'high',
                site_name: 'Ntinda Backhaul',
                area_label: 'Ntinda',
                status: 'in_progress',
                received_source: 'provider_email',
                provider_received_at: '2026-11-24T06:00:00Z',
                provider_deadline_at: '2026-11-25T10:00:00Z',
                submitted_at: '2026-11-24T06:05:00Z',
                accepted_at: '2026-11-24T06:10:00Z',
                assigned_at: '2026-11-24T06:15:00Z',
                work_completed_at: null,
                coordinator_reviewed_at: null,
                reported_to_provider_at: null,
                provider_confirmed_at: null,
                intake_owner_profile_id: 'desk-1',
                accepted_by_profile_id: 'coord-1',
                lead_profile_id: 'tech-1',
                lead_name: 'Isaac Ssemanda',
                assistant_count: 0,
                open_urgent_count: 0,
                highest_urgent_status: 'none',
                version: 2,
              },
            ],
          },
        }
      }
      return {
        isPending: false,
        isError: false,
        refetch: vi.fn(),
        data: { total_count: 0, limit: 10, offset: 0, rows: [] },
      }
    })
    mockReadRouterFloatOverview.mockResolvedValue({
      cap: 5,
      technicians: [],
      available_routers: [],
      active_float: [
        {
          custody_id: '00000000-0000-4000-8000-000000000001',
          equipment_asset_id: '00000000-0000-4000-8000-000000000002',
          model_name: 'Huawei HG8245H5',
          serial_number: 'SN-1',
          mac_address: null,
          float_state: 'faulty_to_return',
          custodian_profile_id: '00000000-0000-4000-8000-000000000003',
          custodian_name: 'Isaac Ssemanda',
          warehouse_id: '00000000-0000-4000-8000-000000000004',
          warehouse_name: 'Kampala Central',
          issued_at: '2026-11-25T10:00:00Z',
          confirmed_at: null,
          faulty_reported_at: '2026-11-25T12:00:00Z',
          faulty_notes: 'No power',
        },
      ],
    })

    renderDashboard()

    expect(screen.getByRole('link', { name: /Awaiting Assignment.*2/i })).toHaveAttribute(
      'href',
      '/services/dispatch?status=submitted',
    )
    expect(screen.getByRole('link', { name: /Open Urgent Tickets.*1/i })).toHaveAttribute(
      'href',
      '/services/dispatch?urgent=1',
    )
    expect(screen.getByRole('link', { name: /Overdue SLA.*1/i })).toHaveAttribute(
      'href',
      '/services/monitor?bucket=overdue',
    )
    expect(screen.getByRole('link', { name: /Awaiting Review.*3/i })).toHaveAttribute(
      'href',
      '/services/dispatch?status=work_completed',
    )
    expect(screen.queryByRole('link', { name: /Ready to Report/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Awaiting Provider Confirmation/i })).not.toBeInTheDocument()

    // Overdue non-urgent in_progress ticket appears inside Needs attention now
    expect(screen.getByText('SRV-2026-OVERDUE')).toBeInTheDocument()
    expect(screen.getByText('Check SLA')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText(/Router handover issues/i)).toBeInTheDocument()
    })
  })

  it('filters closed provider-confirmed tickets out of Field Technician active jobs and separates Awaiting Review', async () => {
    mockUseAuth.mockReturnValue(
      makeAuth('service_technician', ['service_visits.read_assigned', 'service_visits.work_assigned'], 'Isaac Ssemanda'),
    )
    mockUseMyAssignedRequests.mockReturnValue({
      isPending: false,
      isError: false,
      refetch: vi.fn(),
      data: {
        active_count: 1,
        awaiting_review_count: 2,
        historical_count: 21,
        limit: 6,
        offset: 0,
        rows: [
          {
            id: '00000000-0000-4000-8000-000000000101',
            internal_code: 'SRV-2026-0025',
            request_type: 'installation',
            priority: 'high',
            site_name: 'Kololo Demo Villa',
            area_label: 'Kololo',
            status: 'in_progress',
            provider_name: 'Roke Telkom',
            provider_deadline_at: null,
            is_active_assignment: true,
            assignment_bucket: 'active',
            my_role: 'lead',
            open_visit_id: null,
            open_urgent_count: 0,
            version: 1,
          },
          {
            // Retained active crew on a closed ticket must NOT appear in technician active jobs
            id: '00000000-0000-4000-8000-000000000102',
            internal_code: 'SRV-2026-CONFIRMED',
            request_type: 'installation',
            priority: 'normal',
            site_name: 'Closed Retention Test',
            area_label: 'Ntinda',
            status: 'provider_confirmed',
            provider_name: 'Roke Telkom',
            provider_deadline_at: null,
            is_active_assignment: true,
            my_role: 'lead',
            open_visit_id: null,
            open_urgent_count: 0,
            version: 5,
          },
        ],
      },
    })
    mockReadMyRouterFloat.mockResolvedValue({
      cap: 5,
      pending_count: 1,
      confirmed_count: 3,
      faulty_count: 0,
      active_total: 4,
      remaining_slots: 1,
      items: [],
    })

    renderDashboard()

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Ready to Install.*3/i })).toHaveAttribute('href', '/services/my-float')
    })
    expect(screen.getByRole('link', { name: /My Active Jobs.*1/i })).toHaveAttribute(
      'href',
      '/services/my-jobs?section=active',
    )
    expect(screen.getByRole('link', { name: /Awaiting Review.*2/i })).toHaveAttribute(
      'href',
      '/services/my-jobs?section=awaiting_review',
    )
    expect(screen.getByRole('link', { name: /Past Jobs \(21\)/i })).toHaveAttribute(
      'href',
      '/services/my-jobs?section=historical',
    )
    expect(screen.getByText('4 / 5')).toBeInTheDocument()
    expect(screen.getByText(/Pending pickup: 1 · Faulty: 0/i)).toBeInTheDocument()
    expect(screen.getByText('SRV-2026-0025')).toBeInTheDocument()
    expect(screen.queryByText('SRV-2026-CONFIRMED')).not.toBeInTheDocument()
  })

  it('formats server activity summary labels and preserves repeat visit counts', () => {
    const formatted = formatServiceActivitySummary({
      today: '2026-11-26',
      yesterday: {
        from_date: '2026-11-25',
        to_date: '2026-11-25',
        submitted_count: 0,
        visits_completed_count: 2,
        provider_confirmed_count: 0,
      },
      last_7_days: {
        from_date: '2026-11-20',
        to_date: '2026-11-26',
        submitted_count: 4,
        visits_completed_count: 7,
        provider_confirmed_count: 3,
      },
    })

    expect(formatted.yesterday.label).toBe('25 Nov')
    expect(formatted.yesterday.visitsCompletedCount).toBe(2)
    expect(formatted.last7Days.label).toBe('20 Nov – 26 Nov')
    expect(formatted.last7Days.visitsCompletedCount).toBe(7)
  })
})
