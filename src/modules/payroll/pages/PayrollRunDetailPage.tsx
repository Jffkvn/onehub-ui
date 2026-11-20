import { useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  CheckCircle2,
  Lock,
  Save,
  Search,
  FileSpreadsheet,
  Receipt,
  GitBranch,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  FileText,
  AlertCircle,
} from 'lucide-react'

import { PageHeader } from '@/components/patterns/PageHeader'
import { KpiCard } from '@/components/patterns/KpiCard'
import { StatusPill } from '@/components/ui/StatusPill'
import { Button } from '@/components/ui/Button'
import { Input, FormGroup } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { useHasPermission } from '@/modules/auth/AuthProvider'
import {
  PayrollRefreshError,
  usePayrollPayeStatus,
  usePayrollRun,
  useRefreshPayrollPaye,
  useReplacePayrollDraft,
} from '../api/payroll'
import { ApprovePayrollModal } from '../components/ApprovePayrollModal'
import { RecordPaymentModal } from '../components/RecordPaymentModal'
import { CreateAmendmentModal } from '../components/CreateAmendmentModal'
import { downloadPayslip } from '../exports/payslip'
import { downloadMasterPayroll } from '../exports/masterPayroll'
import type { PayrollDraftItem, PayrollItem, PayrollLineItem } from '@/_contract/types/payroll.types'

