import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import { Topbar } from './Topbar'

vi.mock('./DevRoleSwitcher', () => ({ DevRoleSwitcher: () => null }))

it('only shows search when the current screen can use it', () => {
  const onSearchChange = vi.fn()
  const view = render(<Topbar />)
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  view.rerender(<Topbar onSearchChange={onSearchChange} />)
  fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'router' } })
  expect(onSearchChange).toHaveBeenCalledWith('router')
})
