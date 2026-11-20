import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@/components/ui/Toast'
import { ServiceDispatchPage } from './ServiceDispatchPage'

const mockUseAuth = vi.fn()
const mockUseServiceRequests = vi.fn()
const mockUseServiceUrgentFlags = vi.fn()
const mockRetryUrgentNotification = vi.fn()

vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuth: () => mockUseAuth() as unknown,
}))

vi.mock('../api/services', async () => {
  const actual = await vi.importActual<typeof import('../api/services')>('../api/services')
  return {
    ...actual,
    usePendingServiceOperations: () => [],
    useRetryPendingServiceOperation: () => ({ mutateAsync: vi.fn(), isPending: false, variables: undefined }),
    useDiscardPendingServiceOperation: () => vi.fn(),
    useServiceRequests: (...args: unknown[]) => mockUseServiceRequests(...args) as unknown,
    useServiceUrgentFlags: (...args: unknown[]) => mockUseServiceUrgentFlags(...args) as unknown,
    useRetryUrgentNotification: () => ({ mutateAsync: mockRetryUrgentNotification, isPending: false }),
    useReissueUrgentNotification: () => ({ mutateAsync: vi.fn(), isPending: false }),
  }
})

function LocationEcho() {
  const loc = useLocation()
  return <span data-testid="dispatch-location">{`${loc.pathname}${loc.search}`}</span>
}

function renderDispatch(initialPath = '/services/dispatch') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <ServiceDispatchPage />
          <LocationEcho />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

function makeRow(id: string, code: string, siteName: string, urgentCount = 0) {
  return {
    id,
    internal_code: code,
    request_type: 'installation' as const,
    priority: urgentCount > 0 ? ('urgent' as const) : ('normal' as const),
    site_name: siteName,
    area_label: 'Kololo',
    status: 'submitted' as const,
    provider_name: 'Roke Telkom',
    provider_reference: `REF-${code}`,
    provider_received_at: '2026-11-17T06:00:00Z',
    provider_deadline_at: null,
    submitted_at: '2026-11-17T06:05:00Z',
    accepted_at: null,
    assigned_at: null,
    work_completed_at: null,
    coordinator_reviewed_at: null,
    reported_to_provider_at: null,
    provider_confirmed_at: null,
    intake_owner_profile_id: 'desk-1',
    accepted_by_profile_id: null,
    lead_profile_id: null,
    lead_name: null,
    assistant_count: 0,
    open_urgent_count: urgentCount,
    highest_urgent_status: urgentCount > 0 ? ('open' as const) : ('none' as const),
    version: 1,
  }
}

