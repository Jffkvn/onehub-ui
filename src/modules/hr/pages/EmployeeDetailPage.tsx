import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  Banknote,
  BriefcaseBusiness,
  CalendarClock,
  FileCheck2,
  Mail,
  Pencil,
  ShieldCheck,
} from 'lucide-react'

import { EmptyState } from '@/components/patterns/EmptyState'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { StatusPill } from '@/components/ui/StatusPill'
import { useHasPermission } from '@/modules/auth/AuthProvider'
import { useEmployee } from '../api/employees'
import { EmployeeFormModal } from '../components/EmployeeFormModal'
import { EmployeeDossierHistory } from '../components/EmployeeDossierHistory'
import { EmployeeDossierPhoto } from '../components/EmployeeDossierPhoto'
import { EmployeeDossierExport } from '../components/EmployeeDossierExport'
import { OffboardEmployeeModal } from '../components/OffboardEmployeeModal'
import { ArchiveEmployeeModal } from '../components/ArchiveEmployeeModal'
import { formatDate, formatLabel, formatMoney } from '../lib/formatters'

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-line/60 pb-2.5 last:border-b-0 last:pb-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="text-xs font-medium text-muted shrink-0">{label}</dt>
      <dd className="text-xs font-semibold text-ink sm:text-right break-words">{value}</dd>
    </div>
  )
}

