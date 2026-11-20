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
  it('prompts before closing when hasUnsavedChanges is true and supports Keep editing vs Discard changes', () => {
    const handleOpenChange = vi.fn()
    render(
      <Dialog open hasUnsavedChanges onOpenChange={handleOpenChange} title="Edit Record">
        <p>Form fields</p>
      </Dialog>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(handleOpenChange).not.toHaveBeenCalled()
    const alert = screen.getByRole('alertdialog')
    expect(alert).toHaveTextContent(/unsaved changes/i)

    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(handleOpenChange).not.toHaveBeenCalled()

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(handleOpenChange).toHaveBeenCalledWith(false)
  })

  it('renders a viewport-bounded flex scroll layout with a pinned footer slot', () => {
    render(
      <Dialog
        open
        title="Add Pay Grade"
        footer={<button type="button">Save Pay Grade</button>}
      >
        <p>Long body content</p>
      </Dialog>,
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('max-h-[calc(100dvh-1.5rem)]')
    expect(dialog.className).toContain('flex-col')
    const saveBtn = screen.getByRole('button', { name: 'Save Pay Grade' })
    expect(saveBtn).toBeInTheDocument()
    expect(saveBtn.parentElement?.className).toContain('shrink-0')
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
