import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusPill, Badge } from './StatusPill'

describe('StatusPill & Badge Primitives', () => {
  it('maps tones correctly and renders leading dot by default', () => {
    render(<StatusPill tone="success">Approved</StatusPill>)
    const element = screen.getByText('Approved')
    expect(element).toBeInTheDocument()
    expect(element.parentElement).toHaveClass('bg-emerald-tint')
  })

  it('renders badge without dot', () => {
    render(<Badge tone="warning">3 Pending</Badge>)
    const element = screen.getByText('3 Pending')
    expect(element).toBeInTheDocument()
    expect(element.parentElement).toHaveClass('bg-amber-tint')
  })
})
