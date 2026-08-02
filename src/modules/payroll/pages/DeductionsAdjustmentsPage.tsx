import { useMemo, useState } from 'react'
import { Calculator, Search, Receipt } from 'lucide-react'

import { PageHeader } from '@/components/patterns/PageHeader'
import { KpiCard } from '@/components/patterns/KpiCard'
import { DataTable, type ColumnDef } from '@/components/patterns/DataTable'
import { Skeleton } from '@/components/ui/Skeleton'
import { usePayrollRuns } from '../api/payroll'

interface DeductionRow {
  id: string
  employeeName: string
  employeeNumber: string
  periodLabel: string
  kind: string
  description: string
  amount: number
}

export function DeductionsAdjustmentsPage() {
  const { data: runs = [], isLoading } = usePayrollRuns()
  const [searchQuery, setSearchQuery] = useState('')

  // Flatten all line items across runs for display
  const deductionRows = useMemo(() => {
    const rows: DeductionRow[] = []
    for (const run of runs) {
      for (const item of run.items) {
        for (const line of item.lineItems) {
          if (line.kind === 'deduction' || line.kind === 'salary_advance' || line.kind === 'proration') {
            rows.push({
              id: `${item.id}-${line.code}-${rows.length}`,
              employeeName: item.employeeName,
              employeeNumber: item.employeeNumber,
              periodLabel: run.periodLabel,
              kind: line.kind === 'salary_advance' ? 'Salary Advance' : line.kind === 'proration' ? 'Proration / Leave' : 'Deduction',
              description: line.description,
              amount: line.amount,
            })
          }
        }
      }
    }
    return rows
  }, [runs])

  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return deductionRows
    const q = searchQuery.toLowerCase().trim()
    return deductionRows.filter(
      (r) =>
        r.employeeName.toLowerCase().includes(q) ||
        r.employeeNumber.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q),
    )
  }, [deductionRows, searchQuery])

  const totalDeductionAmount = deductionRows.reduce((sum, r) => sum + r.amount, 0)

  const columns: ColumnDef<DeductionRow>[] = [
    {
      key: 'employee',
      header: 'Employee',
      accessor: (r) => (
        <div>
          <p className="font-semibold text-ink">{r.employeeName}</p>
          <p className="font-mono text-[10px] text-muted">{r.employeeNumber}</p>
        </div>
      ),
    },
    {
      key: 'period',
      header: 'Payroll Period',
      accessor: (r) => r.periodLabel,
    },
    {
      key: 'kind',
      header: 'Type',
      accessor: (r) => (
        <span className="font-semibold text-soft uppercase text-[11px] font-mono">
          {r.kind}
        </span>
      ),
    },
    {
      key: 'description',
      header: 'Adjustment Description',
      accessor: (r) => r.description,
    },
    {
      key: 'amount',
      header: 'Amount (UGX)',
      align: 'right',
      accessor: (r) => <span className="font-mono font-bold text-rose">{r.amount.toLocaleString()}</span>,
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Deductions &amp; Adjustments"
        subtitle="Audit and track all salary advance repayments, unpaid leave prorations, and custom deductions applied across payroll runs."
      />

      {/* KPI Overview */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          icon={<Calculator className="h-5 w-5" />}
          tone="rose"
          title="Total Adjustments Applied"
          value={`UGX ${totalDeductionAmount.toLocaleString()}`}
          subline="Summed across all runs"
        />
        <KpiCard
          icon={<Receipt className="h-5 w-5" />}
          tone="amber"
          title="Total Adjustment Records"
          value={deductionRows.length}
          subline="Line items registered"
        />
        <KpiCard
          icon={<Calculator className="h-5 w-5" />}
          tone="blue"
          title="Tracked Runs"
          value={runs.length}
          subline="Active and archived"
        />
      </div>

      {/* Search Input */}
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          type="text"
          placeholder="Filter by employee or description..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-9 w-full rounded-md border border-line bg-surface pl-9 pr-3 text-xs text-ink placeholder:text-muted focus:border-emerald focus:outline-none"
        />
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-3 rounded-lg border border-line bg-surface p-6">
          <Skeleton shape="row" />
          <Skeleton shape="row" />
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface p-8 text-center text-xs text-muted">
          No deductions or adjustments recorded.
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={filteredRows}
          keyExtractor={(r) => r.id}
        />
      )}
    </div>
  )
}