export function PayrollRunDetailPage() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const canPrepare = useHasPermission('payroll.prepare')
  const canApprove = useHasPermission('payroll.approve')
  const canExport = useHasPermission('payroll.export')
  const canRecordPayment = useHasPermission('payroll.record_payment')

  const {
    data: run,
    isLoading,
    isFetching = false,
    isError: isRunError = false,
    error: runError = null,
    refetch,
  } = usePayrollRun(id)
  const replaceMutation = useReplacePayrollDraft()
  const payeStatus = usePayrollPayeStatus(id, Boolean(run && run.runType !== 'historical'))
  const refreshPayeMutation = useRefreshPayrollPaye()
  const [payeReason, setPayeReason] = useState('')
  const [payeError, setPayeError] = useState<string | null>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [saveReason, setSaveReason] = useState('')
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null)

  // Draft local state map: itemId -> PayrollDraftItem
  const [draftState, setDraftState] = useState<Record<string, PayrollDraftItem>>({})
  const [deferredItemIds, setDeferredItemIds] = useState<string[]>([])
  const [isDirty, setIsDirty] = useState(false)
  const [isSavingDraft, setIsSavingDraft] = useState(false)
  const [refreshFailedError, setRefreshFailedError] = useState<string | null>(null)
  const saveInFlightRef = useRef(false)
  const draftVersionRef = useRef(0)

  // Modals
  const [approveModalOpen, setApproveModalOpen] = useState(false)
  const [paymentModalOpen, setPaymentModalOpen] = useState(false)
  const [amendmentModalOpen, setAmendmentModalOpen] = useState(false)

  // Initialize draft state from loaded run items
  const isDraft = run?.status === 'draft'
  const isDraftBusy = isSavingDraft || replaceMutation.isPending || refreshPayeMutation.isPending
  const payeApprovalBlocked = isDraft && run.runType !== 'historical' &&
    (payeStatus.isFetching || payeStatus.isError || payeStatus.data?.refreshRequired !== false)
  const payeDate = (value: string) =>
    new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(value))
  const isEditingLocked = isDraftBusy || Boolean(refreshFailedError)

  const activeItems = useMemo(() => {
    if (!run) return []
    return run.items.filter((item) => !deferredItemIds.includes(item.id))
  }, [run, deferredItemIds])

  // Calculate full run TOTALS (from all active items)
  const totals = useMemo(() => {
    if (!run) {
      return {
        contractualGross: 0,
        overtimePay: 0,
        allowances: 0,
        paye: 0,
        nssfEmployee: 0,
        nssfEmployer: 0,
        whtAndOther: 0,
        salaryAdvanceDeduction: 0,
        unpaidLeave: 0,
        totalDeductions: 0,
        netPay: 0,
      }
    }
    return activeItems.reduce(
      (acc, item) => {
        const unpaidLeaveLine = item.lineItems.find(
          (l) => l.kind === 'proration' && l.code === 'UNPAID_LEAVE',
        )
        return {
          contractualGross: acc.contractualGross + item.contractualGross,
          overtimePay: acc.overtimePay + item.overtimePay,
          allowances: acc.allowances + item.allowances,
          paye: acc.paye + item.paye,
          nssfEmployee: acc.nssfEmployee + item.nssfEmployee,
          nssfEmployer: acc.nssfEmployer + item.nssfEmployer,
          whtAndOther: acc.whtAndOther + (item.wht + item.otherDeductions),
          salaryAdvanceDeduction: acc.salaryAdvanceDeduction + item.salaryAdvanceDeduction,
          unpaidLeave: acc.unpaidLeave + (unpaidLeaveLine?.amount || 0),
          totalDeductions: acc.totalDeductions + item.totalDeductions,
          netPay: acc.netPay + item.netPay,
        }
      },
      {
        contractualGross: 0,
        overtimePay: 0,
        allowances: 0,
        paye: 0,
        nssfEmployee: 0,
        nssfEmployer: 0,
        whtAndOther: 0,
        salaryAdvanceDeduction: 0,
        unpaidLeave: 0,
        totalDeductions: 0,
        netPay: 0,
      },
    )
  }, [run, activeItems])

  // Filter displayed rows based on search query
  const displayedItems = useMemo(() => {
    if (!searchQuery.trim()) return activeItems
    const q = searchQuery.toLowerCase().trim()
    return activeItems.filter(
      (item) =>
        item.employeeName.toLowerCase().includes(q) ||
        item.employeeNumber.toLowerCase().includes(q),
    )
  }, [activeItems, searchQuery])

  // Handlers for draft editing
  const getDraftItem = (item: PayrollItem): PayrollDraftItem => {
    return (
      draftState[item.id] || {
        employeeId: item.employeeId,
        percentOfMonthWorked: item.percentOfMonthWorked,
        overtimeHours: item.overtimeHours,
        lineItems: item.lineItems,
      }
    )
  }

  const updateDraftItem = (itemId: string, patch: Partial<PayrollDraftItem>) => {
    if (saveInFlightRef.current || isEditingLocked) return
    const originalItem = run?.items.find((i) => i.id === itemId)
    if (!originalItem) return

    const currentDraft = getDraftItem(originalItem)
    const nextDraft = { ...currentDraft, ...patch }

    draftVersionRef.current += 1
    setDraftState((prev) => ({ ...prev, [itemId]: nextDraft }))
    setIsDirty(true)
  }

  const toggleDeferItem = (itemId: string) => {
    if (saveInFlightRef.current || isEditingLocked) return
    draftVersionRef.current += 1
    setDeferredItemIds((prev) =>
      prev.includes(itemId) ? prev.filter((i) => i !== itemId) : [...prev, itemId],
    )
    setIsDirty(true)
  }

  const addLineItem = (itemId: string, line: PayrollLineItem) => {
    if (saveInFlightRef.current || isEditingLocked) return
    const originalItem = run?.items.find((i) => i.id === itemId)
    if (!originalItem) return

    const currentDraft = getDraftItem(originalItem)
    const nextLines = [...currentDraft.lineItems, line]
    updateDraftItem(itemId, { lineItems: nextLines })
  }

  const removeLineItem = (itemId: string, index: number) => {
    if (saveInFlightRef.current || isEditingLocked) return
    const originalItem = run?.items.find((i) => i.id === itemId)
    if (!originalItem) return

    const currentDraft = getDraftItem(originalItem)
    const target = currentDraft.lineItems[index]
    if (target?.code.trim().toUpperCase() === 'STAFF_ADVANCE') return
    const nextLines = currentDraft.lineItems.filter((_, idx) => idx !== index)
    updateDraftItem(itemId, { lineItems: nextLines })
  }

  const handleSaveDraft = async () => {
    if (
      saveInFlightRef.current ||
      isEditingLocked ||
      !run ||
      !isDirty ||
      saveReason.trim().length < 3
    ) {
      return
    }

    const saveVersion = draftVersionRef.current
    const itemsToSave: PayrollDraftItem[] = activeItems.map((item) => getDraftItem(item))

    saveInFlightRef.current = true
    setIsSavingDraft(true)
    setRefreshFailedError(null)

    try {
      await replaceMutation.mutateAsync({
        id: run.id,
        items: itemsToSave,
        reason: saveReason.trim(),
      })

      if (draftVersionRef.current === saveVersion) {
        setDraftState({})
        setDeferredItemIds([])
        setIsDirty(false)
        setSaveReason('')
      }
    } catch (error) {
      if (
        error instanceof PayrollRefreshError ||
        (error instanceof Error && error.name === 'PayrollRefreshError')
      ) {
        setRefreshFailedError(
          error.message || 'Unable to refresh updated payroll run from the server.',
        )
      }
      // Save failures stay visible via replaceMutation.isError while preserving local edits.
    } finally {
      saveInFlightRef.current = false
      setIsSavingDraft(false)
    }
  }

  const handleRefreshPaye = async () => {
    if (!run || !isDraft || !canPrepare || !payeStatus.data?.refreshRequired ||
      isDirty || isEditingLocked || saveInFlightRef.current || payeReason.trim().length < 3) {
      return
    }
    saveInFlightRef.current = true
    setPayeError(null)

    try {
      await refreshPayeMutation.mutateAsync({ id: run.id, reason: payeReason.trim() })
      setPayeReason('')
    } catch (error) {
      if (error instanceof PayrollRefreshError) {
        setRefreshFailedError(error.message)
      } else {
        setPayeError(
          error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
            ? error.message
            : 'PAYE could not be refreshed. Check the draft and try again.',
        )
      }
    } finally {
      saveInFlightRef.current = false
    }
  }

  const handleRetryRefresh = async () => {
    if (!refetch) return
    const [res, tax] = await Promise.all([
      refetch(),
      run && run.runType !== 'historical' ? payeStatus.refetch() : Promise.resolve(null),
    ])
    if (!res.isError && res.data && (!tax || (!tax.isError && tax.data))) {
      setDraftState({})
      setDeferredItemIds([])
      setIsDirty(false)
      setSaveReason('')
      setRefreshFailedError(null)
      replaceMutation.reset?.()
    } else {
      const error = res.error ?? tax?.error
      setRefreshFailedError(error instanceof Error ? error.message : 'Unable to reload payroll and PAYE status.')
    }
  }

  if (isLoading || !run) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton shape="kpi" className="w-64" />
        <Skeleton shape="card" className="h-64" />
        <Skeleton shape="row" />
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-24">
      {/* Top Header & Navigation Back Button */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => { void navigate('/finance/payroll') }}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to Runs
        </Button>
      </div>

      <PageHeader
        title={`${run.periodLabel} Payroll Run`}
        subtitle={`${run.runType.toUpperCase()} RUN #${run.runNumber} · ID: ${run.id}`}
        actions={
          <div className="flex items-center gap-3">
            <StatusPill tone={run.status === 'approved' ? 'success' : 'warning'} size="md">
              {run.status === 'approved' ? 'Approved & Locked' : 'Draft In Prep'}
            </StatusPill>
          </div>
        }
      />

      {isDraft && payeStatus.isError && (
        <div role="alert" className="rounded-lg border border-amber/40 bg-amber/10 p-4 text-sm">
          <p>Unable to verify the PAYE schedule. Retry before approving this draft.</p>
          <Button className="mt-3" variant="outline" size="sm" onClick={() => void payeStatus.refetch()}>
            Retry PAYE check
          </Button>
        </div>
      )}
      {isDraft && payeStatus.data?.refreshRequired ? (
        <section className="rounded-lg border border-amber/40 bg-amber/10 p-4 text-sm">
          <h2 className="font-semibold text-ink">PAYE refresh required</h2>
          <p className="mt-1 text-soft">
            Apply the resident schedule effective {payeStatus.data.effectiveFrom ? payeDate(payeStatus.data.effectiveFrom) : 'the applicable date'} before approval.
            Refresh recalculates PAYE and net pay from the saved draft.
          </p>
          {canPrepare ? (
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="w-full max-w-sm">
                <span className="mb-1 block font-medium">Refresh reason</span>
                <Input aria-label="PAYE refresh reason" value={payeReason} maxLength={1000}
                  disabled={isEditingLocked || isDirty} onChange={(event) => setPayeReason(event.target.value)} />
              </label>
              <Button
                disabled={isEditingLocked || isDirty || payeReason.trim().length < 3}
                loading={refreshPayeMutation.isPending}
                onClick={() => void handleRefreshPaye()}
              >
                Refresh PAYE
              </Button>
            </div>
          ) : (
            <p className="mt-2 text-soft">A payroll preparer can refresh this draft.</p>
          )}
          {isDirty && <p className="mt-2 text-soft">Save your draft edits before refreshing PAYE.</p>}
          {payeError && <p role="alert" className="mt-2 text-rose">{payeError}</p>}
        </section>
      ) : payeStatus.data?.appliedEffectiveFrom && (
        <p className="rounded-lg border border-line bg-surface p-3 text-sm text-soft">
          Resident PAYE schedule · Applied since {payeDate(payeStatus.data.appliedEffectiveFrom)}
        </p>
      )}

      {/* Lock Notice for Approved Runs */}
      {run.status === 'approved' && (
        <div className="flex items-center gap-3 rounded-lg border border-emerald/30 bg-emerald-tint p-4 text-xs text-ink">
          <CheckCircle2 className="h-5 w-5 text-emerald shrink-0" />
          <div>
            <p className="font-semibold text-emerald-600">Approved and locked</p>
            <p className="text-soft">
              Approved on {run.approvedAt?.slice(0, 10)}. Statutory export files (Master Excel, Bank CSV, NSSF, PAYE, WHT) and employee Payslip PDFs are unlocked.
            </p>
          </div>
        </div>
      )}

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<FileText className="h-5 w-5" />}
          tone="emerald"
          title="Total Gross Salary"
          value={`UGX ${totals.contractualGross.toLocaleString()}`}
          subline="Contractual base gross"
        />
        <KpiCard
          icon={<FileText className="h-5 w-5" />}
          tone="rose"
          title="Total Deductions"
          value={`UGX ${totals.totalDeductions.toLocaleString()}`}
          subline="PAYE + NSSF + Advances + WHT"
        />
        <KpiCard
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="blue"
          title="Total Net Payable"
          value={`UGX ${totals.netPay.toLocaleString()}`}
          subline="Direct disbursement"
        />
        <KpiCard
          icon={<FileText className="h-5 w-5" />}
          tone="amber"
          title="Active Employees"
          value={activeItems.length}
          subline={deferredItemIds.length > 0 ? `${deferredItemIds.length} deferred` : 'Full active headcount'}
        />
      </div>

      {/* Employer NSSF Banner */}
      <div className="rounded-lg border border-blue-tint bg-blue-tint/50 p-4 text-xs text-ink flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="font-bold text-blue">Employer NSSF Banner</span>
          <p className="text-soft mt-0.5">
            Employer NSSF cost: <strong className="font-mono text-ink whitespace-nowrap tabular-nums">UGX {totals.nssfEmployer.toLocaleString()}</strong> — company contribution on top of salaries.
          </p>
        </div>
        <div className="text-right">
          <p className="text-muted font-medium">Total NSSF to Remit (15%)</p>
          <p className="font-mono text-sm font-bold text-ink whitespace-nowrap tabular-nums">
            UGX {(totals.nssfEmployee + totals.nssfEmployer).toLocaleString()}
          </p>
        </div>
      </div>

      {/* Table Controls: Search */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="text"
            placeholder="Search employee name or number..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 w-full rounded-md border border-line bg-surface pl-9 pr-3 text-xs text-ink placeholder:text-muted focus:border-emerald focus:outline-none"
          />
        </div>

        <span className="text-xs text-soft font-mono">
          Showing {displayedItems.length} of {activeItems.length} employees
        </span>
      </div>

      {/* Dense Payroll Table (12 Columns in Order) */}
      <div className="w-full overflow-x-auto rounded-lg border border-line bg-surface shadow-xs">
        <table className="w-full text-left text-xs border-collapse">
          <thead className="sticky top-0 z-10 bg-canvas/90 font-body font-semibold uppercase tracking-wider text-muted border-b border-line backdrop-blur-xs">
            <tr>
              <th className="px-3 py-3">Employee</th>
              <th className="px-3 py-3 text-right">Gross Salary</th>
              <th className="px-3 py-3 text-right">Overtime</th>
              <th className="px-3 py-3 text-right">Allowances</th>
              <th className="px-3 py-3 text-right">PAYE (URA)</th>
              <th className="px-3 py-3 text-right">NSSF (Emp)</th>
              <th className="px-3 py-3 text-right">WHT / Other</th>
              <th className="px-3 py-3 text-right">Advance</th>
              <th className="px-3 py-3 text-right">Unpaid Leave</th>
              <th className="px-3 py-3 text-right">Total Deductions</th>
              <th className="px-3 py-3 text-right font-bold text-ink">Net Pay</th>
              <th className="px-3 py-3 text-right">Action</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-line font-body text-ink">
            {displayedItems.map((item) => {
              const draft = getDraftItem(item)
              const isExpanded = expandedItemId === item.id
              const unpaidLeaveLine = item.lineItems.find(
                (l) => l.kind === 'proration' && l.code === 'UNPAID_LEAVE',
              )

              return (
                <FragmentWrapper key={item.id}>
                  <tr className="hover:bg-line/20 transition-colors">
                    {/* 1. Employee */}
                    <td className="px-3 py-2.5 font-medium">
                      <p className="font-semibold text-ink">{item.employeeName}</p>
                      <p className="font-mono text-[10px] text-muted">{item.employeeNumber}</p>
                    </td>

                    {/* 2. Gross Salary */}
                    <td className="px-3 py-2.5 text-right tabular-nums font-mono">
                      {item.contractualGross.toLocaleString()}
                    </td>

                    {/* 3. Overtime */}
                    <td className="px-3 py-2.5 text-right tabular-nums font-mono">
                      {item.overtimePay > 0 ? item.overtimePay.toLocaleString() : '—'}
                    </td>

                    {/* 4. Allowances */}
                    <td className="px-3 py-2.5 text-right tabular-nums font-mono">
                      {item.allowances > 0 ? item.allowances.toLocaleString() : '—'}
                    </td>

                    {/* 5. PAYE */}
                    <td className="px-3 py-2.5 text-right tabular-nums font-mono text-rose">
                      {item.paye > 0 ? item.paye.toLocaleString() : '—'}
                    </td>

                    {/* 6. NSSF Emp */}
                    <td className="px-3 py-2.5 text-right tabular-nums font-mono text-soft">
                      {item.nssfEmployee > 0 ? item.nssfEmployee.toLocaleString() : '—'}
                    </td>

                    {/* 7. WHT / Other */}
                    <td className="px-3 py-2.5 text-right tabular-nums font-mono text-soft">
                      {item.wht + item.otherDeductions > 0
                        ? (item.wht + item.otherDeductions).toLocaleString()
                        : '—'}
                    </td>

                    {/* 8. Advance */}
                    <td className="px-3 py-2.5 text-right tabular-nums font-mono text-amber">
                      {item.salaryAdvanceDeduction > 0
                        ? item.salaryAdvanceDeduction.toLocaleString()
                        : '—'}
                    </td>

                    {/* 9. Unpaid Leave */}
                    <td className="px-3 py-2.5 text-right tabular-nums font-mono text-soft">
                      {unpaidLeaveLine ? unpaidLeaveLine.amount.toLocaleString() : '—'}
                    </td>

                    {/* 10. Total Deductions */}
                    <td className="px-3 py-2.5 text-right tabular-nums font-mono font-semibold text-rose">
                      {item.totalDeductions.toLocaleString()}
                    </td>

                    {/* 11. Net Pay */}
                    <td className="px-3 py-2.5 text-right tabular-nums font-mono font-bold text-emerald-600 text-sm">
                      {item.netPay.toLocaleString()}
                    </td>

                    {/* 12. Action */}
                    <td className="px-3 py-2.5 text-right">
                      {isDraft && canPrepare ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setExpandedItemId(isExpanded ? null : item.id)}
                        >
                          {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          Edit
                        </Button>
                      ) : run.status === 'approved' && canExport ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            void downloadPayslip(run, item)
                          }}
                          leftIcon={<FileText className="h-3.5 w-3.5" />}
                        >
                          PDF
                        </Button>
                      ) : null}
                    </td>
                  </tr>

                  {/* Draft Inline Row Editing Drawer */}
                  {isDraft && isExpanded && (
                    <tr className="bg-canvas/80 border-b-2 border-emerald/20">
                      <td colSpan={12} className="p-4 space-y-4">
                        <div className="flex items-center justify-between border-b border-line pb-2">
                          <span className="font-display text-xs font-bold text-ink">
                            Edit Line Items &amp; Adjustments for {item.employeeName}
                          </span>
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={isEditingLocked}
                            onClick={() => toggleDeferItem(item.id)}
                          >
                            Defer from run
                          </Button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <FormGroup label="% Month Worked">
                            <Input
                              type="number"
                              min={0}
                              max={100}
                              disabled={isEditingLocked}
                              value={draft.percentOfMonthWorked}
                              onChange={(e) =>
                                updateDraftItem(item.id, {
                                  percentOfMonthWorked: Number(e.target.value),
                                })
                              }
                            />
                          </FormGroup>

                          <FormGroup label="Overtime Hours">
                            <Input
                              type="number"
                              min={0}
                              disabled={isEditingLocked}
                              value={draft.overtimeHours}
                              onChange={(e) =>
                                updateDraftItem(item.id, {
                                  overtimeHours: Number(e.target.value),
                                })
                              }
                            />
                          </FormGroup>
                        </div>

                        {/* Add Line Item Controls */}
                        <div className="space-y-2 pt-2">
                          <p className="text-xs font-semibold text-soft">Custom Line Items</p>
                          <div className="space-y-1.5">
                            {draft.lineItems.map((line, idx) => {
                              const isAutoStaffAdvance =
                                line.code.trim().toUpperCase() === 'STAFF_ADVANCE'
                              return (
                                <div
                                  key={`${line.kind}-${line.code}-${idx}`}
                                  className="flex items-center justify-between rounded bg-surface p-2 text-xs border border-line"
                                >
                                  <div>
                                    <span className="font-mono text-[10px] uppercase font-bold text-muted mr-2">
                                      {line.kind} ({line.code})
                                    </span>
                                    <span className="text-ink">{line.description}</span>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <span className="font-mono font-bold text-ink whitespace-nowrap tabular-nums">
                                      UGX {line.amount.toLocaleString()}
                                    </span>
                                    {isAutoStaffAdvance ? (
                                      <span className="rounded bg-line/60 px-2 py-0.5 text-[11px] font-medium text-muted">
                                        Auto-calculated
                                      </span>
                                    ) : (
                                      <button
                                        type="button"
                                        disabled={isEditingLocked}
                                        aria-label={`Remove ${line.description}`}
                                        onClick={() => removeLineItem(item.id, idx)}
                                        className="text-rose hover:bg-rose-tint p-1 rounded disabled:pointer-events-none disabled:opacity-50"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>

                          <AddLineItemForm
                            disabled={isEditingLocked}
                            onAdd={(line) => addLineItem(item.id, line)}
                          />
                        </div>
                      </td>
                    </tr>
                  )}
                </FragmentWrapper>
              )
            })}
          </tbody>

          {/* TOTALS Footer (Summed from FULL Run, NOT Search Filtered) */}
          <tfoot className="border-t-2 border-line bg-canvas font-body font-bold text-ink">
            <tr>
              <td className="px-3 py-3">TOTALS ({activeItems.length} staff)</td>
              <td className="px-3 py-3 text-right font-mono tabular-nums">
                {totals.contractualGross.toLocaleString()}
              </td>
              <td className="px-3 py-3 text-right font-mono tabular-nums">
                {totals.overtimePay.toLocaleString()}
              </td>
              <td className="px-3 py-3 text-right font-mono tabular-nums">
                {totals.allowances.toLocaleString()}
              </td>
              <td className="px-3 py-3 text-right font-mono tabular-nums text-rose">
                {totals.paye.toLocaleString()}
              </td>
              <td className="px-3 py-3 text-right font-mono tabular-nums">
                {totals.nssfEmployee.toLocaleString()}
              </td>
              <td className="px-3 py-3 text-right font-mono tabular-nums">
                {totals.whtAndOther.toLocaleString()}
              </td>
              <td className="px-3 py-3 text-right font-mono tabular-nums text-amber">
                {totals.salaryAdvanceDeduction.toLocaleString()}
              </td>
              <td className="px-3 py-3 text-right font-mono tabular-nums">
                {totals.unpaidLeave.toLocaleString()}
              </td>
              <td className="px-3 py-3 text-right font-mono tabular-nums text-rose">
                {totals.totalDeductions.toLocaleString()}
              </td>
              <td className="px-3 py-3 text-right font-mono tabular-nums text-emerald-600 text-sm">
                {totals.netPay.toLocaleString()}
              </td>
              <td className="px-3 py-3"></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Draft Save / Refresh Error */}
      {refreshFailedError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber/40 bg-amber-tint/70 p-3 text-xs text-ink"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-amber" />
            <span>
              Draft changes were saved on the server, but refreshing the recalculated run failed (
              {refreshFailedError}). Retry refresh before making further edits or approving.
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={isFetching || payeStatus.isFetching}
            onClick={() => void handleRetryRefresh()}
          >
            Retry Refresh
          </Button>
        </div>
      ) : replaceMutation.isError ? (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md border border-rose/30 bg-rose-tint p-3 text-xs text-rose"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>
            {replaceMutation.error instanceof Error
              ? replaceMutation.error.message
              : 'Draft changes could not be saved. Review inputs and try again.'}
          </span>
        </div>
      ) : isRunError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-rose/30 bg-rose-tint p-3 text-xs text-rose"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>
              {runError instanceof Error
                ? runError.message
                : 'Unable to refresh latest payroll run data from the server.'}
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={isFetching}
            onClick={() => void refetch?.()}
          >
            Retry Refresh
          </Button>
        </div>
      ) : null}

      {/* Sticky Action Footer */}
      <div className="fixed bottom-0 left-0 right-0 z-topbar border-t border-line bg-surface/95 p-4 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {isDraft && canPrepare && (
              <Input
                placeholder="Reason for changes (min 3 chars)..."
                disabled={isEditingLocked}
                value={saveReason}
                onChange={(e) => setSaveReason(e.target.value)}
                className="w-72 h-9 text-xs"
              />
            )}
          </div>

          <div className="flex items-center gap-3">
            {isDraft && canPrepare && (
              <Button
                variant="secondary"
                size="md"
                disabled={isEditingLocked || !isDirty || saveReason.trim().length < 3}
                loading={isDraftBusy}
                onClick={() => void handleSaveDraft()}
                leftIcon={<Save className="h-4 w-4" />}
              >
                Save Draft
              </Button>
            )}

            {isDraft && canApprove && (
              <Button
                variant="primary"
                size="md"
                disabled={isDirty || isEditingLocked || isFetching || isRunError || payeApprovalBlocked}
                onClick={() => {
                  if (isDirty || isEditingLocked || isFetching || isRunError || payeApprovalBlocked) return
                  setApproveModalOpen(true)
                }}
                leftIcon={<Lock className="h-4 w-4" />}
              >
                Approve Payroll Run
              </Button>
            )}

            {run.status === 'approved' && canExport && (
              <Button
                variant="secondary"
                size="md"
                onClick={() => void downloadMasterPayroll(run)}
                leftIcon={<FileSpreadsheet className="h-4 w-4" />}
              >
                Export Master Excel
              </Button>
            )}

            {run.status === 'approved' && canRecordPayment && (
              <Button
                variant="primary"
                size="md"
                onClick={() => setPaymentModalOpen(true)}
                leftIcon={<Receipt className="h-4 w-4" />}
              >
                {run.payment ? 'Update Payment Record' : 'Record Payment'}
              </Button>
            )}

            {run.status === 'approved' && canPrepare && (
              <Button
                variant="outline"
                size="md"
                onClick={() => setAmendmentModalOpen(true)}
                leftIcon={<GitBranch className="h-4 w-4" />}
              >
                Create Amendment Run
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      <ApprovePayrollModal
        run={run}
        open={approveModalOpen}
        onOpenChange={setApproveModalOpen}
      />

      <RecordPaymentModal
        run={run}
        open={paymentModalOpen}
        onOpenChange={setPaymentModalOpen}
      />

      <CreateAmendmentModal
        sourceRun={run}
        open={amendmentModalOpen}
        onOpenChange={setAmendmentModalOpen}
        onCreated={(newRunId) => {
          void navigate(`/finance/payroll/${newRunId}`)
        }}
      />
    </div>
  )
}