export function EmployeeDetailPage() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const canUpdate = useHasPermission('employees.update')
  const canArchive = useHasPermission('employees.archive')

  const { data: employee, isLoading, isError, refetch } = useEmployee(id)

  const [editOpen, setEditOpen] = useState(false)
  const [offboardOpen, setOffboardOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-40" />
        <div className="rounded-lg border border-line bg-surface p-6 space-y-4">
          <Skeleton className="h-12 w-64" />
          <Skeleton shape="card" className="h-44" />
        </div>
      </div>
    )
  }

  if (isError || !employee) {
    return (
      <div className="space-y-6">
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<ArrowLeft className="h-4 w-4" />}
          onClick={() => {
            void navigate('/people/employees')
          }}
        >
          Back to Employees
        </Button>

        <div className="rounded-lg border border-line bg-surface p-8 shadow-xs">
          <EmptyState
            icon={<AlertTriangle className="h-6 w-6" />}
            tone="rose"
            title="Employee record unavailable"
            description="The requested profile could not be loaded or you do not have access to view it."
            action={
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={() => void refetch()}>
                  Try Again
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    void navigate('/people/employees')
                  }}
                >
                  Directory
                </Button>
              </div>
            }
          />
        </div>
      </div>
    )
  }

  const isArchived = Boolean(employee.archivedAt)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<ArrowLeft className="h-4 w-4" />}
          onClick={() => {
            void navigate('/people/employees')
          }}
        >
          Back to Employees
        </Button>
      </div>

      {/* Dossier Header */}
      <div className="flex flex-col gap-5 rounded-lg border border-line bg-surface p-6 shadow-xs lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-4 min-w-0">
          <EmployeeDossierPhoto employeeId={employee.id} employeeName={employee.legalName}
            canEdit={canUpdate && !isArchived} />
          <div className="space-y-1.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="font-mono text-xs font-semibold text-muted">
                {employee.employeeNumber}
              </span>
              {isArchived ? (
                <StatusPill tone="danger" size="sm">
                  Archived
                </StatusPill>
              ) : employee.active ? (
                <StatusPill tone="success" size="sm">
                  Active
                </StatusPill>
              ) : (
                <StatusPill tone="neutral" size="sm">
                  Inactive / Exited
                </StatusPill>
              )}
            </div>
            <h1 className="font-display text-2xl font-bold text-ink truncate">
              {employee.legalName}
            </h1>
            <p className="text-xs text-soft">
              {employee.jobTitleName ?? 'Role not assigned'} ·{' '}
              {employee.departmentName ?? 'Department not assigned'} ·{' '}
              {employee.payGradeName ?? 'No pay grade'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <EmployeeDossierExport key={employee.id} employee={employee} />
          {!isArchived && canUpdate && (
            <Button
              variant="secondary"
              size="md"
              leftIcon={<Pencil className="h-4 w-4" />}
              onClick={() => setEditOpen(true)}
            >
              Edit Employee
            </Button>
          )}
          {!isArchived && canArchive && employee.active && (
            <Button
              variant="outline"
              size="md"
              leftIcon={<CalendarClock className="h-4 w-4" />}
              onClick={() => setOffboardOpen(true)}
            >
              Record Exit
            </Button>
          )}
          {!isArchived && canArchive && (
            <Button
              variant="danger"
              size="md"
              leftIcon={<Archive className="h-4 w-4" />}
              onClick={() => setArchiveOpen(true)}
            >
              Archive
            </Button>
          )}
        </div>
      </div>

      {/* Structured Display-Only Cards */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Personal & Contact */}
        <section className="rounded-lg border border-line bg-surface p-6 shadow-xs space-y-4">
          <div className="flex items-center gap-2 border-b border-line pb-3">
            <Mail className="h-4 w-4 text-violet" />
            <h2 className="font-display text-sm font-bold text-ink">Personal &amp; Contact</h2>
          </div>
          <dl className="space-y-2.5">
            <DetailRow label="Full Legal Name" value={employee.legalName} />
            <DetailRow
              label="Employee Number"
              value={<span className="font-mono">{employee.employeeNumber}</span>}
            />
            <DetailRow label="National ID / NIN" value={employee.nationalId ?? 'Not provided'} />
            <DetailRow label="Gender" value={formatLabel(employee.gender, 'Not specified')} />
            <DetailRow label="Date of Birth" value={formatDate(employee.dateOfBirth)} />
            <DetailRow label="Company Email" value={employee.companyEmail ?? 'Not provided'} />
            <DetailRow label="Personal Email" value={employee.personalEmail ?? 'Not provided'} />
            <DetailRow
              label="Work Phone"
              value={<span className="font-mono">{employee.workPhone ?? 'Not provided'}</span>}
            />
          </dl>
        </section>

        {/* Current Employment */}
        <section className="rounded-lg border border-line bg-surface p-6 shadow-xs space-y-4">
          <div className="flex items-center gap-2 border-b border-line pb-3">
            <BriefcaseBusiness className="h-4 w-4 text-emerald" />
            <h2 className="font-display text-sm font-bold text-ink">Current Employment</h2>
          </div>
          <dl className="space-y-2.5">
            <DetailRow label="Department" value={employee.departmentName ?? 'Not assigned'} />
            <DetailRow label="Job Title" value={employee.jobTitleName ?? 'Not assigned'} />
            <DetailRow label="Pay Grade" value={employee.payGradeName ?? 'Not assigned'} />
            <DetailRow label="Employment Type" value={formatLabel(employee.employmentType)} />
            <DetailRow label="Contract Type" value={formatLabel(employee.contractType)} />
            <DetailRow label="Start Date" value={formatDate(employee.startDate)} />
            <DetailRow
              label="Contract / Last Working Day"
              value={employee.endDate ? formatDate(employee.endDate) : 'Open-ended'}
            />
            <DetailRow label="Probation Status" value={formatLabel(employee.probationStatus)} />
            <DetailRow label="Probation End Date" value={formatDate(employee.probationEndDate)} />
          </dl>
        </section>

        {/* Compensation & Disbursement (Read-only) */}
        <section className="rounded-lg border border-line bg-surface p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-line pb-3">
            <div className="flex items-center gap-2">
              <Banknote className="h-4 w-4 text-blue" />
              <h2 className="font-display text-sm font-bold text-ink">
                Salary &amp; Disbursement
              </h2>
            </div>
            <span className="text-[11px] font-medium text-muted">Display-only</span>
          </div>
          <dl className="space-y-2.5">
            <DetailRow
              label="Gross Monthly Salary"
              value={
                <span className="font-mono whitespace-nowrap tabular-nums">
                  {formatMoney(employee.grossSalary, employee.currency ?? 'UGX')}
                </span>
              }
            />
            <DetailRow
              label="Custom Overtime Rate"
              value={
                <span className="font-mono whitespace-nowrap tabular-nums">
                  {formatMoney(employee.customOvertimeRate, employee.currency ?? 'UGX', 'Grade / Default')}
                </span>
              }
            />
            <DetailRow label="Payment Method" value={formatLabel(employee.paymentMethod, 'Cash')} />
            <DetailRow label="Bank Name" value={employee.bankName ?? 'Not provided'} />
            <DetailRow
              label="Account Number"
              value={<span className="font-mono">{employee.accountNumber ?? 'Not provided'}</span>}
            />
            <DetailRow
              label="Sort / Branch Code"
              value={<span className="font-mono">{employee.sortCode ?? 'Not provided'}</span>}
            />
            <DetailRow
              label="Mobile Money Number"
              value={
                <span className="font-mono">{employee.mobileMoneyNumber ?? 'Not provided'}</span>
              }
            />
          </dl>
        </section>

        {/* Statutory & Payroll Settings (Read-only) */}
        <section className="rounded-lg border border-line bg-surface p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-line pb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-amber" />
              <h2 className="font-display text-sm font-bold text-ink">Statutory &amp; Payroll</h2>
            </div>
            <span className="text-[11px] font-medium text-muted">Payroll defaults</span>
          </div>
          <dl className="space-y-2.5">
            <DetailRow
              label="TIN Number"
              value={<span className="font-mono">{employee.tinNumber ?? 'Not provided'}</span>}
            />
            <DetailRow
              label="NSSF Number"
              value={<span className="font-mono">{employee.nssfNumber ?? 'Not provided'}</span>}
            />
            <DetailRow label="Tax Treatment" value={formatLabel(employee.employeeTaxType, 'Local')} />
            <DetailRow
              label="% Month Worked Default"
              value={<span className="font-mono">{employee.pctMonthWorked ?? 100}%</span>}
            />
            <DetailRow
              label="WHT Rate"
              value={<span className="font-mono">{employee.whtRate ?? 6}%</span>}
            />
          </dl>
        </section>
        <EmployeeDossierHistory employeeId={employee.id} canEdit={canUpdate && !isArchived} />
      </div>

      {/* Dossier Notice */}
      <div className="flex items-start gap-3 rounded-lg border border-line bg-surface p-4 text-xs text-soft shadow-xs">
        <FileCheck2 className="h-4 w-4 shrink-0 text-muted mt-0.5" />
        <p>
          Core employment, salary, statutory payroll, and disbursement details are managed here. Use Edit Employee, Record Exit, or Archive above when a staff record changes.
        </p>
      </div>

      {/* Modals */}
      <EmployeeFormModal
        open={editOpen}
        onOpenChange={setEditOpen}
        employee={employee}
      />

      <OffboardEmployeeModal
        open={offboardOpen}
        onOpenChange={setOffboardOpen}
        employee={employee}
      />

      <ArchiveEmployeeModal
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        employee={employee}
        onArchived={() => {
          void navigate('/people/employees')
        }}
      />
    </div>
  )
}
