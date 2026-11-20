import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@/components/ui/Toast'
import { resetServiceSessionRegistryForTest } from '../lib/pendingOperations'
import { ServiceIntakePage } from './ServiceIntakePage'

const mockSaveDraft = vi.fn()
const mockSubmitReq = vi.fn()
const mockUseAuth = vi.fn()
const mockUseServiceRequests = vi.fn()

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
    useServiceRequestDetail: () => ({ data: null, isLoading: false, isError: false }),
    useServiceRequests: (...args: unknown[]) => mockUseServiceRequests(...args) as unknown,
    useSaveServiceDraft: () => ({ mutateAsync: mockSaveDraft, isPending: false }),
    useSubmitServiceRequest: () => ({ mutateAsync: mockSubmitReq, isPending: false }),
  }
})

function LocationEcho() {
  const loc = useLocation()
  return <span data-testid="intake-location">{`${loc.pathname}${loc.search}`}</span>
}

function renderIntake(initialPath = '/services/intake/new') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <ServiceIntakePage />
          <LocationEcho />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

function fillIntakeRequiredFields() {
  fireEvent.change(screen.getByPlaceholderText('e.g. Roke Telkom'), { target: { value: 'Roke Telkom' } })
  fireEvent.change(screen.getByPlaceholderText('e.g. RK-99812'), { target: { value: 'RK-DUPE-1' } })
  fireEvent.change(screen.getByPlaceholderText('e.g. Acacia Mall Wing B'), { target: { value: 'Acacia Wing B' } })
  fireEvent.change(screen.getByPlaceholderText('e.g. Kololo'), { target: { value: 'Kololo' } })
  fireEvent.change(screen.getByPlaceholderText('Plot, floor, suite, gate directions...'), {
    target: { value: 'Plot 14 Acacia Ave' },
  })
  fireEvent.change(screen.getByPlaceholderText('Site contact full name'), { target: { value: 'Jane Doe' } })
  fireEvent.change(screen.getByPlaceholderText('+256 7XX XXX XXX'), { target: { value: '+256700111222' } })
  fireEvent.change(screen.getByPlaceholderText('Describe installation work or fault symptoms...'), {
    target: { value: 'Install enterprise fibre drop to suite 4' },
  })
}

function makeDeskAuth(userId = 'desk-1', authEpoch = 1) {
  return {
    status: 'authenticated',
    devPreviewRole: null,
    authEpoch,
    session: { userId },
    access: {
      profile: { id: userId, displayName: `Desk ${userId}`, status: 'active' },
      isActive: true,
      roleKeys: ['service_desk'],
      permissionKeys: [
        'service_requests.intake',
        'service_requests.read',
        'service_requests.report_provider',
      ],
    },
  }
}

