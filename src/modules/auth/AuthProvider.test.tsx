import { render, screen, waitFor } from '@testing-library/react'
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
  const { status, access } = useAuth()
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="user">{access?.profile?.displayName ?? 'None'}</span>
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
})
