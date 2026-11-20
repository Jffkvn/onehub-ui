import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/ui/Toast'
import { AppRouter } from '@/app/router'
import { AuthProvider, useAuth } from '@/modules/auth/AuthProvider'
import type { AccessContext, AuthGateway, AuthSession } from '@/modules/auth/AuthGateway'
import { selfServiceApi, type SelfServiceProfile } from '../api/selfService'

type UserKey = 'alpha' | 'beta' | 'unlinked' | 'gamma'

const USERS: Record<
  UserKey,
  {
    userId: string
    email: string
    displayName: string
    profile: SelfServiceProfile | null
  }
> = {
  alpha: {
    userId: 'user-alpha',
    email: 'alpha@egypro.test',
    displayName: 'Alpha User',
    profile: {
      id: 'emp-alpha',
      employeeNumber: 'EMP-ALPHA',
      legalName: 'Alpha Legal Name',
      companyEmail: 'alpha@egypro.test',
      personalEmail: 'alpha.personal@example.test',
      workPhone: '+256700111111',
      active: true,
      departmentName: 'Alpha Engineering',
      jobTitleName: 'Field Engineer',
      payGradeName: 'Grade 1',
      startDate: '2026-01-01',
      endDate: null,
      employmentType: 'full_time',
      contractType: 'permanent',
      probationEndDate: null,
      probationStatus: 'passed',
    },
  },
  beta: {
    userId: 'user-beta',
    email: 'beta@egypro.test',
    displayName: 'Beta User',
    profile: {
      id: 'emp-beta',
      employeeNumber: 'EMP-BETA',
      legalName: 'Beta Legal Name',
      companyEmail: 'beta@egypro.test',
      personalEmail: 'beta.personal@example.test',
      workPhone: '+256700222222',
      active: true,
      departmentName: 'Beta Finance',
      jobTitleName: 'Payroll Officer',
      payGradeName: 'Grade 2',
      startDate: '2026-02-01',
      endDate: null,
      employmentType: 'full_time',
      contractType: 'permanent',
      probationEndDate: null,
      probationStatus: 'passed',
    },
  },
  unlinked: {
    userId: 'user-unlinked',
    email: 'unlinked@egypro.test',
    displayName: 'Unlinked Account',
    profile: null,
  },
  gamma: {
    userId: 'user-gamma',
    email: 'gamma@egypro.test',
    displayName: 'Gamma User',
    profile: {
      id: 'emp-gamma',
      employeeNumber: 'EMP-GAMMA',
      legalName: 'Gamma Legal Name',
      companyEmail: 'gamma@egypro.test',
      personalEmail: null,
      workPhone: '+256700333333',
      active: true,
      departmentName: 'Gamma Ops',
      jobTitleName: 'Coordinator',
      payGradeName: 'Grade 3',
      startDate: '2026-03-01',
      endDate: null,
      employmentType: 'full_time',
      contractType: 'permanent',
      probationEndDate: null,
      probationStatus: 'not_applicable',
    },
  },
}

function makeAccess(user: UserKey): AccessContext {
  const entry = USERS[user]
  return {
    profile: {
      id: entry.userId,
      displayName: entry.displayName,
      status: 'active',
    },
    isActive: true,
    roleKeys: ['employee'],
    permissionKeys: ['staff_advances.read_self', 'training.read_self', 'performance.read_self'],
    enabledModules: [],
    mfaPolicy: { method: 'totp', enforcedRoles: ['super_admin'], optionalForOtherRoles: true },
    mfaRequired: false,
  }
}

function createGateway(initialUser: UserKey | null = 'alpha') {
  let activeUser: UserKey | null = initialUser
  const listeners = new Set<(event: string, session: AuthSession | null) => void>()

  const getActiveSession = (): AuthSession | null => {
    if (!activeUser) return null
    return {
      userId: USERS[activeUser].userId,
      email: USERS[activeUser].email,
    }
  }

  const gateway: AuthGateway & { currentKey: () => UserKey | null } = {
    currentKey: () => activeUser,
    getSession: () => Promise.resolve(getActiveSession()),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    signIn(email) {
      const matched = (Object.keys(USERS) as UserKey[]).find((k) => USERS[k].email === email)
      if (!matched) return Promise.reject(new Error('Unknown QA account'))
      activeUser = matched
      const next = getActiveSession()!
      listeners.forEach((l) => l('SIGNED_IN', next))
      return Promise.resolve(next)
    },
    acceptInvite() {
      return Promise.resolve(getActiveSession()!)
    },
    setInitialPassword() {
      return Promise.resolve()
    },
    signOut() {
      activeUser = null
      listeners.forEach((l) => l('SIGNED_OUT', null))
      return Promise.resolve()
    },
    loadAccessContext() {
      if (!activeUser) return Promise.reject(new Error('No active user'))
      return Promise.resolve(makeAccess(activeUser))
    },
    listFactors: () => Promise.resolve({ verifiedTotp: [], unverifiedTotp: [] }),
    enrollTotp: () => Promise.resolve({ factorId: 'f1', qrCode: '', secret: '' }),
    verifyTotp: () => Promise.resolve(),
    getAal: () => Promise.resolve('aal1' as const),
  }

  return gateway
}

function Deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function SignOutTrigger() {
  const auth = useAuth()
  return (
    <button type="button" onClick={() => void auth.signOut()}>
      Test Sign Out
    </button>
  )
}

