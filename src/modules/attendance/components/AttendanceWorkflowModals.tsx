import { useEffect, useId, useState } from 'react'
import { AlertTriangle, MapPin, ShieldCheck } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { FormGroup, Input, Textarea } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Combobox } from '@/components/ui/Combobox'
import { Switch } from '@/components/ui/Toggles'
import { useToast } from '@/components/ui/Toast'
import {
  formatDateTimeInZone,
  formatTimeInZone,
  getTodayIsoInZone,
  zonedWallClockToIso,
} from '../lib/zonedTime'
import {
  isApplyFromNowRequiredError,
  parseArrangementConflictId,
} from '../lib/pendingOperations'
import {
  useAttendanceArrangements,
  useAttendanceFieldEvidence,
  useAttendanceRegister,
  useDecideArrangement,
  useDecideCorrection,
  useDecideExplanation,
  useHrCorrectDay,
  useHrCreateArrangement,
  useReviewFieldEvidence,
} from '../api/attendance'
import type {
  ArrangementRow,
  RegisterRow,
  ReviewCorrectionRow,
  ReviewExplanationRow,
  SetupRosterRow,
} from '../schemas/attendance'
import {
  LocationCheckPill,
  ModalSubmitFooter,
  WEEKDAY_OPTIONS,
  WorkModePill,
  WorkflowStatusPill,
} from './AttendanceBadges'

/* ─── Correction / Explanation Review Modal ───────────────────────────────── */

export function WorkflowDecisionModal({
  open,
  onOpenChange,
  target,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  target:
    | { kind: 'correction'; row: ReviewCorrectionRow }
    | { kind: 'explanation'; row: ReviewExplanationRow }
    | null
}) {
  const formId = useId()
  const { toast } = useToast()
  const decideCorrection = useDecideCorrection()
  const decideExplanation = useDecideExplanation()

  const [decision, setDecision] = useState<'approved' | 'rejected'>('approved')
  const [note, setNote] = useState('')
  const [dirty, setDirty] = useState(false)
  const [submitError, setSubmitError] = useState<unknown>(null)

  useEffect(() => {
    if (open) {
      setDecision('approved')
      setNote('')
      setDirty(false)
      setSubmitError(null)
    }
  }, [open, target])

  const isPending = decideCorrection.isPending || decideExplanation.isPending

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!target) return
    setSubmitError(null)
    if (decision === 'rejected' && note.trim().length < 3) {
      setSubmitError(new Error('Rejection requires a review note of at least 3 characters.'))
      return
    }
    try {
      if (target.kind === 'correction') {
        await decideCorrection.mutateAsync({
          correctionId: target.row.id,
          decision,
          reviewNote: note.trim() || null,
          dayVersion: target.row.day_version,
        })
        toast(`Correction ${decision}`, { tone: decision === 'approved' ? 'success' : 'info' })
      } else {
        await decideExplanation.mutateAsync({
          explanationId: target.row.id,
          decision,
          reviewNote: note.trim() || null,
        })
        toast(`Explanation ${decision}`, { tone: decision === 'approved' ? 'success' : 'info' })
      }
      onOpenChange(false)
    } catch (error) {
      setSubmitError(error)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        target?.kind === 'correction'
          ? `Review Correction — ${target.row.employee_name}`
          : `Review Extra Time — ${target?.row.employee_name ?? ''}`
      }
      description={target ? `${target.row.local_date}: ${target.row.reason}` : undefined}
      hasUnsavedChanges={dirty}
      footer={
        <ModalSubmitFooter
          formId={formId}
          submitError={submitError}
          isPending={isPending}
          submitLabel={decision === 'approved' ? 'Approve' : 'Reject'}
          submitVariant={decision === 'rejected' ? 'danger' : 'primary'}
        />
      }
    >
      <form id={formId} onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <FormGroup label="Decision" required>
          <Select
            value={decision}
            onValueChange={(v) => {
              setDecision(v as 'approved' | 'rejected')
              setDirty(true)
            }}
            options={[
              { value: 'approved', label: 'Approve' },
              { value: 'rejected', label: 'Reject (note required)' },
            ]}
          />
        </FormGroup>

        <FormGroup label="Review Note" required={decision === 'rejected'}>
          <Textarea
            rows={3}
            value={note}
            onChange={(e) => {
              setNote(e.target.value)
              setDirty(true)
            }}
            placeholder={
              decision === 'rejected'
                ? 'Provide clear reason for rejection (min 3 characters)...'
                : 'Optional note...'
            }
          />
        </FormGroup>
      </form>
    </Dialog>
  )
}

