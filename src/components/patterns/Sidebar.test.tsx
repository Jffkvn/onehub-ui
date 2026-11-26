import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Sidebar, type NavGroup } from './Sidebar'

const sampleGroups: NavGroup[] = [
  {
    title: 'Home',
    hideHeader: true,
    items: [{ id: 'dashboard', label: 'Dashboard', path: '/dashboard', icon: <span /> }],
  },
  {
    title: 'Service Ops',
    items: [{ id: 'dispatch', label: 'Dispatch & Queues', path: '/services/dispatch', icon: <span /> }],
  },
  {
    title: 'My Self-Service',
    collapsible: true,
    defaultCollapsed: true,
    items: [
      { id: 'my-payslips', label: 'My Pay', path: '/my/payslips', icon: <span /> },
      { id: 'my-leave', label: 'My Leave', path: '/my/leave', icon: <span /> },
    ],
  },
]

describe('Sidebar', () => {
  it('omits the inactive Ask AI Assistant button and starts My Self-Service collapsed for operational roles', () => {
    render(<Sidebar groups={sampleGroups} activePath="/dashboard" onNavigate={vi.fn()} />)

    expect(screen.queryByText(/Ask AI Assistant/i)).not.toBeInTheDocument()
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByText('Dispatch & Queues')).toBeInTheDocument()
    expect(screen.queryByText('My Pay')).not.toBeInTheDocument()

    const toggle = screen.getByRole('button', { name: /My Self-Service/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('My Pay')).toBeInTheDocument()
  })

  it('auto-expands My Self-Service when activePath is inside a self-service route or defaultCollapsed is false', () => {
    const { rerender } = render(
      <Sidebar groups={sampleGroups} activePath="/my/payslips" onNavigate={vi.fn()} />,
    )

    expect(screen.getByRole('button', { name: /My Self-Service/i })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('My Pay')).toBeInTheDocument()

    const employeeGroups: NavGroup[] = [
      sampleGroups[0],
      { ...sampleGroups[2], defaultCollapsed: false },
    ]
    rerender(<Sidebar groups={employeeGroups} activePath="/dashboard" onNavigate={vi.fn()} />)
    expect(screen.getByText('My Leave')).toBeInTheDocument()
  })
})
