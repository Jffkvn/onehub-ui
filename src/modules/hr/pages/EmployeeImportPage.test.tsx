import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { ToastProvider } from '@/components/ui/Toast'
import { EMPLOYEE_TEMPLATE_HEADERS } from '../import/employeeTemplate'
import EmployeeImportPage from './EmployeeImportPage'

const { rpc, fromQuery, writeFileMock } = vi.hoisted(() => ({
  rpc: vi.fn(),
  fromQuery: vi.fn<() => Promise<{ data: unknown[]; error: null }>>(),
  writeFileMock: vi.fn(),
}))

vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuth: () => ({
    status: 'authenticated',
    session: { userId: 'u-hr', email: 'hr@example.com' },
    access: {
      profile: { id: 'u-hr', displayName: 'HR Admin', status: 'active' },
      roleKeys: ['hr_admin'],
      permissionKeys: ['employees.read', 'employee_imports.manage'],
    },
    authEpoch: 1,
    devPreviewRole: null,
  }),
  useHasPermission: () => true,
}))

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: () => ({
    rpc,
    from: (table: string) => {
      if (table === 'departments') {
        return {
          select: () => ({
            is: () => ({
              order: () => Promise.resolve({ data: [{ id: 'd1', name: 'Engineering' }], error: null }),
            }),
          }),
        }
      }
      if (table === 'job_titles') {
        return {
          select: () => ({
            is: () => ({
              order: () =>
                Promise.resolve({
                  data: [{ id: 'j1', name: 'Technician', department_id: 'd1' }],
                  error: null,
                }),
            }),
          }),
        }
      }
      if (table === 'pay_grades') {
        return {
          select: () => ({
            is: () => ({
              order: () =>
                Promise.resolve({
                  data: [{ id: 'p1', code: 'PG-2', name: 'Technical Officer' }],
                  error: null,
                }),
            }),
          }),
        }
      }
      return {
        select: () => ({
          order: () => fromQuery(),
        }),
      }
    },
  }),
}))

vi.mock('xlsx', async (importOriginal) => ({
  ...(await importOriginal<typeof import('xlsx')>()),
  writeFile: writeFileMock,
}))

function renderImportPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <EmployeeImportPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