/* ─── Arrangement Decision Modal (Handles Overlap Replace & Apply-From-Now) ── */

export function DecideArrangementModal({
  open,
  onOpenChange,
  arrangement,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  arrangement: ArrangementRow | null
}) {
  const formId = useId()
  const { toast } = useToast()
  const mutation = useDecideArrangement()

  const [decision, setDecision] = useState<'approved' | 'rejected'>('approved')
  const [note, setNote] = useState('')
  const [replaceConflict, setReplaceConflict] = useState(false)
  const [conflictId, setConflictId] = useState<string | null>(null)
  const [applyFromNow, setApplyFromNow] = useState(false)
  const [applyReason, setApplyReason] = useState('')
  const [dirty, setDirty] = useState(false)
  const [submitError, setSubmitError] = useState<unknown>(null)

  const todayIso = getTodayIsoInZone('Africa/Kampala')

  const empApprovedQuery = useAttendanceArrangements(
    {
      employeeId: arrangement?.employee_id ?? null,
      status: 'approved',
      reviewOnly: false,
    },
    open && Boolean(arrangement) && Boolean(conflictId),
  )

  const empTodayRegister = useAttendanceRegister(
    {
      from: todayIso,
      to: todayIso,
      employeeId: arrangement?.employee_id ?? null,
      limit: 5,
      offset: 0,
    },
    open && Boolean(arrangement) && applyFromNow,
  )

  const matchedConflict =
    empApprovedQuery.data?.rows.find((r) => r.id === conflictId) ?? null
  const todayDayVersion = empTodayRegister.data?.rows[0]?.day_version ?? null

  useEffect(() => {
    if (open) {
      setDecision('approved')
      setNote('')
      setReplaceConflict(false)
      setConflictId(null)
      setApplyFromNow(false)
      setApplyReason('')
      setDirty(false)
      setSubmitError(null)
    }
  }, [open, arrangement])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!arrangement) return
    setSubmitError(null)
    if (decision === 'rejected' && note.trim().length < 3) {
      setSubmitError(new Error('Rejecting requires a review note of at least 3 characters.'))
      return
    }
    if (applyFromNow && applyReason.trim().length < 3) {
      setSubmitError(new Error('Apply-from-now switch requires a reason (minimum 3 characters).'))
      return
    }
    try {
      await mutation.mutateAsync({
        arrangementId: arrangement.id,
        decision,
        reviewNote: note.trim() || null,
        expectedVersion: arrangement.version,
        replace: decision === 'approved' && replaceConflict && Boolean(matchedConflict),
        applyFromNow: decision === 'approved' && applyFromNow,
        applyReason: decision === 'approved' && applyFromNow ? applyReason.trim() : null,
        dayVersion: decision === 'approved' && applyFromNow ? todayDayVersion : null,
        expectedReplacedId:
          decision === 'approved' && replaceConflict ? (matchedConflict?.id ?? null) : null,
        expectedReplacedVersion:
          decision === 'approved' && replaceConflict ? (matchedConflict?.version ?? null) : null,
      })
      toast(`Work arrangement ${decision}`, { tone: decision === 'approved' ? 'success' : 'info' })
      onOpenChange(false)
    } catch (error) {
      const detectedConflict = parseArrangementConflictId(error)
      if (detectedConflict) {
        setConflictId(detectedConflict)
        setReplaceConflict(true)
      }
      if (isApplyFromNowRequiredError(error)) {
        setApplyFromNow(true)
      }
      setSubmitError(error)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Review Arrangement — ${arrangement?.employee_name ?? ''}`}
      description={
        arrangement
          ? `${arrangement.mode.toUpperCase()} (${arrangement.start_date}${arrangement.end_date ? ` → ${arrangement.end_date}` : ''}): ${arrangement.reason}`
          : undefined
      }
      hasUnsavedChanges={dirty}
      footer={
        <ModalSubmitFooter
          formId={formId}
          submitError={submitError}
          isPending={mutation.isPending}
          submitLabel={decision === 'approved' ? 'Approve Arrangement' : 'Reject Arrangement'}
          submitVariant={decision === 'rejected' ? 'danger' : 'primary'}
        />
      }
    >
      <form id={formId} onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <FormGroup label="Decision" required>
          <Select
            value={decision}
            onValueChange={(v) => {
              setDecision(v as 'approved' | 'rejected')
              setDirty(true)
            }}
            options={[
              { value: 'approved', label: 'Approve Arrangement' },
              { value: 'rejected', label: 'Reject Arrangement (note required)' },
            ]}
          />
        </FormGroup>

        {decision === 'approved' && conflictId && (
          <div className="rounded-md border border-amber/40 bg-amber-tint p-3 space-y-2 text-xs">
            <p className="font-semibold text-ink">
              Overlapping approved arrangement detected ({matchedConflict ? `${matchedConflict.mode} · ${matchedConflict.start_date}` : conflictId.slice(0, 8)}).
            </p>
            <Switch
              checked={replaceConflict}
              onCheckedChange={setReplaceConflict}
              label="Replace overlapping arrangement cleanly"
            />
          </div>
        )}

        {decision === 'approved' && (
          <div className="space-y-3 rounded-md border border-line bg-canvas/50 p-3">
            <Switch
              checked={applyFromNow}
              onCheckedChange={(checked) => {
                setApplyFromNow(checked)
                setDirty(true)
              }}
              label="Apply switch mid-day from now (keeps morning punch mode intact)"
            />
            {applyFromNow && (
              <FormGroup
                label="Mid-Day Switch Audit Reason"
                required
                hint={
                  todayDayVersion !== null
                    ? `Locks today's day version v${todayDayVersion}`
                    : 'Loading today attendance day version...'
                }
              >
                <Input
                  value={applyReason}
                  onChange={(e) => {
                    setApplyReason(e.target.value)
                    setDirty(true)
                  }}
                  placeholder="e.g. Dispatched to client site after morning office check-in"
                />
              </FormGroup>
            )}
          </div>
        )}

        <FormGroup label="Review Note" required={decision === 'rejected'}>
          <Textarea
            rows={2}
            value={note}
            onChange={(e) => {
              setNote(e.target.value)
              setDirty(true)
            }}
            placeholder={decision === 'rejected' ? 'Rejection reason...' : 'Optional approval note...'}
          />
        </FormGroup>
      </form>
    </Dialog>
  )
}

