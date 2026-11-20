import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import type { IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import type { PerformanceCycle, performanceApi } from './api'
import { PERFORMANCE_TEMPLATE_HEADERS } from './performanceWorkbook'
import { PerformanceImportDialog } from './PerformanceImportDialog'

const cycle: PerformanceCycle = {
  id: '40000000-0000-4000-8000-000000000001',
  name: 'FY 2026 Review',
  start_date: '2026-01-01',
  end_date: '2026-12-31',
  status: 'active',
  total_reviews: 1,
  completed_reviews: 0,
}

const scope: IdentityScopeRef = {
  identityKey: 'u-hr',
  authEpoch: 1,
  isAuthReady: true,
  latestRef: { current: { identityKey: 'u-hr', authEpoch: 1, isAuthReady: true } },
}

function makeWorkbookFile(employeeNumbers = ['EMP-01']): File {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([
    [...PERFORMANCE_TEMPLATE_HEADERS],
    ...employeeNumbers.map((number) => [
      number,
      'Reviewer Jane',
      'Strong delivery cleanly measured.',
      'Yes',
      'No',
      'Deliver milestone A',
      '5',
      '',
      '',
      '',
      '',
    ]),
  ])
  XLSX.utils.book_append_sheet(wb, ws, 'Performance Reviews')
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array
  return new File([new Uint8Array(bytes)], 'perf.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

describe('PerformanceImportDialog', () => {
  it.each([false, true])('re-validates stale rows without resaving successful rows (partial result %s)', async (partial) => {
    const savedEmployee = '10000000-0000-4000-8000-000000000002'
    const savedReview = '30000000-0000-4000-8000-000000000002'
    const listImportVersions = vi
      .fn()
      .mockResolvedValueOnce([
        {
          employee_id: '10000000-0000-4000-8000-000000000001',
          review_id: '30000000-0000-4000-8000-000000000001',
          status: 'draft',
          version: 1,
        },
      ])
      .mockResolvedValueOnce([
        {
          employee_id: '10000000-0000-4000-8000-000000000001',
          review_id: '30000000-0000-4000-8000-000000000001',
          status: 'reopened',
          version: 2,
        },
        ...(partial ? [{ employee_id: savedEmployee, review_id: savedReview, status: 'hr_approved', version: 1 }] : []),
      ])

    const importReview = vi.fn()
    if (partial) importReview.mockResolvedValueOnce(savedReview)
    importReview.mockRejectedValueOnce(
        new Error('This performance review changed since you previewed the workbook. Re-validate before importing.'),
      )
      .mockResolvedValueOnce('30000000-0000-4000-8000-000000000001')

    const api = {
      listEmployees: vi.fn().mockResolvedValue([
        { id: '10000000-0000-4000-8000-000000000001', employee_number: 'EMP-01', legal_name: 'Alice One' },
        { id: savedEmployee, employee_number: 'EMP-02', legal_name: 'Alice Two' },
      ]),
      listReviewers: vi.fn().mockResolvedValue([
        { profile_id: '20000000-0000-4000-8000-000000000001', display_name: 'Reviewer Jane', role_label: 'PM' },
      ]),
      listImportVersions,
      importReview,
    } as unknown as ReturnType<typeof performanceApi>

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <PerformanceImportDialog
          open={true}
          onOpenChange={() => undefined}
          cycle={cycle}
          existingReviews={[]}
          api={api}
          scope={scope}
        />
      </QueryClientProvider>,
    )

    const input = await screen.findByLabelText(/upload performance reviews workbook/i)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /select \.xlsx workbook/i })).toBeEnabled()
    })
    fireEvent.change(input, { target: { files: [makeWorkbookFile(partial ? ['EMP-02', 'EMP-01'] : ['EMP-01'])] } })

    expect(await screen.findByText(/overwrite \(draft\)/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`import ${partial ? 2 : 1} review`, 'i') }))

    expect(await screen.findByText(/changed since you previewed the workbook/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /re-validate workbook/i }))

    expect(await screen.findByText(/overwrite \(reopened\)/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /import 1 review/i }))

    await waitFor(() => {
      expect(importReview).toHaveBeenLastCalledWith(
        expect.objectContaining({
          expectedReviewId: '30000000-0000-4000-8000-000000000001',
          expectedVersion: 2,
        }),
      )
    })
    expect(await screen.findAllByText(/^saved$/i)).toHaveLength(partial ? 2 : 1)
    expect(importReview).toHaveBeenCalledTimes(partial ? 3 : 2)
    if (partial) expect(importReview.mock.calls.filter(([input]) =>
      (input as { employeeId: string }).employeeId === savedEmployee,
    )).toHaveLength(1)
  })
})
