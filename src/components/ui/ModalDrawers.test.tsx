import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Dialog } from './Dialog'
import { SlideOver } from './SlideOver'

describe('Dialog Primitive', () => {
  it('renders modal title and content when open', () => {
    render(
      <Dialog open title="Confirm Action">
        <p>Are you sure?</p>
      </Dialog>,
    )
    expect(screen.getByText('Confirm Action')).toBeInTheDocument()
    expect(screen.getByText('Are you sure?')).toBeInTheDocument()
  })

  it('calls onOpenChange when close button is clicked', () => {
    const handleOpenChange = vi.fn()
    render(
      <Dialog open onOpenChange={handleOpenChange} title="Modal Title">
        <p>Content</p>
      </Dialog>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(handleOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('SlideOver Primitive', () => {
  it('renders slideover title and close button when open', () => {
    render(
      <SlideOver open title="Employee Details">
        <p>Profile Content</p>
      </SlideOver>,
    )
    expect(screen.getByText('Employee Details')).toBeInTheDocument()
    expect(screen.getByText('Profile Content')).toBeInTheDocument()
  })
})
