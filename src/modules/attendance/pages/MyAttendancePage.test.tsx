import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/ui/Toast'
import { MyAttendancePage } from './MyAttendancePage'
import type { MyHistoryResponse, TodayContext } from '../schemas/attendance'

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

function baseToday(overrides: Partial<TodayContext> = {}): TodayContext {
  return {
    enabled: true,
    enrolled: true,
    employee_id: 'emp-1',
    local_date: '2026-11-16',
    timezone: 'Africa/Kampala',
    context_revision: 'rev-1',
    work_mode: 'office',
    mode_reason: 'office_assignment',
    is_workday: true,
    is_holiday: false,
    holiday_name: null,
    workplace: {
      id: 'wp-1',
      name: 'Kampala HQ',
      radius_meters: 150,
      timezone: 'Africa/Kampala',
      is_active: true,
    },
    schedule: {
      id: 'sch-1',
      name: 'Standard Shift',
      timezone: 'Africa/Kampala',
      half_day_boundary: '13:00:00',
      lateness_grace_minutes: 5,
      explanation_threshold_minutes: 15,
      is_workday: true,
      expected_start: '08:00:00',
      expected_end: '17:00:00',
      expected_start_at: '2026-11-16T05:00:00Z',
      expected_end_at: '2026-11-16T14:00:00Z',
    },
    active_arrangement: null,
    day: null,
    open_correction: null,
    server_now: '2026-11-16T05:05:00Z',
    ...overrides,
  }
}

function emptyHistory(): MyHistoryResponse {
  return {
    from_date: '2026-10-18',
    to_date: '2026-11-16',
    days: [],
    corrections: [],
    explanations: [],
    arrangements: [],
  }
}

