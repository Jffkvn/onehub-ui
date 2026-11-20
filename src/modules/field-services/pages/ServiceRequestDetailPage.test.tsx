import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@/components/ui/Toast'
import { ServiceRequestDetailPage } from './ServiceRequestDetailPage'
import type { ServiceRequestDetail } from '../schemas/services'

const mockUseAuth = vi.fn()
const mockUseDetail = vi.fn()
const mockSaveVisit = vi.fn()
const mockCompleteVisit = vi.fn()
const mockLogContribution = vi.fn()
const mockRetryUrgent = vi.fn()
const mockReissueUrgent = vi.fn()

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
    useServiceRequestDetail: () => mockUseDetail() as unknown,
    useServiceChecklists: () => ({
      data: {
        provisional: true,
        installation: [
          { key: 'ont_mounted', label: 'ONT / customer equipment mounted & powered' },
        ],
        maintenance: [{ key: 'fault_isolated', label: 'Fault location isolated cleanly' }],
      },
      isLoading: false,
    }),
    useDispatchCandidates: () => ({ data: [], isLoading: false }),
    useSubmitServiceRequest: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useAcceptServiceRequest: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useStartServiceVisit: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useSaveServiceVisit: () => ({ mutateAsync: mockSaveVisit, isPending: false }),
    useCompleteServiceVisit: () => ({ mutateAsync: mockCompleteVisit, isPending: false, variables: undefined }),
    useLogAssistantVisitContribution: () => ({ mutateAsync: mockLogContribution, isPending: false }),
    useAssignServiceRequest: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useAddAssignmentAssistant: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useReviewServiceRequest: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useReportServiceToProvider: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useConfirmProviderHandoff: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useCancelServiceRequest: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useRaiseUrgentFlag: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useAckUrgentFlag: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useResolveUrgentFlag: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useRetryUrgentNotification: () => ({ mutateAsync: mockRetryUrgent, isPending: false }),
    useReissueUrgentNotification: () => ({ mutateAsync: mockReissueUrgent, isPending: false }),
    useSignedServiceEvidenceUrl: () => ({ data: null, isLoading: false, isError: false }),
  }
})

const ACTOR_ID = 'c5100000-0000-4000-8000-000000000009'
const BASE_ID = 'd5100000-0000-4000-8000-000000000001'
const VISIT_ID = 'e5100000-0000-4000-8000-000000000001'
const ASGN_ID = 'a5100000-0000-4000-8000-000000000001'

function makeDetail(overrides: Partial<ServiceRequestDetail>): ServiceRequestDetail {
  return {
    viewer_scope: 'active_assigned',
    id: BASE_ID,
    internal_code: 'SRV-2026-00042',
    provider_name: 'Roke Telkom',
    provider_reference: 'RK-42',
    request_type: 'installation',
    priority: 'high',
    site_name: 'Bugolobi Court',
    area_label: 'Bugolobi',
    physical_address: 'Plot 20 Luthuli Ave',
    access_instructions: 'Security gate desk',
    customer_contact_name: 'Peter Kato',
    customer_contact_phone: '+256700222333',
    summary: 'Install customer fibre ONT on 2nd floor',
    intake_internal_notes: null,
    received_source: 'provider_email',
    provider_received_at: '2026-11-17T06:00:00Z',
    provider_deadline_at: null,
    status: 'in_progress',
    version: 3,
    active_assignment_id: ASGN_ID,
    active_episode_number: 1,
    my_assignment_role: 'lead',
    active_crew: [
      { profile_id: ACTOR_ID, display_name: 'Engineer Alpha', assignment_role: 'lead' },
    ],
    visits: [
      {
        id: VISIT_ID,
        assignment_id: ASGN_ID,
        visit_number: 1,
        lead_profile_id: ACTOR_ID,
        lead_name: 'Engineer Alpha',
        visit_status: 'in_progress',
        checklist: {},
        work_notes: '',
        photo_paths: [],
        outcome: null,
        follow_up_reason: null,
        arrival_at: '2026-11-17T07:00:00Z',
        ended_at: null,
        version: 1,
        contributors: [],
      },
    ],
    urgent_flags: [],
    events: [],
    ...overrides,
  }
}

