import { useEffect, useId, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Dialog } from '@/components/ui/Dialog'
import { FormGroup, Input, Textarea } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { useToast } from '@/components/ui/Toast'
import { captureSessionScopedAttendanceLocation } from '../lib/geolocation'
import {
  captureAttendanceSessionSnapshot,
  isAbortError,
  isAttendanceSessionCurrent,
} from '../lib/pendingOperations'
import { zonedWallClockToIso } from '../lib/zonedTime'
import {
  arrangementFormSchema,
  correctionFormSchema,
  explanationFormSchema,
  stillWorkingFormSchema,
  type TodayContext,
} from '../schemas/attendance'
import {
  useDeclareStillWorking,
  useSubmitArrangement,
  useSubmitCorrection,
  useSubmitExplanation,
} from '../api/attendance'
import { ModalSubmitFooter, WEEKDAY_OPTIONS } from './AttendanceBadges'

/* ─── Declare Still Working Modal ─────────────────────────────────────────── */

type StillWorkingValues = z.input<typeof stillWorkingFormSchema>

export function StillWorkingModal({
  open,
  onOpenChange,
  today,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  today: TodayContext
}) {
  const formId = useId()
  const { toast } = useToast()
  const mutation = useDeclareStillWorking()
  const [submitError, setSubmitError] = useState<unknown>(null)

  const form = useForm<StillWorkingValues>({
    resolver: zodResolver(stillWorkingFormSchema),
    defaultValues: { reason: '', expectedFinishTime: '19:00' },
  })

  useEffect(() => {
    if (open) {
      form.reset({ reason: '', expectedFinishTime: '19:00' })
      setSubmitError(null)
    }
  }, [open, form])

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null)
    const sessionSnap = captureAttendanceSessionSnapshot()
    try {
      const finishIso = zonedWallClockToIso(
        today.local_date,
        values.expectedFinishTime,
        today.timezone,
      )
      const loc = await captureSessionScopedAttendanceLocation(
        today.work_mode,
        'still_working',
        sessionSnap,
        isAttendanceSessionCurrent,
      )
      await mutation.mutateAsync({
        reason: values.reason.trim(),
        expectedFinishAt: finishIso,
        locationStatus: loc.locationStatus,
        lat: loc.lat,
        lng: loc.lng,
        accuracyM: loc.accuracyM,
        clientCapturedAt: loc.clientCapturedAt,
        contextRevision: today.context_revision,
      })
      toast('Still working confirmation recorded', { tone: 'success' })
      onOpenChange(false)
    } catch (error) {
      if (isAbortError(error)) return
      setSubmitError(error)
    }
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Declare Still Working"
      description={`Confirm ongoing work for ${today.local_date} (${today.timezone}). GPS is only requested in Office mode.`}
      hasUnsavedChanges={form.formState.isDirty}
      footer={
        <ModalSubmitFooter
          formId={formId}
          submitError={submitError}
          isPending={mutation.isPending}
          submitLabel="Confirm Still Working"
        />
      }
    >
      <form id={formId} onSubmit={(e) => { void onSubmit(e) }} className="space-y-4">
        <FormGroup
          label="Expected Finish Time"
          required
          hint={`24-hour clock in ${today.timezone} (e.g. 19:30)`}
          error={form.formState.errors.expectedFinishTime?.message}
        >
          <Input type="time" {...form.register('expectedFinishTime')} />
        </FormGroup>

        <FormGroup
          label="Work Activity / Reason"
          required
          error={form.formState.errors.reason?.message}
        >
          <Textarea
            rows={3}
            placeholder="Describe ongoing handover, site maintenance, or client delivery..."
            {...form.register('reason')}
          />
        </FormGroup>
      </form>
    </Dialog>
  )
}

/* ─── Request Correction Modal ────────────────────────────────────────────── */

type CorrectionFormValues = z.input<typeof correctionFormSchema>