function renderMyAttendance() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MyAttendancePage />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('MyAttendancePage Component Lifecycle & Failure Recovery', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    mockRpc.mockReset()
    mockUseAuth.mockReturnValue({
      status: 'authenticated',
      session: { userId: 'profile-emp-1', email: 'emp1@example.com' },
      access: {
        profile: { id: 'profile-emp-1', displayName: 'Engineer One', status: 'active' },
        isActive: true,
        roleKeys: ['employee'],
        permissionKeys: ['attendance.clock_self', 'attendance.read_self'],
        enabledModules: [],
        mfaPolicy: { method: 'totp', enforcedRoles: ['super_admin'], optionalForOtherRoles: true },
        mfaRequired: false,
      },
      authEpoch: 1,
    })
  })

  it('keeps Start Day disabled when live attendance policy is paused (enabled=false)', async () => {
    mockRpc.mockImplementation((fn: unknown) => {
      if (fn === 'rpc_attendance_today_context') {
        return Promise.resolve({ data: baseToday({ enabled: false }), error: null })
      }
      if (fn === 'rpc_attendance_my_history') {
        return Promise.resolve({ data: emptyHistory(), error: null })
      }
      return Promise.resolve({ data: null, error: null })
    })

    renderMyAttendance()

    expect(
      await screen.findByText(/Live attendance capture is currently disabled/i),
    ).toBeInTheDocument()
    const startBtn = screen.getByRole('button', { name: /Start Day/i })
    expect(startBtn).toBeDisabled()
  })

  it('shows unlinked profile empty state cleanly on 42501 unlinked error', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'No active employee record is linked to your profile.' },
    })

    renderMyAttendance()

    expect(
      await screen.findByText(/Profile Not Linked to an Employee Record/i),
    ).toBeInTheDocument()
  })

  it('persists denied GPS on Start Day and freezes lost-response retry across unmount/remount reload', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: {
        getCurrentPosition: (_ok: PositionCallback, err?: PositionErrorCallback) => {
          err?.({
            code: 1,
            message: 'User denied Geolocation',
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
          })
        },
      },
    })

    let firstClockInReqId: string | null = null
    let allowClockInSuccess = false

    mockRpc.mockImplementation((fn: unknown, rawArgs?: unknown) => {
      const args = (rawArgs ?? undefined) as Record<string, unknown> | undefined
      if (fn === 'rpc_attendance_today_context') {
        return Promise.resolve({
          data: baseToday(
            allowClockInSuccess
              ? {
                  day: {
                    id: 'day-1',
                    local_date: '2026-11-16',
                    expected_start_at: '2026-11-16T05:00:00Z',
                    expected_end_at: '2026-11-16T14:00:00Z',
                    is_workday: true,
                    is_holiday: false,
                    clock_in_at: '2026-11-16T05:10:00Z',
                    clock_out_at: null,
                    has_clock_in: true,
                    has_clock_out: false,
                    clock_in_location_check: 'denied',
                    clock_out_location_check: null,
                    clock_in_distance_m: null,
                    clock_out_distance_m: null,
                    clock_in_work_mode: 'office',
                    clock_out_work_mode: null,
                    still_working_until: null,
                    extra_minutes: 0,
                    record_state: 'open',
                    review_status: 'none',
                    explanation_status: 'not_required',
                    version: 1,
                  },
                }
              : {},
          ),
          error: null,
        })
      }
      if (fn === 'rpc_attendance_my_history') {
        return Promise.resolve({ data: emptyHistory(), error: null })
      }
      if (fn === 'rpc_attendance_clock_in') {
        expect(args?.p_location_status).toBe('denied')
        expect(args?.p_lat).toBeNull()
        expect(args?.p_lng).toBeNull()

        if (!firstClockInReqId) {
          firstClockInReqId = String(args?.p_request_id)
          return Promise.resolve({
            data: null,
            error: { status: 504, message: 'Gateway timeout after commit' },
          })
        }
        allowClockInSuccess = true
        return Promise.resolve({
          data: {
            request_id: String(args?.p_request_id),
            operation_type: 'attendance_clock_in',
            replayed: true,
            result: { day_id: 'day-1' },
          },
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: null })
    })

    const firstMount = renderMyAttendance()

    const startBtn = await screen.findByRole('button', { name: /Start Day/i })
    await waitFor(() => expect(startBtn).toBeEnabled())
    fireEvent.click(startBtn)

    // Frozen awaiting confirmation banner appears
    expect(
      await screen.findByTestId('attendance-pending-retry-banner'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Start Day/i })).toBeDisabled()

    // Simulate browser reload (unmount + remount fresh tree)
    firstMount.unmount()
    renderMyAttendance()

    const retryBanner = await screen.findByTestId('attendance-pending-retry-banner')
    expect(retryBanner).toBeInTheDocument()

    const retryBtn = screen.getByRole('button', { name: /Retry Pending Action/i })
    fireEvent.click(retryBtn)

    await waitFor(() => {
      expect(screen.queryByTestId('attendance-pending-retry-banner')).not.toBeInTheDocument()
      expect(screen.getByText(/GPS denied/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /End Day/i })).toBeInTheDocument()
    })

    const clockInCalls = mockRpc.mock.calls.filter(([fn]) => fn === 'rpc_attendance_clock_in')
    expect(clockInCalls).toHaveLength(2)
    const secondCallArgs = clockInCalls[1]?.[1] as Record<string, unknown> | undefined
    expect(secondCallArgs?.p_request_id).toBe(firstClockInReqId)
  })

  it('validates and submits missed-punch correction with timezone-aware Kampalan conversion', async () => {
    mockRpc.mockImplementation((fn: unknown) => {
      if (fn === 'rpc_attendance_today_context') {
        return Promise.resolve({ data: baseToday(), error: null })
      }
      if (fn === 'rpc_attendance_my_history') {
        return Promise.resolve({ data: emptyHistory(), error: null })
      }
      if (fn === 'rpc_attendance_submit_correction') {
        return Promise.resolve({
          data: {
            request_id: 'corr-req-1',
            operation_type: 'attendance_submit_correction',
            replayed: false,
            result: { correction_id: 'corr-1' },
          },
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: null })
    })

    renderMyAttendance()

    fireEvent.click(await screen.findByRole('button', { name: /Request Correction/i }))
    expect(
      await screen.findByRole('heading', { name: /Request Attendance Correction/i }),
    ).toBeInTheDocument()

    const form = document.querySelector('form')!
    const dateInput = form.querySelector('input[type="date"]') as HTMLInputElement
    const timeInputs = form.querySelectorAll('input[type="time"]')
    const textarea = form.querySelector('textarea') as HTMLTextAreaElement

    fireEvent.change(dateInput, { target: { value: '2026-11-15' } })
    fireEvent.change(timeInputs[0], { target: { value: '08:15' } })
    fireEvent.change(timeInputs[1], { target: { value: '17:30' } })
    fireEvent.change(textarea, { target: { value: 'Forgot to press Start/End Day while onsite' } })
    fireEvent.click(screen.getByRole('button', { name: /Submit Request/i }))

    await waitFor(() => {
      const corrCall = mockRpc.mock.calls.find(([fn]) => fn === 'rpc_attendance_submit_correction')
      expect(corrCall).toBeTruthy()
      const args = corrCall?.[1] as Record<string, unknown> | undefined
      expect(args?.p_local_date).toBe('2026-11-15')
      expect(args?.p_request_kind).toBe('wrong_time')
      // Africa/Kampala (+03:00): 08:15 -> 05:15Z, 17:30 -> 14:30Z
      expect(args?.p_claimed_in_at).toBe('2026-11-15T05:15:00.000Z')
      expect(args?.p_claimed_out_at).toBe('2026-11-15T14:30:00.000Z')
    })
  })

  it('aligns explanation_status required_unsubmitted CTA and persisted backend location_check labels (B4-05)', async () => {
    mockRpc.mockImplementation((fn: unknown) => {
      if (fn === 'rpc_attendance_today_context') {
        return Promise.resolve({
          data: baseToday({
            day: {
              id: 'day-today',
              local_date: '2026-11-16',
              expected_start_at: '2026-11-16T05:00:00Z',
              expected_end_at: '2026-11-16T14:00:00Z',
              is_workday: true,
              is_holiday: false,
              clock_in_at: '2026-11-16T05:00:00Z',
              clock_out_at: '2026-11-16T15:10:00Z',
              has_clock_in: true,
              has_clock_out: true,
              clock_in_location_check: 'onsite',
              clock_out_location_check: 'outside',
              clock_in_distance_m: 18,
              clock_out_distance_m: 410,
              clock_in_work_mode: 'office',
              clock_out_work_mode: 'office',
              still_working_until: null,
              extra_minutes: 70,
              record_state: 'complete',
              review_status: 'none',
              explanation_status: 'required_unsubmitted',
              version: 2,
            },
          }),
          error: null,
        })
      }
      if (fn === 'rpc_attendance_my_history') {
        return Promise.resolve({
          data: {
            ...emptyHistory(),
            days: [
              {
                id: 'day-past',
                local_date: '2026-11-15',
                timezone: 'Africa/Kampala',
                grace_minutes: 5,
                expected_start_at: '2026-11-15T05:00:00Z',
                expected_end_at: '2026-11-15T14:00:00Z',
                is_workday: true,
                is_holiday: false,
                clock_in_at: '2026-11-15T05:01:00Z',
                clock_out_at: '2026-11-15T15:00:00Z',
                has_clock_in: true,
                has_clock_out: true,
                clock_in_location_check: 'recorded',
                clock_out_location_check: 'poor_accuracy',
                clock_in_distance_m: null,
                clock_out_distance_m: null,
                clock_in_work_mode: 'field',
                clock_out_work_mode: 'field',
                still_working_until: null,
                extra_minutes: 60,
                record_state: 'complete',
                review_status: 'none',
                explanation_status: 'required_unsubmitted',
                punctuality: 'on_time',
                punches: [],
                version: 1,
              },
            ],
          },
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: null })
    })

    renderMyAttendance()

    expect(await screen.findByText(/Onsite verified \(18m\)/i)).toBeInTheDocument()
    expect(screen.getByText(/Outside zone \(410m\)/i)).toBeInTheDocument()
    expect(screen.getAllByText(/Field GPS recorded/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/Low GPS precision/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByRole('button', { name: /Explain Extra Time/i }).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('button', { name: /Explain \+1h 10m/i })).toBeInTheDocument()
  })

  it('distinguishes verified vs unknown historical schedule provenance on completed days (R2)', async () => {
    mockRpc.mockImplementation((fn: unknown) => {
      if (fn === 'rpc_attendance_today_context') {
        return Promise.resolve({
          data: baseToday({
            schedule: null,
            day: {
              id: 'day-today-unverified',
              local_date: '2026-11-16',
              expected_start_at: null,
              expected_end_at: null,
              is_workday: true,
              is_holiday: false,
              clock_in_at: '2026-11-16T05:00:00Z',
              clock_out_at: '2026-11-16T14:00:00Z',
              has_clock_in: true,
              has_clock_out: true,
              clock_in_location_check: 'onsite',
              clock_out_location_check: 'onsite',
              clock_in_distance_m: 10,
              clock_out_distance_m: 12,
              clock_in_work_mode: 'office',
              clock_out_work_mode: 'office',
              still_working_until: null,
              extra_minutes: 0,
              record_state: 'complete',
              policy_verified: false,
              review_status: 'corrected',
              explanation_status: 'not_required',
              version: 2,
            },
          }),
          error: null,
        })
      }
      if (fn === 'rpc_attendance_my_history') {
        return Promise.resolve({
          data: {
            ...emptyHistory(),
            days: [
              {
                id: 'day-hist-unverified',
                local_date: '2026-11-15',
                timezone: 'Africa/Kampala',
                grace_minutes: 5,
                expected_start_at: null,
                expected_end_at: null,
                is_workday: true,
                is_holiday: false,
                clock_in_at: '2026-11-15T05:00:00Z',
                clock_out_at: '2026-11-15T14:00:00Z',
                has_clock_in: true,
                has_clock_out: true,
                clock_in_location_check: null,
                clock_out_location_check: null,
                clock_in_distance_m: null,
                clock_out_distance_m: null,
                clock_in_work_mode: 'office',
                clock_out_work_mode: 'office',
                still_working_until: null,
                extra_minutes: 0,
                record_state: 'complete',
                policy_verified: false,
                review_status: 'corrected',
                explanation_status: 'not_required',
                punctuality: null,
                punches: [],
                version: 2,
              },
              {
                id: 'day-hist-verified',
                local_date: '2026-11-14',
                timezone: 'Africa/Kampala',
                grace_minutes: 5,
                expected_start_at: '2026-11-14T05:00:00Z',
                expected_end_at: '2026-11-14T14:00:00Z',
                is_workday: true,
                is_holiday: false,
                clock_in_at: '2026-11-14T05:02:00Z',
                clock_out_at: '2026-11-14T14:00:00Z',
                has_clock_in: true,
                has_clock_out: true,
                clock_in_location_check: 'onsite',
                clock_out_location_check: 'onsite',
                clock_in_distance_m: 8,
                clock_out_distance_m: 9,
                clock_in_work_mode: 'office',
                clock_out_work_mode: 'office',
                still_working_until: null,
                extra_minutes: 0,
                record_state: 'complete',
                policy_verified: true,
                review_status: 'none',
                explanation_status: 'not_required',
                punctuality: 'on_time',
                punches: [],
                version: 1,
              },
            ],
          },
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: null })
    })

    renderMyAttendance()

    expect(await screen.findAllByText('Complete')).toBeTruthy()
    const provenancePills = await screen.findAllByText('Schedule Unverified')
    // Today card (1) + unverified history row (desktop table + mobile card = 2); verified row must NOT show it
    expect(provenancePills).toHaveLength(3)
    expect(screen.getAllByText('On Time').length).toBeGreaterThanOrEqual(1)
  })
})