function renderDetail(path = `/services/requests/${BASE_ID}?from=/services/my-jobs`) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/services/requests/:id" element={<ServiceRequestDetailPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('ServiceRequestDetailPage', () => {
  beforeEach(() => {
    mockSaveVisit.mockReset()
    mockCompleteVisit.mockReset()
    mockLogContribution.mockReset()
  })

  it('requires meaningful work notes in addition to checked items before completing a visit', async () => {
    mockUseAuth.mockReturnValue({
      status: 'authenticated',
      session: { userId: ACTOR_ID },
      access: {
        profile: { id: ACTOR_ID },
        roleKeys: ['employee'],
        permissionKeys: ['service_visits.read_assigned', 'service_visits.work_assigned'],
      },
    })
    mockUseDetail.mockReturnValue({
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      data: makeDetail({}),
    })

    renderDetail()

    // Selecting an evidence image must synchronously retain the File after clearing input value
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const pngFile = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'ont.png', {
      type: 'image/png',
    })
    fireEvent.change(fileInput, { target: { files: [pngFile] } })
    expect(await screen.findByText(/Visit Evidence Photos \(1\/10\)/i)).toBeInTheDocument()
    expect(screen.getByText('ont.png')).toBeInTheDocument()

    // Check checklist item but leave notes blank
    fireEvent.click(screen.getByRole('checkbox', { name: /ONT \/ customer equipment mounted/i }))
    fireEvent.click(screen.getByRole('button', { name: /Complete Work/i }))

    expect(
      await screen.findByText(/Tick-boxes alone cannot declare work successful/i),
    ).toBeInTheDocument()
    expect(mockCompleteVisit).not.toHaveBeenCalled()
  })

  it('shows Assistant contributor panel separately while Lead runs the main visit', () => {
    mockUseAuth.mockReturnValue({
      status: 'authenticated',
      session: { userId: 'assistant-1' },
      access: {
        profile: { id: 'assistant-1' },
        roleKeys: ['employee'],
        permissionKeys: ['service_visits.read_assigned', 'service_visits.work_assigned'],
      },
    })
    mockUseDetail.mockReturnValue({
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      data: makeDetail({ my_assignment_role: 'assistant' }),
    })

    renderDetail()
    expect(screen.getByText(/Assistant Crew Contribution/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Complete Work/i })).not.toBeInTheDocument()
  })

  it('enforces non-self-review UI guard when coordinator participated in an earlier episode and handles redacted historical scope & closed-ticket urgent resolution', () => {
    mockUseAuth.mockReturnValue({
      status: 'authenticated',
      session: { userId: ACTOR_ID },
      access: {
        profile: { id: ACTOR_ID },
        roleKeys: ['coordinator'],
        permissionKeys: [
          'service_requests.read',
          'service_requests.review',
          'service_alerts.resolve',
        ],
      },
    })
    mockUseDetail.mockReturnValue({
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      data: makeDetail({
        viewer_scope: 'full',
        status: 'work_completed',
        my_assignment_role: null,
        visits: [
          {
            id: VISIT_ID,
            assignment_id: ASGN_ID,
            visit_number: 1,
            lead_profile_id: 'other-lead',
            lead_name: 'Other Lead',
            visit_status: 'work_completed',
            checklist: { ont_mounted: true },
            work_notes: 'Completed by episode 2 lead',
            photo_paths: [],
            outcome: 'completed',
            follow_up_reason: null,
            arrival_at: '2026-11-17T08:00:00Z',
            ended_at: '2026-11-17T09:00:00Z',
            version: 2,
            contributors: [
              {
                id: 'contrib-1',
                profile_id: ACTOR_ID,
                display_name: 'Coordinator Who Helped Earlier',
                arrival_at: '2026-11-17T07:30:00Z',
                note: 'Ran drop cable earlier',
                photo_paths: [],
                updated_at: '2026-11-17T07:45:00Z',
              },
            ],
          },
        ],
        urgent_flags: [
          {
            id: 'flag-1',
            visit_id: VISIT_ID,
            reason_code: 'safety_hazard',
            summary: 'Pole anchor loose near gate',
            status: 'acknowledged',
            reported_by: 'other-lead',
            reported_by_name: 'Other Lead',
            reported_at: '2026-11-17T08:15:00Z',
            version: 2,
          },
        ],
      }),
    })

    const fullView = renderDetail(`/services/requests/${BASE_ID}?from=/services/dispatch?type=installation`)
    expect(screen.getByTestId('non-self-review-notice')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Approve Work/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Resolve Flag/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Back to Queue/i })).toHaveAttribute(
      'href',
      '/services/dispatch?type=installation',
    )
    fullView.unmount()

    // Historical participant view redacts phone & address
    mockUseDetail.mockReturnValue({
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      data: makeDetail({
        viewer_scope: 'historical_participant',
        status: 'provider_confirmed',
        physical_address: null,
        customer_contact_name: null,
        customer_contact_phone: null,
        my_assignment_role: null,
        active_crew: [],
        visits: [],
        urgent_flags: [],
      }),
    })
    renderDetail()
    expect(screen.getByText(/Historical participant read-only view/i)).toBeInTheDocument()
    expect(screen.getAllByText(/Redacted in historical view/i)).toHaveLength(2)
  })

  it('B5-04: preserves Assistant unsaved note & queued photo when Lead bumps visit.version and shows conflict only if same-owner contribution changes remotely', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const makeTree = () => (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MemoryRouter initialEntries={[`/services/requests/${BASE_ID}?from=/services/my-jobs`]}>
            <Routes>
              <Route path="/services/requests/:id" element={<ServiceRequestDetailPage />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    )

    mockUseAuth.mockReturnValue({
      status: 'authenticated',
      session: { userId: 'assistant-1' },
      access: {
        profile: { id: 'assistant-1' },
        roleKeys: ['employee'],
        permissionKeys: ['service_visits.read_assigned', 'service_visits.work_assigned'],
      },
    })
    mockUseDetail.mockReturnValue({
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      data: makeDetail({ my_assignment_role: 'assistant' }),
    })

    const view = render(makeTree())
    const noteBox = screen.getByPlaceholderText(/Document cabling assistance/i)
    fireEvent.change(noteBox, { target: { value: 'Checking splice tray 2' } })
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'local-proof.png', {
      type: 'image/png',
    })
    fireEvent.change(fileInput, { target: { files: [file] } })
    expect(screen.getByText('local-proof.png')).toBeInTheDocument()
    expect(screen.getByText('Unsaved edits')).toBeInTheDocument()

    // Lead bumps visit.version 1 -> 2 and updates Lead work_notes while Assistant's saved contribution is unchanged
    mockUseDetail.mockReturnValue({
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      data: makeDetail({
        my_assignment_role: 'assistant',
        version: 4,
        visits: [
          {
            ...makeDetail({}).visits[0],
            version: 2,
            work_notes: 'Lead optical reading -17dBm',
            checklist: { ont_mounted: true },
          },
        ],
      }),
    })
    view.rerender(makeTree())

    expect(screen.getByDisplayValue('Checking splice tray 2')).toBeInTheDocument()
    expect(screen.getByText('local-proof.png')).toBeInTheDocument()
    expect(screen.queryByTestId('visit-draft-conflict-banner')).not.toBeInTheDocument()

    // Same-owner remote change triggers conflict banner without wiping unsaved edits
    mockUseDetail.mockReturnValue({
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      data: makeDetail({
        my_assignment_role: 'assistant',
        visits: [
          {
            ...makeDetail({}).visits[0],
            version: 3,
            contributors: [
              {
                id: 'contrib-asst-1',
                profile_id: 'assistant-1',
                display_name: 'Assistant 1',
                arrival_at: '2026-11-17T07:10:00Z',
                note: 'Saved from tablet session',
                photo_paths: [],
                updated_at: '2026-11-17T07:15:00Z',
              },
            ],
          },
        ],
      }),
    })
    view.rerender(makeTree())

    expect(await screen.findByTestId('visit-draft-conflict-banner')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Checking splice tray 2')).toBeInTheDocument()
    expect(screen.getByText('local-proof.png')).toBeInTheDocument()

    // Keep Editing My Draft closes banner while preserving dirty draft
    fireEvent.click(screen.getByRole('button', { name: /Keep Editing My Draft/i }))
    expect(screen.queryByTestId('visit-draft-conflict-banner')).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('Checking splice tray 2')).toBeInTheDocument()
    expect(screen.getByText('local-proof.png')).toBeInTheDocument()

    // Newer remote edit re-surfaces banner and Load Server Version replaces dirty draft cleanly
    mockUseDetail.mockReturnValue({
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      data: makeDetail({
        my_assignment_role: 'assistant',
        visits: [
          {
            ...makeDetail({}).visits[0],
            version: 4,
            contributors: [
              {
                id: 'contrib-asst-1',
                profile_id: 'assistant-1',
                display_name: 'Assistant 1',
                arrival_at: '2026-11-17T07:10:00Z',
                note: 'Latest server tablet note',
                photo_paths: [],
                updated_at: '2026-11-17T07:20:00Z',
              },
            ],
          },
        ],
      }),
    })
    view.rerender(makeTree())

    expect(await screen.findByTestId('visit-draft-conflict-banner')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Load Server Version/i }))
    expect(screen.getByDisplayValue('Latest server tablet note')).toBeInTheDocument()
    expect(screen.queryByText('local-proof.png')).not.toBeInTheDocument()
    expect(screen.queryByTestId('visit-draft-conflict-banner')).not.toBeInTheDocument()

    // Switching actorId unmounts previous user's panel so no draft bleeds to another assistant
    fireEvent.change(screen.getByPlaceholderText(/Document cabling assistance/i), {
      target: { value: 'Temp assistant-1 edit' },
    })
    expect(screen.getByText('Unsaved edits')).toBeInTheDocument()

    mockUseAuth.mockReturnValue({
      status: 'authenticated',
      session: { userId: 'assistant-2' },
      access: {
        profile: { id: 'assistant-2' },
        roleKeys: ['employee'],
        permissionKeys: ['service_visits.read_assigned', 'service_visits.work_assigned'],
      },
    })
    view.rerender(makeTree())
    expect(screen.queryByDisplayValue('Temp assistant-1 edit')).not.toBeInTheDocument()
    expect(screen.queryByText('Unsaved edits')).not.toBeInTheDocument()
  })

  it('B5-04: preserves Lead unsaved checklist, notes & queued photo across refetch/assistant updates and supports Discard & conflict resolution', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const makeTree = () => (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MemoryRouter initialEntries={[`/services/requests/${BASE_ID}?from=/services/my-jobs`]}>
            <Routes>
              <Route path="/services/requests/:id" element={<ServiceRequestDetailPage />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    )

    mockUseAuth.mockReturnValue({
      status: 'authenticated',
      session: { userId: ACTOR_ID },
      access: {
        profile: { id: ACTOR_ID },
        roleKeys: ['employee'],
        permissionKeys: ['service_visits.read_assigned', 'service_visits.work_assigned'],
      },
    })
    mockUseDetail.mockReturnValue({
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      data: makeDetail({}),
    })

    const view = render(makeTree())
    fireEvent.click(screen.getByRole('checkbox', { name: /ONT \/ customer equipment mounted/i }))
    fireEvent.change(screen.getByPlaceholderText(/Document work done/i), {
      target: { value: 'Optical -18.4 dBm at splitter' },
    })
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'lead-proof.png', {
      type: 'image/png',
    })
    fireEvent.change(fileInput, { target: { files: [file] } })

    // Assistant logs contribution concurrently -> Lead draft stays completely intact without conflict
    mockUseDetail.mockReturnValue({
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      data: makeDetail({
        visits: [
          {
            ...makeDetail({}).visits[0],
            version: 1,
            contributors: [
              {
                id: 'c-1',
                profile_id: 'assistant-1',
                display_name: 'Assistant 1',
                arrival_at: '2026-11-17T07:10:00Z',
                note: 'Assistant ran drop',
                photo_paths: [],
                updated_at: '2026-11-17T07:12:00Z',
              },
            ],
          },
        ],
      }),
    })
    view.rerender(makeTree())

    expect(screen.getByRole('checkbox', { name: /ONT \/ customer equipment mounted/i })).toBeChecked()
    expect(screen.getByDisplayValue('Optical -18.4 dBm at splitter')).toBeInTheDocument()
    expect(screen.getByText('lead-proof.png')).toBeInTheDocument()
    expect(screen.queryByTestId('visit-draft-conflict-banner')).not.toBeInTheDocument()

    // Explicit Discard Unsaved Edits resets Lead state to server baseline
    fireEvent.click(screen.getByRole('button', { name: /Discard Unsaved Edits/i }))
    expect(screen.getByRole('checkbox', { name: /ONT \/ customer equipment mounted/i })).not.toBeChecked()
    expect(screen.getByPlaceholderText(/Document work done/i)).toHaveValue('')
    expect(screen.queryByText('lead-proof.png')).not.toBeInTheDocument()
    expect(screen.queryByText('Unsaved edits')).not.toBeInTheDocument()

    // Type new edit, remote Lead edit lands -> conflict banner appears
    fireEvent.change(screen.getByPlaceholderText(/Document work done/i), {
      target: { value: 'Lead local draft' },
    })
    mockUseDetail.mockReturnValue({
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      data: makeDetail({
        visits: [
          {
            ...makeDetail({}).visits[0],
            version: 2,
            work_notes: 'Remote lead save',
          },
        ],
      }),
    })
    view.rerender(makeTree())
    expect(await screen.findByTestId('visit-draft-conflict-banner')).toBeInTheDocument()

    // Superseded/closed visit unmounts panel cleanly
    mockUseDetail.mockReturnValue({
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      data: makeDetail({
        status: 'work_completed',
        visits: [
          {
            ...makeDetail({}).visits[0],
            visit_status: 'work_completed',
            version: 3,
          },
        ],
      }),
    })
    view.rerender(makeTree())
    expect(screen.queryByPlaceholderText(/Document work done/i)).not.toBeInTheDocument()
  })

  it('B6: highlights ?urgent=<flagId>, surfaces coordinator delivery status + Retry/Audited Reissue, and hides delivery controls from crew', async () => {
    const FLAG_ID = 'f6100000-0000-4000-8000-000000000001'
    mockRetryUrgent.mockResolvedValue({
      flag_id: FLAG_ID,
      retried_count: 1,
      skipped_unauthorised_count: 0,
      exhausted_count: 0,
      reconciliation_required_count: 0,
    })
    mockReissueUrgent.mockResolvedValue({
      flag_id: FLAG_ID,
      reconciled_count: 1,
      reissued_count: 1,
    })

    // 1. Coordinator sees delivery status + Retry + ack/resolve attribution + ?urgent highlight
    mockUseAuth.mockReturnValue({
      status: 'authenticated',
      devPreviewRole: null,
      session: { userId: 'coord-1' },
      access: {
        profile: { id: 'coord-1', displayName: 'Coordinator One', status: 'active' },
        roleKeys: ['coordinator'],
        permissionKeys: [
          'service_requests.read',
          'service_alerts.read',
          'service_alerts.ack',
          'service_alerts.resolve',
        ],
      },
    })
    mockUseDetail.mockReturnValue({
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      data: makeDetail({
        viewer_scope: 'full',
        my_assignment_role: null,
        urgent_flags: [
          {
            id: FLAG_ID,
            visit_id: VISIT_ID,
            reason_code: 'safety_hazard',
            summary: 'Live power drop blocking pole',
            status: 'acknowledged',
            reported_by: ACTOR_ID,
            reported_by_name: 'Engineer Alpha',
            reported_at: '2026-11-17T07:00:00Z',
            acknowledged_by: 'coord-1',
            acknowledged_by_name: 'Coordinator One',
            acknowledged_at: '2026-11-17T07:05:00Z',
            acknowledgement_note: 'Dispatched power team',
            resolved_by: null,
            resolved_by_name: null,
            resolved_at: null,
            resolution_note: null,
            version: 2,
            delivery_summary: {
              total: 1,
              sent: 0,
              pending: 0,
              processing: 0,
              failed: 1,
              skipped: 0,
              max_attempt_count: 2,
              requires_reconciliation: false,
              latest_status: 'failed',
              latest_error_code: 'EMAIL_CHANNEL_DISABLED',
              last_attempt_at: '2026-11-17T07:00:05Z',
            },
            deliveries: [
              {
                id: 'd6100000-0000-4000-8000-000000000001',
                recipient_name: 'Coordinator One',
                status: 'failed',
                attempt_count: 2,
                last_error_code: 'EMAIL_CHANNEL_DISABLED',
                requires_reconciliation: false,
                first_provider_attempt_at: null,
                next_attempt_at: null,
                reconciled_at: null,
                updated_at: '2026-11-17T07:00:05Z',
              },
            ],
          },
        ],
      }),
    })

    const renderWithUrl = (url: string) =>
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider>
            <MemoryRouter initialEntries={[url]}>
              <Routes>
                <Route path="/services/requests/:id" element={<ServiceRequestDetailPage />} />
              </Routes>
            </MemoryRouter>
          </ToastProvider>
        </QueryClientProvider>,
      )

    const coordView = renderWithUrl(`/services/requests/${BASE_ID}?urgent=${FLAG_ID}`)
    expect(screen.getByText('Linked Alert')).toBeInTheDocument()
    expect(screen.getByText(/Acknowledged by Coordinator One/i)).toBeInTheDocument()
    expect(screen.getAllByText(/Global Email Channel Disabled/i).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /Retry Email Delivery/i }))
    await waitFor(() => {
      expect(mockRetryUrgent).toHaveBeenCalledWith({ flagId: FLAG_ID })
    })
    coordView.unmount()

    // 2. Reconciliation-required shows Audited Reissue dialog requiring risk confirmation
    mockUseDetail.mockReturnValue({
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      data: makeDetail({
        viewer_scope: 'full',
        my_assignment_role: null,
        urgent_flags: [
          {
            id: FLAG_ID,
            visit_id: VISIT_ID,
            reason_code: 'safety_hazard',
            summary: 'Live power drop blocking pole',
            status: 'acknowledged',
            reported_by: ACTOR_ID,
            reported_by_name: 'Engineer Alpha',
            reported_at: '2026-11-17T07:00:00Z',
            version: 2,
            delivery_summary: {
              total: 1,
              sent: 0,
              pending: 0,
              processing: 0,
              failed: 1,
              skipped: 0,
              max_attempt_count: 5,
              requires_reconciliation: true,
              latest_status: 'failed',
              latest_error_code: 'STALE_FINAL_CLAIM_UNKNOWN_DELIVERY',
              last_attempt_at: '2026-11-17T07:20:00Z',
            },
            deliveries: [],
          },
        ],
      }),
    })

    const reissueView = renderWithUrl(`/services/requests/${BASE_ID}`)
    fireEvent.click(screen.getByRole('button', { name: /Audited Reissue/i }))
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /I understand this audited reissue carries duplicate-email risk/i,
      }),
    )
    fireEvent.change(screen.getByLabelText(/Reconciliation & Reissue Justification/i), {
      target: { value: 'Verified in Resend log that delivery timed out prior to accept.' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Confirm Audited Reissue/i }))
    await waitFor(() => {
      expect(mockReissueUrgent).toHaveBeenCalledWith({
        flagId: FLAG_ID,
        confirmDuplicateRisk: true,
        reason: 'Verified in Resend log that delivery timed out prior to accept.',
      })
    })
    reissueView.unmount()

    // 3. Field Engineer (Tier 2) does NOT see delivery status panel even if client attempts
    mockUseAuth.mockReturnValue({
      status: 'authenticated',
      devPreviewRole: null,
      session: { userId: ACTOR_ID },
      access: {
        profile: { id: ACTOR_ID, displayName: 'Engineer Alpha', status: 'active' },
        roleKeys: ['employee'],
        permissionKeys: ['service_visits.read_assigned', 'service_visits.work_assigned'],
      },
    })
    mockUseDetail.mockReturnValue({
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      data: makeDetail({
        urgent_flags: [
          {
            id: FLAG_ID,
            visit_id: VISIT_ID,
            reason_code: 'safety_hazard',
            summary: 'Live power drop blocking pole',
            status: 'open',
            reported_by: ACTOR_ID,
            reported_by_name: 'Engineer Alpha',
            reported_at: '2026-11-17T07:00:00Z',
            version: 1,
            delivery_summary: null,
            deliveries: null,
          },
        ],
      }),
    })

    renderWithUrl(`/services/requests/${BASE_ID}`)
    expect(screen.getByText('Live power drop blocking pole')).toBeInTheDocument()
    expect(screen.queryByText(/Email Escalation Delivery/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Retry Email Delivery/i })).not.toBeInTheDocument()
  })

  it('B6-02: derives Retry vs Audited Reissue accurately across mixed, sent-at-5, skipped-at-5, and all-sent histories', () => {
    const FLAG_ID = 'f6200000-0000-4000-8000-000000000002'
    mockUseAuth.mockReturnValue({
      status: 'authenticated',
      devPreviewRole: null,
      session: { userId: 'coord-1' },
      access: {
        profile: { id: 'coord-1', displayName: 'Coordinator One', status: 'active' },
        roleKeys: ['coordinator'],
        permissionKeys: [
          'service_requests.read',
          'service_alerts.read',
          'service_alerts.ack',
          'service_alerts.resolve',
        ],
      },
    })

    const renderCoord = () =>
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider>
            <MemoryRouter initialEntries={[`/services/requests/${BASE_ID}`]}>
              <Routes>
                <Route path="/services/requests/:id" element={<ServiceRequestDetailPage />} />
              </Routes>
            </MemoryRouter>
          </ToastProvider>
        </QueryClientProvider>,
      )

    // Case 1: Recipient A sent on attempt 5, Recipient B failed on attempt 1 (even if aggregate max_attempt_count is 5)
    mockUseDetail.mockReturnValue({
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      data: makeDetail({
        viewer_scope: 'full',
        my_assignment_role: null,
        urgent_flags: [
          {
            id: FLAG_ID,
            visit_id: VISIT_ID,
            reason_code: 'safety_hazard',
            summary: 'Sent-at-5 plus failed-at-1 case',
            status: 'open',
            reported_by: ACTOR_ID,
            reported_by_name: 'Engineer Alpha',
            reported_at: '2026-11-17T07:00:00Z',
            version: 1,
            delivery_summary: {
              total: 2,
              sent: 1,
              pending: 0,
              processing: 0,
              failed: 1,
              skipped: 0,
              max_attempt_count: 5,
              requires_reconciliation: false,
              latest_status: 'failed',
              latest_error_code: 'RESEND_NETWORK_ERROR',
              last_attempt_at: '2026-11-17T07:05:00Z',
            },
            deliveries: [
              {
                id: 'd6200000-0000-4000-8000-000000000001',
                recipient_name: 'Coordinator One',
                status: 'sent',
                attempt_count: 5,
                last_error_code: null,
                requires_reconciliation: false,
                first_provider_attempt_at: '2026-11-17T07:00:00Z',
                next_attempt_at: null,
                reconciled_at: null,
                updated_at: '2026-11-17T07:05:00Z',
              },
              {
                id: 'd6200000-0000-4000-8000-000000000002',
                recipient_name: 'Backup Dispatcher',
                status: 'failed',
                attempt_count: 1,
                last_error_code: 'RESEND_NETWORK_ERROR',
                requires_reconciliation: false,
                first_provider_attempt_at: null,
                next_attempt_at: '2026-11-17T07:10:00Z',
                reconciled_at: null,
                updated_at: '2026-11-17T07:05:00Z',
              },
            ],
          },
        ],
      }),
    })
    const view1 = renderCoord()
    expect(screen.getByRole('button', { name: /Retry Email Delivery/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Audited Reissue/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/Reconciliation Required/i)).not.toBeInTheDocument()
    view1.unmount()

    // Case 2: Reconciled/skipped historical row at attempt 5 + replacement failed at attempt 1
    mockUseDetail.mockReturnValue({
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      data: makeDetail({
        viewer_scope: 'full',
        my_assignment_role: null,
        urgent_flags: [
          {
            id: FLAG_ID,
            visit_id: VISIT_ID,
            reason_code: 'safety_hazard',
            summary: 'Skipped-at-5 plus replacement failed-at-1',
            status: 'open',
            reported_by: ACTOR_ID,
            reported_by_name: 'Engineer Alpha',
            reported_at: '2026-11-17T07:00:00Z',
            version: 1,
            delivery_summary: {
              total: 2,
              sent: 0,
              pending: 0,
              processing: 0,
              failed: 1,
              skipped: 1,
              max_attempt_count: 5,
              requires_reconciliation: false,
              latest_status: 'failed',
              latest_error_code: 'RESEND_NETWORK_ERROR',
              last_attempt_at: '2026-11-17T07:20:00Z',
            },
            deliveries: [
              {
                id: 'd6200000-0000-4000-8000-000000000003',
                recipient_name: 'Coordinator One',
                status: 'skipped',
                attempt_count: 5,
                last_error_code: 'RECONCILED_AND_REISSUED',
                requires_reconciliation: false,
                first_provider_attempt_at: '2026-11-17T07:00:00Z',
                next_attempt_at: null,
                reconciled_at: '2026-11-17T07:15:00Z',
                updated_at: '2026-11-17T07:15:00Z',
              },
              {
                id: 'd6200000-0000-4000-8000-000000000004',
                recipient_name: 'Coordinator One',
                status: 'failed',
                attempt_count: 1,
                last_error_code: 'RESEND_NETWORK_ERROR',
                requires_reconciliation: false,
                first_provider_attempt_at: null,
                next_attempt_at: '2026-11-17T07:25:00Z',
                reconciled_at: null,
                updated_at: '2026-11-17T07:20:00Z',
              },
            ],
          },
        ],
      }),
    })
    const view2 = renderCoord()
    expect(screen.getByRole('button', { name: /Retry Email Delivery/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Audited Reissue/i })).not.toBeInTheDocument()
    view2.unmount()

    // Case 3: Mixed active set (1 reconciliation-required failure + 1 ordinary retryable failure) -> BOTH buttons shown
    mockUseDetail.mockReturnValue({
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      data: makeDetail({
        viewer_scope: 'full',
        my_assignment_role: null,
        urgent_flags: [
          {
            id: FLAG_ID,
            visit_id: VISIT_ID,
            reason_code: 'safety_hazard',
            summary: 'Mixed active recovery case',
            status: 'open',
            reported_by: ACTOR_ID,
            reported_by_name: 'Engineer Alpha',
            reported_at: '2026-11-17T07:00:00Z',
            version: 1,
            delivery_summary: {
              total: 2,
              sent: 0,
              pending: 0,
              processing: 0,
              failed: 2,
              skipped: 0,
              retryable_count: 1,
              reissuable_count: 1,
              max_attempt_count: 5,
              requires_reconciliation: true,
              latest_status: 'failed',
              latest_error_code: 'STALE_FINAL_CLAIM_UNKNOWN_DELIVERY',
              last_attempt_at: '2026-11-17T07:25:00Z',
            },
            deliveries: [
              {
                id: 'd6200000-0000-4000-8000-000000000005',
                recipient_name: 'Coordinator One',
                status: 'failed',
                attempt_count: 5,
                last_error_code: 'STALE_FINAL_CLAIM_UNKNOWN_DELIVERY',
                requires_reconciliation: true,
                first_provider_attempt_at: '2026-11-17T07:00:00Z',
                next_attempt_at: null,
                reconciled_at: null,
                updated_at: '2026-11-17T07:25:00Z',
              },
              {
                id: 'd6200000-0000-4000-8000-000000000006',
                recipient_name: 'Backup Dispatcher',
                status: 'failed',
                attempt_count: 1,
                last_error_code: 'RESEND_NETWORK_ERROR',
                requires_reconciliation: false,
                first_provider_attempt_at: null,
                next_attempt_at: '2026-11-17T07:30:00Z',
                reconciled_at: null,
                updated_at: '2026-11-17T07:25:00Z',
              },
            ],
          },
        ],
      }),
    })
    const view3 = renderCoord()
    expect(screen.getByRole('button', { name: /Retry Email Delivery/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Audited Reissue/i })).toBeInTheDocument()
    view3.unmount()

    // Case 4: All-sent delivery history (including sent at attempt 5) -> neither button shown
    mockUseDetail.mockReturnValue({
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      data: makeDetail({
        viewer_scope: 'full',
        my_assignment_role: null,
        urgent_flags: [
          {
            id: FLAG_ID,
            visit_id: VISIT_ID,
            reason_code: 'safety_hazard',
            summary: 'All delivered case',
            status: 'acknowledged',
            reported_by: ACTOR_ID,
            reported_by_name: 'Engineer Alpha',
            reported_at: '2026-11-17T07:00:00Z',
            version: 2,
            delivery_summary: {
              total: 1,
              sent: 1,
              pending: 0,
              processing: 0,
              failed: 0,
              skipped: 0,
              retryable_count: 0,
              reissuable_count: 0,
              max_attempt_count: 0,
              requires_reconciliation: false,
              latest_status: 'sent',
              latest_error_code: null,
              last_attempt_at: '2026-11-17T07:05:00Z',
            },
            deliveries: [
              {
                id: 'd6200000-0000-4000-8000-000000000007',
                recipient_name: 'Coordinator One',
                status: 'sent',
                attempt_count: 5,
                last_error_code: null,
                requires_reconciliation: false,
                first_provider_attempt_at: '2026-11-17T07:00:00Z',
                next_attempt_at: null,
                reconciled_at: null,
                updated_at: '2026-11-17T07:05:00Z',
              },
            ],
          },
        ],
      }),
    })
    renderCoord()
    expect(screen.queryByRole('button', { name: /Retry Email Delivery/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Audited Reissue/i })).not.toBeInTheDocument()
  })

  it('B6-R1: surfaces Retry (and not Audited Reissue) for an in-window below-cap stale processing claim', () => {
    const FLAG_ID = 'f6200000-0000-4000-8000-000000000003'
    mockUseAuth.mockReturnValue({
      status: 'authenticated',
      devPreviewRole: null,
      session: { userId: 'coord-1' },
      access: {
        profile: { id: 'coord-1', displayName: 'Coordinator One', status: 'active' },
        roleKeys: ['coordinator'],
        permissionKeys: [
          'service_requests.read',
          'service_alerts.read',
          'service_alerts.ack',
          'service_alerts.resolve',
        ],
      },
    })

    mockUseDetail.mockReturnValue({
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      data: makeDetail({
        viewer_scope: 'full',
        my_assignment_role: null,
        urgent_flags: [
          {
            id: FLAG_ID,
            visit_id: VISIT_ID,
            reason_code: 'safety_hazard',
            summary: 'Stale in-window claim',
            status: 'open',
            reported_by: ACTOR_ID,
            reported_by_name: 'Engineer Alpha',
            reported_at: '2026-11-17T07:00:00Z',
            version: 1,
            delivery_summary: {
              total: 1,
              sent: 0,
              pending: 0,
              processing: 1,
              failed: 0,
              skipped: 0,
              retryable_count: 1,
              reissuable_count: 0,
              max_attempt_count: 1,
              requires_reconciliation: false,
              latest_status: 'processing',
              latest_error_code: null,
              last_attempt_at: '2026-11-17T07:00:00Z',
            },
            deliveries: [
              {
                id: 'd6200000-0000-4000-8000-000000000008',
                recipient_name: 'Coordinator One',
                status: 'processing',
                attempt_count: 1,
                last_error_code: null,
                requires_reconciliation: false,
                is_retryable: true,
                is_reissuable: false,
                first_provider_attempt_at: '2026-11-17T07:00:00Z',
                next_attempt_at: '2026-11-17T07:05:00Z',
                reconciled_at: null,
                updated_at: '2026-11-17T07:00:00Z',
              },
            ],
          },
        ],
      }),
    })
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <MemoryRouter initialEntries={[`/services/requests/${BASE_ID}`]}>
            <Routes>
              <Route path="/services/requests/:id" element={<ServiceRequestDetailPage />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    )
    expect(screen.getByRole('button', { name: /Retry Email Delivery/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Audited Reissue/i })).not.toBeInTheDocument()
  })
})
