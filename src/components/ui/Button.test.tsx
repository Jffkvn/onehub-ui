import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './Button'

describe('Button Primitive', () => {
  it('renders children correctly', () => {
    render(<Button>Approve Payroll</Button>)
    expect(screen.getByRole('button', { name: 'Approve Payroll' })).toBeInTheDocument()
  })

  it('handles click events when enabled', () => {
    const handleClick = vi.fn()
    render(<Button onClick={handleClick}>Click Me</Button>)
    fireEvent.click(screen.getByRole('button'))
    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('prevents click events when disabled', () => {
    const handleClick = vi.fn()
    render(<Button disabled onClick={handleClick}>Disabled</Button>)
    const btn = screen.getByRole('button')
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(handleClick).not.toHaveBeenCalled()
  })

  it('shows loading spinner and disables interaction when loading', () => {
    const handleClick = vi.fn()
    render(<Button loading onClick={handleClick}>Loading State</Button>)
    const btn = screen.getByRole('button')
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(handleClick).not.toHaveBeenCalled()
  })
})
