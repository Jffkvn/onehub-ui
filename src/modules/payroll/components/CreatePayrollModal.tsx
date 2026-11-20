import { useEffect, useMemo, useState } from 'react'
import { Search, Banknote } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Input, FormGroup } from '@/components/ui/Input'
import { Checkbox } from '@/components/ui/Toggles'
import { StatusPill } from '@/components/ui/StatusPill'
import { useEligibleEmployees, useCreatePayrollDraft } from '../api/payroll'
import type { PayrollDraftItem } from '@/_contract/types/payroll.types'

export interface CreatePayrollModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (runId: string) => void
}

export function CreatePayrollModal({
  open,
  onOpenChange,
  onCreated,
}: CreatePayrollModalProps) {
  // Default to current year-month YYYY-MM-01
  const today = new Date()
  const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`
  const [periodStart, setPeriodStart] = useState(defaultMonth)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [initialized, setInitialized] = useState(false)

  const { data: employees = [], isLoading } = useEligibleEmployees()
  const createMutation = useCreatePayrollDraft()

  // Initialize selected IDs to all employees on first load
  useEffect(() => {
    if (!initialized && employees.length > 0) {
      setSelectedIds(employees.map((e) => e.id))
      setInitialized(true)
    }
  }, [initialized, employees])

  // Filter employees based on search query
  const filteredEmployees = useMemo(() => {
    if (!searchQuery.trim()) return employees
    const q = searchQuery.toLowerCase().trim()
    return employees.filter(
      (e) =>
        e.employeeName.toLowerCase().includes(q) ||
        e.employeeNumber.toLowerCase().includes(q),
    )
  }, [employees, searchQuery])

  // Group employees by departmentName (alphabetical)
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

  const handleSubmit = async () => {
    if (selectedIds.length === 0) return

    const items: PayrollDraftItem[] = employees
      .filter((e) => selectedIds.includes(e.id))
      .map((e) => ({
        employeeId: e.id,
        percentOfMonthWorked: e.defaultPercentWorked,
        overtimeHours: 0,
        lineItems: [],
      }))

    try {
      const runId = await createMutation.mutateAsync({
        periodStart,
        items,
      })
      onOpenChange(false)
      onCreated?.(runId)
    } catch {
      // Error handled by query state
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <div className="space-y-5 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600">
              New Payroll Run
            </span>
            <StatusPill tone="info" size="sm">
              Regular Run
            </StatusPill>
          </div>
          <h2 className="font-display text-lg font-bold text-ink">Initialize Monthly Payroll</h2>
          <p className="font-body text-xs text-soft">
            Imports active employees at their contractual salary rates and current period settings.
          </p>
        </div>

        {/* Period Selector */}
        <FormGroup label="Payroll Period Start Date">
          <Input
            type="date"
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
            className="w-full"
          />
        </FormGroup>

        {/* Search & Selection Controls */}
        <div className="flex items-center justify-between gap-3 pt-1 border-t border-line">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <input
              type="text"
              placeholder="Search by name or EMP number..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 w-full rounded-md border border-line bg-canvas pl-8 pr-3 text-xs text-ink placeholder:text-muted focus:border-emerald focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <Button variant="ghost" size="sm" onClick={toggleSelectAll} className="text-xs">
              {selectedIds.length === employees.length ? 'Deselect All' : 'Select All'}
            </Button>

            <span className="font-mono text-xs font-semibold text-emerald-600 bg-emerald-tint px-2.5 py-1 rounded">
              {selectedIds.length} of {employees.length} selected
            </span>
          </div>
        </div>

        {/* Employee List Grouped by Department */}
        <div className="flex-1 overflow-y-auto min-h-[220px] max-h-[320px] rounded-lg border border-line bg-canvas p-3 space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center p-8 text-xs text-muted">
              Loading active employees…
            </div>
          ) : groupedDepartments.length === 0 ? (
            <div className="flex items-center justify-center p-8 text-xs text-muted">
              No matching employees found.
            </div>
          ) : (
            groupedDepartments.map((dept) => {
              const deptEmpIds = dept.items.map((i) => i.id)
              const isDeptAllSelected = deptEmpIds.every((id) => selectedIds.includes(id))

              return (
                <div key={dept.name} className="space-y-1.5">
                  <div className="flex items-center justify-between border-b border-line pb-1 px-1">
                    <span className="font-display text-xs font-bold uppercase tracking-wider text-muted">
                      {dept.name} ({dept.items.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleDept(deptEmpIds)}
                      className="text-[11px] font-semibold text-emerald-600 hover:underline"
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
                              ? 'border-emerald/40 bg-surface shadow-xs'
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
                          <span className="font-mono text-[11px] text-soft">
                            {emp.defaultPercentWorked}%
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })
          )}
        </div>

        {createMutation.isError && (
          <div role="alert" className="rounded-md bg-rose-tint p-3 text-xs text-rose">
            {createMutation.error instanceof Error
              ? createMutation.error.message
              : 'Unable to create payroll draft. Please check selected period and staff.'}
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-line">
          <Button variant="outline" size="md" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            loading={createMutation.isPending}
            disabled={selectedIds.length === 0}
            onClick={() => void handleSubmit()}
            leftIcon={<Banknote className="h-4 w-4" />}
          >
            Create Draft Run ({selectedIds.length})
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