export function CorrectionRequestModal({
  open,
  onOpenChange,
  defaultDate,
  defaultKind = 'missing_clock_out',
  defaultInTime = '',
  defaultOutTime = '',
  timeZone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultDate: string
  defaultKind?: 'missing_clock_in' | 'missing_clock_out' | 'wrong_time' | 'location_issue' | 'other'
  defaultInTime?: string
  defaultOutTime?: string
  timeZone: string
}) {
  const formId = useId()
  const { toast } = useToast()
  const mutation = useSubmitCorrection()
  const [submitError, setSubmitError] = useState<unknown>(null)

  const form = useForm<CorrectionFormValues>({
    resolver: zodResolver(correctionFormSchema),
    defaultValues: {
      localDate: defaultDate,
      requestKind: defaultKind,
      claimedInTime: defaultInTime,
      claimedOutTime: defaultOutTime,
      reason: '',
    },
  })

  useEffect(() => {
    if (open) {
      form.reset({
        localDate: defaultDate,
        requestKind: defaultKind,
        claimedInTime: defaultInTime,
        claimedOutTime: defaultOutTime,
        reason: '',
      })
      setSubmitError(null)
    }
  }, [open, defaultDate, defaultKind, defaultInTime, defaultOutTime, form])

  const selectedKind = form.watch('requestKind')
  const showIn =
    selectedKind === 'missing_clock_in' ||
    selectedKind === 'wrong_time' ||
    selectedKind === 'location_issue' ||
    selectedKind === 'other'
  const showOut =
    selectedKind === 'missing_clock_out' ||
    selectedKind === 'wrong_time' ||
    selectedKind === 'location_issue' ||
    selectedKind === 'other'

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null)
    try {
      const claimedInAt =
        showIn && values.claimedInTime
          ? zonedWallClockToIso(values.localDate, values.claimedInTime, timeZone)
          : null
      const claimedOutAt =
        showOut && values.claimedOutTime
          ? zonedWallClockToIso(values.localDate, values.claimedOutTime, timeZone)
          : null

      await mutation.mutateAsync({
        localDate: values.localDate,
        requestKind: values.requestKind,
        claimedInAt,
        claimedOutAt,
        reason: values.reason.trim(),
      })
      toast('Correction request submitted for review', { tone: 'success' })
      onOpenChange(false)
    } catch (error) {
      setSubmitError(error)
    }
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Request Attendance Correction"
      description={`Submit missed clock-in/out or time adjustment (${timeZone}).`}
      hasUnsavedChanges={form.formState.isDirty}
      footer={
        <ModalSubmitFooter
          formId={formId}
          submitError={submitError}
          isPending={mutation.isPending}
          submitLabel="Submit Request"
        />
      }
    >
      <form id={formId} onSubmit={(e) => { void onSubmit(e) }} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormGroup
            label="Attendance Date"
            required
            error={form.formState.errors.localDate?.message}
          >
            <Input type="date" {...form.register('localDate')} />
          </FormGroup>

          <FormGroup label="Correction Type" required>
            <Controller
              control={form.control}
              name="requestKind"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  options={[
                    { value: 'missing_clock_in', label: 'Missing Start Day (Clock-In)' },
                    { value: 'missing_clock_out', label: 'Missing End Day (Clock-Out)' },
                    { value: 'wrong_time', label: 'Wrong / Adjusted Times' },
                    { value: 'location_issue', label: 'Location Issue' },
                    { value: 'other', label: 'Other Attendance Correction' },
                  ]}
                />
              )}
            />
          </FormGroup>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {showIn && (
            <FormGroup
              label="Actual Start Time"
              required={selectedKind === 'missing_clock_in'}
              error={form.formState.errors.claimedInTime?.message}
            >
              <Input type="time" {...form.register('claimedInTime')} />
            </FormGroup>
          )}
          {showOut && (
            <FormGroup
              label="Actual End Time"
              required={selectedKind === 'missing_clock_out'}
              error={form.formState.errors.claimedOutTime?.message}
            >
              <Input type="time" {...form.register('claimedOutTime')} />
            </FormGroup>
          )}
        </div>

        <FormGroup
          label="Reason"
          required
          error={form.formState.errors.reason?.message}
        >
          <Textarea
            rows={3}
            placeholder="Explain why the punch was missed or needs adjustment..."
            {...form.register('reason')}
          />
        </FormGroup>
      </form>
    </Dialog>
  )
}

