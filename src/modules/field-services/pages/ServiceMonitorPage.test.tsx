import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@/components/ui/Toast'
import { ServiceMonitorPage } from './ServiceMonitorPage'

const mockUseAuth = vi.fn()
const mockUseMonitorSnapshot = vi.fn()
const mockUseMonitorQueue = vi.fn()

vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuth: () => mockUseAuth() as unknown,
}))

vi.mock('../api/services', async () => {
  const actual = await vi.importActual<typeof import('../api/services')>('../api/services')
  return {
    ...actual,
    useServiceMonitorSnapshot: () => mockUseMonitorSnapshot() as unknown,
    useServiceMonitorQueue: (...args: unknown[]) => mockUseMonitorQueue(...args) as unknown,
  }
})

function LocationEcho() {
  const loc = useLocation()
  return <span data-testid="monitor-location">{`${loc.pathname}${loc.search}`}</span>
}

function renderMonitor(initialUrl = '/services/monitor') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialUrl]}>
          <ServiceMonitorPage />
          <LocationEcho />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

function makeSnapshot(overrides: Partial<Record<string, unknown>> = {}) {
  const nowIso = new Date().toISOString()
  return {
    generated_at: nowIso,
    unassigned_count: 3,
    assigned_count: 4,
    in_progress_count: 2,
    follow_up_count: 1,
    review_pending_count: 2,
    reported_pending_confirm_count: 1,
    overdue_count: 2,
    open_urgent_flags_count: 1,
    acknowledged_urgent_flags_count: 1,
    ...overrides,
  }
}

