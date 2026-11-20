import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RequirePermission } from './RequirePermission'

const mockUseAuth = vi.fn()

vi.mock('./AuthProvider', () => ({
  useAuth: () => mockUseAuth() as unknown,
}))

describe('RequirePermission (DEF-01)', () => {
  beforeEach(() => {
    mockUseAuth.mockReset()
  })

  it('denies route when permission exists on a disallowed role', () => {
    mockUseAuth.mockReturnValue({
      status: 'authenticated',
      devPreviewRole: null,
      access: {
        roleKeys: ['super_admin'],
        permissionKeys: ['cash_advances.manage'],
      },
    })

    render(
      <MemoryRouter initialEntries={['/ops/cash']}>
        <Routes>
          <Route
            element={
              <RequirePermission
                allowedRoles={['coordinator', 'cfo']}
                anyOf={['cash_advances.manage', 'cash_advances.request']}
              />
            }
          >
            <Route path="/ops/cash" element={<div>Cash Page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.queryByText('Cash Page')).not.toBeInTheDocument()
    expect(screen.getByText(/403 — Permission Denied/i)).toBeInTheDocument()
  })

  it('allows route when both allowedRoles and anyOf permissions match', () => {
    mockUseAuth.mockReturnValue({
      status: 'authenticated',
      devPreviewRole: null,
      access: {
        roleKeys: ['coordinator'],
        permissionKeys: ['cash_advances.request'],
      },
    })

    render(
      <MemoryRouter initialEntries={['/ops/cash']}>
        <Routes>
          <Route
            element={
              <RequirePermission
                allowedRoles={['coordinator', 'cfo']}
                anyOf={['cash_advances.manage', 'cash_advances.request']}
              />
            }
          >
            <Route path="/ops/cash" element={<div>Cash Page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('Cash Page')).toBeInTheDocument()
  })
})