function renderSameTabSession(gateway: AuthGateway) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60 * 5,
        retry: false,
      },
    },
  })

  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider gateway={gateway}>
          <ToastProvider>
            <MemoryRouter initialEntries={['/my']}>
              <SignOutTrigger />
              <AppRouter />
            </MemoryRouter>
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>,
    ),
  }
}

async function signInViaLoginForm(email: string) {
  const emailInput = await screen.findByPlaceholderText('name@egypro.co.ug')
  const passwordInput = screen.getByPlaceholderText('••••••••••••')
  fireEvent.change(emailInput, { target: { value: email } })
  fireEvent.change(passwordInput, { target: { value: 'Pass1234!' } })
  fireEvent.click(screen.getByRole('button', { name: /Sign in securely/i }))
}

describe('MyWorkspace same-QueryClient account switching & cache isolation (P1)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('never shows Alpha profile to Beta while pending, failing, or under the 5-minute stale policy', async () => {
    const gateway = createGateway('alpha')
    const betaPending = Deferred<SelfServiceProfile | null>()
    let betaShouldFail = false
    const calledFor: Array<UserKey | null> = []

    vi.spyOn(selfServiceApi, 'getProfile').mockImplementation(async () => {
      const current = gateway.currentKey()
      calledFor.push(current)
      if (current === 'alpha') return USERS.alpha.profile
      if (current === 'beta') {
        if (betaShouldFail) throw new Error('Beta network failure')
        return betaPending.promise
      }
      return null
    })

    renderSameTabSession(gateway)

    expect((await screen.findAllByText('Alpha Legal Name')).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('EMP-ALPHA').length).toBeGreaterThanOrEqual(1)
    expect(calledFor).toEqual(['alpha'])

    // Sign out Alpha cleanly, then sign in Beta through LoginPage on the exact same QueryClient
    fireEvent.click(screen.getByRole('button', { name: 'Test Sign Out' }))
    await signInViaLoginForm('beta@egypro.test')

    // While Beta's fetch is pending, Alpha's personal/employment data must NEVER be rendered
    await waitFor(() => {
      expect(calledFor).toEqual(['alpha', 'beta'])
    })
    expect(screen.queryByText('Alpha Legal Name')).not.toBeInTheDocument()
    expect(screen.queryByText('EMP-ALPHA')).not.toBeInTheDocument()
    expect(screen.queryByText('alpha.personal@example.test')).not.toBeInTheDocument()

    // Resolve Beta's fetch -> Beta's own profile displays cleanly
    betaPending.resolve(USERS.beta.profile)
    expect((await screen.findAllByText('Beta Legal Name')).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('EMP-BETA').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('Alpha Legal Name')).not.toBeInTheDocument()

    // Sign out Beta, then re-sign-in Beta with failing fetch -> error alert appears and neither Alpha nor stale Beta returns
    fireEvent.click(screen.getByRole('button', { name: 'Test Sign Out' }))
    betaShouldFail = true
    await signInViaLoginForm('beta@egypro.test')

    expect(await screen.findByText('Your workspace could not be loaded')).toBeInTheDocument()
    expect(screen.queryByText('Alpha Legal Name')).not.toBeInTheDocument()
    expect(screen.queryByText('Beta Legal Name')).not.toBeInTheDocument()
  })

  it('discards a late-resolving Alpha response after account switch and updates linked/unlinked states accurately', async () => {
    const gateway = createGateway('alpha')
    const lateAlphaRequest = Deferred<SelfServiceProfile | null>()
    const lateBetaRequest = Deferred<SelfServiceProfile | null>()
    let alphaCalls = 0

    vi.spyOn(selfServiceApi, 'getProfile').mockImplementation(async () => {
      const current = gateway.currentKey()
      if (current === 'alpha') {
        alphaCalls += 1
        return alphaCalls === 1 ? lateAlphaRequest.promise : USERS.alpha.profile
      }
      if (current === 'beta') return lateBetaRequest.promise
      if (current === 'unlinked') return USERS.unlinked.profile
      if (current === 'gamma') return USERS.gamma.profile
      return null
    })

    renderSameTabSession(gateway)

    // Alpha is authenticated and starts slow request #1, then signs out before it settles
    await waitFor(() => expect(alphaCalls).toBe(1))
    fireEvent.click(screen.getByRole('button', { name: 'Test Sign Out' }))

    // Beta signs in while Beta is pending and late Alpha finally resolves
    await signInViaLoginForm('beta@egypro.test')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'My Workspace' })).toBeInTheDocument())

    lateAlphaRequest.resolve(USERS.alpha.profile)
    await Promise.resolve()

    expect(screen.queryByText('Alpha Legal Name')).not.toBeInTheDocument()
    expect(screen.queryByText('EMP-ALPHA')).not.toBeInTheDocument()

    // Now resolve Beta -> Beta shows cleanly
    lateBetaRequest.resolve(USERS.beta.profile)
    expect((await screen.findAllByText('Beta Legal Name')).length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('Alpha Legal Name')).not.toBeInTheDocument()

    // Linked (Beta) -> Unlinked -> Linked (Gamma)
    fireEvent.click(screen.getByRole('button', { name: 'Test Sign Out' }))
    await signInViaLoginForm('unlinked@egypro.test')
    expect(await screen.findByText('Your employee profile is not linked yet')).toBeInTheDocument()
    expect(screen.getByText(/unlinked@egypro.test/)).toBeInTheDocument()
    expect(screen.queryByText('Beta Legal Name')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Test Sign Out' }))
    await signInViaLoginForm('gamma@egypro.test')
    expect((await screen.findAllByText('Gamma Legal Name')).length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('Your employee profile is not linked yet')).not.toBeInTheDocument()
  })
})