function buildWorkbookFile(rows: string[][], name = 'employees.xlsx'): File {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(rows)
  XLSX.utils.book_append_sheet(wb, ws, 'Employees')
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array | ArrayBuffer
  const payload = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes)
  return new File([payload], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

describe('EmployeeImportPage', () => {
  let employeeVersion: number

  beforeEach(() => {
    vi.clearAllMocks()
    employeeVersion = 1
    fromQuery.mockImplementation(() => Promise.resolve({
      data: [
        {
          id: 'e1000000-0000-4000-8000-000000000001',
          version: employeeVersion,
          employee_number: 'EMP-001',
          legal_name: 'Alice Namukasa',
          company_email: 'alice@example.com',
          personal_email: null,
          work_phone: null,
          gender: null,
          date_of_birth: null,
          archived_at: null,
          employee_confidential_profiles: [
            {
              version: 1,
              national_id: null,
              gross_salary: 3000000,
              currency_code: 'UGX',
              custom_overtime_rate: null,
              payment_method: 'cash',
              mobile_money_number: null,
              bank_name: null,
              account_number: null,
              sort_code: null,
              tin_number: '1000999888',
              nssf_number: null,
              employee_tax_type: 'local',
              pct_month_worked: 100,
              wht_rate: 6,
            },
          ],
          employment_periods: [
            {
              id: 'ep1',
              version: 1,
              start_date: '2025-01-15',
              end_date: null,
              department_id: 'd1',
              job_title_id: 'j1',
              pay_grade_id: 'p1',
              employment_type: 'full_time',
              contract_type: 'permanent',
              probation_end_date: null,
              probation_status: 'not_applicable',
              departments: { name: 'Engineering' },
              job_titles: { name: 'Technician' },
              pay_grades: { name: 'Technical Officer' },
            },
          ],
        },
      ],
      error: null,
    }))
    rpc.mockImplementation((fn: string) => {
      if (fn === 'record_employee_export') return Promise.resolve({ data: null, error: null })
      if (fn === 'commit_employee_import') {
        return Promise.resolve({ data: { created: 0, updated: 1 }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    })
  })

  it('audits employee export before downloading and blocks download when audit fails', async () => {
    const timeline: string[] = []
    writeFileMock.mockImplementation(() => {
      timeline.push('download')
    })
    rpc.mockImplementation((fn: string) => {
      if (fn === 'record_employee_export') {
        timeline.push('audit')
        return Promise.resolve({ data: null, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    })

    renderImportPage()
    fireEvent.click(screen.getByRole('button', { name: /export employees/i }))
    await waitFor(() => {
      expect(writeFileMock).toHaveBeenCalledTimes(1)
    })
    expect(timeline).toEqual(['audit', 'download'])

    // If audit fails, workbook must NEVER be written/downloaded
    rpc.mockImplementation((fn: string) => {
      if (fn === 'record_employee_export') {
        return Promise.resolve({ data: null, error: { message: 'Audit service unavailable' } })
      }
      return Promise.resolve({ data: null, error: null })
    })

    fireEvent.click(screen.getByRole('button', { name: /export employees/i }))
    expect(await screen.findByText(/audit service unavailable/i)).toBeInTheDocument()
    expect(writeFileMock).toHaveBeenCalledTimes(1)
  })

  it('surfaces blank-field clear warnings, detects stale previews on commit, and re-validates cleanly', async () => {
    let commitAttempts = 0
    rpc.mockImplementation((fn: string) => {
      if (fn === 'commit_employee_import') {
        commitAttempts += 1
        if (commitAttempts === 1) {
          employeeVersion = 2
          return Promise.resolve({
            data: null,
            error: {
              code: '40001',
              message:
                'Employee EMP-001 changed since you previewed this workbook. Re-validate the workbook before committing.',
            },
          })
        }
        return Promise.resolve({ data: { created: 0, updated: 1 }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    })

    renderImportPage()
    await waitFor(() => expect(screen.getByLabelText(/upload employee workbook/i)).toBeInTheDocument())

    const row = EMPLOYEE_TEMPLATE_HEADERS.map((h) => {
      if (h === 'Employee Number') return 'EMP-001'
      if (h === 'Full Name') return 'Alice Namukasa'
      if (h === 'Company Email') return 'alice@example.com'
      if (h === 'Department') return 'Engineering'
      if (h === 'Job Title') return 'Technician'
      if (h === 'Pay Grade Code') return 'PG-2'
      if (h === 'Employment Type') return 'full_time'
      if (h === 'Contract Type') return 'permanent'
      if (h === 'Start Date (YYYY-MM-DD)') return '2025-01-15'
      if (h === 'Gross Salary (UGX)') return '3000000'
      return ''
    })
    const file = buildWorkbookFile([[...EMPLOYEE_TEMPLATE_HEADERS], row])
    const input = screen.getByLabelText(/upload employee workbook/i)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /select \.xlsx workbook/i })).toBeEnabled()
    })
    fireEvent.change(input, { target: { files: [file] } })

    expect(await screen.findByText(/validation preview/i)).toBeInTheDocument()
    expect(screen.getByText(/clears existing data: tin number/i)).toBeInTheDocument()

    const commitBtn = screen.getByRole('button', { name: /commit 1 valid row/i })
    expect(commitBtn).toBeDisabled()

    fireEvent.click(screen.getByRole('checkbox'))
    expect(commitBtn).toBeEnabled()

    // First commit fails with stale preview 40001
    fireEvent.click(commitBtn)
    expect(await screen.findByText(/changed since you previewed/i)).toBeInTheDocument()
    const revalidateBtn = screen.getByRole('button', { name: /re-validate workbook/i })
    expect(commitBtn).toBeDisabled()

    // Re-validate fetches new version token, requires re-confirm, and succeeds
    fireEvent.click(revalidateBtn)
    await waitFor(() => {
      expect(screen.queryByText(/changed since you previewed/i)).not.toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /commit 1 valid row/i }))

    await waitFor(() => {
      expect(rpc).toHaveBeenLastCalledWith(
        'commit_employee_import',
        expect.objectContaining({
          import_rows: [
            expect.objectContaining({
              expected_version_token: '2:false:1:1:ep1@1',
            }),
          ],
        }),
      )
    })
    expect(await screen.findByText(/import committed cleanly/i)).toBeInTheDocument()
  })
})
