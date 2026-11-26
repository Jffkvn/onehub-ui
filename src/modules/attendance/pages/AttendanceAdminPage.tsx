import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { z } from 'zod'
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Eye,
  FileEdit,
  MapPin,
  Plus,
  Shield,
  Users,
} from 'lucide-react'
import { PageHeader } from '@/components/patterns/PageHeader'
import { KpiCard } from '@/components/patterns/KpiCard'
import { DataTable, type ColumnDef } from '@/components/patterns/DataTable'
import { DetailSlideOver } from '@/components/patterns/DetailSlideOver'
import { EmptyState } from '@/components/patterns/EmptyState'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Tabs } from '@/components/ui/Wrappers'
import { useHasPermission } from '@/modules/auth/AuthProvider'
import {
  addDaysToIsoDate,
  formatLocalDateLabel,
  formatMinutesDuration,
  formatTimeInZone,
  getTodayIsoInZone,
} from '../lib/zonedTime'
import {
  useAttendanceArrangements,
  useAttendanceRegister,
  useAttendanceReviewQueues,
  useAttendanceSetupOverview,
} from '../api/attendance'
import type {
  ArrangementRow,
  RegisterRow,
  ReviewCorrectionRow,
  ReviewExplanationRow,
} from '../schemas/attendance'
import {
  LocationCheckPill,
  PendingAttendanceOperationsBanner,
  PolicyProvenancePill,
  PunctualityPill,
  RecordStatePill,
  WorkModePill,
  WorkflowStatusPill,
  formatWeekdaysSummary,
} from '../components/AttendanceBadges'
import {
  DecideArrangementModal,
  FieldEvidenceModal,
  HrCorrectDayModal,
  HrCreateArrangementModal,
  WorkflowDecisionModal,
} from '../components/AttendanceWorkflowModals'
import { AttendanceSetupSection } from '../components/AttendanceSetupSection'

const REGISTER_PAGE_SIZE = 50

