import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@/components/ui/Toast'
import { AppRouter } from './router'
import type { UserRole } from '@/config/modules'

const mockUseAuth = vi.fn()

vi.mock('@/modules/hr/api/employees', () => ({
  useEmployees: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useEmployee: () => ({ data: null, isLoading: false, isError: false, refetch: vi.fn() }),
  useEmployeeSetup: () => ({ data: { departments: [], jobTitles: [], payGrades: [] } }),
  useCreateEmployee: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateEmployee: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useArchiveEmployee: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useOffboardEmployee: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/modules/hr/api/setup', () => ({
  useHrSetupRecords: () => ({
    data: { departments: [], jobTitles: [], payGrades: [] },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useSaveDepartment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSaveJobTitle: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSavePayGrade: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetSetupArchived: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/modules/portal/api/selfService', () => ({
  useMyProfile: () => ({ data: null, isLoading: false, isError: false, refetch: vi.fn() }),
  selfServiceApi: { listPayslips: vi.fn().mockResolvedValue([]) },
}))

vi.mock('@/modules/performance/PerformancePage', () => ({
  default: ({ manage }: { manage?: boolean }) => <HREntryPoint title={manage ? 'Performance Reviews' : 'My Performance'} />,
}))

vi.mock('@/modules/reports/ReportsPage', () => ({
  default: () => <HREntryPoint title="HR Reports" />,
}))

vi.mock('@/modules/training/TrainingPage', () => ({
  default: ({ manage }: { manage?: boolean }) => <HREntryPoint title={manage ? 'Training Records' : 'My Training'} />,
}))

vi.mock('@/modules/warehouse/requests/WarehouseRequests', () => ({
  WarehouseRequestsPage: () => <HREntryPoint title="Stock requests" />,
  WarehouseRequestDetailPage: () => <HREntryPoint title="Stock request details" />,
}))

vi.mock('@/modules/projects/ProjectPages', () => ({
  ProjectListPage: ({ tracker }: { tracker?: boolean }) => <HREntryPoint title={tracker ? 'Daily tracker' : 'Projects'} />,
  ProjectCreatePage: () => <HREntryPoint title="Create project" />,
  ProjectWorkspacePage: () => <HREntryPoint title="Project workspace" />,
}))

vi.mock('@/modules/project-cash/ProjectCashPages', () => ({
  ProjectCashListPage: () => <HREntryPoint title="Project Cash" />,
  ProjectCashDetailPage: () => <HREntryPoint title="Project cash advance" />,
}))

function HREntryPoint({ title }: { title: string }) {
  const location = useLocation()
  return <><h1>{title}</h1><p>{location.pathname + location.search}</p></>
}

vi.mock('@/modules/attendance/api/attendance', () => ({
  useAttendanceTodayContext: () => ({ data: null, isLoading: false, error: null, refetch: vi.fn() }),
  useAttendanceMyHistory: () => ({
    data: { from_date: '2026-10-18', to_date: '2026-11-16', days: [], corrections: [], explanations: [], arrangements: [] },
    isLoading: false,
    error: null,
  }),
  useAttendanceRegister: () => ({
    data: {
      from_date: '2026-11-10',
      to_date: '2026-11-16',
      total_count: 0,
      limit: 50,
      offset: 0,
      summary: { total_rows: 0, complete_count: 0, open_count: 0, exception_count: 0 },
      rows: [],
    },
    isLoading: false,
  }),
  useAttendanceReviewQueues: () => ({
    data: { corrections: [], explanations: [], field_reviews: [] },
    isLoading: false,
  }),
  useAttendanceArrangements: () => ({
    data: { total_count: 0, limit: 50, offset: 0, rows: [] },
    isLoading: false,
  }),
  useAttendanceSetupOverview: () => ({ data: null, isLoading: false }),
  useAttendanceFieldEvidence: () => ({ data: null, isLoading: false, error: null }),
  useClockIn: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useClockOut: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeclareStillWorking: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSubmitCorrection: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCancelCorrection: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSubmitExplanation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSubmitArrangement: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCancelArrangement: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDecideCorrection: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useHrCorrectDay: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDecideExplanation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDecideArrangement: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useHrCreateArrangement: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReviewFieldEvidence: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetAttendanceEnabled: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSaveWorkplace: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSaveSchedule: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSaveHoliday: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetEnrollmentDefaults: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetEmployeeManager: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useBulkEnroll: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePendingAttendanceOperations: () => [],
  useRetryPendingAttendanceOperation: () => ({ mutateAsync: vi.fn(), isPending: false, variables: undefined }),
  useDiscardPendingAttendanceOperation: () => vi.fn(),
}))

vi.mock('@/modules/field-services/api/services', () => ({
  getEffectiveServiceAccess: (authState: {
    access?: { profile?: { id?: string }; roleKeys?: UserRole[]; permissionKeys?: string[] }
    session?: { userId?: string }
  }) => {
    const perms = authState?.access?.permissionKeys ?? []
    return {
      actorId: authState?.access?.profile?.id ?? authState?.session?.userId ?? null,
      roleKeys: authState?.access?.roleKeys ?? [],
      permissionKeys: perms,
      hasPermission: (key: string) => perms.includes(key),
    }
  },
  hasParticipatedInRequest: () => false,
  usePendingServiceOperations: () => [],
  useRetryPendingServiceOperation: () => ({ mutateAsync: vi.fn(), isPending: false, variables: undefined }),
  useDiscardPendingServiceOperation: () => vi.fn(),
  useServiceChecklists: () => ({ data: { provisional: true, installation: [], maintenance: [] }, isLoading: false }),
  useDispatchCandidates: () => ({ data: [], isLoading: false }),
  useServiceOverviewCounts: () => ({
    data: {
      total_count: 0,
      installation: {
        total: 0,
        active: 0,
        submitted: 0,
        follow_up_required: 0,
        work_completed: 0,
        open_urgent_tickets: 0,
        open_urgent_flags: 0,
      },
      maintenance: {
        total: 0,
        active: 0,
        submitted: 0,
        follow_up_required: 0,
        work_completed: 0,
        open_urgent_tickets: 0,
        open_urgent_flags: 0,
      },
      queues: {
        intake_attention_count: 0,
        draft_count: 0,
        submitted_count: 0,
        assigned_count: 0,
        in_progress_count: 0,
        follow_up_required_count: 0,
        work_completed_count: 0,
        coordinator_reviewed_count: 0,
        reported_to_provider_count: 0,
        provider_confirmed_count: 0,
        cancelled_count: 0,
        open_urgent_tickets: 0,
        open_urgent_flags: 0,
      },
    },
    isLoading: false,
    isError: false,
  }),
  useServiceRequests: () => ({ data: { total_count: 0, limit: 50, offset: 0, rows: [] }, isLoading: false, isError: false }),
  useMyAssignedRequests: () => ({
    data: { total_count: 0, active_count: 0, historical_count: 0, limit: 50, offset: 0, rows: [] },
    isLoading: false,
    isError: false,
  }),
  useServiceRequestDetail: () => ({ data: null, isLoading: false, isError: false, error: new Error('Not mocked'), refetch: vi.fn() }),
  useSignedServiceEvidenceUrl: () => ({ data: null, isLoading: false, isError: false }),
  useSaveServiceDraft: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSubmitServiceRequest: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCancelServiceRequest: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAcceptServiceRequest: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAssignServiceRequest: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAddAssignmentAssistant: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useStartServiceVisit: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSaveServiceVisit: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCompleteServiceVisit: () => ({ mutateAsync: vi.fn(), isPending: false, variables: undefined }),
  useLogAssistantVisitContribution: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReviewServiceRequest: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReportServiceToProvider: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useConfirmProviderHandoff: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRaiseUrgentFlag: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAckUrgentFlag: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useResolveUrgentFlag: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useServiceMonitorSnapshot: () => ({
    data: {
      generated_at: '2026-11-17T10:00:00Z',
      unassigned_count: 1,
      assigned_count: 2,
      in_progress_count: 1,
      follow_up_count: 0,
      review_pending_count: 0,
      reported_pending_confirm_count: 0,
      overdue_count: 0,
      open_urgent_flags_count: 1,
      acknowledged_urgent_flags_count: 0,
    },
    isLoading: false,
    isError: false,
    isFetching: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
  }),
  useServiceMonitorQueue: () => ({
    data: {
      generated_at: '2026-11-17T10:00:00Z',
      bucket: 'all',
      total_count: 0,
      limit: 25,
      offset: 0,
      rows: [],
    },
    isLoading: false,
    isError: false,
    isFetching: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
  }),
  useServiceUrgentFlags: () => ({
    data: {
      total_count: 0,
      open_count: 0,
      acknowledged_count: 0,
      failed_delivery_flags_count: 0,
      limit: 10,
      offset: 0,
      rows: [],
    },
    isLoading: false,
    isError: false,
  }),
  useRetryUrgentNotification: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReissueUrgentNotification: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/modules/notifications/api/notifications', async () => {
  const actual = await vi.importActual<typeof import('@/modules/notifications/api/notifications')>(
    '@/modules/notifications/api/notifications',
  )
  return {
    ...actual,
    useNotificationBellState: () => ({
      data: {
        total_count: 0,
        unread_count: 0,
        unread_urgent_count: 0,
        filter: 'all',
        filtered_count: 0,
        limit: 20,
        offset: 0,
        rows: [],
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }),
    useNotifications: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
    useNotificationPreferences: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
    useMarkNotificationRead: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useMarkAllNotificationsRead: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useSetNotificationEmailPreference: () => ({ mutateAsync: vi.fn(), isPending: false }),
  }
})

vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuth: () => mockUseAuth() as unknown,
  usePermissions: () => {
    const state = mockUseAuth() as { access?: { permissionKeys?: string[] } }
    return state?.access?.permissionKeys ?? []
  },
  useHasPermission: (key?: string, anyOf?: string[]) => {
    const state = mockUseAuth() as { access?: { permissionKeys?: string[] } }
    const perms = state?.access?.permissionKeys ?? []
    if (!key && (!anyOf || anyOf.length === 0)) return true
    if (key && perms.includes(key)) return true
    return Boolean(anyOf?.some((p) => perms.includes(p)))
  },
}))

function renderRouter(
  initialPath: string,
  roleKeys: UserRole[],
  permissionKeys: string[],
) {
  mockUseAuth.mockReturnValue({
    status: 'authenticated',
    devPreviewRole: null,
    setDevPreviewRole: vi.fn(),
    session: { userId: 'u-1', email: 'qa@example.com' },
    access: {
      profile: { id: 'u-1', displayName: 'QA User', status: 'active' },
      isActive: true,
      roleKeys,
      permissionKeys,
      enabledModules: [],
      mfaPolicy: { method: 'totp', enforcedRoles: ['super_admin'], optionalForOtherRoles: true },
      mfaRequired: false,
    },
    signOut: vi.fn(),
    hasPermission: (key: string) => permissionKeys.includes(key),
    hasAnyPermission: (...keys: string[]) => keys.some((key) => permissionKeys.includes(key)),
  })

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <AppRouter />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('AppRouter RBAC & Navigation (DEF-01 / DEF-09 / SPA Nav)', () => {
  beforeEach(() => {
    mockUseAuth.mockReset()
  })

  it('opens a stock request notification for warehouse staff and denies unrelated employees', async () => {
    const path = '/inventory/requests/a1100000-0000-4000-8000-000000000001'
    const warehouse = renderRouter(path, ['warehouse_manager'], ['inventory.issue'])
    expect(await screen.findByRole('heading', { name: 'Stock request details' })).toBeInTheDocument()
    expect(screen.getByText(path)).toBeInTheDocument()
    warehouse.unmount()

    renderRouter(path, ['employee'], [])
    expect(await screen.findByRole('heading', { name: /Permission Denied/i })).toBeInTheDocument()
  })

  it('redirects root / cleanly to /dashboard and legacy /workspace/advances to /my/advances', async () => {
    const root = renderRouter('/', ['employee'], ['staff_advances.read_self'])
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    root.unmount()

    renderRouter('/workspace/advances?advance=07700000-0000-4000-8000-000000000001', ['employee'], ['staff_advances.read_self'])
    expect(await screen.findByRole('heading', { name: 'My Advances' })).toBeInTheDocument()
  })

  it('guards legacy staff advance links and allows ordinary employees into My Pay', async () => {
    const denied = renderRouter('/hr/staff-advances?advance=07700000-0000-4000-8000-000000000001', ['employee'], ['staff_advances.read_self'])
    expect(await screen.findByRole('heading', { name: /Permission Denied/i })).toBeInTheDocument()
    denied.unmount()

    renderRouter('/my/payslips', ['warehouse_manager'], ['inventory.read'])
    expect(await screen.findByRole('heading', { name: 'My Pay' })).toBeInTheDocument()
  })

  it('keeps legacy HR review and training notification links scoped to management', async () => {
    const selection = '07700000-0000-4000-8000-000000000001'
    const denied = renderRouter('/hr/performance?review=' + selection, ['employee'], ['performance.read_self'])
    expect(await screen.findByRole('heading', { name: /Permission Denied/i })).toBeInTheDocument()
    denied.unmount()

    const hr = renderRouter('/hr/performance?review=' + selection, ['hr_admin'], ['performance.manage'])
    expect(await screen.findByText('/people/performance?review=' + selection)).toBeInTheDocument()
    hr.unmount()

    renderRouter('/hr/training?training=' + selection, ['hr_admin'], ['training.manage'])
    expect(await screen.findByText('/people/training?training=' + selection)).toBeInTheDocument()
  })

  it('lets employees open their own development workflows with self-service grants', async () => {
    const employee = renderRouter('/my/performance', ['employee'], ['performance.read_self'])
    expect(await screen.findByRole('heading', { name: 'My Performance' })).toBeInTheDocument()
    employee.unmount()

    renderRouter('/my/training', ['employee'], ['training.read_self'])
    expect(await screen.findByRole('heading', { name: 'My Training' })).toBeInTheDocument()
  })

  it('protects the HR reports deep link with the existing reports grant', async () => {
    const path = '/system/reports?report=workforce'
    const denied = renderRouter(path, ['employee'], [])
    expect(await screen.findByRole('heading', { name: /Permission Denied/i })).toBeInTheDocument()
    denied.unmount()

    renderRouter(path, ['hr_admin'], ['reports.view'])
    expect(await screen.findByRole('heading', { name: 'HR Reports' })).toBeInTheDocument()
    expect(screen.getByText(path)).toBeInTheDocument()
  })

  it('allows coordinator with Launch projects.read grant into /ops/projects', async () => {
    renderRouter('/ops/projects', ['coordinator'], ['projects.read', 'cash_advances.request'])
    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeInTheDocument()
  })

  it('opens project notification destinations for a coordinator and guards them for unrelated staff', async () => {
    const base = '/projects/a7e00000-0000-4000-8000-000000000001'
    for (const tab of ['team', 'updates']) {
      const path = base + '/' + tab
      const eligible = renderRouter(path, ['coordinator'], ['projects.read', 'daily_updates.read'])
      expect(await screen.findByRole('heading', { name: 'Project workspace' })).toBeInTheDocument()
      expect(screen.getByText(path)).toBeInTheDocument()
      eligible.unmount()

      const denied = renderRouter(path, ['employee'], [])
      expect(await screen.findByRole('heading', { name: /Permission Denied/i })).toBeInTheDocument()
      denied.unmount()
    }
  })

  it('allows coordinator into /ops/cash and blocks warehouse_manager and provisional super_admin', async () => {
    const coord = renderRouter('/ops/cash', ['coordinator'], ['cash_advances.request', 'projects.read_operational'])
    expect(await screen.findByRole('heading', { name: 'Project Cash' })).toBeInTheDocument()
    coord.unmount()

    const warehouse = renderRouter('/ops/cash', ['warehouse_manager'], ['inventory.read'])
    expect(await screen.findByText(/403 — Permission Denied/i)).toBeInTheDocument()
    warehouse.unmount()

    const superAdmin = renderRouter('/ops/cash', ['super_admin'], ['cash_advances.manage', 'projects.read_all'])
    expect(await screen.findByText(/403 — Permission Denied/i)).toBeInTheDocument()
    superAdmin.unmount()
  })

  it('opens a cash notification for the director and denies unrelated roles', async () => {
    const id = 'a7c00000-0000-4000-8000-000000000001'
    const path = '/cash/advances/' + id
    const director = renderRouter(path, ['managing_director'], ['cash_advances.view_all'])
    expect(await screen.findByRole('heading', { name: 'Project cash advance' })).toBeInTheDocument()
    expect(screen.getByText('/ops/cash/' + id)).toBeInTheDocument()
    director.unmount()

    for (const role of ['warehouse_manager', 'super_admin'] as const) {
      const denied = renderRouter(path, [role], ['cash_advances.manage', 'cash_advances.view_all'])
      expect(await screen.findByRole('heading', { name: /Permission Denied/i })).toBeInTheDocument()
      denied.unmount()
    }
  })

  it('navigates between sidebar routes inside SPA without full-page reload', async () => {
    renderRouter('/dashboard', ['hr_admin'], ['employees.read'])
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()

    const employeesNav = screen.getByRole('button', { name: /Employees/i })
    fireEvent.click(employeesNav)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Employees' })).toBeInTheDocument()
    })
  })

  it('enforces HR vs self-service route permissions for /people/employees/:id, /people/pay-grades, and /my/profile', async () => {
    const empDetailDenied = renderRouter('/people/employees/emp-1', ['employee'], ['staff_advances.read_self'])
    expect(await screen.findByText(/403 — Permission Denied/i)).toBeInTheDocument()
    empDetailDenied.unmount()

    const empSetupDenied = renderRouter('/people/pay-grades', ['employee'], ['employees.read'])
    expect(await screen.findByText(/403 — Permission Denied/i)).toBeInTheDocument()
    empSetupDenied.unmount()

    const hrSetup = renderRouter('/people/pay-grades', ['hr_admin'], ['employees.manage_setup'])
    expect(await screen.findByRole('heading', { name: 'Pay Grades & HR Setup' })).toBeInTheDocument()
    hrSetup.unmount()

    const myProfile = renderRouter('/my/profile', ['employee'], ['staff_advances.read_self'])
    expect(await screen.findByRole('heading', { name: 'My Profile' })).toBeInTheDocument()
    myProfile.unmount()
  })

  it('enforces Batch 4 Attendance self-service and register RBAC boundaries', async () => {
    const myAtt = renderRouter('/my/attendance', ['employee'], ['attendance.clock_self', 'attendance.read_self'])
    expect(await screen.findByRole('heading', { name: 'My Attendance' })).toBeInTheDocument()
    myAtt.unmount()

    const empRegisterDenied = renderRouter('/people/attendance', ['employee'], ['attendance.clock_self', 'attendance.read_self'])
    expect(await screen.findByText(/403 — Permission Denied/i)).toBeInTheDocument()
    empRegisterDenied.unmount()

    const mdRegister = renderRouter('/people/attendance', ['managing_director'], ['attendance.clock_self', 'attendance.read_self', 'attendance.read_all'])
    expect(await screen.findByRole('heading', { name: 'Attendance & Field Operations' })).toBeInTheDocument()
    mdRegister.unmount()
  })

  it('enforces Batch 5 Field Services route RBAC and strictly isolates service_monitor accounts', async () => {
    const deskIntake = renderRouter('/services/intake', ['service_desk'], ['service_requests.intake', 'service_requests.read', 'service_requests.report_provider'])
    expect(await screen.findByRole('heading', { name: 'Service Intake & Provider Handoff' })).toBeInTheDocument()
    deskIntake.unmount()

    const empDispatchDenied = renderRouter('/services/dispatch', ['employee'], ['service_visits.read_assigned', 'service_visits.work_assigned'])
    expect(await screen.findByText(/403 — Permission Denied/i)).toBeInTheDocument()
    empDispatchDenied.unmount()

    const empMyJobs = renderRouter('/services/my-jobs', ['employee'], ['service_visits.read_assigned', 'service_visits.work_assigned'])
    expect(await screen.findByRole('heading', { name: 'My Service Jobs' })).toBeInTheDocument()
    empMyJobs.unmount()

    const monitorRoot = renderRouter('/', ['service_monitor'], ['service_requests.monitor', 'service_alerts.read'])
    expect(await screen.findByRole('heading', { name: 'Operations Monitor' })).toBeInTheDocument()
    monitorRoot.unmount()

    for (const blockedPath of ['/dashboard', '/my', '/my/payslips', '/my/advances', '/my/performance', '/my/training', '/my/insurance', '/my/reimbursements', '/people/insurance', '/finance/reimbursements', '/people/employees/import', '/services', '/services/requests/req-1']) {
      const blocked = renderRouter(blockedPath, ['service_monitor'], ['service_requests.monitor', 'service_alerts.read'])
      expect(await screen.findByText(/403 — Permission Denied/i)).toBeInTheDocument()
      blocked.unmount()
    }
  })

  it('enforces Batch 7D routes for health insurance, personal reimbursements, and employee workbook import', async () => {
    const empIns = renderRouter('/my/insurance', ['employee'], ['insurance.read_self'])
    expect(await screen.findByRole('heading', { name: 'My Health Insurance' })).toBeInTheDocument()
    empIns.unmount()

    const empReimb = renderRouter('/my/reimbursements', ['employee'], ['reimbursements.read_self'])
    expect(await screen.findByRole('heading', { name: 'My Reimbursements' })).toBeInTheDocument()
    empReimb.unmount()

    for (const restricted of ['/people/insurance', '/finance/reimbursements', '/people/employees/import']) {
      const denied = renderRouter(restricted, ['employee'], ['insurance.read_self', 'reimbursements.read_self', 'employees.read'])
      expect(await screen.findByText(/403 — Permission Denied/i)).toBeInTheDocument()
      denied.unmount()
    }

    const hrImport = renderRouter('/people/employees/import', ['hr_admin'], ['employee_imports.manage', 'employees.read'])
    expect(await screen.findByRole('heading', { name: 'Employee Workbook Import & Export' })).toBeInTheDocument()
    hrImport.unmount()

    const mdIns = renderRouter('/people/insurance', ['managing_director'], ['insurance.read'])
    expect(await screen.findByRole('heading', { name: 'Health Insurance Register' })).toBeInTheDocument()
    mdIns.unmount()

    const finReimb = renderRouter('/finance/reimbursements', ['cfo'], ['reimbursements.read_all', 'reimbursements.review', 'reimbursements.pay'])
    expect(await screen.findByRole('heading', { name: 'Personal Reimbursements' })).toBeInTheDocument()
    finReimb.unmount()
  })
})

