import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EmployeeFormModal } from './EmployeeFormModal'
import type { EmployeeSummary } from '../api/employees'

const mockCreateMutateAsync = vi.fn()
const mockUpdateMutateAsync = vi.fn()

vi.mock('../api/employees', () => ({
  useEmployeeSetup: () => ({
    data: {
      departments: [
        { id: 'dept-1', name: 'Engineering' },
        { id: 'dept-2', name: 'Operations' },
      ],
      jobTitles: [
        { id: 'jt-1', name: 'Field Engineer', departmentId: 'dept-1' },
        { id: 'jt-2', name: 'Operations Lead', departmentId: 'dept-2' },
      ],
      payGrades: [
        { id: 'pg-1', code: 'G1', name: 'Grade 1' },
        { id: 'pg-2', code: 'G2', name: 'Grade 2' },
      ],
    },
  }),
  useCreateEmployee: () => ({
    mutateAsync: mockCreateMutateAsync,
    isPending: false,
  }),
  useUpdateEmployee: () => ({
    mutateAsync: mockUpdateMutateAsync,
    isPending: false,
  }),
}))

const existingEmployee: EmployeeSummary = {
  id: 'emp-1',
  employeeNumber: 'EMP-QA-01',
  legalName: 'Kato Mukasa',
  companyEmail: 'kato@example.com',
  workPhone: '+256700000001',
  active: true,
  departmentName: 'Engineering',
  jobTitleName: 'Field Engineer',
  payGradeName: 'Grade 1',
  startDate: '2026-11-01',
  endDate: null,
  departmentId: 'dept-1',
  jobTitleId: 'jt-1',
  payGradeId: 'pg-1',
  employmentType: 'full_time',
  contractType: 'permanent',
  probationStatus: 'not_applicable',
  grossSalary: 1500000,
  currency: 'UGX',
  paymentMethod: 'cash',
  employeeTaxType: 'local',
  pctMonthWorked: 100,
  whtRate: 6,
}

describe('EmployeeFormModal', () => {
  beforeEach(() => {
    mockCreateMutateAsync.mockReset()
    mockUpdateMutateAsync.mockReset()
  })

  it('renders cleanly without Radix empty-value crash and protects unsaved edits (DEF-06)', async () => {
    const onOpenChange = vi.fn()
    render(
      <EmployeeFormModal
        open
        onOpenChange={onOpenChange}
        employee={existingEmployee}
      />,
    )

    const phoneInput = screen.getByPlaceholderText('+256770001122')
    fireEvent.change(phoneInput, { target: { value: '+256700999888' } })

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/unsaved changes/i)

    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(phoneInput).toHaveValue('+256700999888')

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it('surfaces backend save failure inline without closing or losing edits', async () => {
    const onOpenChange = vi.fn()
    mockUpdateMutateAsync.mockRejectedValue(new Error('Duplicate employee number'))

    render(
      <EmployeeFormModal
        open
        onOpenChange={onOpenChange}
        employee={existingEmployee}
      />,
    )

    const nameInput = screen.getByPlaceholderText('e.g. Kato Mukasa John')
    fireEvent.change(nameInput, { target: { value: 'Kato Updated' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Employee Changes' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Duplicate employee number')
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(nameInput).toHaveValue('Kato Updated')
  })

  it('portals Combobox inside Dialog with keyboard selection and Escape dismissal before unsaved-changes guard', async () => {
    const onOpenChange = vi.fn()
    render(
      <EmployeeFormModal
        open
        onOpenChange={onOpenChange}
        employee={existingEmployee}
      />,
    )

    // Edit phone first so dialog is dirty
    fireEvent.change(screen.getByPlaceholderText('+256770001122'), {
      target: { value: '+256700888777' },
    })

    // Open Department Combobox -> press Escape -> closes popup ONLY, not dirty alertdialog
    const deptTrigger = screen.getByRole('button', { name: 'Engineering' })
    fireEvent.click(deptTrigger)
    const searchInput = await screen.findByPlaceholderText('Search departments...')
    fireEvent.keyDown(searchInput, { key: 'Escape' })

    expect(screen.queryByPlaceholderText('Search departments...')).not.toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    // Reopen, search, navigate with ArrowDown, select with Enter
    fireEvent.click(deptTrigger)
    const searchInput2 = await screen.findByPlaceholderText('Search departments...')
    fireEvent.change(searchInput2, { target: { value: 'Oper' } })
    fireEvent.keyDown(searchInput2, { key: 'Enter' })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Operations' })).toBeInTheDocument()
      // Stale Engineering job title resets to the unassigned ('') option when Department changes
      expect(screen.getByRole('button', { name: 'None / Unassigned' })).toBeInTheDocument()
    })
  })
})