/* ─── Extra-Time Explanation Modal ────────────────────────────────────────── */

type ExplanationFormValues = z.input<typeof explanationFormSchema>

export function ExplanationModal({
  open,
  onOpenChange,
  attendanceDayId,
  localDate,
  extraMinutes,
  timeZone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  attendanceDayId: string
  localDate: string
  extraMinutes: number
  timeZone: string
}) {
  const formId = useId()
  const { toast } = useToast()
  const mutation = useSubmitExplanation()
  const [submitError, setSubmitError] = useState<unknown>(null)

  const form = useForm<ExplanationFormValues>({
    resolver: zodResolver(explanationFormSchema),
    defaultValues: { reason: '', declaredFinishTime: '' },
  })

  useEffect(() => {
    if (open) {
      form.reset({ reason: '', declaredFinishTime: '' })
      setSubmitError(null)
    }
  }, [open, form])

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null)
    try {
      const finishIso = values.declaredFinishTime
        ? zonedWallClockToIso(localDate, values.declaredFinishTime, timeZone)
        : null
      await mutation.mutateAsync({
        attendanceDayId,
        reason: values.reason.trim(),
        declaredFinishAt: finishIso,
      })
      toast('Extra-time explanation submitted', { tone: 'success' })
      onOpenChange(false)
    } catch (error) {
      setSubmitError(error)
    }
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Submit Extra-Time Explanation"
      description={`Document ${extraMinutes} extra minutes recorded on ${localDate}.`}
      hasUnsavedChanges={form.formState.isDirty}
      footer={
        <ModalSubmitFooter
          formId={formId}
          submitError={submitError}
          isPending={mutation.isPending}
          submitLabel="Submit Explanation"
        />
      }
    >
      <form id={formId} onSubmit={(e) => { void onSubmit(e) }} className="space-y-4">
        <FormGroup
          label="Declared Finish Time (optional)"
          hint={`24-hour time in ${timeZone}`}
        >
          <Input type="time" {...form.register('declaredFinishTime')} />
        </FormGroup>

        <FormGroup
          label="Explanation"
          required
          error={form.formState.errors.reason?.message}
        >
          <Textarea
            rows={3}
            placeholder="Explain extra hours worked after scheduled end time..."
            {...form.register('reason')}
          />
        </FormGroup>
      </form>
    </Dialog>
  )
}

/* ─── Work Arrangement Request Modal ──────────────────────────────────────── */

type ArrangementFormValues = z.input<typeof arrangementFormSchema>

