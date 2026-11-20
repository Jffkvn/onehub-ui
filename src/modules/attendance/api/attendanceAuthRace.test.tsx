import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from '@/modules/auth/AuthProvider'
import type { AccessContext, AuthGateway, AuthSession } from '@/modules/auth/AuthGateway'
import { useClockIn } from './attendance'
import {
  isAbortError,
  readPendingAttendanceOperations,
  resetAttendanceSessionRegistryForTest,
} from '../lib/pendingOperations'

const mockRpc = vi.fn<(...args: unknown[]) => Promise<{ data: unknown; error: unknown }>>()

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: () => ({
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}))

function buildAccess(userId: string): AccessContext {
  return {
    profile: { id: userId, displayName: userId, status: 'active' },
    isActive: true,
    roleKeys: ['employee'],
    permissionKeys: ['attendance.clock_self', 'attendance.read_self'],
    enabledModules: [],
    mfaPolicy: { method: 'totp', enforcedRoles: ['super_admin'], optionalForOtherRoles: true },
    mfaRequired: false,
  }
}

function createFakeAuthGateway(initialUserId: string) {
  let currentSession: AuthSession | null = {
    userId: initialUserId,
    email: `${initialUserId}@example.com`,
  }
  const listeners = new Set<(event: string, s: AuthSession | null) => void>()

  const gateway: AuthGateway = {
    getSession: vi.fn(() => Promise.resolve(currentSession)),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    signIn: vi.fn((email: string) => {
      const userId = email.split('@')[0] ?? 'user-beta'
      currentSession = { userId, email }
      return Promise.resolve(currentSession)
    }),
    acceptInvite: vi.fn(() => Promise.reject(new Error('unused'))),
    setInitialPassword: vi.fn(() => Promise.resolve(undefined)),
    signOut: vi.fn(() => {
      currentSession = null
      return Promise.resolve(undefined)
    }),
    loadAccessContext: vi.fn(() => {
      if (!currentSession) return Promise.reject(new Error('unauthenticated'))
      return Promise.resolve(buildAccess(currentSession.userId))
    }),
    listFactors: vi.fn(() => Promise.resolve({ verifiedTotp: [], unverifiedTotp: [] })),
    enrollTotp: vi.fn(() => Promise.reject(new Error('unused'))),
    verifyTotp: vi.fn(() => Promise.resolve(undefined)),
    getAal: vi.fn(() => Promise.resolve('aal1' as const)),
  }

  return {
    gateway,
    emitAuthEvent: (event: string, session: AuthSession | null) => {
      currentSession = session
      for (const listener of listeners) {
        listener(event, session)
      }
    },
  }
}

describe('Real AuthProvider Async & Account-Switch Race Protection (B4-02)', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    resetAttendanceSessionRegistryForTest()
    mockRpc.mockReset()
  })

  it('prevents delayed 504 rejection and delayed 200 completion from resurrecting Alpha pending op after signOut/switch to Beta', async () => {
    const { gateway } = createFakeAuthGateway('profile-alpha')
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <AuthProvider gateway={gateway}>{children}</AuthProvider>
      </QueryClientProvider>
    )

    const { result } = renderHook(
      () => ({
        auth: useAuth(),
        clockIn: useClockIn(),
      }),
      { wrapper },
    )

    await waitFor(() => expect(result.current.auth.status).toBe('authenticated'))

    // Hold Alpha's RPC open in flight
    let resolveRpc: ((val: { data: unknown; error: unknown }) => void) | undefined
    mockRpc.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRpc = resolve
        }),
    )

    let caughtError: unknown = null
    const inFlightPromise = result.current.clockIn
      .mutateAsync({
        locationStatus: 'captured',
        lat: 0.3136,
        lng: 32.5811,
        accuracyM: 9,
        clientCapturedAt: '2026-11-16T05:05:00Z',
        contextRevision: 'rev-alpha',
      })
      .catch((err) => {
        caughtError = err
      })

    // Ensure the RPC call is genuinely in-flight and Alpha's op was pre-frozen synchronously
    await waitFor(() => {
      expect(resolveRpc).toBeTypeOf('function')
      expect(readPendingAttendanceOperations('profile-alpha')).toHaveLength(1)
    })

    // User signs out & signs in as Beta BEFORE Alpha's network call settles
    await act(async () => {
      await result.current.auth.signOut()
      await result.current.auth.signIn('profile-beta@example.com', 'pw')
    })

    await waitFor(() => {
      expect(result.current.auth.status).toBe('authenticated')
      expect(result.current.auth.session?.userId).toBe('profile-beta')
    })

    // Now the stale Alpha RPC rejects with 504!
    await act(async () => {
      resolveRpc!({ data: null, error: { status: 504, message: 'Gateway timeout' } })
      await inFlightPromise
    })

    expect(isAbortError(caughtError)).toBe(true)
    // CRITICAL B4-02 INVARIANT: Alpha's pending op / GPS coordinates MUST NOT reappear in sessionStorage
    expect(readPendingAttendanceOperations('profile-alpha')).toHaveLength(0)
    expect(readPendingAttendanceOperations('profile-beta')).toHaveLength(0)
    expect(window.sessionStorage.length).toBe(0)
  })

  it('aborts delayed 200 completion from previous epoch cleanly without touching Beta queries or storage', async () => {
    const { gateway, emitAuthEvent } = createFakeAuthGateway('profile-alpha')
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <AuthProvider gateway={gateway}>{children}</AuthProvider>
      </QueryClientProvider>
    )

    const { result } = renderHook(
      () => ({
        auth: useAuth(),
        clockIn: useClockIn(),
      }),
      { wrapper },
    )

    await waitFor(() => expect(result.current.auth.status).toBe('authenticated'))

    let resolveRpc: ((val: { data: unknown; error: unknown }) => void) | undefined
    mockRpc.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRpc = resolve
        }),
    )

    let caughtError: unknown = null
    const inFlightPromise = result.current.clockIn
      .mutateAsync({
        locationStatus: 'captured',
        lat: 0.3476,
        lng: 32.5825,
        accuracyM: 12,
        clientCapturedAt: '2026-11-16T05:05:00Z',
        contextRevision: 'rev-alpha',
      })
      .catch((err) => {
        caughtError = err
      })

    await waitFor(() => {
      expect(resolveRpc).toBeTypeOf('function')
    })

    // Simulate background auth state change directly to Beta via gateway subscription
    act(() => {
      emitAuthEvent('SIGNED_IN', { userId: 'profile-beta', email: 'profile-beta@example.com' })
    })

    await waitFor(() => expect(result.current.auth.session?.userId).toBe('profile-beta'))
    invalidateSpy.mockClear()

    // Old Alpha 200 arrives later
    await act(async () => {
      resolveRpc!({
        data: {
          request_id: 'alpha-req',
          operation_type: 'attendance_clock_in',
          replayed: false,
          result: { day_id: 'day-alpha' },
        },
        error: null,
      })
      await inFlightPromise
    })

    expect(isAbortError(caughtError)).toBe(true)
    expect(invalidateSpy).not.toHaveBeenCalled()
    expect(window.sessionStorage.length).toBe(0)
  })
})
