import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LoginPage } from './LoginPage'

const mockUseAuth = vi.fn()

vi.mock('./AuthProvider', () => ({
  useAuth: () => mockUseAuth() as unknown,
}))

describe('LoginPage (DEF-04)', () => {
  beforeEach(() => {
    mockUseAuth.mockReset()
  })

  it('displays clear inactive/unlinked account feedback when auth status is access_denied', () => {
    mockUseAuth.mockReturnValue({
      status: 'access_denied',
      signIn: vi.fn(),
    })

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      /inactive or unlinked and cannot access OneHub/i,
    )
  })

  it('displays access verification error when auth status is error', () => {
    mockUseAuth.mockReturnValue({
      status: 'error',
      signIn: vi.fn(),
    })

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(/unable to verify your workspace access/i)
  })
})