export function AttendanceAdminPage() {
  const canManage = useHasPermission('attendance.manage')
  const canReadAll = useHasPermission('attendance.read_all')
  const canTeamReview = useHasPermission('attendance.team_review')
  const canApproveQueues = canManage || canTeamReview

  const todayIso = getTodayIsoInZone('Africa/Kampala')
  const [search] = useSearchParams()
  const from = z.string().date().safeParse(search.get('from'))
  const to = z.string().date().safeParse(search.get('to'))
  const rangeIsValid = from.success && to.success && from.data <= to.data && to.data <= todayIso
    && Date.parse(to.data) - Date.parse(from.data) <= 89 * 86_400_000
  const department = z.string().uuid().safeParse(search.get('department'))
  const [fromDate, setFromDate] = useState(() => rangeIsValid ? from.data : addDaysToIsoDate(todayIso, -6))
  const [toDate, setToDate] = useState(() => rangeIsValid ? to.data : todayIso)
  const [departmentId, setDepartmentId] = useState(() => department.success ? department.data : '')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [registerPage, setRegisterPage] = useState(0)
  const [activeTab, setActiveTab] = useState<string>('register')

  // Slide-over & modal targets
  const [selectedRegisterRow, setSelectedRegisterRow] = useState<RegisterRow | null>(null)
  const [hrCorrectionTarget, setHrCorrectionTarget] = useState<RegisterRow | null>(null)
  const [fieldEvidencePunchId, setFieldEvidencePunchId] = useState<string | null>(null)
  const [hrCreateArrOpen, setHrCreateArrOpen] = useState(false)
  const [decisionTarget, setDecisionTarget] = useState<
    | { kind: 'correction'; row: ReviewCorrectionRow }
    | { kind: 'explanation'; row: ReviewExplanationRow }
    | null
  >(null)
  const [arrDecisionTarget, setArrDecisionTarget] = useState<ArrangementRow | null>(null)

  const setupQuery = useAttendanceSetupOverview(canManage || canReadAll || canTeamReview)
  const registerQuery = useAttendanceRegister({
    from: fromDate,
    to: toDate,
    departmentId: departmentId || null,
    status: statusFilter || null,
    limit: REGISTER_PAGE_SIZE,
    offset: registerPage * REGISTER_PAGE_SIZE,
  })
  const queuesQuery = useAttendanceReviewQueues('pending', canApproveQueues)
  const arrangementsQuery = useAttendanceArrangements(
    {
      status: 'pending',
      reviewOnly: !canManage && canTeamReview,
    },
    canApproveQueues,
  )

  const register = registerQuery.data
  const setup = setupQuery.data
  const queues = queuesQuery.data
  const pendingArrangements = arrangementsQuery.data?.rows ?? []

  const pendingTotalCount =
    (queues?.corrections.length ?? 0) +
    (queues?.explanations.length ?? 0) +
    (canManage ? (queues?.field_reviews.length ?? 0) : 0) +
    pendingArrangements.filter((r) => r.can_decide).length

  const roleScopeTitle = canManage
    ? 'HR Attendance Administration Scope'
    : canTeamReview && !canReadAll
      ? 'Team Reviewer Scope (Assigned Reports)'
      : 'Company-Wide Read-Only Oversight'

  const roleScopeDescription = canManage
    ? 'Full register view, approval workflows, direct HR corrections, restricted GPS inspection, and setup configuration.'
    : canTeamReview && !canReadAll
      ? 'Showing employees assigned to you as attendance manager. You can decide team corrections and arrangements without access to raw GPS coordinates or company setup.'
      : 'Company-wide visibility across all departments without raw GPS coordinates, setup changes, or direct edit actions.'

  const registerColumns: ColumnDef<RegisterRow>[] = [
    {
      key: 'employee',
      header: 'Employee',
      accessor: (row) => (
        <div>
          <p className="font-semibold text-ink">{row.employee_name}</p>
          <p className="text-[11px] text-muted">
            <span className="font-mono">{row.employee_number}</span>
            {row.department_name ? ` · ${row.department_name}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'date',
      header: 'Date & Mode',
      accessor: (row) => (
        <div className="space-y-1">
          <p className="font-medium text-ink">{formatLocalDateLabel(row.local_date)}</p>
          <div className="flex items-center gap-1.5">
            <WorkModePill mode={row.work_mode} />
            <PunctualityPill punctuality={row.punctuality} />
          </div>
        </div>
      ),
    },
    {
      key: 'times',
      header: 'In / Out',
      accessor: (row) => (
        <div className="text-xs tabular-nums space-y-0.5">
          <p className="text-ink">In: {formatTimeInZone(row.clock_in_at, row.timezone)}</p>
          <p className="text-soft">Out: {formatTimeInZone(row.clock_out_at, row.timezone)}</p>
        </div>
      ),
    },
    {
      key: 'location',
      header: 'Location Check',
      accessor: (row) => (
        <div className="flex flex-col items-start gap-1">
          <LocationCheckPill
            locationCheck={row.clock_in_location_check}
            distanceM={row.clock_in_distance_m}
          />
          {row.clock_out_location_check && (
            <LocationCheckPill
              locationCheck={row.clock_out_location_check}
              distanceM={row.clock_out_distance_m}
            />
          )}
        </div>
      ),
    },
    {
      key: 'state',
      header: 'Status',
      accessor: (row) => (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-1">
            <RecordStatePill state={row.effective_state} />
            <PolicyProvenancePill
              policyVerified={row.policy_verified}
              recordState={row.effective_state}
            />
          </div>
          {row.extra_minutes > 0 && (
            <p className="text-[11px] text-amber tabular-nums">
              +{formatMinutesDuration(row.extra_minutes)}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Inspect',
      align: 'right',
      accessor: (row) => (
        <Button
          size="sm"
          variant="outline"
          leftIcon={<Eye className="h-3.5 w-3.5" />}
          onClick={() => setSelectedRegisterRow(row)}
        >
          Details
        </Button>
      ),
    },
  ]

  const registerTabContent = (
    <div className="space-y-6">
      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          title="Register Entries"
          value={register?.summary.total_rows ?? 0}
          tone="blue"
          loading={registerQuery.isLoading}
          icon={<Users className="h-5 w-5" />}
        />
        <KpiCard
          title="Complete Days"
          value={register?.summary.complete_count ?? 0}
          tone="emerald"
          loading={registerQuery.isLoading}
          icon={<CheckCircle2 className="h-5 w-5" />}
        />
        <KpiCard
          title="Currently Working"
          value={register?.summary.open_count ?? 0}
          tone="cyan"
          loading={registerQuery.isLoading}
          icon={<Clock className="h-5 w-5" />}
        />
        <KpiCard
          title="Exceptions / Reviews"
          value={register?.summary.exception_count ?? 0}
          tone="amber"
          loading={registerQuery.isLoading}
          icon={<AlertTriangle className="h-5 w-5" />}
        />
      </div>

      {/* Filters Bar */}
      <div className="grid grid-cols-1 gap-3 rounded-lg border border-line bg-surface p-4 shadow-xs sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="mb-1 block text-xs font-semibold text-ink">From Date</label>
          <Input
            type="date"
            value={fromDate}
            onChange={(e) => { setFromDate(e.target.value); setRegisterPage(0) }}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-ink">To Date</label>
          <Input
            type="date"
            value={toDate}
            onChange={(e) => { setToDate(e.target.value); setRegisterPage(0) }}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-ink">Department</label>
          <Select
            value={departmentId}
            onValueChange={(id) => { setDepartmentId(id); setRegisterPage(0) }}
            options={[
              { value: '', label: 'All Departments' },
              ...(setup?.departments ?? []).map((d) => ({ value: d.id, label: d.name })),
            ]}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-ink">Status Filter</label>
          <Select
            value={statusFilter}
            onValueChange={(status) => { setStatusFilter(status); setRegisterPage(0) }}
            options={[
              { value: '', label: 'All Statuses' },
              { value: 'needs_review', label: 'Needs Review' },
              { value: 'complete', label: 'Complete' },
              { value: 'open', label: 'Working' },
              { value: 'missing_clock_out', label: 'Missing End Day' },
              { value: 'expected', label: 'Scheduled' },
              { value: 'holiday', label: 'Holiday' },
              { value: 'unverified', label: 'Policy Unverified' },
            ]}
          />
        </div>
      </div>

      {/* Register Table (Desktop) + Cards (Phone) */}
      <div className="hidden md:block">
        <DataTable
          columns={registerColumns}
          data={register?.rows ?? []}
          loading={registerQuery.isLoading}
          keyExtractor={(row) => `${row.employee_id}-${row.local_date}`}
          emptyTitle="No attendance records match your filters"
          emptyDescription="Adjust the date window or status filter above."
        />
      </div>

      <div className="space-y-3 md:hidden">
        {(register?.rows ?? []).length === 0 ? (
          <div className="rounded-lg border border-line bg-surface p-6">
            <EmptyState
              title="No attendance records match your filters"
              description="Try widening the date range above."
            />
          </div>
        ) : (
          (register?.rows ?? []).map((row) => (
            <div
              key={`${row.employee_id}-${row.local_date}`}
              className="rounded-lg border border-line bg-surface p-4 shadow-xs space-y-2.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-display text-sm font-bold text-ink">{row.employee_name}</p>
                  <p className="text-xs text-muted">{formatLocalDateLabel(row.local_date)}</p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-1">
                  <RecordStatePill state={row.effective_state} />
                  <PolicyProvenancePill
                    policyVerified={row.policy_verified}
                    recordState={row.effective_state}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <WorkModePill mode={row.work_mode} />
                <PunctualityPill punctuality={row.punctuality} />
                <LocationCheckPill
                  locationCheck={row.clock_in_location_check}
                  distanceM={row.clock_in_distance_m}
                />
              </div>
              <div className="flex items-center justify-between border-t border-line pt-2 text-xs tabular-nums">
                <span>
                  In {formatTimeInZone(row.clock_in_at, row.timezone)} · Out{' '}
                  {formatTimeInZone(row.clock_out_at, row.timezone)}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSelectedRegisterRow(row)}
                >
                  Details
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
      {(registerPage > 0 || (register?.total_count ?? 0) > REGISTER_PAGE_SIZE) && (
        <nav aria-label="Attendance register pages" className="flex flex-wrap items-center justify-end gap-2">
          <span className="mr-2 text-sm text-muted" role="status">
            Page {registerPage + 1}{register && ` · ${register.total_count} matches`}
          </span>
          <Button size="sm" variant="outline" disabled={registerPage === 0}
            onClick={() => setRegisterPage((page) => page - 1)}>Previous page</Button>
          <Button size="sm" variant="outline"
            disabled={registerQuery.isFetching || !register || register.total_count <= (registerPage + 1) * REGISTER_PAGE_SIZE}
            onClick={() => setRegisterPage((page) => page + 1)}>Next page</Button>
        </nav>
      )}
    </div>
  )

  const approvalsTabContent = (
    <div className="space-y-6">
      {/* Pending Corrections */}
      <section className="rounded-lg border border-line bg-surface p-5 shadow-xs space-y-4">
        <h3 className="font-display text-sm font-bold text-ink">
          Pending Correction Requests ({queues?.corrections.length ?? 0})
        </h3>
        {(queues?.corrections.length ?? 0) === 0 ? (
          <p className="text-xs text-muted">No pending correction requests in your scope.</p>
        ) : (
          <div className="space-y-3">
            {queues?.corrections.map((c) => (
              <div
                key={c.id}
                className="flex flex-col gap-3 rounded-md border border-line bg-canvas/50 p-3.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-1 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink">{c.employee_name}</span>
                    <span className="font-mono text-muted">{c.employee_number}</span>
                    <span className="rounded bg-surface px-1.5 py-0.5 text-[11px] font-medium text-ink border border-line">
                      {c.local_date}
                    </span>
                    <WorkflowStatusPill status={c.request_kind} />
                  </div>
                  <p className="text-soft">{c.reason}</p>
                  <p className="text-[11px] text-muted tabular-nums">
                    Claimed:{' '}
                    {c.claimed_in_at ? `In ${formatTimeInZone(c.claimed_in_at, c.timezone)}` : ''}{' '}
                    {c.claimed_out_at ? `Out ${formatTimeInZone(c.claimed_out_at, c.timezone)}` : ''}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => setDecisionTarget({ kind: 'correction', row: c })}
                >
                  Review
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Pending Work Arrangements */}
      <section className="rounded-lg border border-line bg-surface p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-sm font-bold text-ink">
            Pending Field &amp; Remote Arrangements ({pendingArrangements.length})
          </h3>
          {canManage && (
            <Button
              size="sm"
              variant="outline"
              leftIcon={<Plus className="h-3.5 w-3.5" />}
              onClick={() => setHrCreateArrOpen(true)}
            >
              Assign Arrangement (HR)
            </Button>
          )}
        </div>
        {pendingArrangements.length === 0 ? (
          <p className="text-xs text-muted">No pending arrangement requests in your scope.</p>
        ) : (
          <div className="space-y-3">
            {pendingArrangements.map((ar) => (
              <div
                key={ar.id}
                className="flex flex-col gap-3 rounded-md border border-line bg-canvas/50 p-3.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-1 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink">{ar.employee_name}</span>
                    <WorkModePill mode={ar.mode} />
                    <span className="text-ink font-medium">
                      {ar.start_date}
                      {ar.end_date ? ` → ${ar.end_date}` : ' onwards'}
                    </span>
                    {ar.coverage_type === 'weekly' && (
                      <span className="text-muted">({formatWeekdaysSummary(ar.weekdays)})</span>
                    )}
                  </div>
                  {ar.duty_label && <p className="font-medium text-ink">{ar.duty_label}</p>}
                  <p className="text-soft">{ar.reason}</p>
                </div>
                {ar.can_decide ? (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => setArrDecisionTarget(ar)}
                  >
                    Decide
                  </Button>
                ) : (
                  <span className="text-xs text-muted">Self-request locked</span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Pending Extra-Time Explanations */}
      <section className="rounded-lg border border-line bg-surface p-5 shadow-xs space-y-4">
        <h3 className="font-display text-sm font-bold text-ink">
          Pending Extra-Time Explanations ({queues?.explanations.length ?? 0})
        </h3>
        {(queues?.explanations.length ?? 0) === 0 ? (
          <p className="text-xs text-muted">No pending extra-time explanations in your scope.</p>
        ) : (
          <div className="space-y-3">
            {queues?.explanations.map((ex) => (
              <div
                key={ex.id}
                className="flex flex-col gap-3 rounded-md border border-line bg-canvas/50 p-3.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-1 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-ink">{ex.employee_name}</span>
                    <span className="text-muted">{ex.local_date}</span>
                    <span className="font-semibold text-amber">
                      +{formatMinutesDuration(ex.extra_minutes)}
                    </span>
                  </div>
                  <p className="text-soft">{ex.reason}</p>
                </div>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => setDecisionTarget({ kind: 'explanation', row: ex })}
                >
                  Review
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* HR-Only Field Reviews */}
      {canManage && (
        <section className="rounded-lg border border-line bg-surface p-5 shadow-xs space-y-4">
          <h3 className="font-display text-sm font-bold text-ink">
            HR Field &amp; GPS Follow-Up Queue ({queues?.field_reviews.length ?? 0})
          </h3>
          {(queues?.field_reviews.length ?? 0) === 0 ? (
            <p className="text-xs text-muted">No low-precision or flagged field punches awaiting review.</p>
          ) : (
            <div className="space-y-3">
              {queues?.field_reviews.map((fr) => (
                <div
                  key={fr.punch_id}
                  className="flex flex-col gap-3 rounded-md border border-line bg-canvas/50 p-3.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="space-y-1 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink">{fr.employee_name}</span>
                      <span className="text-muted">{fr.local_date}</span>
                      <LocationCheckPill locationCheck={fr.location_check} />
                      <WorkflowStatusPill status={fr.status} />
                    </div>
                    {fr.accuracy_m != null && (
                      <p className="text-muted">Reported accuracy: ±{Math.round(fr.accuracy_m)}m</p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    leftIcon={<MapPin className="h-3.5 w-3.5" />}
                    onClick={() => setFieldEvidencePunchId(fr.punch_id)}
                  >
                    Inspect GPS Evidence
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )

  const tabs = [
    {
      value: 'register',
      label: (
        <span className="inline-flex items-center gap-1.5">
          <Clock className="h-4 w-4" />
          Attendance Register
        </span>
      ),
      content: registerTabContent,
    },
    ...(canApproveQueues
      ? [
          {
            value: 'approvals',
            label: (
              <span className="inline-flex items-center gap-1.5">
                <ClipboardCheck className="h-4 w-4" />
                Approvals ({pendingTotalCount})
              </span>
            ),
            content: approvalsTabContent,
          },
        ]
      : []),
    ...(canManage
      ? [
          {
            value: 'setup',
            label: 'Setup & Enrolment',
            content: setup ? (
              <AttendanceSetupSection setup={setup} />
            ) : (
              <EmptyState title="Loading setup configuration..." description="Fetching workplaces, schedules, and roster." />
            ),
          },
        ]
      : []),
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="People Operations"
        title="Attendance & Field Operations"
        subtitle="Review daily attendance, resolve missed clock-ins or clock-outs, and manage field and remote schedules."
      />

      <PendingAttendanceOperationsBanner filterScope="admin" />

      {/* Role Scope Notice */}
      <div className="flex items-start gap-3 rounded-lg border border-line bg-surface p-4 text-xs shadow-xs">
        <Shield className="h-4 w-4 shrink-0 text-emerald mt-0.5" />
        <div>
          <p className="font-semibold text-ink">{roleScopeTitle}</p>
          <p className="text-soft mt-0.5">{roleScopeDescription}</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} tabs={tabs} />

      {/* Register Row Inspection SlideOver */}
      <DetailSlideOver
        open={Boolean(selectedRegisterRow)}
        onOpenChange={(open) => {
          if (!open) setSelectedRegisterRow(null)
        }}
        title={selectedRegisterRow?.employee_name ?? ''}
        idText={
          selectedRegisterRow
            ? `${selectedRegisterRow.employee_number} · ${selectedRegisterRow.local_date}`
            : undefined
        }
        statusPill={
          selectedRegisterRow ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <RecordStatePill state={selectedRegisterRow.effective_state} />
              <PolicyProvenancePill
                policyVerified={selectedRegisterRow.policy_verified}
                recordState={selectedRegisterRow.effective_state}
              />
            </div>
          ) : undefined
        }
        stats={
          selectedRegisterRow
            ? [
                {
                  label: 'Started At',
                  value: formatTimeInZone(selectedRegisterRow.clock_in_at, selectedRegisterRow.timezone),
                },
                {
                  label: 'Ended At',
                  value: formatTimeInZone(selectedRegisterRow.clock_out_at, selectedRegisterRow.timezone),
                },
                {
                  label: 'Work Mode',
                  value: <WorkModePill mode={selectedRegisterRow.work_mode} />,
                },
                {
                  label: 'Punctuality',
                  value: <PunctualityPill punctuality={selectedRegisterRow.punctuality} />,
                },
              ]
            : undefined
        }
        sections={
          selectedRegisterRow
            ? [
                {
                  title: 'Location & Provenance',
                  content: (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-2">
                        <LocationCheckPill
                          locationCheck={selectedRegisterRow.clock_in_location_check}
                          distanceM={selectedRegisterRow.clock_in_distance_m}
                        />
                        {selectedRegisterRow.clock_out_location_check && (
                          <LocationCheckPill
                            locationCheck={selectedRegisterRow.clock_out_location_check}
                            distanceM={selectedRegisterRow.clock_out_distance_m}
                          />
                        )}
                      </div>
                      <p>
                        Workplace: <strong className="text-ink">{selectedRegisterRow.workplace_name ?? 'None'}</strong> · Schedule:{' '}
                        <strong className="text-ink">
                          {selectedRegisterRow.policy_verified === false
                            ? 'Unknown / Unverified'
                            : (selectedRegisterRow.schedule_name ?? 'None')}
                        </strong>
                      </p>
                    </div>
                  ),
                },
                {
                  title: 'Review & Extra Time',
                  content: (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-2">
                        <WorkflowStatusPill status={selectedRegisterRow.review_status} />
                        <WorkflowStatusPill status={selectedRegisterRow.explanation_status} />
                      </div>
                      {selectedRegisterRow.extra_minutes > 0 && (
                        <p className="text-amber font-medium">
                          Extra time beyond shift: +{formatMinutesDuration(selectedRegisterRow.extra_minutes)}
                        </p>
                      )}
                    </div>
                  ),
                },
              ]
            : undefined
        }
        footer={
          canManage && selectedRegisterRow ? (
            <div className="flex flex-wrap items-center gap-2 w-full">
              <Button
                size="sm"
                variant="primary"
                leftIcon={<FileEdit className="h-3.5 w-3.5" />}
                onClick={() => {
                  setHrCorrectionTarget(selectedRegisterRow)
                }}
              >
                Direct HR Correction
              </Button>
              {(selectedRegisterRow.clock_in_punch_id || selectedRegisterRow.clock_out_punch_id) && (
                <Button
                  size="sm"
                  variant="outline"
                  leftIcon={<MapPin className="h-3.5 w-3.5" />}
                  onClick={() => {
                    const targetPunch =
                      selectedRegisterRow.clock_in_punch_id ??
                      selectedRegisterRow.clock_out_punch_id ??
                      null
                    setFieldEvidencePunchId(targetPunch)
                  }}
                >
                  Inspect Raw GPS
                </Button>
              )}
            </div>
          ) : undefined
        }
      />

      {/* Workflow Modals */}
      <WorkflowDecisionModal
        open={Boolean(decisionTarget)}
        onOpenChange={(open) => {
          if (!open) setDecisionTarget(null)
        }}
        target={decisionTarget}
      />

      <DecideArrangementModal
        open={Boolean(arrDecisionTarget)}
        onOpenChange={(open) => {
          if (!open) setArrDecisionTarget(null)
        }}
        arrangement={arrDecisionTarget}
      />

      <HrCorrectDayModal
        open={Boolean(hrCorrectionTarget)}
        onOpenChange={(open) => {
          if (!open) setHrCorrectionTarget(null)
        }}
        row={hrCorrectionTarget}
      />

      {canManage && setup && (
        <HrCreateArrangementModal
          open={hrCreateArrOpen}
          onOpenChange={setHrCreateArrOpen}
          roster={setup.roster}
        />
      )}

      {canManage && (
        <FieldEvidenceModal
          open={Boolean(fieldEvidencePunchId)}
          onOpenChange={(open) => {
            if (!open) setFieldEvidencePunchId(null)
          }}
          punchId={fieldEvidencePunchId}
        />
      )}
    </div>
  )
}