/* ─── HR Direct Day Correction Modal ──────────────────────────────────────── */

export function HrCorrectDayModal({
  open,
  onOpenChange,
  row,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  row: RegisterRow | null
}) {
  const formId = useId()
  const { toast } = useToast()
  const mutation = useHrCorrectDay()

  const [inTime, setInTime] = useState('')
  const [outTime, setOutTime] = useState('')
  const [reason, setReason] = useState('')
  const [dirty, setDirty] = useState(false)
  const [submitError, setSubmitError] = useState<unknown>(null)

  useEffect(() => {
    if (!open || !row) return
    setInTime(row.clock_in_at ? formatTimeInZone(row.clock_in_at, row.timezone).replace('—', '') : '')
    setOutTime(row.clock_out_at ? formatTimeInZone(row.clock_out_at, row.timezone).replace('—', '') : '')
    setReason('')
    setDirty(false)
    setSubmitError(null)
  }, [open, row])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!row) return
    setSubmitError(null)
    if (!inTime.trim() && !outTime.trim()) {
      setSubmitError(new Error('Provide at least one corrected time.'))
      return
    }
    if (reason.trim().length < 10) {
      setSubmitError(new Error('Audit reason requires at least 10 characters.'))
      return
    }
    try {
      const claimedInAt = inTime.trim()
        ? zonedWallClockToIso(row.local_date, inTime.trim(), row.timezone)
        : null
      const claimedOutAt = outTime.trim()
        ? zonedWallClockToIso(row.local_date, outTime.trim(), row.timezone)
        : null

      await mutation.mutateAsync({
        employeeId: row.employee_id,
        localDate: row.local_date,
        claimedInAt,
        claimedOutAt,
        reason: reason.trim(),
        expectedDayVersion: row.day_version ?? null,
      })
      toast('Direct HR day correction applied', { tone: 'success' })
      onOpenChange(false)
    } catch (error) {
      setSubmitError(error)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Direct HR Correction — ${row?.employee_name ?? ''}`}
      description={row ? `${row.local_date} (${row.timezone})` : undefined}
      hasUnsavedChanges={dirty}
      footer={
        <ModalSubmitFooter
          formId={formId}
          submitError={submitError}
          isPending={mutation.isPending}
          submitLabel="Apply Correction"
        />
      }
    >
      <form id={formId} onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormGroup label="Corrected Start Time">
            <Input
              type="time"
              value={inTime}
              onChange={(e) => {
                setInTime(e.target.value)
                setDirty(true)
              }}
            />
          </FormGroup>
          <FormGroup label="Corrected End Time">
            <Input
              type="time"
              value={outTime}
              onChange={(e) => {
                setOutTime(e.target.value)
                setDirty(true)
              }}
            />
          </FormGroup>
        </div>

        <FormGroup label="Audit Reason" required>
          <Textarea
            rows={3}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value)
              setDirty(true)
            }}
            placeholder="Reason for HR override / correction..."
          />
        </FormGroup>
      </form>
    </Dialog>
  )
}

/* ─── HR Create Direct Work Arrangement Modal ─────────────────────────────── */

export function HrCreateArrangementModal({
  open,
  onOpenChange,
  roster,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  roster: SetupRosterRow[]
}) {
  const formId = useId()
  const { toast } = useToast()
  const mutation = useHrCreateArrangement()
  const todayIso = getTodayIsoInZone('Africa/Kampala')

  const [employeeId, setEmployeeId] = useState('')
  const [mode, setMode] = useState<'field' | 'remote'>('field')
  const [coverageType, setCoverageType] = useState<'dated' | 'weekly'>('dated')
  const [startDate, setStartDate] = useState(todayIso)
  const [endDate, setEndDate] = useState(todayIso)
  const [weekdays, setWeekdays] = useState<number[]>([1, 3, 5])
  const [dutyLabel, setDutyLabel] = useState('')
  const [reason, setReason] = useState('')
  const [conflictId, setConflictId] = useState<string | null>(null)
  const [replaceConflict, setReplaceConflict] = useState(false)
  const [applyFromNow, setApplyFromNow] = useState(false)
  const [applyReason, setApplyReason] = useState('')
  const [dirty, setDirty] = useState(false)
  const [submitError, setSubmitError] = useState<unknown>(null)

  const empApprovedQuery = useAttendanceArrangements(
    { employeeId: employeeId || null, status: 'approved', reviewOnly: false },
    open && Boolean(employeeId) && Boolean(conflictId),
  )
  const matchedConflict =
    empApprovedQuery.data?.rows.find((r) => r.id === conflictId) ?? null

  const empTodayRegister = useAttendanceRegister(
    { from: todayIso, to: todayIso, employeeId: employeeId || null, limit: 5, offset: 0 },
    open && Boolean(employeeId) && applyFromNow,
  )
  const todayDayVersion = empTodayRegister.data?.rows[0]?.day_version ?? null

  useEffect(() => {
    if (!open) return
    setEmployeeId('')
    setMode('field')
    setCoverageType('dated')
    setStartDate(todayIso)
    setEndDate(todayIso)
    setWeekdays([1, 3, 5])
    setDutyLabel('')
    setReason('')
    setConflictId(null)
    setReplaceConflict(false)
    setApplyFromNow(false)
    setApplyReason('')
    setDirty(false)
    setSubmitError(null)
  }, [open, todayIso])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitError(null)
    if (!employeeId) {
      setSubmitError(new Error('Select an employee.'))
      return
    }
    if (reason.trim().length < 3) {
      setSubmitError(new Error('Reason requires at least 3 characters.'))
      return
    }
    try {
      await mutation.mutateAsync({
        employeeId,
        mode,
        coverageType,
        startDate,
        endDate: endDate.trim() || null,
        weekdays: coverageType === 'weekly' ? weekdays : null,
        reason: reason.trim(),
        dutyLabel: dutyLabel.trim() || null,
        replace: replaceConflict && Boolean(matchedConflict),
        applyFromNow,
        applyReason: applyFromNow ? applyReason.trim() : null,
        dayVersion: applyFromNow ? todayDayVersion : null,
        expectedReplacedId: replaceConflict ? (matchedConflict?.id ?? null) : null,
        expectedReplacedVersion: replaceConflict ? (matchedConflict?.version ?? null) : null,
      })
      toast('Approved work arrangement assigned', { tone: 'success' })
      onOpenChange(false)
    } catch (error) {
      const detected = parseArrangementConflictId(error)
      if (detected) {
        setConflictId(detected)
        setReplaceConflict(true)
      }
      if (isApplyFromNowRequiredError(error)) {
        setApplyFromNow(true)
      }
      setSubmitError(error)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      className="sm:max-w-2xl"
      title="Assign Field / Remote Arrangement (HR)"
      description="Create an approved field or remote schedule directly for an employee."
      hasUnsavedChanges={dirty}
      footer={
        <ModalSubmitFooter
          formId={formId}
          submitError={submitError}
          isPending={mutation.isPending}
          submitLabel="Assign Arrangement"
        />
      }
    >
      <form id={formId} onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <FormGroup label="Employee" required>
          <Combobox
            value={employeeId}
            onValueChange={(v) => {
              setEmployeeId(v)
              setDirty(true)
            }}
            placeholder="Select staff member..."
            options={roster.map((r) => ({
              value: r.employee_id,
              label: r.legal_name,
              subtitle: r.employee_number,
            }))}
          />
        </FormGroup>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormGroup label="Work Mode" required>
            <Select
              value={mode}
              onValueChange={(v) => {
                setMode(v as 'field' | 'remote')
                setDirty(true)
              }}
              options={[
                { value: 'field', label: 'Field Work' },
                { value: 'remote', label: 'Remote Work' },
              ]}
            />
          </FormGroup>

          <FormGroup label="Coverage Pattern" required>
            <Select
              value={coverageType}
              onValueChange={(v) => {
                setCoverageType(v as 'dated' | 'weekly')
                setDirty(true)
              }}
              options={[
                { value: 'dated', label: 'Specific Date Range' },
                { value: 'weekly', label: 'Weekly Recurring' },
              ]}
            />
          </FormGroup>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormGroup label="Start Date" required>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value)
                setDirty(true)
              }}
            />
          </FormGroup>
          <FormGroup label={coverageType === 'dated' ? 'End Date' : 'End Date (optional)'}>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value)
                setDirty(true)
              }}
            />
          </FormGroup>
        </div>

        {coverageType === 'weekly' && (
          <FormGroup label="Weekdays" required>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAY_OPTIONS.map((d) => {
                const active = weekdays.includes(d.value)
                return (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => {
                      setWeekdays((prev) =>
                        prev.includes(d.value)
                          ? prev.filter((x) => x !== d.value)
                          : [...prev, d.value],
                      )
                      setDirty(true)
                    }}
                    className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${
                      active
                        ? 'border-emerald bg-emerald text-white'
                        : 'border-line bg-surface text-soft'
                    }`}
                  >
                    {d.short}
                  </button>
                )
              })}
            </div>
          </FormGroup>
        )}

        <FormGroup label="Duty / Site Label (optional)">
          <Input
            value={dutyLabel}
            onChange={(e) => {
              setDutyLabel(e.target.value)
              setDirty(true)
            }}
            placeholder="e.g. Mbarara MTN Site Upgrade"
          />
        </FormGroup>

        {conflictId && (
          <div className="rounded-md border border-amber/40 bg-amber-tint p-3 space-y-2 text-xs">
            <p className="font-semibold text-ink">Overlapping approved arrangement found.</p>
            <Switch
              checked={replaceConflict}
              onCheckedChange={setReplaceConflict}
              label="Replace overlapping approved arrangement"
            />
          </div>
        )}

        <div className="space-y-2 rounded-md border border-line bg-canvas/50 p-3">
          <Switch
            checked={applyFromNow}
            onCheckedChange={(checked) => {
              setApplyFromNow(checked)
              setDirty(true)
            }}
            label="Apply switch mid-day from now"
          />
          {applyFromNow && (
            <Input
              value={applyReason}
              onChange={(e) => setApplyReason(e.target.value)}
              placeholder="Reason for mid-day work mode switch..."
            />
          )}
        </div>

        <FormGroup label="Reason" required>
          <Textarea
            rows={2}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value)
              setDirty(true)
            }}
            placeholder="Assignment rationale..."
          />
        </FormGroup>
      </form>
    </Dialog>
  )
}

