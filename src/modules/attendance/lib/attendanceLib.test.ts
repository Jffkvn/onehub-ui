import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addDaysToIsoDate,
  formatLocalDateLabel,
  formatMinutesDuration,
  formatTimeInZone,
  zonedWallClockToIso,
} from './zonedTime'
import {
  captureAttendanceLocation,
  captureSessionScopedAttendanceLocation,
  describeLocationCheck,
} from './geolocation'
import {
  PENDING_OPS_STORAGE_PREFIX,
  UncertainAttendanceTransportError,
  canonicalizeAttendancePayload,
  captureAttendanceSessionSnapshot,
  classifyAttendanceRpcError,
  clearAllPendingAttendanceOperations,
  clearPendingAttendanceOperation,
  isAbortError,
  isAttendanceSessionCurrent,
  parseArrangementConflictId,
  readPendingAttendanceOperation,
  readPendingAttendanceOperations,
  resetAttendanceSessionRegistryForTest,
  syncAttendanceAuthSessionFromProvider,
  writePendingAttendanceOperation,
} from './pendingOperations'

describe('Attendance Pure Utilities (zonedTime / geolocation / pendingOperations)', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    resetAttendanceSessionRegistryForTest()
    vi.restoreAllMocks()
  })

  it('converts and formats zoned wall-clock timestamps accurately in Africa/Kampala and DST zones', () => {
    const kampalaIso = zonedWallClockToIso('2026-11-16', '08:15', 'Africa/Kampala')
    expect(kampalaIso).toBe('2026-11-16T05:15:00.000Z')
    expect(formatTimeInZone(kampalaIso, 'Africa/Kampala')).toBe('08:15')

    // America/New_York switches from EDT (-04:00) to EST (-05:00) on 2026-11-01
    expect(zonedWallClockToIso('2026-07-15', '09:00', 'America/New_York')).toBe(
      '2026-07-15T13:00:00.000Z',
    )
    expect(zonedWallClockToIso('2026-11-16', '09:00', 'America/New_York')).toBe(
      '2026-11-16T14:00:00.000Z',
    )

    expect(formatLocalDateLabel('2026-11-16')).toContain('Nov')
    expect(addDaysToIsoDate('2026-11-16', -29)).toBe('2026-10-18')
    expect(formatMinutesDuration(95)).toBe('1h 35m')
  })

  it('captures GPS accurately and aligns location_check display to exact backend tokens (B4-05)', async () => {
    const remoteRes = await captureAttendanceLocation('remote', 'clock_in')
    expect(remoteRes).toEqual({
      locationStatus: 'not_requested',
      lat: null,
      lng: null,
      accuracyM: null,
      clientCapturedAt: null,
    })

    const fieldStillWorking = await captureAttendanceLocation('field', 'still_working')
    expect(fieldStillWorking.locationStatus).toBe('not_requested')

    const mockGeo = {
      getCurrentPosition: vi.fn((_ok: PositionCallback, err?: PositionErrorCallback) => {
        err?.({
          code: 1,
          message: 'User denied geolocation',
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        })
      }),
    }
    vi.stubGlobal('navigator', { ...navigator, geolocation: mockGeo })
    const denied = await captureAttendanceLocation('office', 'clock_in')
    expect(denied).toEqual({
      locationStatus: 'denied',
      lat: null,
      lng: null,
      accuracyM: null,
      clientCapturedAt: null,
    })

    expect(describeLocationCheck('onsite', 12)).toEqual({
      label: 'Onsite verified (12m)',
      tone: 'success',
    })
    expect(describeLocationCheck('outside', 420)).toEqual({
      label: 'Outside zone (420m)',
      tone: 'danger',
    })
    expect(describeLocationCheck('poor_accuracy')).toEqual({
      label: 'Low GPS precision',
      tone: 'warning',
    })
    expect(describeLocationCheck('denied').tone).toBe('warning')
    expect(describeLocationCheck('unavailable').tone).toBe('warning')
    expect(describeLocationCheck('not_required').tone).toBe('neutral')
    expect(describeLocationCheck('recorded')).toEqual({
      label: 'Field GPS recorded',
      tone: 'info',
    })
  })

  it('aborts in-flight session-scoped geolocation immediately when account switches mid-prompt (B4-02)', async () => {
    syncAttendanceAuthSessionFromProvider({
      identityKey: 'user-alpha',
      authEpoch: 1,
      isReady: true,
    })
    const snap = captureAttendanceSessionSnapshot()

    let resolveGeo: PositionCallback | null = null
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: {
        getCurrentPosition: vi.fn((ok: PositionCallback) => {
          resolveGeo = ok
        }),
      },
    })

    const promise = captureSessionScopedAttendanceLocation(
      'office',
      'clock_in',
      snap,
      isAttendanceSessionCurrent,
    )

    // User switches session while OS GPS permission dialog is open
    syncAttendanceAuthSessionFromProvider({
      identityKey: 'user-beta',
      authEpoch: 2,
      isReady: true,
      invalidate: true,
      clearStorage: true,
    })

    resolveGeo!({
      coords: {
        latitude: 0.3476,
        longitude: 32.5825,
        accuracy: 10,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        toJSON: () => ({}),
      },
      timestamp: Date.now(),
      toJSON: () => ({}),
    })

    await expect(promise).rejects.toSatisfy((err: unknown) => isAbortError(err))
  })

  it('classifies errors, preserves canonical multi-intent ops, and isolates storage per user', () => {
    expect(classifyAttendanceRpcError({ code: '42501', message: 'Forbidden' })).toBe('definite')
    expect(classifyAttendanceRpcError({ code: 'P0001', message: 'STALE_CONTEXT: reload' })).toBe('definite')
    expect(classifyAttendanceRpcError({ status: 409, message: 'IDEMPOTENCY_CONFLICT' })).toBe('definite')
    expect(classifyAttendanceRpcError({ status: 503, message: 'Service Unavailable' })).toBe('uncertain')
    expect(classifyAttendanceRpcError(new Error('TypeError: Failed to fetch'))).toBe('uncertain')
    expect(classifyAttendanceRpcError(new UncertainAttendanceTransportError('Null data'))).toBe(
      'uncertain',
    )

    expect(
      parseArrangementConflictId(
        new Error('ARRANGEMENT_CONFLICT:11111111-2222-3333-4444-555555555555: overlap'),
      ),
    ).toBe('11111111-2222-3333-4444-555555555555')

    expect(canonicalizeAttendancePayload({ b: 2, a: { d: 4, c: 3 } })).toBe(
      canonicalizeAttendancePayload({ a: { c: 3, d: 4 }, b: 2 }),
    )

    window.sessionStorage.setItem('unrelated.key', 'keep-me')
    writePendingAttendanceOperation({
      profileId: 'user-a',
      intentKey: 'execution:punch',
      operationType: 'clock_in',
      rpcName: 'rpc_attendance_clock_in',
      label: 'Start Day',
      requestId: 'req-123',
      payload: { p_location_status: 'denied' },
      payloadCanonical: canonicalizeAttendancePayload({ p_location_status: 'denied' }),
      createdAt: '2026-11-16T08:00:00.000Z',
    })
    writePendingAttendanceOperation({
      profileId: 'user-a',
      intentKey: 'self:submit_arrangement',
      operationType: 'submit_arrangement',
      rpcName: 'rpc_attendance_submit_arrangement',
      label: 'Submit Work Arrangement',
      requestId: 'req-arr-1',
      payload: { p_mode: 'field' },
      payloadCanonical: canonicalizeAttendancePayload({ p_mode: 'field' }),
      createdAt: '2026-11-16T08:05:00.000Z',
    })
    writePendingAttendanceOperation({
      profileId: 'user-b',
      intentKey: 'execution:punch',
      operationType: 'clock_out',
      rpcName: 'rpc_attendance_clock_out',
      label: 'End Day',
      requestId: 'req-456',
      payload: { p_location_status: 'captured' },
      payloadCanonical: canonicalizeAttendancePayload({ p_location_status: 'captured' }),
      createdAt: '2026-11-16T17:00:00.000Z',
    })

    expect(window.sessionStorage.getItem(`${PENDING_OPS_STORAGE_PREFIX}user-a`)).toBeTruthy()
    expect(readPendingAttendanceOperations('user-a')).toHaveLength(2)
    expect(readPendingAttendanceOperation('user-a')?.requestId).toBe('req-123')
    expect(readPendingAttendanceOperation('user-b')?.requestId).toBe('req-456')

    clearPendingAttendanceOperation('user-a', 'execution:punch')
    expect(readPendingAttendanceOperations('user-a')).toHaveLength(1)
    expect(readPendingAttendanceOperation('user-a')?.requestId).toBe('req-arr-1')
    expect(readPendingAttendanceOperation('user-b')?.requestId).toBe('req-456')

    clearAllPendingAttendanceOperations()
    expect(readPendingAttendanceOperations('user-a')).toHaveLength(0)
    expect(readPendingAttendanceOperation('user-b')).toBeNull()
    expect(window.sessionStorage.getItem('unrelated.key')).toBe('keep-me')
  })
})