export function SubmitArrangementModal({
  open,
  onOpenChange,
  defaultDate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultDate: string
}) {
  const formId = useId()
  const { toast } = useToast()
  const mutation = useSubmitArrangement()
  const [submitError, setSubmitError] = useState<unknown>(null)

  const form = useForm<ArrangementFormValues>({
    resolver: zodResolver(arrangementFormSchema),
    defaultValues: {
      mode: 'field',
      coverageType: 'dated',
      startDate: defaultDate,
      endDate: defaultDate,
      weekdays: [1, 3, 5],
      dutyLabel: '',
      reason: '',
    },
  })

  useEffect(() => {
    if (open) {
      form.reset({
        mode: 'field',
        coverageType: 'dated',
        startDate: defaultDate,
        endDate: defaultDate,
        weekdays: [1, 3, 5],
        dutyLabel: '',
        reason: '',
      })
      setSubmitError(null)
    }
  }, [open, defaultDate, form])

  const coverageType = form.watch('coverageType')
  const selectedWeekdays = form.watch('weekdays')

  const toggleWeekday = (dow: number) => {
    const next = selectedWeekdays.includes(dow)
      ? selectedWeekdays.filter((d) => d !== dow)
      : [...selectedWeekdays, dow].sort((a, b) => a - b)
    form.setValue('weekdays', next, { shouldDirty: true, shouldValidate: true })
  }

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null)
    try {
      await mutation.mutateAsync({
        mode: values.mode,
        coverageType: values.coverageType,
        startDate: values.startDate,
        endDate: values.endDate && values.endDate.trim() ? values.endDate.trim() : null,
        weekdays: values.coverageType === 'weekly' ? values.weekdays : null,
        reason: values.reason.trim(),
        dutyLabel: values.dutyLabel && values.dutyLabel.trim() ? values.dutyLabel.trim() : null,
      })
      toast('Work arrangement request submitted', { tone: 'success' })
      onOpenChange(false)
    } catch (error) {
      if (!isAbortError(error)) {
        setSubmitError(error)
      }
    }
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Request Field / Remote Work"
      description="Submit a field assignment or remote schedule for manager/HR approval."
      hasUnsavedChanges={form.formState.isDirty}
      footer={
        <ModalSubmitFooter
          formId={formId}
          submitError={submitError}
          isPending={mutation.isPending}
          submitLabel="Submit Arrangement"
        />
      }
    >
      <form id={formId} onSubmit={(e) => { void onSubmit(e) }} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormGroup label="Work Mode" required>
            <Controller
              control={form.control}
              name="mode"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  options={[
                    { value: 'field', label: 'Field Work (Site GPS captured)' },
                    { value: 'remote', label: 'Remote Work (No GPS required)' },
                  ]}
                />
              )}
            />
          </FormGroup>

          <FormGroup label="Coverage Pattern" required>
            <Controller
              control={form.control}
              name="coverageType"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  options={[
                    { value: 'dated', label: 'Specific Date Range' },
                    { value: 'weekly', label: 'Weekly Recurring Days' },
                  ]}
                />
              )}
            />
          </FormGroup>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormGroup
            label="Start Date"
            required
            error={form.formState.errors.startDate?.message}
          >
            <Input type="date" {...form.register('startDate')} />
          </FormGroup>

          <FormGroup
            label={coverageType === 'dated' ? 'End Date' : 'End Date (optional)'}
            required={coverageType === 'dated'}
            error={form.formState.errors.endDate?.message}
          >
            <Input type="date" {...form.register('endDate')} />
          </FormGroup>
        </div>

        {coverageType === 'weekly' && (
          <FormGroup
            label="Recurring Weekdays"
            required
            error={form.formState.errors.weekdays?.message}
          >
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAY_OPTIONS.map((day) => {
                const active = selectedWeekdays.includes(day.value)
                return (
                  <button
                    key={day.value}
                    type="button"
                    onClick={() => toggleWeekday(day.value)}
                    className={`rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                      active
                        ? 'border-emerald bg-emerald text-white'
                        : 'border-line bg-surface text-soft hover:text-ink'
                    }`}
                  >
                    {day.short}
                  </button>
                )
              })}
            </div>
          </FormGroup>
        )}

        <FormGroup
          label="Duty / Assignment Label (optional)"
          hint="Site, mission, or client location label"
          error={form.formState.errors.dutyLabel?.message}
        >
          <Input placeholder="e.g. Mbarara MTN Site Audit" {...form.register('dutyLabel')} />
        </FormGroup>

        <FormGroup
          label="Reason"
          required
          error={form.formState.errors.reason?.message}
        >
          <Textarea
            rows={3}
            placeholder="Describe field site duties or remote work rationale..."
            {...form.register('reason')}
          />
        </FormGroup>
      </form>
    </Dialog>
  )
}
