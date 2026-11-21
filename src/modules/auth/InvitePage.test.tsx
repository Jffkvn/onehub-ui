import { StrictMode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InvitePage } from './InvitePage'
import { RequireAuth } from './RequireAuth'
import { TotpEnrollmentPage } from './TotpEnrollmentPage'

const mocks = vi.hoisted(() => ({
  status: 'authenticated',
  enrollTotp: vi.fn(() => Promise.resolve({ factorId: 'test-factor', qrCode: 'data:image/png;base64,eA==', secret: 'synthetic-test-secret' })),
  verifyTotp: vi.fn((_factor: string, _code: string) => { void _factor; void _code; return Promise.resolve() }),
  refreshSecurity: vi.fn(),
  signOut: vi.fn(),
  acceptInvite: vi.fn((_token: string) => { void _token; return Promise.resolve({ userId: 'invited-user', email: 'invite@example.invalid' }) }),
  setInitialPassword: vi.fn((_password: string, _userId: string) => { void _password; void _userId; return Promise.resolve() }),
}))

vi.mock('./AuthProvider', () => ({
  useAuth: () => ({ ...mocks }),
}))

describe('first-time invitation acceptance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.status = 'authenticated'
  })

  it('redeems a one-time invite once and opens the guarded workspace after the password is set', async () => {
    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/invite?token_hash=synthetic-one-time-invite']}>
          <Routes>
            <Route path="/invite" element={<InvitePage />} />
            <Route path="/" element={<h1>Workspace entry</h1>} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    )

    expect(await screen.findByRole('button', { name: 'Activate account' })).toBeEnabled()
    expect(mocks.acceptInvite).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'synthetic-passphrase' } })
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'synthetic-passphrase' } })
    fireEvent.click(screen.getByRole('button', { name: 'Activate account' }))
    await waitFor(() => expect(mocks.setInitialPassword).toHaveBeenCalledExactlyOnceWith('synthetic-passphrase', 'invited-user'))
    expect(mocks.acceptInvite).toHaveBeenCalledExactlyOnceWith('synthetic-one-time-invite')
    expect(await screen.findByRole('heading', { name: 'Workspace entry' })).toBeInTheDocument()
  })

  it('routes a newly invited administrator through required authenticator enrollment', async () => {
    mocks.setInitialPassword.mockImplementationOnce(() => { mocks.status = 'mfa_enrollment_required'; return Promise.resolve() })
    mocks.refreshSecurity.mockImplementationOnce(() => { mocks.status = 'authenticated' })
    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/invite?token_hash=synthetic-admin-invite']}>
          <Routes>
            <Route path="/invite" element={<InvitePage />} />
            <Route path="/mfa/enroll" element={<TotpEnrollmentPage />} />
            <Route element={<RequireAuth />}>
              <Route path="/" element={<h1>Workspace home</h1>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    )

    expect(await screen.findByRole('button', { name: 'Activate account' })).toBeEnabled()
    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'synthetic-admin-password' } })
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'synthetic-admin-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Activate account' }))
    const code = await screen.findByLabelText('Six-digit Code')
    expect(mocks.enrollTotp).toHaveBeenCalledTimes(1)
    fireEvent.change(code, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify authenticator' }))
    expect(await screen.findByRole('heading', { name: 'Workspace home' })).toBeInTheDocument()
    expect(mocks.verifyTotp).toHaveBeenCalledWith('test-factor', '123456')
  })
})