describe('ServiceMonitorPage (Batch 6 Display-Safe Operations Monitor)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAuth.mockReturnValue({
      status: 'authenticated',
      devPreviewRole: null,
      session: { userId: 'mon-1' },
      access: {
        profile: { id: 'mon-1', displayName: 'Operations TV Display', status: 'active' },
        roleKeys: ['service_monitor'],
        permissionKeys: ['service_requests.monitor', 'service_alerts.read'],
      },
    })
    mockUseMonitorSnapshot.mockReturnValue({
      isLoading: false,
      isError: false,
      isFetching: false,
      error: null,
      dataUpdatedAt: Date.now(),
      refetch: vi.fn(),
      data: makeSnapshot(),
    })
    mockUseMonitorQueue.mockReturnValue({
      isLoading: false,
      isError: false,
      isFetching: false,
      error: null,
      dataUpdatedAt: Date.now(),
      refetch: vi.fn(),
      data: {
        generated_at: new Date().toISOString(),
        bucket: 'all',
        total_count: 31,
        limit: 25,
        offset: 0,
        rows: [
          {
            id: 'req-m1',
            internal_code: 'SRV-2026-00901',
            request_type: 'maintenance',
            priority: 'urgent',
            area_label: 'Bugolobi',
            status: 'in_progress',
            has_blocker: true,
            open_urgent_count: 1,
            highest_urgent_status: 'open',
            urgent_reason_code: 'fiber_backbone_fault',
            submitted_at: '2026-11-17T06:00:00Z',
            assigned_at: '2026-11-17T06:20:00Z',
            provider_deadline_at: '2026-11-17T07:00:00Z',
            assigned_lead_name: 'Isaac',
          },
        ],
      },
    })
  })

  it('renders display-safe queue without PII or detail links for monitor-only accounts and supports bucket drill-downs', () => {
    renderMonitor()

    expect(screen.getByRole('heading', { name: 'Operations Monitor' })).toBeInTheDocument()
    expect(screen.getAllByText('SRV-2026-00901').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Bugolobi').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Fibre Backbone Fault').length).toBeGreaterThan(0)

    // Strict zero-detail link omission for service_monitor account
    expect(screen.queryByRole('link', { name: /Open/i })).not.toBeInTheDocument()

    // Drill down to follow_up bucket & verify query params + total_count pagination
    fireEvent.click(screen.getByRole('button', { name: /Follow-Up Required/i }))
    expect(screen.getByTestId('monitor-location')).toHaveTextContent('/services/monitor?bucket=follow_up')
    expect(mockUseMonitorQueue).toHaveBeenLastCalledWith(
      expect.objectContaining({ bucket: 'follow_up', limit: 25, offset: 0 }),
    )
    expect(screen.getByText(/Showing 1–25 of 31 · Page 1 of 2/i)).toBeInTheDocument()
  })

  it('shows ticket Open link for operational coordinators with service_requests.read', () => {
    mockUseAuth.mockReturnValue({
      status: 'authenticated',
      devPreviewRole: null,
      session: { userId: 'coord-1' },
      access: {
        profile: { id: 'coord-1', displayName: 'Coordinator One', status: 'active' },
        roleKeys: ['coordinator'],
        permissionKeys: ['service_requests.monitor', 'service_requests.read'],
      },
    })

    renderMonitor()
    const links = screen.getAllByRole('link', { name: /Open/i })
    expect(links.length).toBeGreaterThan(0)
    expect(links[0]).toHaveAttribute(
      'href',
      `/services/requests/req-m1?from=${encodeURIComponent('/services/monitor')}`,
    )
  })

  it('surfaces >90s stale data warning and disconnected error banner without fake zeroes', () => {
    const staleTime = Date.now() - 125_000
    mockUseMonitorSnapshot.mockReturnValue({
      isLoading: false,
      isError: false,
      isFetching: false,
      error: null,
      dataUpdatedAt: staleTime,
      refetch: vi.fn(),
      data: makeSnapshot({ generated_at: new Date(staleTime).toISOString() }),
    })
    mockUseMonitorQueue.mockReturnValue({
      isLoading: false,
      isError: false,
      isFetching: false,
      error: null,
      dataUpdatedAt: staleTime,
      refetch: vi.fn(),
      data: {
        generated_at: new Date(staleTime).toISOString(),
        bucket: 'all',
        total_count: 0,
        limit: 25,
        offset: 0,
        rows: [],
      },
    })

    const view = renderMonitor()
    expect(
      screen.getByText(/Stale data warning — summary counts & operational queue over 90 seconds old/i),
    ).toBeInTheDocument()

    // Now test disconnected with no snapshot -> must NOT fake zeroes ("0")
    mockUseMonitorSnapshot.mockReturnValue({
      isLoading: false,
      isError: true,
      isFetching: false,
      error: new Error('Network unreachable'),
      dataUpdatedAt: 0,
      refetch: vi.fn(),
      data: undefined,
    })
    mockUseMonitorQueue.mockReturnValue({
      isLoading: false,
      isError: true,
      isFetching: false,
      error: new Error('Network unreachable'),
      dataUpdatedAt: 0,
      refetch: vi.fn(),
      data: undefined,
    })

    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <MemoryRouter initialEntries={['/services/monitor']}>
            <ServiceMonitorPage />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(/Disconnected — Monitor feed unavailable/i)
    expect(screen.getByRole('alert')).toHaveTextContent(/Network unreachable/i)
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(8)
  })

  it('B6-01: evaluates summary and queue freshness independently across both asymmetric pending cases and background errors', () => {
    const staleTime = Date.now() - 185_000
    const freshTime = Date.now()

    // 1. Old snapshot (pending refetch, no error) + fresh queue -> MUST trigger stale warning naming summary counts
    mockUseMonitorSnapshot.mockReturnValue({
      isLoading: false,
      isError: false,
      isFetching: true,
      error: null,
      dataUpdatedAt: staleTime,
      refetch: vi.fn(),
      data: makeSnapshot({ generated_at: new Date(staleTime).toISOString() }),
    })
    mockUseMonitorQueue.mockReturnValue({
      isLoading: false,
      isError: false,
      isFetching: false,
      error: null,
      dataUpdatedAt: freshTime,
      refetch: vi.fn(),
      data: {
        generated_at: new Date(freshTime).toISOString(),
        bucket: 'all',
        total_count: 0,
        limit: 25,
        offset: 0,
        rows: [],
      },
    })

    const view = renderMonitor()
    expect(screen.getByRole('status')).toHaveTextContent(/Stale data warning — summary counts over 90 seconds old/i)
    expect(screen.getByTestId('monitor-snapshot-freshness')).toHaveTextContent(/Stale \(>90s\)/i)
    expect(screen.getByTestId('monitor-queue-freshness')).not.toHaveTextContent(/Stale \(>90s\)/i)
    expect(screen.getByTestId('monitor-freshness')).toHaveTextContent(/Oldest feed:/i)

    // 2. Fresh snapshot + old queue (pending refetch, no error) -> MUST trigger stale warning naming operational queue
    mockUseMonitorSnapshot.mockReturnValue({
      isLoading: false,
      isError: false,
      isFetching: false,
      error: null,
      dataUpdatedAt: freshTime,
      refetch: vi.fn(),
      data: makeSnapshot({ generated_at: new Date(freshTime).toISOString() }),
    })
    mockUseMonitorQueue.mockReturnValue({
      isLoading: false,
      isError: false,
      isFetching: true,
      error: null,
      dataUpdatedAt: staleTime,
      refetch: vi.fn(),
      data: {
        generated_at: new Date(staleTime).toISOString(),
        bucket: 'all',
        total_count: 0,
        limit: 25,
        offset: 0,
        rows: [],
      },
    })

    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <MemoryRouter initialEntries={['/services/monitor']}>
            <ServiceMonitorPage />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    )
    expect(screen.getByRole('status')).toHaveTextContent(/Stale data warning — operational queue over 90 seconds old/i)
    expect(screen.getByTestId('monitor-queue-freshness')).toHaveTextContent(/Stale \(>90s\)/i)
    expect(screen.getByTestId('monitor-snapshot-freshness')).not.toHaveTextContent(/Stale \(>90s\)/i)
    expect(screen.getByTestId('monitor-freshness')).toHaveTextContent(/Oldest feed:/i)

    // 3. Background sync error on one feed while other is fresh -> MUST still surface sync-failed stale warning
    mockUseMonitorQueue.mockReturnValue({
      isLoading: false,
      isError: true,
      isFetching: false,
      error: new Error('Background poll failed'),
      dataUpdatedAt: freshTime,
      refetch: vi.fn(),
      data: {
        generated_at: new Date(freshTime).toISOString(),
        bucket: 'all',
        total_count: 0,
        limit: 25,
        offset: 0,
        rows: [],
      },
    })
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <MemoryRouter initialEntries={['/services/monitor']}>
            <ServiceMonitorPage />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    )
    expect(screen.getByRole('status')).toHaveTextContent(/live refresh failed on operational queue/i)
  })
})
