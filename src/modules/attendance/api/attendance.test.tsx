import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, renderHook, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/ui/Toast'
import { PendingAttendanceOperationsBanner } from '../components/AttendanceBadges'
import {
  sanitizeRpcArgs,
  useBulkEnroll,
  useClockIn,
  useDecideCorrection,
  useDiscardPendingAttendanceOperation,
  useHrCorrectDay,
  usePendingAttendanceOperations,
  useRetryPendingAttendanceOperation,
  useSaveSchedule,
  useSubmitArrangement,
  useSubmitCorrection,
} from './attendance'
import { setupOverviewResponseSchema, todayContextSchema } from '../schemas/attendance'
import {
  PendingOperationConflictError,
  clearAllPendingAttendanceOperations,
  clearPendingAttendanceOperation,
  isAbortError,
  isAttendanceOperationActivelyInFlight,
  readPendingAttendanceOperation,
  readPendingAttendanceOperationByIntent,
  readPendingAttendanceOperations,
  resetAttendanceSessionRegistryForTest,
  writePendingAttendanceOperation,
} from '../lib/pendingOperations'

const mockRpc = vi.fn<(...args: unknown[]) => Promise<{ data: unknown; error: unknown }>>()
const mockUseAuth = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: () => ({
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}))

vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuth: () => mockUseAuth() as unknown,
}))

function createWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ToastProvider>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </ToastProvider>
    )
  }
}