/* ─── HR-Only Field Evidence Inspection & Review Modal ────────────────────── */

export function FieldEvidenceModal({
  open,
  onOpenChange,
  punchId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  punchId: string | null
}) {
  const formId = useId()
  const { toast } = useToast()
  const evidenceQuery = useAttendanceFieldEvidence(open ? punchId : null)
  const reviewMutation = useReviewFieldEvidence()

  const [action, setAction] = useState<'verify' | 'flag_follow_up' | 'dismiss_follow_up' | 'add_note'>('verify')
  const [note, setNote] = useState('')
  const [dirty, setDirty] = useState(false)
  const [submitError, setSubmitError] = useState<unknown>(null)

  useEffect(() => {
    if (open) {
      setAction('verify')
      setNote('')
      setDirty(false)
      setSubmitError(null)
    }
  }, [open, punchId])

  const ev = evidenceQuery.data

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!punchId) return
    setSubmitError(null)
    if (action !== 'verify' && note.trim().length < 3) {
      setSubmitError(new Error('Note is required (min 3 characters) for flag/dismiss/note actions.'))
      return
    }
    try {
      await reviewMutation.mutateAsync({
        punchId,
        action,
        note: note.trim() || null,
        expectedVersion: ev?.review?.version ?? null,
      })
      toast('Field evidence review saved', { tone: 'success' })
      onOpenChange(false)
    } catch (error) {
      setSubmitError(error)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Raw GPS Location Evidence (HR Restricted)"
      description={ev ? `${ev.employee_name ?? ''} · ${ev.punch_kind.replace(/_/g, ' ')}` : 'Loading punch evidence...'}
      hasUnsavedChanges={dirty}
      footer={
        <ModalSubmitFooter
          formId={formId}
          submitError={submitError}
          isPending={reviewMutation.isPending}
          submitLabel="Save Review Action"
        />
      }
    >
      {evidenceQuery.isLoading ? (
        <p className="text-xs text-muted">Loading location evidence...</p>
      ) : evidenceQuery.error ? (
        <div className="flex items-start gap-2 rounded-md border border-rose/30 bg-rose-tint p-3 text-xs text-rose">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{String(evidenceQuery.error)}</span>
        </div>
      ) : ev ? (
        <form id={formId} onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div className="rounded-lg border border-line bg-canvas/70 p-4 space-y-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <WorkModePill mode={ev.work_mode} />
              <LocationCheckPill locationCheck={ev.location_check} distanceM={ev.distance_m} />
            </div>
            <p className="text-soft">
              Server received: <span className="text-ink font-medium">{formatDateTimeInZone(ev.occurred_at, 'Africa/Kampala')}</span>
            </p>
            {ev.coordinates ? (
              <div className="flex items-center gap-2 rounded bg-surface px-3 py-2 font-mono text-ink border border-line">
                <MapPin className="h-3.5 w-3.5 text-emerald shrink-0" />
                <span>
                  {ev.coordinates.lat.toFixed(6)}, {ev.coordinates.lng.toFixed(6)}
                </span>
                {ev.coordinates.accuracy_m != null && (
                  <span className="text-muted">±{Math.round(ev.coordinates.accuracy_m)}m</span>
                )}
              </div>
            ) : (
              <p className="text-amber font-medium">
                Raw coordinates purged or not captured ({ev.location_status}).
              </p>
            )}
            {ev.review && (
              <div className="flex items-center gap-2 pt-1">
                <ShieldCheck className="h-3.5 w-3.5 text-blue" />
                <span>Review status:</span>
                <WorkflowStatusPill status={ev.review.status} />
              </div>
            )}
          </div>

          <FormGroup label="HR Review Action" required>
            <Select
              value={action}
              onValueChange={(v) => {
                setAction(v as typeof action)
                setDirty(true)
              }}
              options={[
                { value: 'verify', label: 'Verify Location Evidence' },
                { value: 'flag_follow_up', label: 'Flag for Follow-up' },
                { value: 'dismiss_follow_up', label: 'Dismiss Follow-up' },
                { value: 'add_note', label: 'Add Review Note Only' },
              ]}
            />
          </FormGroup>

          <FormGroup label="Review Note" required={action !== 'verify'}>
            <Textarea
              rows={2}
              value={note}
              onChange={(e) => {
                setNote(e.target.value)
                setDirty(true)
              }}
              placeholder="Document GPS check outcome or follow-up decision..."
            />
          </FormGroup>
        </form>
      ) : null}
    </Dialog>
  )
}