function FragmentWrapper({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

function AddLineItemForm({
  onAdd,
  disabled = false,
}: {
  onAdd: (line: PayrollLineItem) => void
  disabled?: boolean
}) {
  const [kind, setKind] = useState<PayrollLineItem['kind']>('allowance')
  const [code, setCode] = useState('BONUS')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')

  const handleAdd = () => {
    if (disabled || !description || !amount || Number(amount) <= 0) return
    onAdd({
      kind,
      code,
      description,
      amount: Number(amount),
    })
    setDescription('')
    setAmount('')
  }

  return (
    <div className="flex items-center gap-2 pt-2">
      <select
        disabled={disabled}
        value={kind}
        onChange={(e) => setKind(e.target.value as PayrollLineItem['kind'])}
        className="h-8 rounded border border-line bg-surface text-xs px-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <option value="allowance">Allowance</option>
        <option value="deduction">Deduction</option>
        <option value="salary_advance">Advance</option>
      </select>
      <input
        type="text"
        disabled={disabled}
        placeholder="Code (e.g. BONUS)"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        className="h-8 w-24 rounded border border-line bg-surface text-xs px-2 uppercase font-mono disabled:cursor-not-allowed disabled:opacity-50"
      />
      <input
        type="text"
        disabled={disabled}
        placeholder="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="h-8 flex-1 rounded border border-line bg-surface text-xs px-2 disabled:cursor-not-allowed disabled:opacity-50"
      />
      <input
        type="number"
        disabled={disabled}
        placeholder="Amount UGX"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="h-8 w-28 rounded border border-line bg-surface text-xs px-2 font-mono disabled:cursor-not-allowed disabled:opacity-50"
      />
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={handleAdd}
        leftIcon={<Plus className="h-3 w-3" />}
      >
        Add Line
      </Button>
    </div>
  )
}
