import { useState } from 'react'
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  FileEdit,
  Loader2,
  MapPin,
  PauseCircle,
  Play,
  Square,
  UserX,
} from 'lucide-react'
import { PageHeader } from '@/components/patterns/PageHeader'
import { EmptyState } from '@/components/patterns/EmptyState'
import { DataTable, type ColumnDef } from '@/components/patterns/DataTable'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { Tabs } from '@/components/ui/Wrappers'
import { useToast } from '@/components/ui/Toast'
import { useAuth, useHasPermission } from '@/modules/auth/AuthProvider'
import { captureSessionScopedAttendanceLocation } from '../lib/geolocation'
import {
  addDaysToIsoDate,
  formatLocalDateLabel,
  formatMinutesDuration,
  formatSqlTimeShort,
  formatTimeInZone,
  getTodayIsoInZone,
} from '../lib/zonedTime'
import {
  captureAttendanceSessionSnapshot,
  classifyAttendanceRpcError,
  extractErrorMessage,
  isAbortError,
  isAttendanceSessionCurrent,
  isUnlinkedEmployeeError,
} from '../lib/pendingOperations'
import {
  useAttendanceMyHistory,
  useAttendanceTodayContext,
  useCancelArrangement,
  useCancelCorrection,
  useClockIn,
  useClockOut,
  usePendingAttendanceOperations,
} from '../api/attendance'
import type { MyArrangement, MyCorrection, MyHistoryDay } from '../schemas/attendance'
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
  CorrectionRequestModal,
  ExplanationModal,
  StillWorkingModal,
  SubmitArrangementModal,
} from '../components/MyAttendanceModals'