it('routes an authorized admin to the warehouse approval settings editor', async () => {
  renderRouter('/inventory/settings', ['super_admin'], ['inventory.read', 'inventory.manage_settings'])
  expect(await screen.findByRole('heading', { name: 'Warehouse approval settings' })).toBeInTheDocument()
})

it('routes a linked employee to My Equipment without inventory management permissions', async () => {
  renderRouter('/my/assets', ['employee'], ['equipment_requests.read_self'])
  expect(await screen.findByRole('heading', { name: 'My Equipment' })).toBeInTheDocument()
})

it('routes a warehouse reviewer to employee equipment requests', async () => {
  renderRouter('/inventory/employee-requests', ['warehouse_manager'], ['inventory.issue'])
  expect(await screen.findByRole('heading', { name: 'Employee equipment requests' })).toBeInTheDocument()
})

describe('Batch 7F workspace routes', () => {
  it.each([
    ['/system/settings', 'Company Settings', 'company.manage'],
    ['/system/audit', 'Audit Log', 'audit.read'],
  ])('requires the matching system grant for %s', async (path, title, permission) => {
    const allowed = renderRouter(path, ['super_admin'], [permission])
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument()
    allowed.unmount()

    renderRouter(path, ['hr_admin'], ['users.read', 'users.manage'])
    expect(await screen.findByRole('heading', { name: /Permission Denied/i })).toBeInTheDocument()
  })

  it('opens User Access for HR with users.read and rejects roles.read by itself', async () => {
    const hr = renderRouter('/system/users', ['hr_admin'], ['users.read', 'users.manage'])
    expect(await screen.findByRole('heading', { name: 'User Access & Roles' })).toBeInTheDocument()
    hr.unmount()

    renderRouter('/system/users', ['employee'], ['roles.read'])
    expect(await screen.findByRole('heading', { name: /Permission Denied/i })).toBeInTheDocument()
  })

  it('gives the service technician a My Service Jobs link and no construction dashboard link', async () => {
    renderRouter('/dashboard', ['service_technician'], ['service_visits.read_assigned', 'service_visits.work_assigned'])
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /My Service Jobs/i })).toHaveAttribute('href', '/services/my-jobs')
    expect(screen.queryByRole('link', { name: /Project Cash|Daily Tracker/i })).not.toBeInTheDocument()
  })
})
