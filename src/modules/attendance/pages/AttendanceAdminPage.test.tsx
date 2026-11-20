import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/ui/Toast'
import {
  canonicalizeAttendancePayload,
  resetAttendanceSessionRegistryForTest,
  writePendingAttendanceOperation,
} from '../lib/pendingOperations'
import { AttendanceAdminPage } from './AttendanceAdminPage'
import type {
  ArrangementsListResponse,
  RegisterResponse,
  ReviewQueuesResponse,
  SetupOverviewResponse,
} from '../schemas/attendance'

const mockRpc = vi.fn<(...args: unknown[]) => Promise<{ data: unknown; error: unknown }>>()
const mockUseAuth = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: () => ({
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}))

vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuth: () => mockUseAuth() as unknown,
  usePermissions: () => {
    const auth = mockUseAuth() as { access?: { permissionKeys?: string[] } }
    return auth?.access?.permissionKeys ?? []
  },
  useHasPermission: (key?: string, anyOf?: string[]) => {
    const auth = mockUseAuth() as { access?: { permissionKeys?: string[] } }
    const perms = auth?.access?.permissionKeys ?? []
    if (!key && (!anyOf || anyOf.length === 0)) return true
    if (key && perms.includes(key)) return true
    return Boolean(anyOf?.some((p) => perms.includes(p)))
  },
}))

function buildRegister(): RegisterResponse {
  return {
    from_date: '2026-11-10',
    to_date: '2026-11-16',
    total_count: 1,
    limit: 50,
    offset: 0,
    summary: { total_rows: 1, complete_count: 1, open_count: 0, exception_count: 0 },
    rows: [
      {
        attendance_day_id: 'day-1',
        day_version: 2,
        employee_id: 'emp-1',
        employee_number: 'EGP-001',
        employee_name: 'Alice Field',
        department_id: 'dept-1',
        department_name: 'Engineering',
        local_date: '2026-11-16',
        timezone: 'Africa/Kampala',
        workplace_name: 'Kampala HQ',
        schedule_name: 'Standard Shift',
        work_mode: 'field',
        clock_out_work_mode: 'field',
        is_workday: true,
        is_holiday: false,
        expected_start_at: '2026-11-16T05:00:00Z',
        expected_end_at: '2026-11-16T14:00:00Z',
        clock_in_at: '2026-11-16T05:02:00Z',
        clock_out_at: '2026-11-16T14:15:00Z',
        clock_in_location_check: 'recorded',
        clock_out_location_check: 'recorded',
        clock_in_distance_m: null,
        clock_out_distance_m: null,
        clock_in_punch_id: 'punch-in-1',
        clock_out_punch_id: null,
        still_working_until: null,
        extra_minutes: 15,
        effective_state: 'complete',
        punctuality: 'on_time',
        review_status: 'none',
        explanation_status: 'not_required',
        field_follow_up: true,
        needs_review: true,
      },
    ],
  }
}

function buildSetup(isManage: boolean): SetupOverviewResponse {
  return {
    policy: { enabled: false },
    ready_to_enable: false,
    defaults: isManage
      ? {
          schedule_id: 'sch-1',
          workplace_id: null,
          enrollment_basis: 'office',
          default_manager_employee_id: null,
          auto_enroll_new: false,
          revision: 1,
          updated_at: '2026-11-16T08:00:00Z',
        }
      : null,
    workplaces: [
      {
        id: 'wp-1',
        name: 'Kampala HQ',
        ...(isManage ? { latitude: 0.3136, longitude: 32.5811 } : {}),
        radius_meters: 150,
        timezone: 'Africa/Kampala',
        is_active: true,
        updated_at: '2026-11-16T08:00:00Z',
      },
    ],
    schedules: [],
    holidays: [],
    departments: [{ id: 'dept-1', name: 'Engineering' }],
    roster: [
      {
        employee_id: 'emp-1',
        employee_number: 'EGP-001',
        legal_name: 'Alice Field',
        department_id: 'dept-1',
        department_name: 'Engineering',
        attendance_manager_id: 'emp-pm',
        attendance_manager_name: 'Paul Manager',
        active_assignment: null,
      },
    ],
  }
}