export function MyAttendancePage() {
  const auth = useAuth()
  const { toast } = useToast()
  const identityKey = auth.session?.userId ?? auth.access?.profile?.id ?? null
  const authEpoch = auth.authEpoch ?? 0
  const isAuthReady = auth.status ? auth.status === 'authenticated' : Boolean(identityKey)

  const canClockSelf = useHasPermission('attendance.clock_self')
  const canReadSelf = useHasPermission('attendance.read_self')

  const [historyDaysSpan, setHistoryDaysSpan] = useState<number>(30)
  const [activeTab, setActiveTab] = useState<string>('history')
  const pendingOps = usePendingAttendanceOperations()
  const pendingPunchOp = pendingOps.find((op) => op.intentKey === 'execution:punch') ?? null
  const [actionError, setActionError] = useState<string | null>(null)
  const [punchBusy, setPunchBusy] = useState(false)

  // Modal state
  const [stillWorkingOpen, setStillWorkingOpen] = useState(false)
  const [correctionModalState, setCorrectionModalState] = useState<{
    open: boolean
    date: string
    kind: 'missing_clock_in' | 'missing_clock_out' | 'wrong_time' | 'location_issue' | 'other'
    inTime: string
    outTime: string
  }>({
    open: false,
    date: getTodayIsoInZone('Africa/Kampala'),
    kind: 'wrong_time',
    inTime: '',
    outTime: '',
  })
  const [explanationTarget, setExplanationTarget] = useState<{
    dayId: string
    localDate: string
    extraMinutes: number
  } | null>(null)
  const [arrangementOpen, setArrangementOpen] = useState(false)

  const todayQuery = useAttendanceTodayContext(canClockSelf)
  const todayTz = todayQuery.data?.timezone ?? 'Africa/Kampala'
  const toDate = todayQuery.data?.local_date ?? getTodayIsoInZone(todayTz)
  const fromDate = addDaysToIsoDate(toDate, -(historyDaysSpan - 1))

  const historyQuery = useAttendanceMyHistory(fromDate, toDate, canReadSelf)

  const clockInMutation = useClockIn()
  const clockOutMutation = useClockOut()
  const cancelCorrectionMutation = useCancelCorrection()
  const cancelArrangementMutation = useCancelArrangement()

  const unlinkedProfile =
    isUnlinkedEmployeeError(todayQuery.error) || isUnlinkedEmployeeError(historyQuery.error)

  const executePunch = async (action: 'clock_in' | 'clock_out') => {
    const today = todayQuery.data
    if (!today || punchBusy || pendingPunchOp) return

    const sessionSnap = captureAttendanceSessionSnapshot({
      identityKey,
      authEpoch,
      isReady: isAuthReady,
    })

    setPunchBusy(true)
    setActionError(null)
    try {
      const location = await captureSessionScopedAttendanceLocation(
        today.work_mode,
        action,
        sessionSnap,
        isAttendanceSessionCurrent,
      )
      const params = {
        locationStatus: location.locationStatus,
        lat: location.lat,
        lng: location.lng,
        accuracyM: location.accuracyM,
        clientCapturedAt: location.clientCapturedAt,
        contextRevision: today.context_revision,
      }
      if (action === 'clock_in') {
        await clockInMutation.mutateAsync(params)
        if (isAttendanceSessionCurrent(sessionSnap)) {
          toast('Workday started', { tone: 'success' })
        }
      } else {
        await clockOutMutation.mutateAsync(params)
        if (isAttendanceSessionCurrent(sessionSnap)) {
          toast('Workday ended', { tone: 'success' })
        }
      }
    } catch (error) {
      if (isAbortError(error) || !isAttendanceSessionCurrent(sessionSnap)) {
        return
      }
      if (classifyAttendanceRpcError(error) === 'definite') {
        setActionError(extractErrorMessage(error))
      }
    } finally {
      setPunchBusy(false)
    }
  }

  const openCorrectionForDay = (day?: MyHistoryDay) => {
    const fallbackKind = !day
      ? 'wrong_time'
      : !day.has_clock_in && !day.has_clock_out
        ? 'wrong_time'
        : !day.has_clock_in
          ? 'missing_clock_in'
          : !day.has_clock_out
            ? 'missing_clock_out'
            : 'wrong_time'
    setCorrectionModalState({
      open: true,
      date: day?.local_date ?? toDate,
      kind: fallbackKind,
      inTime: day?.clock_in_at ? formatTimeInZone(day.clock_in_at, day.timezone).replace('—', '') : '',
      outTime: day?.clock_out_at ? formatTimeInZone(day.clock_out_at, day.timezone).replace('—', '') : '',
    })
  }

  /* ─── History Columns ───────────────────────────────────────────────────── */

  const historyColumns: ColumnDef<MyHistoryDay>[] = [
    {
      key: 'date',
      header: 'Date',
      accessor: (row) => (
        <div>
          <p className="font-semibold text-ink">{formatLocalDateLabel(row.local_date)}</p>
          <p className="text-[11px] text-muted">{row.timezone}</p>
        </div>
      ),
    },
    {
      key: 'mode',
      header: 'Mode & Schedule',
      accessor: (row) => (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <WorkModePill mode={row.clock_in_work_mode ?? row.clock_out_work_mode} />
            <PunctualityPill punctuality={row.punctuality} />
          </div>
          {row.expected_start_at && row.expected_end_at && (
            <p className="text-[11px] text-muted tabular-nums">
              {formatTimeInZone(row.expected_start_at, row.timezone)} –{' '}
              {formatTimeInZone(row.expected_end_at, row.timezone)}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'punches',
      header: 'Recorded Times',
      accessor: (row) => (
        <div className="space-y-1 text-xs tabular-nums">
          <p className="text-ink">
            In: <span className="font-semibold">{formatTimeInZone(row.clock_in_at, row.timezone)}</span>
          </p>
          <p className="text-soft">
            Out: <span className="font-semibold">{formatTimeInZone(row.clock_out_at, row.timezone)}</span>
          </p>
        </div>
      ),
    },
    {
      key: 'gps',
      header: 'Location Evidence',
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
      key: 'status',
      header: 'Status',
      accessor: (row) => (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-1">
            <RecordStatePill state={row.record_state} />
            <PolicyProvenancePill
              policyVerified={row.policy_verified}
              recordState={row.record_state}
            />
          </div>
          {row.extra_minutes > 0 && (
            <p className="text-[11px] font-medium text-amber tabular-nums">
              +{formatMinutesDuration(row.extra_minutes)} extra
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      accessor: (row) => (
        <div className="inline-flex items-center justify-end gap-1.5">
          {row.explanation_status === 'required_unsubmitted' && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                setExplanationTarget({
                  dayId: row.id,
                  localDate: row.local_date,
                  extraMinutes: row.extra_minutes,
                })
              }
            >
              Explain Extra Time
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => openCorrectionForDay(row)}
          >
            Correct
          </Button>
        </div>
      ),
    },
  ]

  const correctionsColumns: ColumnDef<MyCorrection>[] = [
    {
      key: 'date',
      header: 'Date',
      accessor: (row) => (
        <span className="font-semibold text-ink">{formatLocalDateLabel(row.local_date)}</span>
      ),
    },
    {
      key: 'kind',
      header: 'Request',
      accessor: (row) => (
        <div>
          <p className="font-medium text-ink capitalize">{row.request_kind.replace(/_/g, ' ')}</p>
          <p className="text-[11px] text-muted tabular-nums">
            {row.claimed_in_at ? `In ${formatTimeInZone(row.claimed_in_at, todayTz)}` : ''}{' '}
            {row.claimed_out_at ? `Out ${formatTimeInZone(row.claimed_out_at, todayTz)}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'reason',
      header: 'Reason',
      accessor: (row) => <span className="text-soft line-clamp-2">{row.reason}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (row) => (
        <div className="space-y-1">
          <WorkflowStatusPill status={row.status} />
          {row.review_note && <p className="text-[11px] text-muted">{row.review_note}</p>}
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      accessor: (row) =>
        row.status === 'pending' ? (
          <Button
            size="sm"
            variant="outline"
            loading={
              cancelCorrectionMutation.isPending &&
              cancelCorrectionMutation.variables === row.id
            }
            onClick={() => {
              void cancelCorrectionMutation
                .mutateAsync(row.id)
                .then(() => {
                  toast('Correction request cancelled', { tone: 'info' })
                })
                .catch((err) => {
                  toast(extractErrorMessage(err), { tone: 'danger' })
                })
            }}
          >
            Cancel
          </Button>
        ) : (
          <span className="text-xs text-muted">—</span>
        ),
    },
  ]

  const arrangementColumns: ColumnDef<MyArrangement>[] = [
    {
      key: 'mode',
      header: 'Work Mode',
      accessor: (row) => (
        <div className="space-y-1">
          <WorkModePill mode={row.mode} />
          {row.duty_label && <p className="text-[11px] font-medium text-ink">{row.duty_label}</p>}
        </div>
      ),
    },
    {
      key: 'coverage',
      header: 'Coverage',
      accessor: (row) => (
        <div className="text-xs">
          <p className="font-medium text-ink">
            {row.start_date}
            {row.end_date ? ` → ${row.end_date}` : ' onwards'}
          </p>
          {row.coverage_type === 'weekly' && (
            <p className="text-[11px] text-muted">{formatWeekdaysSummary(row.weekdays)}</p>
          )}
        </div>
      ),
    },
    {
      key: 'reason',
      header: 'Reason',
      accessor: (row) => <span className="text-soft line-clamp-2">{row.reason}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (row) => (
        <div className="space-y-1">
          <WorkflowStatusPill status={row.status} />
          {row.review_note && <p className="text-[11px] text-muted">{row.review_note}</p>}
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      accessor: (row) =>
        (row.status === 'pending' || row.status === 'approved') && row.source === 'employee' ? (
          <Button
            size="sm"
            variant="outline"
            loading={
              cancelArrangementMutation.isPending &&
              cancelArrangementMutation.variables?.arrangementId === row.id
            }
            onClick={() => {
              void cancelArrangementMutation
                .mutateAsync({
                  arrangementId: row.id,
                  expectedVersion: row.version,
                })
                .then(() => {
                  toast('Arrangement cancelled', { tone: 'info' })
                })
                .catch((err) => {
                  toast(extractErrorMessage(err), { tone: 'danger' })
                })
            }}
          >
            Cancel
          </Button>
        ) : (
          <span className="text-xs text-muted">—</span>
        ),
    },
  ]

  if (unlinkedProfile) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Self-Service"
          title="My Attendance"
          subtitle="Track your daily attendance, location provenance, corrections, and work arrangements."
        />
        <div className="rounded-lg border border-line bg-surface p-8 shadow-xs">
          <EmptyState
            icon={<UserX className="h-6 w-6" />}
            tone="amber"
            title="Profile Not Linked to an Employee Record"
            description="No active employee record is linked to your profile. Ask HR to link your employee profile in People → Employees before using self-service attendance."
          />
        </div>
      </div>
    )
  }

  const today = todayQuery.data
  const day = today?.day
  const history = historyQuery.data
  const canSubmitToday = Boolean(
    today &&
      today.enabled &&
      today.enrolled &&
      today.work_mode !== 'none' &&
      !today.is_holiday &&
      !pendingPunchOp,
  )

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Self-Service"
        title="My Attendance"
        subtitle="Record your daily Start Day / End Day, submit corrections, and manage approved field or remote work."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              leftIcon={<FileEdit className="h-4 w-4" />}
              onClick={() => openCorrectionForDay(undefined)}
            >
              Request Correction
            </Button>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<MapPin className="h-4 w-4" />}
              onClick={() => setArrangementOpen(true)}
            >
              Field / Remote Request
            </Button>
          </div>
        }
      />

      {/* Pending Uncertain-Transport Banner (Persists Across Reloads for Self Actions) */}
      <PendingAttendanceOperationsBanner filterScope="self" />

      {/* Action Rejection Alert */}
      {actionError && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-rose/40 bg-rose-tint p-4 text-xs text-rose"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Today Hero Card */}
      {canClockSelf && (
        <section className="rounded-lg border border-line bg-surface p-5 sm:p-6 shadow-xs space-y-5">
          {todayQuery.isLoading ? (
            <Skeleton shape="kpi" />
          ) : todayQuery.error ? (
            <EmptyState
              tone="rose"
              title="Unable to Load Today's Attendance"
              description={extractErrorMessage(todayQuery.error)}
              action={
                <Button variant="outline" size="sm" onClick={() => void todayQuery.refetch()}>
                  Retry
                </Button>
              }
            />
          ) : today ? (
            <>
              {!today.enabled && (
                <div className="flex items-start gap-3 rounded-md border border-blue/30 bg-blue-tint p-3.5 text-xs text-ink">
                  <PauseCircle className="h-4 w-4 shrink-0 text-blue mt-0.5" />
                  <div>
                    <p className="font-semibold">Live attendance capture is currently disabled</p>
                    <p className="text-soft mt-0.5">
                      HR has paused live Start Day / End Day tracking while setup is confirmed.
                      Historical logs, correction requests, and arrangement submissions remain available.
                    </p>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-lg font-bold text-ink">
                      {formatLocalDateLabel(today.local_date)}
                    </span>
                    <WorkModePill mode={today.work_mode} />
                    <span className="rounded bg-canvas px-2 py-0.5 font-mono text-[11px] text-muted ring-1 ring-line">
                      {today.timezone}
                    </span>
                    {today.is_holiday && (
                      <span className="rounded bg-violet-tint px-2 py-0.5 text-[11px] font-semibold text-violet">
                        Holiday{today.holiday_name ? `: ${today.holiday_name}` : ''}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-soft">
                    {today.schedule?.is_workday ? (
                      <span className="inline-flex items-center gap-1.5 tabular-nums">
                        <Clock className="h-3.5 w-3.5 text-emerald" />
                        Scheduled: {formatSqlTimeShort(today.schedule.expected_start)} –{' '}
                        {formatSqlTimeShort(today.schedule.expected_end)}
                      </span>
                    ) : (
                      <span>No regular shift scheduled today</span>
                    )}
                    {today.workplace && (
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-blue" />
                        {today.workplace.name} ({today.workplace.radius_meters}m zone)
                      </span>
                    )}
                    {today.active_arrangement?.duty_label && (
                      <span className="inline-flex items-center gap-1.5 text-ink font-medium">
                        <CalendarClock className="h-3.5 w-3.5 text-amber" />
                        {today.active_arrangement.duty_label}
                      </span>
                    )}
                  </div>

                  {!today.enrolled && (
                    <p className="text-xs text-amber">
                      Your profile has not been enrolled into an active attendance schedule yet.
                    </p>
                  )}
                  {today.enrolled && today.work_mode === 'none' && !today.is_holiday && (
                    <p className="text-xs text-amber">
                      {today.mode_reason === 'arrangement_needed'
                        ? 'Your enrolment requires an approved Field or Remote work arrangement for today.'
                        : 'Assigned office workplace is currently inactive. Request an arrangement or contact HR.'}
                    </p>
                  )}
                </div>

                {/* Single Primary CTA */}
                <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                  {!day?.has_clock_in && (
                    <Button
                      variant="primary"
                      size="lg"
                      disabled={!canSubmitToday || punchBusy}
                      loading={punchBusy && clockInMutation.isPending}
                      leftIcon={punchBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                      onClick={() => void executePunch('clock_in')}
                    >
                      Start Day
                    </Button>
                  )}

                  {day?.has_clock_in && !day?.has_clock_out && (
                    <>
                      <Button
                        variant="outline"
                        size="md"
                        disabled={!canSubmitToday || punchBusy}
                        leftIcon={<CalendarClock className="h-4 w-4" />}
                        onClick={() => setStillWorkingOpen(true)}
                      >
                        Still Working
                      </Button>
                      <Button
                        variant="primary"
                        size="lg"
                        disabled={!canSubmitToday || punchBusy}
                        loading={punchBusy && clockOutMutation.isPending}
                        leftIcon={<Square className="h-4 w-4" />}
                        onClick={() => void executePunch('clock_out')}
                      >
                        End Day
                      </Button>
                    </>
                  )}

                  {day?.has_clock_in && day?.has_clock_out && (
                    <div className="inline-flex items-center gap-2 rounded-md border border-emerald/30 bg-emerald-tint px-3.5 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald">
                      <CheckCircle2 className="h-4 w-4" />
                      <span>Workday Complete</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Recorded Today Summary */}
              {day && (day.has_clock_in || day.has_clock_out) && (
                <div className="grid grid-cols-1 gap-3 border-t border-line pt-4 sm:grid-cols-3">
                  <div className="rounded-md bg-canvas/70 p-3 space-y-1">
                    <p className="text-[11px] font-medium text-muted">Started At</p>
                    <p className="font-display text-base font-bold text-ink tabular-nums">
                      {formatTimeInZone(day.clock_in_at, today.timezone)}
                    </p>
                    <LocationCheckPill
                      locationCheck={day.clock_in_location_check}
                      distanceM={day.clock_in_distance_m}
                    />
                  </div>

                  <div className="rounded-md bg-canvas/70 p-3 space-y-1">
                    <p className="text-[11px] font-medium text-muted">Ended At</p>
                    <p className="font-display text-base font-bold text-ink tabular-nums">
                      {formatTimeInZone(day.clock_out_at, today.timezone)}
                    </p>
                    <LocationCheckPill
                      locationCheck={day.clock_out_location_check}
                      distanceM={day.clock_out_distance_m}
                    />
                  </div>

                  <div className="rounded-md bg-canvas/70 p-3 space-y-1.5">
                    <p className="text-[11px] font-medium text-muted">Day Status &amp; Extra Time</p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <RecordStatePill state={day.record_state} />
                      <PolicyProvenancePill
                        policyVerified={day.policy_verified}
                        recordState={day.record_state}
                      />
                      <WorkflowStatusPill status={day.explanation_status} />
                    </div>
                    {day.still_working_until && (
                      <p className="text-[11px] text-soft tabular-nums">
                        Extended until {formatTimeInZone(day.still_working_until, today.timezone)}
                      </p>
                    )}
                    {day.explanation_status === 'required_unsubmitted' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          setExplanationTarget({
                            dayId: day.id,
                            localDate: day.local_date,
                            extraMinutes: day.extra_minutes,
                          })
                        }
                      >
                        Explain +{formatMinutesDuration(day.extra_minutes)}
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </section>
      )}

      {/* History Range Selector */}
      {canReadSelf && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3 shadow-xs">
          <div>
            <p className="font-display text-sm font-bold text-ink">Personal Records</p>
            <p className="text-xs text-muted tabular-nums">
              Showing {fromDate} to {toDate}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {[14, 30, 60, 90].map((span) => (
              <Button
                key={span}
                size="sm"
                variant={historyDaysSpan === span ? 'primary' : 'outline'}
                onClick={() => setHistoryDaysSpan(span)}
              >
                {span}d
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      {canReadSelf && (
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          tabs={[
            {
              value: 'history',
              label: `Daily Log (${history?.days.length ?? 0})`,
              content: (
                <div className="space-y-4">
                  <div className="hidden md:block">
                    <DataTable
                      columns={historyColumns}
                      data={history?.days ?? []}
                      loading={historyQuery.isLoading}
                      keyExtractor={(row) => row.id}
                      emptyTitle="No attendance days in this period"
                      emptyDescription="Recorded daily attendance and approved corrections will appear here."
                    />
                  </div>
                  <div className="space-y-3 md:hidden">
                    {(history?.days ?? []).length === 0 ? (
                      <div className="rounded-lg border border-line bg-surface p-6">
                        <EmptyState
                          title="No attendance days in this period"
                          description="Recorded daily attendance will appear here."
                        />
                      </div>
                    ) : (
                      (history?.days ?? []).map((row) => (
                        <div
                          key={row.id}
                          className="rounded-lg border border-line bg-surface p-4 shadow-xs space-y-2.5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-display text-sm font-bold text-ink">
                                {formatLocalDateLabel(row.local_date)}
                              </p>
                              <div className="mt-1 flex flex-wrap gap-1.5">
                                <WorkModePill mode={row.clock_in_work_mode ?? row.clock_out_work_mode} />
                                <PunctualityPill punctuality={row.punctuality} />
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center justify-end gap-1">
                              <RecordStatePill state={row.record_state} />
                              <PolicyProvenancePill
                                policyVerified={row.policy_verified}
                                recordState={row.record_state}
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2 border-t border-line pt-2 text-xs tabular-nums">
                            <div>
                              <p className="text-muted">In</p>
                              <p className="font-semibold text-ink">
                                {formatTimeInZone(row.clock_in_at, row.timezone)}
                              </p>
                              <LocationCheckPill
                                locationCheck={row.clock_in_location_check}
                                distanceM={row.clock_in_distance_m}
                              />
                            </div>
                            <div>
                              <p className="text-muted">Out</p>
                              <p className="font-semibold text-ink">
                                {formatTimeInZone(row.clock_out_at, row.timezone)}
                              </p>
                              {row.clock_out_location_check && (
                                <LocationCheckPill
                                  locationCheck={row.clock_out_location_check}
                                  distanceM={row.clock_out_distance_m}
                                />
                              )}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2 border-t border-line pt-2">
                            {row.explanation_status === 'required_unsubmitted' && (
                              <Button
                                size="sm"
                                variant="secondary"
                                className="flex-1"
                                onClick={() =>
                                  setExplanationTarget({
                                    dayId: row.id,
                                    localDate: row.local_date,
                                    extraMinutes: row.extra_minutes,
                                  })
                                }
                              >
                                Explain Extra Time
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="flex-1"
                              onClick={() => openCorrectionForDay(row)}
                            >
                              Request Correction
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ),
            },
            {
              value: 'corrections',
              label: `Corrections (${history?.corrections.length ?? 0})`,
              content: (
                <div className="space-y-4">
                  <div className="hidden md:block">
                    <DataTable
                      columns={correctionsColumns}
                      data={history?.corrections ?? []}
                      loading={historyQuery.isLoading}
                      keyExtractor={(row) => row.id}
                      emptyTitle="No correction requests"
                      emptyDescription="Use Request Correction above if you missed a punch or worked an adjusted window."
                    />
                  </div>
                  <div className="space-y-3 md:hidden">
                    {(history?.corrections ?? []).map((row) => (
                      <div
                        key={row.id}
                        className="rounded-lg border border-line bg-surface p-4 shadow-xs space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-display text-sm font-bold text-ink">
                              {formatLocalDateLabel(row.local_date)}
                            </p>
                            <p className="text-xs text-muted capitalize">
                              {row.request_kind.replace(/_/g, ' ')}
                            </p>
                          </div>
                          <WorkflowStatusPill status={row.status} />
                        </div>
                        <p className="text-xs text-soft">{row.reason}</p>
                        {row.review_note && (
                          <p className="text-xs text-muted">Review: {row.review_note}</p>
                        )}
                        {row.status === 'pending' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void cancelCorrectionMutation.mutateAsync(row.id)}
                          >
                            Cancel Request
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ),
            },
            {
              value: 'arrangements',
              label: `Field & Remote (${history?.arrangements.length ?? 0})`,
              content: (
                <div className="space-y-4">
                  <div className="hidden md:block">
                    <DataTable
                      columns={arrangementColumns}
                      data={history?.arrangements ?? []}
                      loading={historyQuery.isLoading}
                      keyExtractor={(row) => row.id}
                      emptyTitle="No field or remote arrangements"
                      emptyDescription="Request a dated or recurring field/remote schedule when working offsite."
                    />
                  </div>
                  <div className="space-y-3 md:hidden">
                    {(history?.arrangements ?? []).map((row) => (
                      <div
                        key={row.id}
                        className="rounded-lg border border-line bg-surface p-4 shadow-xs space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <WorkModePill mode={row.mode} />
                          <WorkflowStatusPill status={row.status} />
                        </div>
                        <p className="text-xs font-semibold text-ink">
                          {row.start_date}
                          {row.end_date ? ` → ${row.end_date}` : ' onwards'}
                        </p>
                        {row.duty_label && <p className="text-xs text-ink">{row.duty_label}</p>}
                        <p className="text-xs text-soft">{row.reason}</p>
                        {(row.status === 'pending' || row.status === 'approved') &&
                          row.source === 'employee' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void cancelArrangementMutation.mutateAsync({
                                arrangementId: row.id,
                                expectedVersion: row.version,
                              })
                            }
                          >
                            Cancel Request
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ),
            },
          ]}
        />
      )}

      {/* Modals */}
      {today && (
        <StillWorkingModal
          open={stillWorkingOpen}
          onOpenChange={setStillWorkingOpen}
          today={today}
        />
      )}

      <CorrectionRequestModal
        open={correctionModalState.open}
        onOpenChange={(open) => setCorrectionModalState((prev) => ({ ...prev, open }))}
        defaultDate={correctionModalState.date}
        defaultKind={correctionModalState.kind}
        defaultInTime={correctionModalState.inTime}
        defaultOutTime={correctionModalState.outTime}
        timeZone={todayTz}
      />

      {explanationTarget && (
        <ExplanationModal
          open={Boolean(explanationTarget)}
          onOpenChange={(open) => {
            if (!open) setExplanationTarget(null)
          }}
          attendanceDayId={explanationTarget.dayId}
          localDate={explanationTarget.localDate}
          extraMinutes={explanationTarget.extraMinutes}
          timeZone={todayTz}
        />
      )}

      <SubmitArrangementModal
        open={arrangementOpen}
        onOpenChange={setArrangementOpen}
        defaultDate={toDate}
      />
    </div>
  )
}
