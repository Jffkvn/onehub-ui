import { useState } from 'react'
import {
  Building2,
  CalendarDays,
  Clock,
  PauseCircle,
  Pencil,
  PlayCircle,
  Plus,
  Settings2,
  UserCheck,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { StatusPill } from '@/components/ui/StatusPill'
import { DataTable, type ColumnDef } from '@/components/patterns/DataTable'
import { EmptyState } from '@/components/patterns/EmptyState'
import type {
  HolidaySetup,
  ScheduleSetup,
  SetupOverviewResponse,
  SetupRosterRow,
  WorkplaceSetup,
} from '../schemas/attendance'
import {
  BulkEnrollModal,
  DefaultsFormModal,
  EmployeeManagerModal,
  HolidayFormModal,
  ScheduleFormModal,
  ToggleAttendanceEnabledModal,
  WorkplaceFormModal,
} from './AttendanceSetupModals'

export function AttendanceSetupSection({ setup }: { setup: SetupOverviewResponse }) {
  const [toggleOpen, setToggleOpen] = useState(false)
  const [workplaceModal, setWorkplaceModal] = useState<{
    open: boolean
    record: WorkplaceSetup | null
  }>({ open: false, record: null })
  const [scheduleModal, setScheduleModal] = useState<{
    open: boolean
    record: ScheduleSetup | null
  }>({ open: false, record: null })
  const [holidayModal, setHolidayModal] = useState<{
    open: boolean
    record: HolidaySetup | null
  }>({ open: false, record: null })
  const [defaultsOpen, setDefaultsOpen] = useState(false)
  const [bulkEnrollOpen, setBulkEnrollOpen] = useState(false)
  const [managerTarget, setManagerTarget] = useState<SetupRosterRow | null>(null)

  const rosterColumns: ColumnDef<SetupRosterRow>[] = [
    {
      key: 'employee',
      header: 'Employee',
      accessor: (row) => (
        <div>
          <p className="font-semibold text-ink">{row.legal_name}</p>
          <p className="font-mono text-[11px] text-muted">
            {row.employee_number}
            {row.department_name ? ` · ${row.department_name}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'enrolment',
      header: 'Active Assignment',
      accessor: (row) =>
        row.active_assignment ? (
          <div className="text-xs">
            <p className="font-medium text-ink">
              {row.active_assignment.schedule_name ?? 'Schedule assigned'}
            </p>
            <p className="text-[11px] text-muted">
              {row.active_assignment.enrollment_basis === 'office'
                ? `Office · ${row.active_assignment.workplace_name ?? 'No workplace'}`
                : 'Arrangement-based (Field/Remote)'}
            </p>
          </div>
        ) : (
          <StatusPill tone="neutral" size="sm">
            Not Enrolled
          </StatusPill>
        ),
    },
    {
      key: 'manager',
      header: 'Attendance Manager',
      accessor: (row) => (
        <span className="text-xs text-soft">
          {row.attendance_manager_name ?? 'Unassigned (HR / Admin only)'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      accessor: (row) => (
        <Button
          size="sm"
          variant="outline"
          leftIcon={<UserCheck className="h-3.5 w-3.5" />}
          onClick={() => setManagerTarget(row)}
        >
          Manager
        </Button>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      {/* Live Policy Rollout Banner */}
      <section className="rounded-lg border border-line bg-surface p-5 shadow-xs space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-base font-bold text-ink">
                Live Attendance Rollout Status
              </h2>
              <StatusPill tone={setup.policy.enabled ? 'success' : 'warning'} size="sm">
                {setup.policy.enabled ? 'Live Enabled' : 'Live clock-in paused'}
              </StatusPill>
              <StatusPill tone={setup.ready_to_enable ? 'info' : 'neutral'} size="sm">
                {setup.ready_to_enable ? 'Ready to Enable' : 'Setup Incomplete'}
              </StatusPill>
            </div>
            <p className="text-xs text-soft">
              Keep live attendance paused until workplace geofence coordinates, official working hours,
              and initial employee enrolments are confirmed by management.
            </p>
          </div>

          <Button
            variant={setup.policy.enabled ? 'outline' : 'primary'}
            size="md"
            leftIcon={
              setup.policy.enabled ? (
                <PauseCircle className="h-4 w-4" />
              ) : (
                <PlayCircle className="h-4 w-4" />
              )
            }
            onClick={() => setToggleOpen(true)}
          >
            {setup.policy.enabled ? 'Pause Live Attendance' : 'Enable Live Attendance'}
          </Button>
        </div>
      </section>

      {/* Workplaces & Schedules Grid */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Workplaces */}
        <section className="rounded-lg border border-line bg-surface p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between gap-2 border-b border-line pb-3">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-blue" />
              <h3 className="font-display text-sm font-bold text-ink">
                Workplaces ({setup.workplaces.length})
              </h3>
            </div>
            <Button
              size="sm"
              variant="outline"
              leftIcon={<Plus className="h-3.5 w-3.5" />}
              onClick={() => setWorkplaceModal({ open: true, record: null })}
            >
              Add Workplace
            </Button>
          </div>

          {setup.workplaces.length === 0 ? (
            <EmptyState
              title="No workplaces configured"
              description="Add office geofence locations before assigning office-based staff."
            />
          ) : (
            <div className="space-y-2.5">
              {setup.workplaces.map((wp) => (
                <div
                  key={wp.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-line bg-canvas/50 p-3 text-xs"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-ink">{wp.name}</span>
                      <StatusPill tone={wp.is_active ? 'success' : 'neutral'} size="sm">
                        {wp.is_active ? 'Active' : 'Inactive'}
                      </StatusPill>
                    </div>
                    <p className="text-muted tabular-nums">
                      Radius: {wp.radius_meters}m · {wp.timezone}
                      {wp.latitude != null && wp.longitude != null
                        ? ` · ${wp.latitude.toFixed(4)}, ${wp.longitude.toFixed(4)}`
                        : ''}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    leftIcon={<Pencil className="h-3.5 w-3.5" />}
                    onClick={() => setWorkplaceModal({ open: true, record: wp })}
                  >
                    Edit
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Schedules */}
        <section className="rounded-lg border border-line bg-surface p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between gap-2 border-b border-line pb-3">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-emerald" />
              <h3 className="font-display text-sm font-bold text-ink">
                Work Schedules ({setup.schedules.length})
              </h3>
            </div>
            <Button
              size="sm"
              variant="outline"
              leftIcon={<Plus className="h-3.5 w-3.5" />}
              onClick={() => setScheduleModal({ open: true, record: null })}
            >
              Add Schedule
            </Button>
          </div>

          {setup.schedules.length === 0 ? (
            <EmptyState
              title="No schedules configured"
              description="Define workdays, shift hours, lateness grace, and extra-time threshold."
            />
          ) : (
            <div className="space-y-2.5">
              {setup.schedules.map((sch) => (
                <div
                  key={sch.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-line bg-canvas/50 p-3 text-xs"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-ink">{sch.name}</span>
                      <StatusPill tone={sch.is_active ? 'success' : 'neutral'} size="sm">
                        {sch.is_active ? 'Active' : 'Inactive'}
                      </StatusPill>
                    </div>
                    <p className="text-muted tabular-nums">
                      Grace: {sch.lateness_grace_minutes}m · Explain extra &gt;{sch.explanation_threshold_minutes}m · {sch.timezone}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    leftIcon={<Pencil className="h-3.5 w-3.5" />}
                    onClick={() => setScheduleModal({ open: true, record: sch })}
                  >
                    Edit
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Defaults & Holidays Grid */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Global Enrolment Defaults */}
        <section className="rounded-lg border border-line bg-surface p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between gap-2 border-b border-line pb-3">
            <div className="flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-violet" />
              <h3 className="font-display text-sm font-bold text-ink">
                New-Hire Enrolment Defaults
              </h3>
            </div>
            <Button size="sm" variant="outline" onClick={() => setDefaultsOpen(true)}>
              Configure
            </Button>
          </div>

          <dl className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <dt className="text-muted">Basis</dt>
              <dd className="font-semibold text-ink capitalize">
                {setup.defaults?.enrollment_basis ?? 'office'}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Auto-Enrol New Hires</dt>
              <dd className="font-semibold text-ink">
                {setup.defaults?.auto_enroll_new ? 'Enabled' : 'Disabled'}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Default Schedule</dt>
              <dd className="font-semibold text-ink">
                {setup.schedules.find((s) => s.id === setup.defaults?.schedule_id)?.name ?? 'None'}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Default Workplace</dt>
              <dd className="font-semibold text-ink">
                {setup.workplaces.find((w) => w.id === setup.defaults?.workplace_id)?.name ?? 'None'}
              </dd>
            </div>
          </dl>
        </section>

        {/* Public Holidays */}
        <section className="rounded-lg border border-line bg-surface p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between gap-2 border-b border-line pb-3">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-amber" />
              <h3 className="font-display text-sm font-bold text-ink">
                Public Holidays ({setup.holidays.length})
              </h3>
            </div>
            <Button
              size="sm"
              variant="outline"
              leftIcon={<Plus className="h-3.5 w-3.5" />}
              onClick={() => setHolidayModal({ open: true, record: null })}
            >
              Add Holiday
            </Button>
          </div>

          {setup.holidays.length === 0 ? (
            <EmptyState
              title="No public holidays recorded"
              description="Add statutory holidays so unpunched workdays sync cleanly."
            />
          ) : (
            <div className="space-y-2 max-h-56 overflow-y-auto">
              {setup.holidays.map((hol) => (
                <div
                  key={hol.id}
                  className="flex items-center justify-between gap-2 rounded border border-line bg-canvas/50 px-3 py-2 text-xs"
                >
                  <div>
                    <span className="font-mono font-semibold text-ink">{hol.local_date}</span>
                    <span className="mx-2 text-muted">·</span>
                    <span className="text-ink">{hol.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill tone={hol.is_active ? 'violet' : 'neutral'} size="sm">
                      {hol.is_active ? 'Active' : 'Inactive'}
                    </StatusPill>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setHolidayModal({ open: true, record: hol })}
                    >
                      Edit
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Staff Enrolment & Managers Roster */}
      <section className="rounded-lg border border-line bg-surface p-5 shadow-xs space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-line pb-3">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-emerald" />
            <div>
              <h3 className="font-display text-sm font-bold text-ink">
                Staff Enrolment &amp; Line Managers ({setup.roster.length})
              </h3>
              <p className="text-xs text-muted">
                Enrol employees into active schedules and assign Project Managers / Coordinators for team reviews.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="primary"
            leftIcon={<Plus className="h-4 w-4" />}
            onClick={() => setBulkEnrollOpen(true)}
          >
            Bulk Enrol Staff
          </Button>
        </div>

        <div className="hidden md:block">
          <DataTable
            columns={rosterColumns}
            data={setup.roster}
            keyExtractor={(row) => row.employee_id}
            emptyTitle="No active employees found"
            emptyDescription="Add employee records in People → Employees first."
          />
        </div>

        <div className="space-y-3 md:hidden">
          {setup.roster.map((row) => (
            <div
              key={row.employee_id}
              className="rounded-lg border border-line bg-canvas/40 p-3.5 space-y-2 text-xs"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-ink">{row.legal_name}</p>
                  <p className="font-mono text-muted">{row.employee_number}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setManagerTarget(row)}>
                  Manager
                </Button>
              </div>
              <p className="text-soft">
                {row.active_assignment
                  ? `${row.active_assignment.schedule_name ?? 'Schedule'} (${row.active_assignment.enrollment_basis})`
                  : 'Not enrolled'}
              </p>
              <p className="text-muted">
                Manager: {row.attendance_manager_name ?? 'Unassigned'}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Setup Modals */}
      <ToggleAttendanceEnabledModal
        open={toggleOpen}
        onOpenChange={setToggleOpen}
        currentlyEnabled={setup.policy.enabled}
        readyToEnable={setup.ready_to_enable}
      />
      <WorkplaceFormModal
        open={workplaceModal.open}
        onOpenChange={(open) => setWorkplaceModal((prev) => ({ ...prev, open }))}
        workplace={workplaceModal.record}
      />
      <ScheduleFormModal
        open={scheduleModal.open}
        onOpenChange={(open) => setScheduleModal((prev) => ({ ...prev, open }))}
        schedule={scheduleModal.record}
      />
      <HolidayFormModal
        open={holidayModal.open}
        onOpenChange={(open) => setHolidayModal((prev) => ({ ...prev, open }))}
        holiday={holidayModal.record}
      />
      <DefaultsFormModal
        open={defaultsOpen}
        onOpenChange={setDefaultsOpen}
        setup={setup}
      />
      <BulkEnrollModal
        open={bulkEnrollOpen}
        onOpenChange={setBulkEnrollOpen}
        setup={setup}
      />
      <EmployeeManagerModal
        open={Boolean(managerTarget)}
        onOpenChange={(open) => {
          if (!open) setManagerTarget(null)
        }}
        employee={managerTarget}
        roster={setup.roster}
      />
    </div>
  )
}
