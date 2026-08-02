import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Banknote, CheckCircle, Clock, FileSpreadsheet } from 'lucide-react'

import { PageHeader } from '@/components/patterns/PageHeader'
import { KpiCard } from '@/components/patterns/KpiCard'
import { DataTable, type ColumnDef } from '@/components/patterns/DataTable'
import { StatusPill } from '@/components/ui/StatusPill'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/patterns/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { useHasPermission } from '@/modules/auth/AuthProvider'
import { usePayrollRuns } from '../api/payroll'
import { CreatePayrollModal } from '../components/CreatePayrollModal'
import type { PayrollRun } from '@/_contract/types/payroll.types'

export function PayrollRunsPage() {
  const navigate = useNavigate()
  const canPrepare = useHasPermission('payroll.prepare')

  const [createModalOpen, setCreateModalOpen] = useState(false)
  const { data: runs = [], isLoading } = usePayrollRuns()

  // KPI Calculations
  const approvedCount = runs.filter((r) => r.status === 'approved').length
  const draftCount = runs.filter((r) => r.status === 'draft').length
  const latestApprovedRun = runs.find((r) => r.status === 'approved')
  const paymentsRecorded = runs.filter((r) => r.payment !== null).length

  const columns: ColumnDef<PayrollRun>[] = [
    {
      key: 'period',
      header: 'Payroll Period',
      accessor: (r) => (
        <div>
          <span className="font-semibold text-ink">{r.periodLabel}</span>
          <p className="font-mono text-[10px] text-muted">
            {r.runType.toUpperCase()} RUN #{r.runNumber}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (r) => (
        <StatusPill tone={r.status === 'approved' ? 'success' : 'warning'} size="sm">
          {r.status === 'approved' ? 'Approved & Locked' : 'Draft In Prep'}
        </StatusPill>
      ),
    },
    {
      key: 'totalGross',
      header: 'Gross Salary (UGX)',
      align: 'right',
      accessor: (r) => r.totalGross.toLocaleString(),
    },
    {
      key: 'totalNet',
      header: 'Net Payable (UGX)',
      align: 'right',
      accessor: (r) => <strong className="text-ink">{r.totalNet.toLocaleString()}</strong>,
    },
    {
      key: 'payment',
      header: 'Disbursement',
      accessor: (r) =>
        r.payment ? (
          <StatusPill tone="info" size="sm" withDot={false}>
            Paid ({r.payment.method})
          </StatusPill>
        ) : (
          <StatusPill tone="neutral" size="sm" withDot={false}>
            Not Recorded
          </StatusPill>
        ),
    },
    {
      key: 'action',
      header: 'Action',
      align: 'right',
      accessor: (r) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation()
            void navigate(`/finance/payroll/${r.id}`)
          }}
        >
          Open Run &rarr;
        </Button>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payroll Runs"
        subtitle="Manage monthly payroll drafts, approve statutory withholdings (PAYE, NSSF, WHT), and trigger disbursement."
        actions={
          canPrepare ? (
            <Button
              variant="primary"
              size="md"
              onClick={() => setCreateModalOpen(true)}
              leftIcon={<Plus className="h-4 w-4" />}
            >
              New Payroll Run
            </Button>
          ) : undefined
        }
      />

      {/* KPI Cards Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<Banknote className="h-5 w-5" />}
          tone="emerald"
          title="Total Runs Managed"
          value={runs.length}
          subline={`${approvedCount} approved and locked`}
        />
        <KpiCard
          icon={<CheckCircle className="h-5 w-5" />}
          tone="blue"
          title="Latest Net Pay"
          value={
            latestApprovedRun ? `UGX ${latestApprovedRun.totalNet.toLocaleString()}` : 'UGX 0'
          }
          subline={latestApprovedRun ? latestApprovedRun.periodLabel : 'No approved runs'}
        />
        <KpiCard
          icon={<FileSpreadsheet className="h-5 w-5" />}
          tone="violet"
          title="Payments Recorded"
          value={paymentsRecorded}
          subline="Disbursements logged"
        />
        <KpiCard
          icon={<Clock className="h-5 w-5" />}
          tone="amber"
          title="Draft Runs"
          value={draftCount}
          subline="Pending approval"
        />
      </div>

      {/* Runs Table */}
      {isLoading ? (
        <div className="space-y-3 rounded-lg border border-line bg-surface p-6">
          <Skeleton shape="row" />
          <Skeleton shape="row" />
          <Skeleton shape="row" />
        </div>
      ) : runs.length === 0 ? (
        <div className="flex min-h-[300px] items-center justify-center rounded-lg border border-line bg-surface p-8">
          <EmptyState
            icon={<Banknote className="h-6 w-6 text-emerald-600" />}
            tone="emerald"
            title="No Payroll Runs Found"
            description="Initialize your first monthly payroll run to generate employee payslips and statutory filings."
            action={
              canPrepare ? (
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => setCreateModalOpen(true)}
                  leftIcon={<Plus className="h-4 w-4" />}
                >
                  New Payroll Run
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={runs}
          keyExtractor={(r) => r.id}
          onRowClick={(r) => {
            void navigate(`/finance/payroll/${r.id}`)
          }}
        />
      )}

      {/* Create Payroll Modal */}
      <CreatePayrollModal
        open={createModalOpen}
        onOpenChange={setCreateModalOpen}
        onCreated={(runId) => {
          void navigate(`/finance/payroll/${runId}`)
        }}
      />
    </div>
  )
}
