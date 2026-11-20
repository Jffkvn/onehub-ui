import { useState } from 'react'
import { FileSpreadsheet, Download, Building2, PhoneCall, ShieldCheck, FileCheck, Receipt } from 'lucide-react'

import { PageHeader } from '@/components/patterns/PageHeader'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { StatusPill } from '@/components/ui/StatusPill'
import { Skeleton } from '@/components/ui/Skeleton'
import { usePayrollRuns, payrollApi } from '../api/payroll'
import { downloadMasterPayroll } from '../exports/masterPayroll'
import { bankPaymentCsv, mtnBulkPayCsv, nssfCsv, payeCsv, whtCsv, downloadText } from '../exports/paymentFiles'
import type { PayrollRun } from '@/_contract/types/payroll.types'

export function StatutoryExportsPage() {
  const { data: runs = [], isLoading } = usePayrollRuns()

  const approvedRuns = runs.filter((r) => r.status === 'approved')
  const [selectedRunId, setSelectedRunId] = useState<string>(
    approvedRuns[0]?.id || '',
  )
  const [exportError, setExportError] = useState('')

  // Selected Run
  const activeRun = approvedRuns.find((r) => r.id === selectedRunId) || approvedRuns[0]

  const handleExport = async (
    kind: 'master' | 'bank' | 'mtn' | 'nssf' | 'paye' | 'wht',
    exportFn: (run: PayrollRun) => void | Promise<void>,
  ) => {
    if (!activeRun) return
    setExportError('')
    try {
      // Audit record export in database prior to download
      await payrollApi.recordExport(activeRun.id, null, kind)
      await exportFn(activeRun)
    } catch (error) {
      setExportError(
        error instanceof Error ? error.message : 'Unable to generate export file.',
      )
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Statutory Payroll Exports"
        subtitle="Generate and download statutory compliance files for Uganda Revenue Authority (PAYE/WHT), NSSF, Stanbic/Centenary bank CSVs, and MTN Mobile Money."
      />

      {/* Approved Run Selector */}
      <div className="rounded-xl border border-line bg-surface p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h3 className="font-display text-sm font-bold text-ink">Select Approved Payroll Run</h3>
            <p className="font-body text-xs text-soft">
              Only approved and locked payroll runs can produce official compliance filings.
            </p>
          </div>

          <div className="w-full sm:w-72">
            <Select
              value={activeRun?.id || ''}
              onValueChange={setSelectedRunId}
              options={approvedRuns.map((r) => ({
                value: r.id,
                label: `${r.periodLabel} (${r.runType.toUpperCase()} #${r.runNumber})`,
              }))}
            />
          </div>
        </div>

        {activeRun && (
          <div className="flex flex-wrap items-center gap-4 pt-3 border-t border-line text-xs font-mono text-soft">
            <div>Net Pay: <strong className="text-emerald-600 whitespace-nowrap tabular-nums">UGX {activeRun.totalNet.toLocaleString()}</strong></div>
            <div>PAYE: <strong className="text-rose whitespace-nowrap tabular-nums">UGX {activeRun.totalPaye.toLocaleString()}</strong></div>
            <div>NSSF (15%): <strong className="text-blue whitespace-nowrap tabular-nums">UGX {(activeRun.totalNssfEmployee + activeRun.totalNssfEmployer).toLocaleString()}</strong></div>
            <div>Staff: <strong className="text-ink tabular-nums">{activeRun.items.length}</strong></div>
          </div>
        )}
      </div>

      {exportError && (
        <div role="alert" className="rounded-md border border-rose/30 bg-rose-tint p-3 text-xs text-rose">
          {exportError}
        </div>
      )}

      {/* Export Cards Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Skeleton shape="card" />
          <Skeleton shape="card" />
          <Skeleton shape="card" />
        </div>
      ) : !activeRun ? (
        <div className="rounded-lg border border-line bg-surface p-8 text-center text-xs text-muted">
          No approved payroll runs available for export.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* 1. Master Payroll Excel */}
          <ExportCard
            title="Master Payroll Sheet"
            format="Excel (.xlsx)"
            icon={<FileSpreadsheet className="h-5 w-5 text-emerald-600" />}
            description="Complete itemised master payroll run containing all contractual earnings, allowances, deductions, net pay, and bank details."
            onDownload={() => {
              void handleExport('master', (run) => downloadMasterPayroll(run))
            }}
          />

          {/* 2. Bank Payment CSV */}
          <ExportCard
            title="Stanbic / Bank CSV"
            format="CSV Format"
            icon={<Building2 className="h-5 w-5 text-blue" />}
            description="Batch payment file for Stanbic, Centenary, and commercial bank electronic funds transfers (EFT)."
            onDownload={() => {
              void handleExport('bank', (run) =>
                downloadText(
                  bankPaymentCsv(run),
                  `Stanbic-Bank-Disbursement-${run.periodStart.slice(0, 7)}.csv`,
                ),
              )
            }}
          />

          {/* 3. MTN Bulk Pay CSV */}
          <ExportCard
            title="MTN Mobile Money"
            format="Bulk Pay CSV"
            icon={<PhoneCall className="h-5 w-5 text-amber" />}
            description="Format for MTN Mobile Money Corporate Bulk Pay system for direct wallet disbursements."
            onDownload={() => {
              void handleExport('mtn', (run) =>
                downloadText(
                  mtnBulkPayCsv(run),
                  `MTN-MoMo-Disbursement-${run.periodStart.slice(0, 7)}.csv`,
                ),
              )
            }}
          />

          {/* 4. NSSF Schedule CSV */}
          <ExportCard
            title="NSSF Contribution Schedule"
            format="NSSF Upload CSV"
            icon={<ShieldCheck className="h-5 w-5 text-emerald" />}
            description="Statutory 5% employee and 10% employer NSSF contribution schedule for National Social Security Fund portal upload."
            onDownload={() => {
              void handleExport('nssf', (run) =>
                downloadText(
                  nssfCsv(run),
                  `NSSF-Schedule-${run.periodStart.slice(0, 7)}.csv`,
                ),
              )
            }}
          />

          {/* 5. URA PAYE Return CSV */}
          <ExportCard
            title="URA PAYE Tax Return"
            format="URA Portal CSV"
            icon={<FileCheck className="h-5 w-5 text-rose" />}
            description="Monthly Pay As You Earn (PAYE) return filing schedule formatted for Uganda Revenue Authority (e-Tax)."
            onDownload={() => {
              void handleExport('paye', (run) =>
                downloadText(
                  payeCsv(run),
                  `URA-PAYE-Return-${run.periodStart.slice(0, 7)}.csv`,
                ),
              )
            }}
          />

          {/* 6. URA WHT Return CSV */}
          <ExportCard
            title="URA WHT Schedule"
            format="WHT Portal CSV"
            icon={<Receipt className="h-5 w-5 text-violet" />}
            description="Withholding tax (WHT) deduction schedule for contractor and consultant payments."
            onDownload={() => {
              void handleExport('wht', (run) =>
                downloadText(
                  whtCsv(run),
                  `URA-WHT-Schedule-${run.periodStart.slice(0, 7)}.csv`,
                ),
              )
            }}
          />
        </div>
      )}
    </div>
  )
}

function ExportCard({
  title,
  format,
  icon,
  description,
  onDownload,
}: {
  title: string
  format: string
  icon: React.ReactNode
  description: string
  onDownload: () => void
}) {
  return (
    <div className="flex flex-col justify-between rounded-xl border border-line bg-surface p-5 shadow-xs hover:border-emerald/40 transition-colors space-y-4">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-canvas border border-line">
            {icon}
          </div>
          <StatusPill tone="info" size="sm" withDot={false}>
            {format}
          </StatusPill>
        </div>

        <div>
          <h4 className="font-display text-sm font-bold text-ink">{title}</h4>
          <p className="font-body text-xs text-soft mt-1">{description}</p>
        </div>
      </div>

      <Button
        variant="outline"
        size="md"
        onClick={onDownload}
        className="w-full"
        leftIcon={<Download className="h-4 w-4" />}
      >
        Download Export File
      </Button>
    </div>
  )
}
