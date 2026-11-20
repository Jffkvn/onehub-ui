import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resetProtectedSessionRegistryForTest } from '@/lib/idempotency/pendingOperations'

import type { EmployeeSummary } from '../api/employees'
import { EmployeeDossierExport } from './EmployeeDossierExport'

const { audit, download, prepare, employeeGet, access, dossierSection } = vi.hoisted(() => ({
  audit: vi.fn(),
  download: vi.fn(),
  prepare: vi.fn(),
  employeeGet: vi.fn(),
  access: vi.fn(),
  dossierSection: vi.fn(),
}))

const employee: EmployeeSummary = {
  id: 'b7d00000-0000-4000-8000-000000000015',
  legalName: 'Dossier QA Worker',
  employeeNumber: 'B7D-15',
  companyEmail: null,
  workPhone: null,
  departmentName: 'Field service',
  jobTitleName: 'Engineer',
  payGradeName: 'G3-Pay',
  startDate: '2025-10-01',
  endDate: null,
  active: true,
  grossSalary: 3500456,
  nationalId: 'DO-NOT-EXPORT-NIN',
  bankName: 'Example Bank',
  accountNumber: 'DO-NOT-EXPORT-BANK-1222',
  tinNumber: 'DO-NOT-EXPORT-TIN-8333',
  nssfNumber: 'DO-NOT-EXPORT-NSSF-9911',
}
const profile = {
  id: 'b7d00000-0000-4000-8000-000000000001',
  displayName: 'QA HR',
}
let permissions: string[]
let isSignedIn: boolean
const scopePermissions = ['employees.read', 'reports.export', 'payroll.read']

vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuth: () => ({
    session: isSignedIn ? { userId: profile.id } : null,
    access: isSignedIn ? { profile, permissionKeys: permissions } : null,
    status: isSignedIn ? 'authenticated' : 'anonymous',
    authEpoch: isSignedIn ? 1 : 2,
  }),
}))
vi.mock('@/modules/auth/AuthGateway', () => ({
  createSupabaseAuthGateway: () => ({ loadAccessContext: access }),
}))
vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: () => ({
    rpc: audit,
    from: () => ({
      select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
    }),
  }),
}))
vi.mock('../api/employees', () => ({ employeeApi: { get: employeeGet } }))
vi.mock('../api/dossierHistory', () => ({ getDossierSection: dossierSection }))
vi.mock('../exports/dossierDocument', () => ({ prepareEmployeeDossierPdf: prepare }))

function openExport() {
  const view = render(<EmployeeDossierExport employee={employee} />)
  fireEvent.click(screen.getByRole('button', { name: 'Export dossier PDF' }))
  return view
}

function confirmExport() {
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Download PDF' }))
}

describe('Employee dossier PDF', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    resetProtectedSessionRegistryForTest()
    isSignedIn = true
    permissions = [...scopePermissions]
    access.mockImplementation(() => Promise.resolve({ profile, isActive: true, permissionKeys: [...permissions] }))
    employeeGet.mockResolvedValue(employee)
    dossierSection.mockResolvedValue({ version: 0, records: [] })
    prepare.mockResolvedValue(download)
    audit.mockResolvedValue({ error: null })
  })

  it('requires permission to read and export employee records', () => {
    permissions = ['employees.read', 'payroll.read']
    render(<EmployeeDossierExport employee={employee} />)
    expect(screen.queryByRole('button', { name: 'Export dossier PDF' })).not.toBeInTheDocument()
    expect(access).not.toHaveBeenCalled()
  })

  it('uses the current employee record and audits before downloading the default pay-free PDF', async () => {
    dossierSection.mockRejectedValueOnce(new Error('Private backend detail'))
    openExport()
    expect(screen.getByRole('checkbox', { name: 'Include pay details' })).not.toBeChecked()
    confirmExport()
    await waitFor(() => expect(download).toHaveBeenCalledOnce())
    expect(employeeGet).toHaveBeenCalledWith(employee.id)
    expect(audit).toHaveBeenCalledWith('record_report_export', {
      p_format: 'pdf',
      p_report_name: 'employee-dossier:' + employee.id,
    })
    expect(audit.mock.invocationCallOrder[0]).toBeLessThan(download.mock.invocationCallOrder[0])
    const documentData = JSON.stringify(prepare.mock.calls[0][0])
    expect(documentData).toContain('could not be loaded')
    expect(documentData).not.toMatch(/Private backend detail|G3-Pay|3,500,456|DO-NOT-EXPORT/)
  })

  it('requires explicit opt-in and includes masked financial identifiers only', async () => {
    openExport()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include pay details' }))
    confirmExport()
    await waitFor(() => expect(download).toHaveBeenCalledOnce())
    expect(audit).toHaveBeenCalledWith('record_report_export', {
      p_format: 'pdf',
      p_report_name: 'employee-dossier-with-pay:' + employee.id,
    })
    const documentData = JSON.stringify(prepare.mock.calls[0][0])
    expect(documentData).toContain('3,500,456')
    expect(documentData).toContain('1222')
    expect(documentData).not.toContain('DO-NOT-EXPORT')
  })

  it('revalidates payroll permission before preparing a PDF with pay', async () => {
    openExport()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include pay details' }))
    access.mockResolvedValue({ profile, isActive: true, permissionKeys: ['employees.read', 'reports.export'] })
    confirmExport()
    expect(await screen.findByRole('alert')).toHaveTextContent('access')
    expect(prepare).not.toHaveBeenCalled()
    expect(download).not.toHaveBeenCalled()
  })

  it('withholds the download when auditing fails or the session changes', async () => {
    audit.mockResolvedValueOnce({ error: { message: 'Server detail' } })
    const view = openExport()
    confirmExport()
    expect(await screen.findByRole('alert')).toHaveTextContent('record this export')
    expect(download).not.toHaveBeenCalled()

    let finishAudit: (result: { error: null }) => void = () => undefined
    const pending = new Promise<{ error: null }>((resolve) => { finishAudit = resolve })
    audit.mockReturnValueOnce(pending)
    confirmExport()
    await waitFor(() => expect(audit).toHaveBeenCalledTimes(2))
    act(() => {
      isSignedIn = false
      view.rerender(<EmployeeDossierExport employee={employee} />)
    })
    await act(async () => {
      finishAudit({ error: null })
      await pending
    })
    expect(download).not.toHaveBeenCalled()
  })
})