describe('Attendance API Adapter & Idempotent Retry Contract', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    resetAttendanceSessionRegistryForTest()
    mockRpc.mockReset()
    mockUseAuth.mockReturnValue({
      status: 'authenticated',
      session: { userId: 'profile-1' },
      access: { profile: { id: 'profile-1' } },
      authEpoch: 1,
    })
  })

  it('converts blank strings and undefined optional RPC parameters to explicit null', () => {
    expect(
      sanitizeRpcArgs({
        p_id: undefined,
        p_reason: '   ',
        p_lat: null,
        p_name: 'Kampala HQ',
      }),
    ).toEqual({
      p_id: null,
      p_reason: null,
      p_lat: null,
      p_name: 'Kampala HQ',
    })
  })

  it('validates non-manage setup overview payloads without workplace coordinates and today context', () => {
    const setupParsed = setupOverviewResponseSchema.parse({
      policy: { enabled: false },
      ready_to_enable: false,
      defaults: null,
      workplaces: [
        {
          id: 'wp-1',
          name: 'Headquarters',
          radius_meters: 150,
          timezone: 'Africa/Kampala',
          is_active: true,
          updated_at: '2026-11-16T08:00:00Z',
        },
      ],
      schedules: [],
      holidays: [],
      departments: [],
      roster: [],
    })
    expect(setupParsed.workplaces[0]?.latitude).toBeUndefined()

    const todayParsed = todayContextSchema.parse({
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
      workplace: null,
      schedule: null,
      active_arrangement: null,
      day: null,
      open_correction: null,
      server_now: '2026-11-16T05:00:00Z',
    })
    expect(todayParsed.work_mode).toBe('office')
  })

  it('freezes p_request_id on uncertain transport error and replays with same ID cleanly', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { status: 503, message: 'upstream gateway timeout' },
    })

    const { result } = renderHook(() => useClockIn(), { wrapper: createWrapper() })

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          locationStatus: 'captured',
          lat: 0.31,
          lng: 32.58,
          accuracyM: 12,
          clientCapturedAt: '2026-11-16T05:05:00Z',
          contextRevision: 'rev-1',
        }),
      ).rejects.toBeTruthy()
    })

    const frozen = readPendingAttendanceOperation('profile-1')
    expect(frozen).not.toBeNull()
    expect(frozen?.operationType).toBe('clock_in')

    mockRpc.mockResolvedValueOnce({
      data: {
        request_id: frozen!.requestId,
        operation_type: 'attendance_clock_in',
        replayed: true,
        result: { day_id: 'day-1' },
      },
      error: null,
    })

    await act(async () => {
      const env = await result.current.mutateAsync({
        locationStatus: 'captured',
        lat: 0.31,
        lng: 32.58,
        accuracyM: 12,
        clientCapturedAt: '2026-11-16T05:05:00Z',
        contextRevision: 'rev-1',
        retryingOperation: frozen!,
      })
      expect(env.replayed).toBe(true)
    })

    expect(mockRpc).toHaveBeenLastCalledWith(
      'rpc_attendance_clock_in',
      expect.objectContaining({ p_request_id: frozen!.requestId }),
    )
    expect(readPendingAttendanceOperation('profile-1')).toBeNull()
  })

  it('clears pending op immediately on definite backend rejection and purges on account switch', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'ATTENDANCE_DISABLED: Live attendance disabled' },
    })

    const { result } = renderHook(() => useClockIn(), { wrapper: createWrapper() })

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          locationStatus: 'denied',
          lat: null,
          lng: null,
          accuracyM: null,
          clientCapturedAt: null,
          contextRevision: 'rev-1',
        }),
      ).rejects.toBeTruthy()
    })

    expect(readPendingAttendanceOperation('profile-1')).toBeNull()

    clearAllPendingAttendanceOperations()
    expect(window.sessionStorage.length).toBe(0)
  })

  it('persists and replays identical p_request_id across self workflows, HR reviews, and setup mutations (B4-01)', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { status: 504, message: 'Gateway Timeout' },
    })

    const wrapper = createWrapper()
    const { result: arrHook } = renderHook(() => useSubmitArrangement(), { wrapper })
    const { result: corrHook } = renderHook(() => useSubmitCorrection(), { wrapper })
    const { result: decHook } = renderHook(() => useDecideCorrection(), { wrapper })
    const { result: hrCorrHook } = renderHook(() => useHrCorrectDay(), { wrapper })
    const { result: schHook } = renderHook(() => useSaveSchedule(), { wrapper })
    const { result: enrollHook } = renderHook(() => useBulkEnroll(), { wrapper })
    const { result: opsHook } = renderHook(() => usePendingAttendanceOperations(), { wrapper })
    const { result: retryHook } = renderHook(() => useRetryPendingAttendanceOperation(), { wrapper })

    const arrInput = {
      mode: 'field' as const,
      coverageType: 'dated' as const,
      startDate: '2026-11-18',
      endDate: '2026-11-19',
      weekdays: null,
      reason: 'Field commissioning site visit in Jinja',
      dutyLabel: 'Jinja Substation',
    }

    await act(async () => {
      await expect(arrHook.current.mutateAsync(arrInput)).rejects.toBeTruthy()
      await expect(
        corrHook.current.mutateAsync({
          localDate: '2026-11-15',
          requestKind: 'wrong_time',
          claimedInAt: '2026-11-15T05:00:00Z',
          claimedOutAt: '2026-11-15T14:00:00Z',
          reason: 'Missed afternoon punch while offsite',
        }),
      ).rejects.toBeTruthy()
      await expect(
        decHook.current.mutateAsync({
          correctionId: 'corr-1',
          decision: 'approved',
          reviewNote: 'Verified with client log',
          dayVersion: 2,
        }),
      ).rejects.toBeTruthy()
      await expect(
        hrCorrHook.current.mutateAsync({
          employeeId: 'emp-2',
          localDate: '2026-11-15',
          claimedInAt: '2026-11-15T05:00:00Z',
          claimedOutAt: null,
          reason: 'Manual HR attendance repair for onboarding',
          expectedDayVersion: 1,
        }),
      ).rejects.toBeTruthy()
      await expect(
        schHook.current.mutateAsync({
          id: 'sch-1',
          name: 'Engineering Shift',
          timezone: 'Africa/Kampala',
          halfDayBoundary: '13:00:00',
          latenessGraceMinutes: 10,
          explanationThresholdMinutes: 15,
          isActive: true,
          days: [{ weekday: 1, is_workday: true, expected_start: '08:00', expected_end: '17:00' }],
          reason: 'Update grace minutes',
        }),
      ).rejects.toBeTruthy()
      await expect(
        enrollHook.current.mutateAsync({
          employeeIds: ['emp-1'],
          scheduleId: 'sch-1',
          workplaceId: 'wp-1',
          enrollmentBasis: 'office',
          effectiveFrom: '2026-11-16',
          effectiveTo: null,
          managerEmployeeId: null,
          reason: 'Enroll cohort',
        }),
      ).rejects.toBeTruthy()
    })

    const persisted = readPendingAttendanceOperations('profile-1')
    expect(persisted).toHaveLength(6)
    expect(opsHook.current).toHaveLength(6)

    const frozenArr = persisted.find((o) => o.operationType === 'submit_arrangement')!
    expect(frozenArr).toBeTruthy()

    // B4-01 Payload-change guard: modifying the payload MUST NOT silently mint a new UUID or reuse old UUID with changed args
    const callsBeforeConflict = mockRpc.mock.calls.length
    await act(async () => {
      await expect(
        arrHook.current.mutateAsync({
          ...arrInput,
          dutyLabel: 'MODIFIED SITE NAME',
        }),
      ).rejects.toBeInstanceOf(PendingOperationConflictError)
    })
    expect(mockRpc.mock.calls.length).toBe(callsBeforeConflict)

    // Resubmitting identical payload OR calling Retry reuses the EXACT frozen requestId
    mockRpc.mockImplementationOnce((_fn, args) => {
      const p = args as Record<string, unknown>
      return Promise.resolve({
        data: {
          request_id: String(p.p_request_id),
          operation_type: 'attendance_submit_arrangement',
          replayed: true,
          result: { arrangement_id: 'arr-99' },
        },
        error: null,
      })
    })

    await act(async () => {
      const env = await retryHook.current.mutateAsync(frozenArr)
      expect(env.replayed).toBe(true)
      expect(env.request_id).toBe(frozenArr.requestId)
    })

    expect(readPendingAttendanceOperations('profile-1')).toHaveLength(5)

    // Explicit discard allows submitting modified payload cleanly with a new operation ID
    const frozenCorr = readPendingAttendanceOperations('profile-1').find(
      (o) => o.operationType === 'submit_correction',
    )!
    act(() => {
      clearPendingAttendanceOperation('profile-1', frozenCorr.intentKey)
    })
    expect(readPendingAttendanceOperations('profile-1')).toHaveLength(4)
  })

  it('prevents same-account late 200 settlement from deleting or masking a superseding operation B and renders truthful in-flight banner (R1)', async () => {
    let settleA!: (res: { data: unknown; error: unknown }) => void
    const promiseA = new Promise<{ data: unknown; error: unknown }>((resolve) => {
      settleA = resolve
    })

    mockRpc.mockImplementationOnce(() => promiseA)

    const wrapper = createWrapper()
    const { result: arrHook } = renderHook(() => useSubmitArrangement(), { wrapper })
    const { result: retryHook } = renderHook(() => useRetryPendingAttendanceOperation(), { wrapper })
    const { result: discardHook } = renderHook(() => useDiscardPendingAttendanceOperation(), {
      wrapper,
    })

    const inputA = {
      mode: 'field' as const,
      coverageType: 'dated' as const,
      startDate: '2026-11-20',
      endDate: '2026-11-20',
      weekdays: null,
      reason: 'Commissioning inspection A',
      dutyLabel: 'Site A',
    }

    let reqA!: Promise<unknown>
    await act(async () => {
      reqA = arrHook.current.mutateAsync(inputA)
      await Promise.resolve()
    })

    const opA = readPendingAttendanceOperationByIntent('profile-1', 'self:submit_arrangement')!
    expect(opA).toBeTruthy()
    expect(opA.status).toBe('in_flight')
    expect(isAttendanceOperationActivelyInFlight(opA)).toBe(true)

    // Unsafe UI discard refuses while A is actively in-flight in the same tab
    expect(discardHook.current('self:submit_arrangement')).toBe(false)
    expect(readPendingAttendanceOperationByIntent('profile-1', 'self:submit_arrangement')?.requestId).toBe(
      opA.requestId,
    )

    // Modifying payload while A is actively in flight explains that the request is currently in progress
    await act(async () => {
      await expect(
        arrHook.current.mutateAsync({ ...inputA, dutyLabel: 'Site B' }),
      ).rejects.toThrow(/currently in progress/i)
    })

    // Unmount and remount banner while A is still unresolved: must truthfully show Sending Request without Retry/Discard
    const { unmount } = render(<PendingAttendanceOperationsBanner />, { wrapper })
    expect(screen.getByText(/Sending Request: Submit Work Arrangement/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Discard/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Retry Pending Action/i })).not.toBeInTheDocument()
    unmount()

    render(<PendingAttendanceOperationsBanner />, { wrapper })
    expect(screen.getByText(/Sending Request: Submit Work Arrangement/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Discard/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Retry Pending Action/i })).not.toBeInTheDocument()

    // Explicitly supersede/discard A (e.g. force discard/storage clear) and submit modified B which hits 504
    act(() => {
      expect(discardHook.current('self:submit_arrangement', { force: true })).toBe(true)
    })

    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { status: 504, message: 'Gateway Timeout' },
    })

    await act(async () => {
      await expect(
        arrHook.current.mutateAsync({ ...inputA, dutyLabel: 'Site B' }),
      ).rejects.toBeTruthy()
    })

    const opB = readPendingAttendanceOperationByIntent('profile-1', 'self:submit_arrangement')!
    expect(opB).toBeTruthy()
    expect(opB.requestId).not.toBe(opA.requestId)
    expect(opB.status).toBe('uncertain')
    expect(opB.payload.p_duty_label).toBe('Site B')
    expect(screen.getByText(/Awaiting Confirmation: Submit Work Arrangement/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Retry Pending Action/i })).toBeInTheDocument()

    // Now late A resolves with 200 OK: A must abort cleanly and NEVER clear or disturb B
    const aOutcome = reqA.catch((err: unknown) => err)
    let settledErr: unknown
    await act(async () => {
      settleA({
        data: {
          request_id: opA.requestId,
          operation_type: 'attendance_submit_arrangement',
          replayed: false,
          result: { arrangement_id: 'arr-a-late' },
        },
        error: null,
      })
      settledErr = await aOutcome
    })
    expect(isAbortError(settledErr)).toBe(true)

    const stillB = readPendingAttendanceOperationByIntent('profile-1', 'self:submit_arrangement')!
    expect(stillB.requestId).toBe(opB.requestId)
    expect(stillB.payload.p_duty_label).toBe('Site B')
    expect(stillB.status).toBe('uncertain')

    // Retrying B sends exact requestId_B once and clears B cleanly
    mockRpc.mockImplementationOnce((_fn, args) => {
      const p = args as Record<string, unknown>
      return Promise.resolve({
        data: {
          request_id: String(p.p_request_id),
          operation_type: 'attendance_submit_arrangement',
          replayed: false,
          result: { arrangement_id: 'arr-b' },
        },
        error: null,
      })
    })

    await act(async () => {
      const env = await retryHook.current.mutateAsync(stillB)
      expect(env.request_id).toBe(opB.requestId)
    })

    expect(mockRpc).toHaveBeenLastCalledWith(
      'rpc_attendance_submit_arrangement',
      expect.objectContaining({
        p_request_id: opB.requestId,
        p_duty_label: 'Site B',
      }),
    )
    expect(readPendingAttendanceOperationByIntent('profile-1', 'self:submit_arrangement')).toBeNull()
  })

  it('prevents same-account late 504 settlement from overwriting B or resurrecting discarded A, and recovers stale in_flight ops after reload (R1)', async () => {
    let rejectA!: (reason?: unknown) => void
    const promiseA = new Promise<{ data: unknown; error: unknown }>((_resolve, reject) => {
      rejectA = reject
    })
    mockRpc.mockImplementationOnce(() => promiseA)

    const wrapper = createWrapper()
    const { result: arrHook } = renderHook(() => useSubmitArrangement(), { wrapper })

    const inputA = {
      mode: 'field' as const,
      coverageType: 'dated' as const,
      startDate: '2026-11-21',
      endDate: '2026-11-21',
      weekdays: null,
      reason: 'Field visit A',
      dutyLabel: 'Site Alpha',
    }

    let reqA!: Promise<unknown>
    await act(async () => {
      reqA = arrHook.current.mutateAsync(inputA)
      await Promise.resolve()
    })

    const opA = readPendingAttendanceOperationByIntent('profile-1', 'self:submit_arrangement')!
    expect(opA.status).toBe('in_flight')

    // Case 1: Discard A with no replacement, then late A fails with 504 -> must abort & never resurrect A
    clearPendingAttendanceOperation('profile-1', 'self:submit_arrangement')
    const aOutcome = reqA.catch((err: unknown) => err)
    let case1Err: unknown
    await act(async () => {
      rejectA({ status: 504, message: 'Gateway Timeout' })
      case1Err = await aOutcome
    })
    expect(isAbortError(case1Err)).toBe(true)
    expect(readPendingAttendanceOperationByIntent('profile-1', 'self:submit_arrangement')).toBeNull()

    // Case 2: Start A2 -> supersede with B (504) -> late A2 rejects 504 -> B remains untouched
    let settleA2Error!: (res: { data: unknown; error: unknown }) => void
    mockRpc.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settleA2Error = resolve
        }),
    )
    let reqA2!: Promise<unknown>
    await act(async () => {
      reqA2 = arrHook.current.mutateAsync(inputA)
      await Promise.resolve()
    })
    const opA2 = readPendingAttendanceOperationByIntent('profile-1', 'self:submit_arrangement')!

    clearPendingAttendanceOperation('profile-1', 'self:submit_arrangement')
    mockRpc.mockResolvedValueOnce({ data: null, error: { status: 504, message: 'Gateway Timeout' } })
    await act(async () => {
      await expect(
        arrHook.current.mutateAsync({ ...inputA, dutyLabel: 'Site Beta' }),
      ).rejects.toBeTruthy()
    })
    const opB = readPendingAttendanceOperationByIntent('profile-1', 'self:submit_arrangement')!
    expect(opB.requestId).not.toBe(opA2.requestId)
    expect(opB.payload.p_duty_label).toBe('Site Beta')

    const a2Outcome = reqA2.catch((err: unknown) => err)
    let case2Err: unknown
    await act(async () => {
      settleA2Error({ data: null, error: { status: 504, message: 'Gateway Timeout' } })
      case2Err = await a2Outcome
    })
    expect(isAbortError(case2Err)).toBe(true)

    const finalB = readPendingAttendanceOperationByIntent('profile-1', 'self:submit_arrangement')!
    expect(finalB.requestId).toBe(opB.requestId)
    expect(finalB.payload.p_duty_label).toBe('Site Beta')

    // Case 3: Reload recovery — a stored 'in_flight' entry from a closed/reloaded tab has no active runtime instance
    writePendingAttendanceOperation({
      profileId: 'profile-1',
      intentKey: 'self:submit_correction:2026-11-10',
      operationType: 'submit_correction',
      rpcName: 'rpc_attendance_submit_correction',
      label: 'Submit Attendance Correction',
      requestId: 'deadbeef-1111-4222-8333-444444444444',
      payload: { p_local_date: '2026-11-10' },
      payloadCanonical: '{"p_local_date":"2026-11-10"}',
      createdAt: '2026-11-17T08:00:00Z',
      status: 'in_flight',
      instanceId: 'previous-page-instance-id',
    })
    render(<PendingAttendanceOperationsBanner />, { wrapper })
    expect(
      screen.getByText(/Awaiting Confirmation: Submit Attendance Correction/i),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Retry Pending Action/i })).toHaveLength(2)
  })
})