function buildQueues(includeFieldReviews: boolean): ReviewQueuesResponse {
  return {
    corrections: [],
    explanations: [],
    field_reviews: includeFieldReviews
      ? [
          {
            punch_id: 'punch-in-1',
            employee_id: 'emp-1',
            employee_number: 'EGP-001',
            employee_name: 'Alice Field',
            local_date: '2026-11-16',
            punch_kind: 'clock_in',
            occurred_at: '2026-11-16T05:02:00Z',
            location_status: 'captured',
            location_check: 'poor_accuracy',
            accuracy_m: 140,
            status: 'follow_up_pending',
            review_note: null,
            version: 1,
          },
        ]
      : [],
  }
}

function buildArrangements(): ArrangementsListResponse {
  return {
    total_count: 1,
    limit: 50,
    offset: 0,
    rows: [
      {
        id: 'arr-pending',
        employee_id: 'emp-1',
        employee_number: 'EGP-001',
        employee_name: 'Alice Field',
        mode: 'field',
        coverage_type: 'dated',
        start_date: '2026-11-16',
        effective_start: '2026-11-16',
        end_date: '2026-11-18',
        weekdays: null,
        reason: 'Site upgrade deployment',
        duty_label: 'Mbarara MTN',
        status: 'pending',
        source: 'employee_request',
        replaced_by: null,
        review_note: null,
        reviewed_at: null,
        version: 1,
        created_at: '2026-11-16T06:00:00Z',
        can_decide: true,
      },
    ],
  }
}

