import { useEffect, useMemo, useState } from 'react'
import { Search, GitBranch } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { FormGroup, Textarea } from '@/components/ui/Input'
import { RadioGroup, Checkbox } from '@/components/ui/Toggles'
import { StatusPill } from '@/components/ui/StatusPill'
import { useEligibleEmployees, useCreatePayrollAmendment } from '../api/payroll'
import { buildAmendmentDraftItems } from '../exports/amendmentDraft'
import type { PayrollRun } from '@/_contract/types/payroll.types'

export interface CreateAmendmentModalProps {
  sourceRun: PayrollRun
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (runId: string) => void
}

export function CreateAmendmentModal({
  sourceRun,
  open,
  onOpenChange,
  onCreated,
}: CreateAmendmentModalProps) {
  const [runType, setRunType] = useState<'supplemental' | 'correction'>('supplemental')
  const [reason, setReason] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [initialized, setInitialized] = useState(false)

  const { data: employees = [], isLoading } = useEligibleEmployees()
  const amendMutation = useCreatePayrollAmendment()

  useEffect(() => {
    if (!initialized && employees.length > 0) {
      setSelectedIds(employees.map((e) => e.id))
      setInitialized(true)
    }
  }, [initialized, employees])

  const filteredEmployees = useMemo(() => {
    if (!searchQuery.trim()) return employees
    const q = searchQuery.toLowerCase().trim()
    return employees.filter(
      (e) =>
        e.employeeName.toLowerCase().includes(q) ||
        e.employeeNumber.toLowerCase().includes(q),
    )
  }, [employees, searchQuery])

  const groupedDepartments = useMemo(() => {
    const map = new Map<string, typeof employees>()
    for (const emp of filteredEmployees) {
      const dept = emp.departmentName?.trim() || 'Unassigned'
      const list = map.get(dept) || []
      list.push(emp)
      map.set(dept, list)
    }

    const sortedDeptNames = Array.from(map.keys()).sort((a, b) => {
      if (a === 'Unassigned') return 1
      if (b === 'Unassigned') return -1
      return a.localeCompare(b)
    })

    return sortedDeptNames.map((deptName) => ({
      name: deptName,
      items: map.get(deptName) || [],
    }))
  }, [filteredEmployees])

  const toggleSelectAll = () => {
    if (selectedIds.length === employees.length) {
      setSelectedIds([])
    } else {
      setSelectedIds(employees.map((e) => e.id))
    }
  }

  const toggleDept = (deptEmpIds: string[]) => {
    const allSelected = deptEmpIds.every((id) => selectedIds.includes(id))
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !deptEmpIds.includes(id)))
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...deptEmpIds])))
    }
  }

  const toggleEmployee = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    )
  }

  const isValid = reason.trim().length >= 3 && selectedIds.length > 0

  const handleSubmit = async () => {
    if (!isValid) return

    const items = buildAmendmentDraftItems(employees, selectedIds, runType)

    try {
      const newRunId = await amendMutation.mutateAsync({
        id: sourceRun.id,
        type: runType,
        reason: reason.trim(),
        items,
      })
      onOpenChange(false)
      onCreated?.(newRunId)
    } catch {
      // Handled by mutation state
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <div className="space-y-5 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-violet">
              Payroll Amendment
            </span>
            <StatusPill tone="violet" size="sm">
              Source Run #{sourceRun.runNumber}
            </StatusPill>
          </div>
          <h2 className="font-display text-lg font-bold text-ink">
            Create Linked Amendment Run
          </h2>
          <p className="font-body text-xs text-soft">
            Linked to approved {sourceRun.periodLabel} run.
          </p>
        </div>

        {/* Amendment Type Selector & Description */}
        <div className="space-y-2 rounded-lg border border-line bg-canvas p-3">
          <p className="text-xs font-semibold text-ink">Amendment Type</p>
          <RadioGroup
            value={runType}
            onValueChange={(val) => setRunType(val as 'supplemental' | 'correction')}
            options={[
              { value: 'supplemental', label: 'Supplemental Run (Additional earnings or missed staff)' },
              { value: 'correction', label: 'Correction Run (Adjustments starting at 0% to prevent duplication)' },
            ]}
          />
          <p className="text-[11px] text-muted italic pt-1">
            {runType === 'supplemental'
              ? 'Supplemental runs import default contractual salaries for selected employees.'
              : 'Correction runs set % worked to 0% by default so you can add targeted adjustments.'}
          </p>
        </div>

        {/* Reason Input */}
        <FormGroup
          label="Reason for Amendment"
          hint="Minimum 3 characters required"
          error={reason.length > 0 && reason.trim().length < 3 ? 'Reason must be at least 3 characters.' : undefined}
        >
          <Textarea
            placeholder="e.g. Late submission of overtime hours for field site technicians."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="min-h-[60px]"
          />
        </FormGroup>

        {/* Employee Picker Search & Controls */}
        <div className="flex items-center justify-between gap-3 pt-1 border-t border-line">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <input
              type="text"
              placeholder="Search employee name or number..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 w-full rounded-md border border-line bg-canvas pl-8 pr-3 text-xs text-ink placeholder:text-muted focus:border-emerald focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <Button variant="ghost" size="sm" onClick={toggleSelectAll} className="text-xs">
              {selectedIds.length === employees.length ? 'Deselect All' : 'Select All'}
            </Button>
            <span className="font-mono text-xs font-semibold text-violet bg-violet-tint px-2.5 py-1 rounded">
              {selectedIds.length} selected
            </span>
          </div>
        </div>

        {/* Department Grouped Employee Selection */}
        <div className="flex-1 overflow-y-auto min-h-[180px] max-h-[260px] rounded-lg border border-line bg-canvas p-3 space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center p-6 text-xs text-muted">
              Loading active employees…
            </div>
          ) : (
            groupedDepartments.map((dept) => {
              const deptEmpIds = dept.items.map((i) => i.id)
              const isDeptAllSelected = deptEmpIds.every((id) => selectedIds.includes(id))

              return (
                <div key={dept.name} className="space-y-1">
                  <div className="flex items-center justify-between border-b border-line pb-1 px-1">
                    <span className="font-display text-[11px] font-bold uppercase tracking-wider text-muted">
                      {dept.name} ({dept.items.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleDept(deptEmpIds)}
                      className="text-[11px] font-semibold text-violet hover:underline"
                    >
                      {isDeptAllSelected ? 'Deselect dept' : 'Select dept'}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
                    {dept.items.map((emp) => {
                      const isChecked = selectedIds.includes(emp.id)
                      return (
                        <div
                          key={emp.id}
                          onClick={() => toggleEmployee(emp.id)}
                          className={`flex items-center justify-between rounded-md border p-2 text-xs transition-colors cursor-pointer select-none ${
                            isChecked
                              ? 'border-violet/40 bg-surface shadow-xs'
                              : 'border-line/60 bg-canvas/40 opacity-70'
                          }`}
                        >
                          <div className="flex items-center gap-2 overflow-hidden">
                            <Checkbox
                              checked={isChecked}
                              onCheckedChange={() => toggleEmployee(emp.id)}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <div className="truncate">
                              <p className="font-semibold text-ink truncate">{emp.employeeName}</p>
                              <p className="font-mono text-[10px] text-muted">{emp.employeeNumber}</p>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })
          )}
        </div>

        {amendMutation.isError && (
          <div role="alert" className="rounded-md bg-rose-tint p-3 text-xs text-rose">
            {amendMutation.error instanceof Error
              ? amendMutation.error.message
              : 'Unable to create payroll amendment run. Please try again.'}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-line">
          <Button variant="outline" size="md" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            disabled={!isValid}
            loading={amendMutation.isPending}
            onClick={() => void handleSubmit()}
            leftIcon={<GitBranch className="h-4 w-4" />}
          >
            Create {runType === 'supplemental' ? 'Supplemental' : 'Correction'} Run ({selectedIds.length})
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
