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
import {
  createSupabaseAuthGateway,
  type AccessContext,
  type AuthGateway,
  type AuthSession,
  type TotpEnrollment,
} from './AuthGateway'
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
  const [status, setStatus] = useState<AuthStatus>('initializing')
  const [session, setSession] = useState<AuthSession | null>(null)
  const [sessionResolved, setSessionResolved] = useState(false)
  const [access, setAccess] = useState<AccessContext | null>(null)
  const [verifiedFactorId, setVerifiedFactorId] = useState<string>()
  const [securityVersion, setSecurityVersion] = useState(0)
  const [devPreviewRole, setDevPreviewRole] = useState<UserRole | null>(null)
  const requestVersion = useRef(0)

  useEffect(() => {
    let active = true
    let unsubscribe: () => void = () => undefined

    try {
      unsubscribe = gateway.subscribe((_event, nextSession) => {
        if (active) {
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
  }, [gateway])

  useEffect(() => {
    const version = ++requestVersion.current
    if (!sessionResolved || !session) return

    Promise.all([
      gateway.loadAccessContext(),
      gateway.listFactors(),
      gateway.getAal(),
    ])
      .then(([nextAccess, factors, aal]) => {
        if (requestVersion.current !== version) return
        setAccess(nextAccess)
        const factorId = factors.verifiedTotp[0]?.id
        setVerifiedFactorId(factorId)

        if (!nextAccess.profile || !nextAccess.isActive) {
          setStatus('access_denied')
        } else if (factorId && aal !== 'aal2') {
          setStatus('mfa_challenge_required')
        } else if (nextAccess.mfaRequired && !factorId) {
          setStatus('mfa_enrollment_required')
        } else {
          setStatus('authenticated')
        }
      })
      .catch(() => {
        if (requestVersion.current === version) setStatus('error')
      })
  }, [gateway, securityVersion, session, sessionResolved])

  const signIn = useCallback(
    async (email: string, password: string) => {
      const nextSession = await gateway.signIn(email, password)
      setStatus('loading_access')
      setSession(nextSession)
      setSessionResolved(true)
    },
    [gateway],
  )
  const acceptInvite = useCallback(
    async (tokenHash: string) => {
      const nextSession = await gateway.acceptInvite(tokenHash)
      setStatus('loading_access')
      setSession(nextSession)
      setSessionResolved(true)
    },
    [gateway],
  )
  const signOut = useCallback(async () => {
    await gateway.signOut()
    setSession(null)
    setSessionResolved(true)
    setAccess(null)
    setVerifiedFactorId(undefined)
    setStatus('unauthenticated')
  }, [gateway])
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