function renderAdmin(roleKey: 'managing_director' | 'project_manager' | 'hr_admin', perms: string[], search = '') {
  mockUseAuth.mockReturnValue({
    status: 'authenticated',
    session: { userId: `profile-${roleKey}`, email: `${roleKey}@example.com` },
    access: {
      profile: { id: `profile-${roleKey}`, displayName: roleKey, status: 'active' },
      isActive: true,
      roleKeys: [roleKey],
      permissionKeys: perms,
      enabledModules: [],
      mfaPolicy: { method: 'totp', enforcedRoles: ['super_admin'], optionalForOtherRoles: true },
      mfaRequired: false,
    },
    authEpoch: 1,
  })

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/people/attendance' + search]}>
        <ToastProvider>
          <AttendanceAdminPage />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AttendanceAdminPage Role Scope & Privacy Boundaries', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    resetAttendanceSessionRegistryForTest()
    mockRpc.mockReset()
  })

  it('loads a report drill-down and pages through the same filtered register', async () => {
    const department = 'a1000000-0000-4000-8000-000000000010'
    mockRpc.mockImplementation((fn: unknown, options: unknown) => {
      if (fn === 'rpc_attendance_get_setup_overview') return Promise.resolve({ data: buildSetup(false), error: null })
      if (fn === 'rpc_attendance_get_register') {
        const { p_offset } = options as { p_offset: number }
        return Promise.resolve({ data: { ...buildRegister(), total_count: 51, offset: p_offset }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    })
    renderAdmin('managing_director', ['attendance.read_all'],
      `?from=2026-01-05&to=2026-01-09&department=${department}`)
    const next = await screen.findByRole('button', { name: 'Next page' })
    fireEvent.click(next)
    expect(await screen.findByText('Page 2 · 51 matches')).toBeInTheDocument()
    expect(mockRpc).toHaveBeenCalledWith('rpc_attendance_get_register', expect.objectContaining({
      p_from: '2026-01-05', p_to: '2026-01-09', p_department_id: department, p_limit: 50, p_offset: 50,
    }))
    expect(next).toBeDisabled()
  })

  it('keeps Managing Director strictly read-only with zero setup, approval, or raw GPS controls', async () => {
    mockRpc.mockImplementation((fn: unknown) => {
      if (fn === 'rpc_attendance_get_setup_overview') return Promise.resolve({ data: buildSetup(false), error: null })
      if (fn === 'rpc_attendance_get_register') return Promise.resolve({ data: buildRegister(), error: null })
      return Promise.resolve({ data: null, error: null })
    })

    renderAdmin('managing_director', ['attendance.clock_self', 'attendance.read_self', 'attendance.read_all'])

    expect(await screen.findByText(/Company-Wide Read-Only Oversight/i)).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /Approvals/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /Setup/i })).not.toBeInTheDocument()

    const detailsButtons = await screen.findAllByRole('button', { name: /Details/i })
    fireEvent.click(detailsButtons[0])

    expect(await screen.findByText(/Location & Provenance/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Direct HR Correction/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Inspect Raw GPS/i })).not.toBeInTheDocument()
  })

  it('gives Project Manager team approvals without raw GPS queue or company setup tab', async () => {
    mockRpc.mockImplementation((fn: unknown) => {
      if (fn === 'rpc_attendance_get_setup_overview') return Promise.resolve({ data: buildSetup(false), error: null })
      if (fn === 'rpc_attendance_get_register') return Promise.resolve({ data: buildRegister(), error: null })
      if (fn === 'rpc_attendance_list_review_queues') return Promise.resolve({ data: buildQueues(false), error: null })
      if (fn === 'rpc_attendance_list_arrangements') return Promise.resolve({ data: buildArrangements(), error: null })
      return Promise.resolve({ data: null, error: null })
    })

    renderAdmin('project_manager', ['attendance.clock_self', 'attendance.read_self', 'attendance.team_review'])

    expect(await screen.findByText(/Team Reviewer Scope/i)).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /Setup/i })).not.toBeInTheDocument()

    const approvalsTab = screen.getByRole('tab', { name: /Approvals/i })
    fireEvent.mouseDown(approvalsTab)
    fireEvent.click(approvalsTab)

    expect(await screen.findByText(/Mbarara MTN/i)).toBeInTheDocument()
    expect(screen.queryByText(/HR Field & GPS Follow-Up Queue/i)).not.toBeInTheDocument()
  })

  it('allows HR Admin to open raw GPS evidence, inspect setup status (disabled), and manage arrangements', async () => {
    mockRpc.mockImplementation((fn: unknown) => {
      if (fn === 'rpc_attendance_get_setup_overview') return Promise.resolve({ data: buildSetup(true), error: null })
      if (fn === 'rpc_attendance_get_register') return Promise.resolve({ data: buildRegister(), error: null })
      if (fn === 'rpc_attendance_list_review_queues') return Promise.resolve({ data: buildQueues(true), error: null })
      if (fn === 'rpc_attendance_list_arrangements') return Promise.resolve({ data: buildArrangements(), error: null })
      if (fn === 'rpc_attendance_get_field_evidence') {
        return Promise.resolve({
          data: {
            punch_id: 'punch-in-1',
            employee_id: 'emp-1',
            employee_name: 'Alice Field',
            punch_kind: 'clock_in',
            work_mode: 'field',
            occurred_at: '2026-11-16T05:02:00Z',
            client_captured_at: '2026-11-16T05:02:00Z',
            location_status: 'captured',
            location_check: 'poor_accuracy',
            accuracy_m: 140,
            distance_m: null,
            expired: false,
            coordinates: { lat: -0.6071, lng: 30.6545, accuracy_m: 140 },
            review: { status: 'follow_up_pending', review_note: null, history: [], version: 1, updated_at: '2026-11-16T05:02:00Z' },
          },
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: null })
    })

    renderAdmin('hr_admin', ['attendance.clock_self', 'attendance.read_self', 'attendance.read_all', 'attendance.manage'])

    const setupTab = await screen.findByRole('tab', { name: /Setup & Enrolment/i })
    fireEvent.mouseDown(setupTab)
    fireEvent.click(setupTab)
    expect(await screen.findByText(/Disabled \(Rollout Pending\)/i)).toBeInTheDocument()

    const hrApprovalsTab = screen.getByRole('tab', { name: /Approvals/i })
    fireEvent.mouseDown(hrApprovalsTab)
    fireEvent.click(hrApprovalsTab)
    fireEvent.click(await screen.findByRole('button', { name: /Inspect GPS Evidence/i }))

    await waitFor(() => {
      expect(screen.getByText(/-0\.607100, 30\.654500/i)).toBeInTheDocument()
    })
  })

  it('surfaces frozen admin pending operations in AttendanceAdminPage and replays exact requestId (B4-01)', async () => {
    const frozenPayload = {
      p_correction_id: 'corr-pending-1',
      p_decision: 'approved',
      p_review_note: 'Confirmed with team lead',
      p_day_version: 2,
    }
    writePendingAttendanceOperation({
      profileId: 'profile-hr_admin',
      intentKey: 'review:decide_correction:corr-pending-1',
      operationType: 'decide_correction',
      rpcName: 'rpc_attendance_decide_correction',
      label: 'Review Correction Request',
      requestId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      payload: frozenPayload,
      payloadCanonical: canonicalizeAttendancePayload(frozenPayload),
      createdAt: '2026-11-16T08:30:00Z',
      errorMessage: 'Gateway timeout',
    })

    mockRpc.mockImplementation((fn: unknown, args?: unknown) => {
      if (fn === 'rpc_attendance_get_setup_overview') return Promise.resolve({ data: buildSetup(true), error: null })
      if (fn === 'rpc_attendance_get_register') return Promise.resolve({ data: buildRegister(), error: null })
      if (fn === 'rpc_attendance_list_review_queues') return Promise.resolve({ data: buildQueues(true), error: null })
      if (fn === 'rpc_attendance_list_arrangements') return Promise.resolve({ data: buildArrangements(), error: null })
      if (fn === 'rpc_attendance_decide_correction') {
        const p = args as Record<string, unknown>
        return Promise.resolve({
          data: {
            request_id: String(p.p_request_id),
            operation_type: 'attendance_decide_correction',
            replayed: true,
            result: { correction_id: 'corr-pending-1' },
          },
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: null })
    })

    renderAdmin('hr_admin', ['attendance.clock_self', 'attendance.read_self', 'attendance.read_all', 'attendance.manage'])

    expect(
      await screen.findByText(/Awaiting Confirmation: Review Correction Request/i),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Retry Pending Action/i }))

    await waitFor(() => {
      expect(
        screen.queryByText(/Awaiting Confirmation: Review Correction Request/i),
      ).not.toBeInTheDocument()
    })
    expect(mockRpc).toHaveBeenCalledWith(
      'rpc_attendance_decide_correction',
      expect.objectContaining({
        p_request_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        p_correction_id: 'corr-pending-1',
      }),
    )
  })

  it('displays Schedule Unverified provenance pill and Unknown / Unverified schedule for repaired unverified-policy days (R2)', async () => {
    const reg = buildRegister()
    reg.total_count = 2
    reg.summary = { total_rows: 2, complete_count: 2, open_count: 0, exception_count: 0 }
    reg.rows = [
      {
        ...reg.rows[0],
        employee_id: 'emp-unverified',
        employee_name: 'Historical Repaired',
        local_date: '2026-11-12',
        schedule_name: null,
        effective_state: 'complete',
        policy_verified: false,
        punctuality: null,
        review_status: 'corrected',
      },
      {
        ...reg.rows[0],
        employee_id: 'emp-verified',
        employee_name: 'Policy Verified',
        local_date: '2026-11-16',
        schedule_name: 'Standard Shift',
        effective_state: 'complete',
        policy_verified: true,
        punctuality: 'on_time',
      },
    ]

    mockRpc.mockImplementation((fn: unknown) => {
      if (fn === 'rpc_attendance_get_setup_overview') return Promise.resolve({ data: buildSetup(true), error: null })
      if (fn === 'rpc_attendance_get_register') return Promise.resolve({ data: reg, error: null })
      if (fn === 'rpc_attendance_list_review_queues') return Promise.resolve({ data: buildQueues(true), error: null })
      if (fn === 'rpc_attendance_list_arrangements') return Promise.resolve({ data: buildArrangements(), error: null })
      return Promise.resolve({ data: null, error: null })
    })

    renderAdmin('hr_admin', ['attendance.clock_self', 'attendance.read_self', 'attendance.read_all', 'attendance.manage'])

    expect((await screen.findAllByText('Historical Repaired')).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Schedule Unverified')).toHaveLength(2) // desktop row + mobile card

    const detailBtns = screen.getAllByRole('button', { name: /Details/i })
    fireEvent.click(detailBtns[0])

    expect(await screen.findByText(/Unknown \/ Unverified/i)).toBeInTheDocument()
  })
})