describe('ServiceIntakePage', () => {
  beforeEach(() => {
    resetServiceSessionRegistryForTest()
    mockSaveDraft.mockReset()
    mockSubmitReq.mockReset()
    mockUseServiceRequests.mockReset()
    mockUseAuth.mockReturnValue(makeDeskAuth('desk-1', 1))
    mockUseServiceRequests.mockReturnValue({
      data: { total_count: 0, limit: 25, offset: 0, rows: [] },
      isLoading: false,
      isError: false,
    })
  })

  it('handles duplicate provider reference warning and requires explicit confirmation before retrying', async () => {
    renderIntake('/services/intake/new')
    fillIntakeRequiredFields()

    mockSaveDraft.mockRejectedValueOnce(
      new Error('PROVIDER_REF_EXISTS: An active request already uses this reference.'),
    )

    fireEvent.click(screen.getByRole('button', { name: /Submit to Dispatch/i }))

    expect(await screen.findByText(/Possible Duplicate Provider Reference/i)).toBeInTheDocument()

    const confirmCheckbox = screen.getByRole('checkbox', {
      name: /Confirm intentional separate ticket/i,
    })
    fireEvent.click(confirmCheckbox)

    mockSaveDraft.mockResolvedValueOnce({
      request_id: 'r1',
      operation_type: 'service_save_draft',
      replayed: false,
      result: { id: 'req-new-1', version: 1 },
    })
    mockSubmitReq.mockResolvedValueOnce({
      request_id: 'r2',
      operation_type: 'service_submit_request',
      replayed: false,
      result: { id: 'req-new-1', status: 'submitted', version: 2 },
    })

    fireEvent.click(screen.getByRole('button', { name: /Submit to Dispatch/i }))

    await waitFor(() => {
      expect(mockSaveDraft).toHaveBeenCalled()
      expect(mockSubmitReq).toHaveBeenCalledTimes(1)
    })

    const lastSaveArgs = mockSaveDraft.mock.calls.at(-1)?.[0] as { confirmDuplicate?: boolean }
    expect(lastSaveArgs.confirmDuplicate).toBe(true)

    const submitArgs = mockSubmitReq.mock.calls[0]?.[0] as {
      id: string
      expectedVersion: number
      confirmDuplicate?: boolean
      pinnedSessionSnapshot?: { identityKey: string | null; isReady: boolean }
    }
    expect(submitArgs.id).toBe('req-new-1')
    expect(submitArgs.expectedVersion).toBe(1)
    expect(submitArgs.confirmDuplicate).toBe(true)
    expect(submitArgs.pinnedSessionSnapshot?.identityKey).toBe('desk-1')
    expect(submitArgs.pinnedSessionSnapshot?.isReady).toBe(true)
  })

  it('B5-01: aborts Save -> Submit continuation cleanly when account switches before submit step', async () => {
    let resolveSave!: (value: unknown) => void
    mockSaveDraft.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        }),
    )

    const { rerender } = renderIntake('/services/intake/new')
    fillIntakeRequiredFields()
    fireEvent.click(screen.getByRole('button', { name: /Submit to Dispatch/i }))

    await waitFor(() => {
      expect(mockSaveDraft).toHaveBeenCalledTimes(1)
    })

    // Switch account while Save Draft is awaiting response
    mockUseAuth.mockReturnValue(makeDeskAuth('desk-2', 2))
    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <MemoryRouter initialEntries={['/services/intake/new']}>
            <ServiceIntakePage />
            <LocationEcho />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    )

    resolveSave({
      request_id: 'r1',
      operation_type: 'service_save_draft',
      replayed: false,
      result: { id: 'req-aborted', version: 1 },
    })

    await waitFor(() => {
      expect(screen.getByTestId('intake-location')).toHaveTextContent('/services/intake/new')
    })
    expect(mockSubmitReq).not.toHaveBeenCalled()
  })

  it('B5-02: passes server statuses filter, paginates intake queue beyond 100 items, and surfaces errors', () => {
    mockUseServiceRequests.mockImplementation((filters: { offset?: number } = {}) => ({
      isLoading: false,
      isError: false,
      data: {
        total_count: 112,
        limit: 25,
        offset: filters.offset ?? 0,
        rows: [
          {
            id: filters.offset === 25 ? 'req-p2' : 'req-p1',
            internal_code: filters.offset === 25 ? 'SRV-2026-00101' : 'SRV-2026-00001',
            request_type: 'installation',
            priority: 'normal',
            site_name: filters.offset === 25 ? 'Page 2 Site' : 'Page 1 Site',
            area_label: 'Kololo',
            status: 'submitted',
            provider_name: 'Roke Telkom',
            provider_reference: filters.offset === 25 ? 'RK-101' : 'RK-001',
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
            open_urgent_count: 0,
            highest_urgent_status: 'none',
            version: 1,
          },
        ],
      },
    }))

    renderIntake('/services/intake')

    expect(mockUseServiceRequests).toHaveBeenCalledWith(
      expect.objectContaining({
        statuses: ['draft', 'submitted', 'coordinator_reviewed', 'reported_to_provider'],
        limit: 25,
        offset: 0,
      }),
      true,
    )
    expect(screen.getByText('112 ticket(s)')).toBeInTheDocument()
    expect(screen.getByText(/Showing 1–25 of 112/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Next/i }))
    expect(screen.getByText('SRV-2026-00101')).toBeInTheDocument()
    expect(screen.getByTestId('intake-location')).toHaveTextContent('/services/intake?queuePage=2')

    // Error state surfaces honestly
    mockUseServiceRequests.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new Error('RPC offline'),
    })
    renderIntake('/services/intake')
    expect(screen.getByText('Could not load intake queue')).toBeInTheDocument()
    expect(screen.getByText('RPC offline')).toBeInTheDocument()
  })
})
