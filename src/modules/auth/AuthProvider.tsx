import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { QueryClientContext } from '@tanstack/react-query'
import {
  createSupabaseAuthGateway,
  type AccessContext,
  type AuthGateway,
  type AuthSession,
  type TotpEnrollment,
} from './AuthGateway'
import {
  clearAllProtectedPendingOperations,
  syncProtectedAuthSessionFromProvider,
} from '@/lib/idempotency/pendingOperations'
import type { UserRole } from '@/config/modules'

export type AuthStatus =
  | 'initializing'
  | 'unauthenticated'
  | 'loading_access'
  | 'mfa_enrollment_required'
  | 'mfa_challenge_required'
  | 'authenticated'
  | 'access_denied'
  | 'error'

interface AuthContextValue {
  status: AuthStatus
  session: AuthSession | null
  access: AccessContext | null
  verifiedFactorId?: string
  authEpoch?: number
  devPreviewRole: UserRole | null
  setDevPreviewRole(role: UserRole | null): void
  signIn(email: string, password: string): Promise<void>
  acceptInvite(tokenHash: string): Promise<void>
  setInitialPassword(password: string): Promise<void>
  signOut(): Promise<void>
  enrollTotp(): Promise<TotpEnrollment>
  verifyTotp(factorId: string, code: string): Promise<void>
  refreshSecurity(): void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({
  children,
  gateway: suppliedGateway,
}: {
  children: ReactNode
  gateway?: AuthGateway
}) {
  const gateway = useMemo(
    () => suppliedGateway ?? createSupabaseAuthGateway(),
    [suppliedGateway],
  )
  const queryClient = useContext(QueryClientContext)
  const [status, setStatus] = useState<AuthStatus>('initializing')
  const [session, setSession] = useState<AuthSession | null>(null)
  const [sessionResolved, setSessionResolved] = useState(false)
  const [access, setAccess] = useState<AccessContext | null>(null)
  const [verifiedFactorId, setVerifiedFactorId] = useState<string>()
  const [securityVersion, setSecurityVersion] = useState(0)
  const [authEpoch, setAuthEpoch] = useState(0)
  const [devPreviewRole, setDevPreviewRole] = useState<UserRole | null>(null)
  const requestVersion = useRef(0)
  const authEpochRef = useRef(0)
  const lastUserIdRef = useRef<string | null>(null)
  const lastProfileIdRef = useRef<string | null>(null)

  const clearProtectedCache = useCallback(
    (bumpEpoch = true) => {
      if (bumpEpoch) {
        authEpochRef.current += 1
        setAuthEpoch(authEpochRef.current)
      }
      syncProtectedAuthSessionFromProvider({
        identityKey: null,
        authEpoch: authEpochRef.current,
        isReady: false,
        invalidate: true,
        clearStorage: true,
      })
      if (!queryClient) return
      void queryClient.cancelQueries()
      queryClient.clear()
    },
    [queryClient],
  )

  useEffect(() => {
    if (status === 'unauthenticated' || status === 'access_denied' || status === 'error') {
      syncProtectedAuthSessionFromProvider({
        identityKey: null,
        authEpoch: authEpochRef.current,
        isReady: false,
        invalidate: true,
      })
      if (queryClient) {
        void queryClient.cancelQueries()
        queryClient.clear()
      }
    }
  }, [queryClient, status])

  useEffect(() => {
    let active = true
    let unsubscribe: () => void = () => undefined

    const handleSessionTransition = (nextSession: AuthSession | null) => {
      const prevUserId = lastUserIdRef.current
      const nextUserId = nextSession?.userId ?? null
      const identityEnded = prevUserId !== null && nextUserId === null
      const identityChanged = prevUserId !== null && nextUserId !== null && prevUserId !== nextUserId

      if (identityEnded || identityChanged) {
        requestVersion.current += 1
        lastProfileIdRef.current = null
        authEpochRef.current += 1
        setAuthEpoch(authEpochRef.current)
        syncProtectedAuthSessionFromProvider({
          identityKey: nextUserId,
          authEpoch: authEpochRef.current,
          isReady: false,
          invalidate: true,
          clearStorage: true,
        })
        if (queryClient) {
          void queryClient.cancelQueries()
        }
        setAccess(null)
        setVerifiedFactorId(undefined)
        setDevPreviewRole(null)
        if (identityChanged && queryClient) {
          queryClient.clear()
        }
      }
      lastUserIdRef.current = nextUserId
    }

    try {
      unsubscribe = gateway.subscribe((_event, nextSession) => {
        if (active) {
          handleSessionTransition(nextSession)
          setSession(nextSession)
          setSessionResolved(true)
          if (!nextSession) {
            setAccess(null)
            setVerifiedFactorId(undefined)
            setStatus('unauthenticated')
          } else {
            setStatus('loading_access')
          }
        }
      })
    } catch {
      queueMicrotask(() => {
        if (active) setStatus('error')
      })

      return () => {
        active = false
      }
    }

    gateway
      .getSession()
      .then((initialSession) => {
        if (active) {
          handleSessionTransition(initialSession)
          setSession(initialSession)
          setSessionResolved(true)
          setStatus(initialSession ? 'loading_access' : 'unauthenticated')
        }
      })
      .catch(() => {
        if (active) setStatus('error')
      })

    return () => {
      active = false
      unsubscribe()
    }
  }, [gateway, queryClient])

  useEffect(() => {
    const version = ++requestVersion.current
    if (!sessionResolved || !session) return
    const expectedUserId = session.userId

    Promise.all([
      gateway.loadAccessContext(),
      gateway.listFactors(),
      gateway.getAal(),
    ])
      .then(([nextAccess, factors, aal]) => {
        if (requestVersion.current !== version || lastUserIdRef.current !== expectedUserId) return

        const nextProfileId = nextAccess.profile?.id ?? null
        if (!nextAccess.profile || !nextAccess.isActive) {
          lastProfileIdRef.current = null
          clearProtectedCache()
        } else if (lastProfileIdRef.current !== null && lastProfileIdRef.current !== nextProfileId) {
          lastProfileIdRef.current = nextProfileId
          clearProtectedCache()
        } else {
          lastProfileIdRef.current = nextProfileId
        }

        setAccess(nextAccess)
        const factorId = factors.verifiedTotp[0]?.id
        setVerifiedFactorId(factorId)

        if (!nextAccess.profile || !nextAccess.isActive) {
          syncProtectedAuthSessionFromProvider({
            identityKey: null,
            authEpoch: authEpochRef.current,
            isReady: false,
            invalidate: true,
            clearStorage: true,
          })
          setStatus('access_denied')
        } else if (factorId && aal !== 'aal2') {
          syncProtectedAuthSessionFromProvider({
            identityKey: expectedUserId ?? nextProfileId,
            authEpoch: authEpochRef.current,
            isReady: false,
            invalidate: true,
          })
          setStatus('mfa_challenge_required')
        } else if (nextAccess.mfaRequired && !factorId) {
          syncProtectedAuthSessionFromProvider({
            identityKey: expectedUserId ?? nextProfileId,
            authEpoch: authEpochRef.current,
            isReady: false,
            invalidate: true,
          })
          setStatus('mfa_enrollment_required')
        } else {
          syncProtectedAuthSessionFromProvider({
            identityKey: expectedUserId ?? nextProfileId,
            authEpoch: authEpochRef.current,
            isReady: true,
          })
          setStatus('authenticated')
        }
      })
      .catch(() => {
        if (requestVersion.current === version) setStatus('error')
      })
  }, [clearProtectedCache, gateway, securityVersion, session, sessionResolved])

  const signIn = useCallback(
    async (email: string, password: string) => {
      clearProtectedCache(false)
      const nextSession = await gateway.signIn(email, password)
      requestVersion.current += 1
      lastUserIdRef.current = nextSession.userId
      lastProfileIdRef.current = null
      clearProtectedCache()
      setAccess(null)
      setVerifiedFactorId(undefined)
      setDevPreviewRole(null)
      setStatus('loading_access')
      setSession(nextSession)
      setSessionResolved(true)
    },
    [clearProtectedCache, gateway],
  )
  const acceptInvite = useCallback(
    async (tokenHash: string) => {
      clearProtectedCache(false)
      const nextSession = await gateway.acceptInvite(tokenHash)
      requestVersion.current += 1
      lastUserIdRef.current = nextSession.userId
      lastProfileIdRef.current = null
      clearProtectedCache()
      setAccess(null)
      setVerifiedFactorId(undefined)
      setDevPreviewRole(null)
      setStatus('loading_access')
      setSession(nextSession)
      setSessionResolved(true)
    },
    [clearProtectedCache, gateway],
  )
  const signOut = useCallback(async () => {
    requestVersion.current += 1
    lastUserIdRef.current = null
    lastProfileIdRef.current = null
    authEpochRef.current += 1
    setAuthEpoch(authEpochRef.current)
    syncProtectedAuthSessionFromProvider({
      identityKey: null,
      authEpoch: authEpochRef.current,
      isReady: false,
      invalidate: true,
      clearStorage: true,
    })
    if (queryClient) {
      void queryClient.cancelQueries()
    }
    setSession(null)
    setSessionResolved(true)
    setAccess(null)
    setVerifiedFactorId(undefined)
    setDevPreviewRole(null)
    setStatus('unauthenticated')
    try {
      await gateway.signOut()
    } finally {
      clearAllProtectedPendingOperations()
      if (queryClient) {
        void queryClient.cancelQueries()
        queryClient.clear()
      }
    }
  }, [gateway, queryClient])
  const setInitialPassword = useCallback(
    (password: string) => gateway.setInitialPassword(password),
    [gateway],
  )
  const enrollTotp = useCallback(() => gateway.enrollTotp(), [gateway])
  const verifyTotp = useCallback(
    (factorId: string, code: string) => gateway.verifyTotp(factorId, code),
    [gateway],
  )
  const refreshSecurity = useCallback(() => {
    setStatus('loading_access')
    setSecurityVersion((current) => current + 1)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      access,
      verifiedFactorId,
      authEpoch,
      devPreviewRole,
      setDevPreviewRole,
      signIn,
      acceptInvite,
      setInitialPassword,
      signOut,
      enrollTotp,
      verifyTotp,
      refreshSecurity,
    }),
    [
      acceptInvite,
      access,
      authEpoch,
      devPreviewRole,
      enrollTotp,
      refreshSecurity,
      session,
      setInitialPassword,
      signIn,
      signOut,
      status,
      verifiedFactorId,
      verifyTotp,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}

export function usePermissions(): string[] {
  const { access } = useAuth()
  return access?.permissionKeys ?? []
}

export function useHasPermission(key?: string, anyOf?: string[]): boolean {
  const permissions = usePermissions()
  if (!key && (!anyOf || anyOf.length === 0)) return true
  if (key && permissions.includes(key)) return true
  if (anyOf && anyOf.some((p) => permissions.includes(p))) return true
  return false
}
