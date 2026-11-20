import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  Archive,
  CalendarClock,
  Clock,
  Eye,
  FileSpreadsheet,
  MoreHorizontal,
  Pencil,
  Search,
  Settings2,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react'

import { PageHeader } from '@/components/patterns/PageHeader'
import { KpiCard } from '@/components/patterns/KpiCard'
import { DataTable, type ColumnDef } from '@/components/patterns/DataTable'
import { EmptyState } from '@/components/patterns/EmptyState'
import { Button } from '@/components/ui/Button'
import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/DropdownMenu'
import { Select } from '@/components/ui/Select'
import { Skeleton } from '@/components/ui/Skeleton'
import { StatusPill } from '@/components/ui/StatusPill'
import { Avatar } from '@/components/ui/Wrappers'
import { useHasPermission } from '@/modules/auth/AuthProvider'
import { useEmployeeSetup, useEmployees, type EmployeeSummary } from '../api/employees'
import { EmployeeFormModal } from '../components/EmployeeFormModal'
import { OffboardEmployeeModal } from '../components/OffboardEmployeeModal'
import { ArchiveEmployeeModal } from '../components/ArchiveEmployeeModal'
import { formatDate, formatLabel } from '../lib/formatters'

function getStatusPill(employee: EmployeeSummary) {
  if (!employee.active) {
    return (
      <StatusPill tone="neutral" size="sm">
        Inactive
      </StatusPill>
    )
  }
  if (employee.probationStatus === 'on_probation' || employee.probationStatus === 'extended') {
    return (
      <StatusPill tone="warning" size="sm">
        Probation
      </StatusPill>
    )
  }
  return (
    <StatusPill tone="success" size="sm">
      Active
    </StatusPill>
  )
}

function isEndingWithinDays(dateValue: string | null | undefined, days: number): boolean {
  if (!dateValue) return false
  const today = new Date().toISOString().slice(0, 10)
  const limitDate = new Date()
  limitDate.setDate(limitDate.getDate() + days)
  const limit = limitDate.toISOString().slice(0, 10)
  return dateValue >= today && dateValue <= limit
}

