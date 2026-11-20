import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { AuthProvider, useAuth } from './AuthProvider'
import type { AccessContext, AuthGateway, AuthSession, FactorState } from './AuthGateway'

class FakeAuthGateway implements AuthGateway {
  session: AuthSession | null = null
  access: AccessContext = {
    profile: {
      id: '00000000-0000-0000-0000-000000000001',
      displayName: 'Test User',
      status: 'active',
    },
    isActive: true,
    roleKeys: ['hr_admin'],
    permissionKeys: ['employees.read', 'leave.manage'],
    enabledModules: ['home', 'hr'],
    mfaPolicy: { method: 'totp', enforcedRoles: ['super_admin'], optionalForOtherRoles: true },
    mfaRequired: false,
  }
  factors: FactorState = { verifiedTotp: [], unverifiedTotp: [] }
  aal: 'aal1' | 'aal2' = 'aal1'

  getSession(): Promise<AuthSession | null> {
    return Promise.resolve(this.session)
  }
  subscribe(listener: (event: string, session: AuthSession | null) => void) {
    listener('INITIAL', this.session)
    return () => undefined
  }
  signIn(): Promise<AuthSession> {
    this.session = { userId: 'usr_1', email: 'test@egypro.co.ug' }
    return Promise.resolve(this.session)
  }
  acceptInvite(): Promise<AuthSession> {
    this.session = { userId: 'usr_1', email: 'test@egypro.co.ug' }
    return Promise.resolve(this.session)
  }
  setInitialPassword(): Promise<void> {
    return Promise.resolve()
  }
  signOut(): Promise<void> {
    this.session = null
    return Promise.resolve()
  }
  loadAccessContext(): Promise<AccessContext> {
    return Promise.resolve(this.access)
  }
  listFactors(): Promise<FactorState> {
    return Promise.resolve(this.factors)
  }
  enrollTotp() {
    return Promise.resolve({ factorId: 'f_1', qrCode: 'data:image/png;base64,fake', secret: 'SECRET' })
  }
  verifyTotp(): Promise<void> {
    return Promise.resolve()
  }
  getAal(): Promise<'aal1' | 'aal2'> {
    return Promise.resolve(this.aal)
  }
}

function Consumer() {
  const auth = useAuth()
  return (
    <div>
      <span data-testid="status">{auth.status}</span>
      <span data-testid="user">{auth.access?.profile?.displayName ?? 'None'}</span>
      <button type="button" onClick={() => void auth.signOut()}>
        Sign Out
      </button>
    </div>
  )
}

describe('AuthProvider', () => {
  it('starts unauthenticated when no session exists', async () => {
    const gateway = new FakeAuthGateway()
    render(
      <AuthProvider gateway={gateway}>
        <Consumer />
      </AuthProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('unauthenticated')
    })
  })

  it('loads access context and transitions to authenticated when session exists', async () => {
    const gateway = new FakeAuthGateway()
    gateway.session = { userId: 'usr_1', email: 'test@egypro.co.ug' }

    render(
      <AuthProvider gateway={gateway}>
        <Consumer />
      </AuthProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('authenticated')
      expect(screen.getByTestId('user').textContent).toBe('Test User')
    })
  })

  it('detects access denied when profile is null or inactive', async () => {
    const gateway = new FakeAuthGateway()
    gateway.session = { userId: 'usr_1', email: 'test@egypro.co.ug' }
    gateway.access.isActive = false

    render(
      <AuthProvider gateway={gateway}>
        <Consumer />
      </AuthProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('access_denied')
    })
  })

  it('clears QueryClient protected caches on sign-out and session swaps', async () => {
    const gateway = new FakeAuthGateway()
    gateway.session = { userId: 'usr_1', email: 'test@egypro.co.ug' }
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: 1000 * 60 * 5 } },
    })

    queryClient.setQueryData(['portal', 'self-service-profile', 'usr_1', 0], { id: 'emp-1' })
    queryClient.setQueryData(['hr', 'employees'], [{ id: 'emp-1' }])
    queryClient.setQueryData(['payroll', 'runs'], [{ id: 'run-1' }])

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider gateway={gateway}>
          <Consumer />
        </AuthProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('authenticated')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }))

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('unauthenticated')
      expect(screen.getByTestId('user').textContent).toBe('None')
    })

    expect(queryClient.getQueryData(['portal', 'self-service-profile', 'usr_1', 0])).toBeUndefined()
    expect(queryClient.getQueryData(['hr', 'employees'])).toBeUndefined()
    expect(queryClient.getQueryData(['payroll', 'runs'])).toBeUndefined()
  })
})