describe('ServiceDispatchPage', () => {
  beforeEach(() => {
    mockUseServiceRequests.mockReset()
    mockUseServiceUrgentFlags.mockReset()
    mockRetryUrgentNotification.mockReset()
    mockUseAuth.mockReturnValue({
      status: 'authenticated',
      devPreviewRole: null,
      session: { userId: 'coord-1' },
      access: {
        profile: { id: 'coord-1', displayName: 'Coordinator', status: 'active' },
        roleKeys: ['coordinator'],
        permissionKeys: ['service_requests.read', 'service_requests.dispatch'],
      },
    })
  })

  it('B5-02: forwards urgentOnly to server query, paginates >100 items, and preserves page in ticket back link', () => {
    mockUseServiceRequests.mockImplementation((filters: { offset?: number; urgentOnly?: boolean }) => {
      if (filters.urgentOnly) {
        return {
          isLoading: false,
          isError: false,
          data: {
            total_count: 1,
            limit: 25,
            offset: 0,
            rows: [makeRow('req-urgent-120', 'SRV-2026-00120', 'Urgent Past-100 Site', 1)],
          },
        }
      }
      const isPage2 = filters.offset === 25
      return {
        isLoading: false,
        isError: false,
        data: {
          total_count: 130,
          limit: 25,
          offset: filters.offset ?? 0,
          rows: [
            makeRow(
              isPage2 ? 'req-26' : 'req-1',
              isPage2 ? 'SRV-2026-00026' : 'SRV-2026-00001',
              isPage2 ? 'Dispatch Site 26' : 'Dispatch Site 1',
            ),
          ],
        },
      }
    })

    renderDispatch('/services/dispatch')
    expect(screen.getByText('SRV-2026-00001')).toBeInTheDocument()
    expect(screen.getByText(/Showing 1–25 of 130 · Page 1 of 6/i)).toBeInTheDocument()

    // Navigate to page 2 and verify ?from= preserves ?page=2
    fireEvent.click(screen.getByRole('button', { name: /Next/i }))
    expect(screen.getByText('SRV-2026-00026')).toBeInTheDocument()
    expect(screen.getByTestId('dispatch-location')).toHaveTextContent('/services/dispatch?page=2')
    const link = screen.getByText('SRV-2026-00026').closest('a')
    expect(link).toHaveAttribute(
      'href',
      `/services/requests/req-26?from=${encodeURIComponent('/services/dispatch?page=2')}`,
    )

    // Toggling Open Urgent Flags resets page to 1 and forwards urgentOnly: true to server hook
    fireEvent.click(screen.getByRole('button', { name: /Open Urgent Flags/i }))
    expect(mockUseServiceRequests).toHaveBeenLastCalledWith(
      expect.objectContaining({
        urgentOnly: true,
        limit: 25,
        offset: 0,
      }),
    )
    expect(screen.getByText('SRV-2026-00120')).toBeInTheDocument()
    expect(screen.getByTestId('dispatch-location')).toHaveTextContent('/services/dispatch?urgent=1')
  })

  it('B6: renders Persistent Urgent Alerts & Email Escalation Queue and allows retry for coordinators with service_alerts.read/ack', () => {
    mockUseAuth.mockReturnValue({
      status: 'authenticated',
      devPreviewRole: null,
      session: { userId: 'coord-1' },
      access: {
        profile: { id: 'coord-1', displayName: 'Coordinator One', status: 'active' },
        roleKeys: ['coordinator'],
        permissionKeys: [
          'service_requests.read',
          'service_requests.dispatch',
          'service_alerts.read',
          'service_alerts.ack',
          'service_alerts.resolve',
        ],
      },
    })
    mockUseServiceRequests.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { total_count: 0, limit: 25, offset: 0, rows: [] },
    })
    mockUseServiceUrgentFlags.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        total_count: 1,
        open_count: 1,
        acknowledged_count: 0,
        failed_delivery_flags_count: 1,
        limit: 10,
        offset: 0,
        rows: [
          {
            id: 'flag-q-1',
            service_request_id: 'req-q-1',
            internal_code: 'SRV-2026-00888',
            site_name: 'Ntinda Tower',
            area_label: 'Ntinda',
            request_type: 'maintenance',
            request_status: 'in_progress',
            visit_id: null,
            reason_code: 'fiber_backbone_fault',
            summary: 'Backbone fibre cut reported by field lead',
            status: 'open',
            reported_by: 'eng-1',
            reported_by_name: 'Engineer Alpha',
            reported_at: '2026-11-17T08:00:00Z',
            version: 1,
            delivery_summary: {
              total: 1,
              sent: 0,
              pending: 0,
              processing: 0,
              failed: 1,
              skipped: 0,
              max_attempt_count: 1,
              requires_reconciliation: false,
              latest_status: 'failed',
              latest_error_code: 'EMAIL_PROVIDER_NOT_CONFIGURED',
              last_attempt_at: '2026-11-17T08:00:02Z',
            },
            deliveries: [],
          },
        ],
      },
    })
    mockRetryUrgentNotification.mockResolvedValue({
      flag_id: 'flag-q-1',
      retried_count: 1,
      skipped_unauthorised_count: 0,
      exhausted_count: 0,
      reconciliation_required_count: 0,
    })

    renderDispatch('/services/dispatch')
    expect(screen.getByText(/Urgent Alerts & Email Escalation Queue/i)).toBeInTheDocument()
    expect(screen.getByText('SRV-2026-00888')).toBeInTheDocument()
    expect(screen.getByText(/Email Provider Secrets Not Configured/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Retry Email Delivery/i }))
    expect(mockRetryUrgentNotification).toHaveBeenCalledWith({ flagId: 'flag-q-1' })

    fireEvent.click(screen.getByRole('button', { name: /Email Delivery Issues/i }))
    expect(mockUseServiceUrgentFlags).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'delivery_failed', enabled: true }),
    )
  })
})