export function EmployeesPage() {
  const navigate = useNavigate()
  const canCreate = useHasPermission('employees.create')
  const canUpdate = useHasPermission('employees.update')
  const canArchive = useHasPermission('employees.archive')
  const canManageSetup = useHasPermission('employees.manage_setup')
  const canImportExport = useHasPermission('employee_imports.manage')

  const { data: employees = [], isLoading, isError, refetch } = useEmployees()
  const { data: setup } = useEmployeeSetup()

  const [searchQuery, setSearchQuery] = useState('')
  const [departmentFilter, setDepartmentFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [employmentTypeFilter, setEmploymentTypeFilter] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [editingEmployee, setEditingEmployee] = useState<EmployeeSummary | null>(null)
  const [offboardingEmployee, setOffboardingEmployee] = useState<EmployeeSummary | null>(null)
  const [archivingEmployee, setArchivingEmployee] = useState<EmployeeSummary | null>(null)

  const metrics = useMemo(() => {
    const active = employees.filter((e) => e.active)
    const onProbation = active.filter(
      (e) => e.probationStatus === 'on_probation' || e.probationStatus === 'extended',
    )
    const contractsEndingSoon = active.filter((e) => isEndingWithinDays(e.endDate, 30))
    const departmentSet = new Set(active.map((e) => e.departmentName).filter(Boolean))
    return {
      total: employees.length,
      activeCount: active.length,
      probationCount: onProbation.length,
      contractsEndingCount: contractsEndingSoon.length,
      departmentCount: departmentSet.size,
    }
  }, [employees])

  const filteredEmployees = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase()
    return employees.filter((employee) => {
      if (needle) {
        const matched = [
          employee.legalName,
          employee.employeeNumber,
          employee.companyEmail,
          employee.departmentName,
          employee.jobTitleName,
        ].some((field) => field?.toLowerCase().includes(needle))
        if (!matched) return false
      }

      if (departmentFilter && employee.departmentId !== departmentFilter) {
        return false
      }

      if (statusFilter === 'active' && !employee.active) return false
      if (statusFilter === 'inactive' && employee.active) return false
      if (
        statusFilter === 'probation' &&
        (!employee.active ||
          (employee.probationStatus !== 'on_probation' &&
            employee.probationStatus !== 'extended'))
      ) {
        return false
      }

      if (employmentTypeFilter && employee.employmentType !== employmentTypeFilter) {
        return false
      }

      return true
    })
  }, [employees, searchQuery, departmentFilter, statusFilter, employmentTypeFilter])

  const buildRowOverflowItems = (row: EmployeeSummary): DropdownMenuItem[] => {
    const items: DropdownMenuItem[] = [
      {
        key: 'view',
        label: 'View Dossier',
        icon: <Eye className="h-3.5 w-3.5" />,
        onClick: () => {
          void navigate(`/people/employees/${row.id}`)
        },
      },
    ]

    if (canUpdate) {
      items.push({
        key: 'edit',
        label: 'Edit Employee',
        icon: <Pencil className="h-3.5 w-3.5" />,
        onClick: () => setEditingEmployee(row),
      })
    }

    if (canArchive && row.active) {
      items.push({
        key: 'offboard',
        label: 'Record Exit',
        icon: <CalendarClock className="h-3.5 w-3.5" />,
        onClick: () => setOffboardingEmployee(row),
      })
    }

    if (canArchive) {
      items.push({
        key: 'archive',
        label: 'Archive Record',
        icon: <Archive className="h-3.5 w-3.5" />,
        danger: true,
        onClick: () => setArchivingEmployee(row),
      })
    }

    return items
  }

  const columns: ColumnDef<EmployeeSummary>[] = [
    {
      key: 'employee',
      header: 'Employee',
      accessor: (row) => (
        <div className="flex items-center gap-3">
          <Avatar name={row.legalName} size="sm" />
          <div className="min-w-0">
            <p className="font-semibold text-ink truncate">{row.legalName}</p>
            <p className="font-mono text-[11px] text-muted">{row.employeeNumber}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'assignment',
      header: 'Assignment',
      accessor: (row) => (
        <div>
          <p className="font-medium text-ink">{row.jobTitleName ?? 'Not assigned'}</p>
          <p className="text-[11px] text-muted">{row.departmentName ?? 'No department'}</p>
        </div>
      ),
    },
    {
      key: 'employmentType',
      header: 'Employment',
      accessor: (row) => (
        <div>
          <p className="text-ink">{formatLabel(row.employmentType, 'Unset')}</p>
          <p className="text-[11px] text-muted">{row.payGradeName ?? 'No pay grade'}</p>
        </div>
      ),
    },
    {
      key: 'contact',
      header: 'Contact',
      accessor: (row) => (
        <div className="min-w-0">
          <p className="text-ink truncate max-w-[200px]">{row.companyEmail ?? '—'}</p>
          <p className="font-mono text-[11px] text-muted">{row.workPhone ?? '—'}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (row) => getStatusPill(row),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      accessor: (row) => (
        <div
          className="inline-flex items-center justify-end gap-1"
          onClick={(event) => event.stopPropagation()}
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void navigate(`/people/employees/${row.id}`)
            }}
          >
            View
          </Button>
          <DropdownMenu
            trigger={
              <Button
                variant="ghost"
                size="icon"
                aria-label={`More actions for ${row.legalName}`}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            }
            items={buildRowOverflowItems(row)}
          />
        </div>
      ),
    },
  ]

  const hasFilters =
    Boolean(searchQuery.trim()) ||
    Boolean(departmentFilter) ||
    statusFilter !== 'all' ||
    Boolean(employmentTypeFilter)

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="People Operations"
        title="Employees"
        subtitle="Manage active staff profiles, department assignments, pay grades, and exit records."
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            {canImportExport && (
              <Button
                variant="outline"
                size="md"
                leftIcon={<FileSpreadsheet className="h-4 w-4" />}
                onClick={() => {
                  void navigate('/people/employees/import')
                }}
              >
                Import / Export
              </Button>
            )}
            {canManageSetup && (
              <Button
                variant="outline"
                size="md"
                leftIcon={<Settings2 className="h-4 w-4" />}
                onClick={() => {
                  void navigate('/people/pay-grades')
                }}
              >
                HR Setup
              </Button>
            )}
            {canCreate && (
              <Button
                variant="primary"
                size="md"
                leftIcon={<UserPlus className="h-4 w-4" />}
                onClick={() => setCreateOpen(true)}
              >
                Add Employee
              </Button>
            )}
          </div>
        }
      />

      {/* KPI Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<Users className="h-5 w-5" />}
          tone="violet"
          title="Total Directory"
          value={metrics.total}
          subline={`${metrics.departmentCount} active departments`}
          loading={isLoading}
        />
        <KpiCard
          icon={<UserCheck className="h-5 w-5" />}
          tone="emerald"
          title="Active Staff"
          value={metrics.activeCount}
          subline="Current employment periods"
          loading={isLoading}
        />
        <KpiCard
          icon={<Clock className="h-5 w-5" />}
          tone="amber"
          title="On Probation"
          value={metrics.probationCount}
          subline="Active probation reviews"
          loading={isLoading}
        />
        <KpiCard
          icon={<CalendarClock className="h-5 w-5" />}
          tone="blue"
          title="Contracts Ending (30d)"
          value={metrics.contractsEndingCount}
          subline="Upcoming fixed-term end dates"
          loading={isLoading}
        />
      </div>

      {/* Filter Toolbar */}
      <div className="grid grid-cols-1 gap-3 rounded-lg border border-line bg-surface p-4 shadow-xs sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative flex items-center">
          <Search className="pointer-events-none absolute left-3 h-4 w-4 text-muted" />
          <input
            type="search"
            aria-label="Search employees"
            placeholder="Search name, ID, email, or role..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="h-10 w-full rounded-md border border-line bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-muted focus:border-emerald focus:outline-none focus:ring-2 focus:ring-emerald/20"
          />
        </div>

        <Select
          value={departmentFilter}
          onValueChange={setDepartmentFilter}
          placeholder="All Departments"
          options={[
            { value: '', label: 'All Departments' },
            ...(setup?.departments.map((dept) => ({ value: dept.id, label: dept.name })) ?? []),
          ]}
        />

        <Select
          value={statusFilter}
          onValueChange={setStatusFilter}
          placeholder="All Statuses"
          options={[
            { value: 'all', label: 'All Statuses' },
            { value: 'active', label: 'Active Only' },
            { value: 'probation', label: 'On Probation' },
            { value: 'inactive', label: 'Inactive / Exited' },
          ]}
        />

        <Select
          value={employmentTypeFilter}
          onValueChange={setEmploymentTypeFilter}
          placeholder="All Employment Types"
          options={[
            { value: '', label: 'All Employment Types' },
            { value: 'full_time', label: 'Full Time' },
            { value: 'part_time', label: 'Part Time' },
            { value: 'casual', label: 'Casual' },
            { value: 'intern', label: 'Intern' },
            { value: 'contractor', label: 'Contractor' },
          ]}
        />
      </div>

      {/* Content */}
      {isError ? (
        <div className="rounded-lg border border-line bg-surface p-8 shadow-xs">
          <EmptyState
            icon={<AlertTriangle className="h-6 w-6" />}
            tone="rose"
            title="Employees could not be loaded"
            description="Check your permissions or connection and try again. Existing records were not modified."
            action={
              <Button variant="secondary" onClick={() => void refetch()}>
                Try Again
              </Button>
            }
          />
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden md:block">
            <DataTable
              columns={columns}
              data={filteredEmployees}
              keyExtractor={(row) => row.id}
              loading={isLoading}
              onRowClick={(row) => {
                void navigate(`/people/employees/${row.id}`)
              }}
              emptyTitle={hasFilters ? 'No matching employees' : 'No employees added yet'}
              emptyDescription={
                hasFilters
                  ? 'Try clearing or widening your search and filters.'
                  : 'Create the first employee record to start managing assignments and payroll.'
              }
            />
          </div>

          {/* Phone / Compact Screen Card List */}
          <div className="space-y-3 md:hidden">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  className="rounded-lg border border-line bg-surface p-4 shadow-xs space-y-3"
                >
                  <Skeleton className="h-5 w-44" />
                  <Skeleton className="h-4 w-32" />
                </div>
              ))
            ) : filteredEmployees.length === 0 ? (
              <div className="rounded-lg border border-line bg-surface p-6 shadow-xs">
                <EmptyState
                  title={hasFilters ? 'No matching employees' : 'No employees added yet'}
                  description={
                    hasFilters
                      ? 'Try clearing or widening your search and filters.'
                      : 'Create the first employee record to start managing assignments and payroll.'
                  }
                />
              </div>
            ) : (
              filteredEmployees.map((row) => (
                <div
                  key={row.id}
                  className="rounded-lg border border-line bg-surface p-4 shadow-xs space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar name={row.legalName} size="md" />
                      <div className="min-w-0">
                        <p className="font-display text-sm font-bold text-ink truncate">
                          {row.legalName}
                        </p>
                        <p className="font-mono text-xs text-muted">{row.employeeNumber}</p>
                      </div>
                    </div>
                    {getStatusPill(row)}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs border-t border-line pt-3">
                    <div>
                      <p className="text-muted">Role</p>
                      <p className="font-medium text-ink truncate">
                        {row.jobTitleName ?? 'Not assigned'}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted">Department</p>
                      <p className="font-medium text-ink truncate">
                        {row.departmentName ?? 'No department'}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted">Start Date</p>
                      <p className="font-medium text-ink">{formatDate(row.startDate)}</p>
                    </div>
                    <div>
                      <p className="text-muted">Pay Grade</p>
                      <p className="font-medium text-ink truncate">
                        {row.payGradeName ?? 'Unassigned'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="flex-1"
                      onClick={() => {
                        void navigate(`/people/employees/${row.id}`)
                      }}
                    >
                      View Dossier
                    </Button>
                    {buildRowOverflowItems(row).length > 1 && (
                      <DropdownMenu
                        trigger={
                          <Button
                            variant="outline"
                            size="sm"
                            aria-label={`More actions for ${row.legalName}`}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        }
                        items={buildRowOverflowItems(row)}
                      />
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {/* Modals */}
      <EmployeeFormModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={(created) => {
          void navigate(`/people/employees/${created.id}`)
        }}
      />

      {editingEmployee && (
        <EmployeeFormModal
          open={Boolean(editingEmployee)}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setEditingEmployee(null)
          }}
          employee={editingEmployee}
        />
      )}

      {offboardingEmployee && (
        <OffboardEmployeeModal
          open={Boolean(offboardingEmployee)}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setOffboardingEmployee(null)
          }}
          employee={offboardingEmployee}
        />
      )}

      {archivingEmployee && (
        <ArchiveEmployeeModal
          open={Boolean(archivingEmployee)}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setArchivingEmployee(null)
          }}
          employee={archivingEmployee}
        />
      )}
    </div>
  )
}
