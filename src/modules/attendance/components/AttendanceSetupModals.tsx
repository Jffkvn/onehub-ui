import { useEffect, useId, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Crosshair, Sparkles } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { FormGroup, Input, Textarea } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Combobox } from '@/components/ui/Combobox'
import { MultiCombobox } from '@/components/ui/MultiCombobox'
import { Switch } from '@/components/ui/Toggles'
import { useToast } from '@/components/ui/Toast'
import { getTodayIsoInZone, formatSqlTimeShort } from '../lib/zonedTime'
import { extractErrorMessage } from '../lib/pendingOperations'
import {
  holidayFormSchema,
  workplaceFormSchema,
  type HolidaySetup,
  type ScheduleSetup,
  type SetupOverviewResponse,
  type SetupRosterRow,
  type WorkplaceSetup,
} from '../schemas/attendance'
import {
  useBulkEnroll,
  useSaveHoliday,
  useSaveSchedule,
  useSaveWorkplace,
  useSetAttendanceEnabled,
  useSetEmployeeManager,
  useSetEnrollmentDefaults,
} from '../api/attendance'
import { ModalSubmitFooter, WEEKDAY_OPTIONS } from './AttendanceBadges'

/* ─── Toggle Live Attendance Enabled Modal ────────────────────────────────── */

const toggleSchema = z.object({
  reason: z.string().trim().min(3, 'Audit reason must be at least 3 characters.').max(500),
})

export function ToggleAttendanceEnabledModal({
  open,
  onOpenChange,
  currentlyEnabled,
  readyToEnable,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentlyEnabled: boolean
  readyToEnable: boolean
}) {
  const formId = useId()
  const { toast } = useToast()
  const mutation = useSetAttendanceEnabled()
  const [submitError, setSubmitError] = useState<unknown>(null)
  const targetEnabled = !currentlyEnabled

  const form = useForm<z.input<typeof toggleSchema>>({
    resolver: zodResolver(toggleSchema),
    defaultValues: { reason: '' },
  })

  useEffect(() => {
    if (open) {
      form.reset({ reason: '' })
      setSubmitError(null)
    }
  }, [open, form])

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null)
    try {
      await mutation.mutateAsync({ enabled: targetEnabled, reason: values.reason.trim() })
      toast(targetEnabled ? 'Live attendance enabled' : 'Live attendance paused', {
        tone: targetEnabled ? 'success' : 'info',
      })
      onOpenChange(false)
    } catch (error) {
      setSubmitError(error)
    }
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={targetEnabled ? 'Enable Live Attendance' : 'Pause Live Attendance'}
      description={
        targetEnabled
          ? 'Staff enrolled in active schedules will see Start Day / End Day controls immediately.'
          : 'Live Start Day / End Day punching will pause across the organisation while historical data remains readable.'
      }
      hasUnsavedChanges={form.formState.isDirty}
      footer={
        <ModalSubmitFooter
          formId={formId}
          submitError={submitError}
          isPending={mutation.isPending}
          submitLabel={targetEnabled ? 'Enable Attendance' : 'Pause Attendance'}
          submitVariant={targetEnabled ? 'primary' : 'danger'}
        />
      }
    >
      <form id={formId} onSubmit={(e) => { void onSubmit(e) }} className="space-y-4">
        {targetEnabled && !readyToEnable && (
          <div className="rounded-md border border-amber/40 bg-amber-tint p-3 text-xs text-ink">
            At least one active employee must hold an active schedule and valid workplace/arrangement
            enrolment before live attendance can be enabled.
          </div>
        )}
        <FormGroup
          label="Audit Reason"
          required
          error={form.formState.errors.reason?.message}
        >
          <Textarea
            rows={3}
            placeholder="Record confirmation/authorisation reason for the audit log..."
            {...form.register('reason')}
          />
        </FormGroup>
      </form>
    </Dialog>
  )
}

/* ─── Workplace Modal ─────────────────────────────────────────────────────── */

type WorkplaceValues = z.input<typeof workplaceFormSchema>

export function WorkplaceFormModal({
  open,
  onOpenChange,
  workplace,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workplace: WorkplaceSetup | null
}) {
  const formId = useId()
  const { toast } = useToast()
  const mutation = useSaveWorkplace()
  const [submitError, setSubmitError] = useState<unknown>(null)
  const [locating, setLocating] = useState(false)

  const form = useForm<WorkplaceValues>({
    resolver: zodResolver(workplaceFormSchema),
    defaultValues: {
      name: '',
      latitude: 0,
      longitude: 0,
      radiusMeters: 150,
      timezone: 'Africa/Kampala',
      isActive: true,
      reason: '',
    },
  })

  useEffect(() => {
    if (open) {
      form.reset({
        name: workplace?.name ?? '',
        latitude: workplace?.latitude ?? 0,
        longitude: workplace?.longitude ?? 0,
        radiusMeters: workplace?.radius_meters ?? 150,
        timezone: workplace?.timezone ?? 'Africa/Kampala',
        isActive: workplace?.is_active ?? true,
        reason: '',
      })
      setSubmitError(null)
    }
  }, [open, workplace, form])

  const captureCurrentCoords = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      toast('Browser geolocation is unavailable on this device', { tone: 'danger' })
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        form.setValue('latitude', Number(pos.coords.latitude.toFixed(6)), { shouldDirty: true })
        form.setValue('longitude', Number(pos.coords.longitude.toFixed(6)), { shouldDirty: true })
        setLocating(false)
        toast('Captured device GPS coordinates', { tone: 'success' })
      },
      () => {
        setLocating(false)
        toast('Could not capture GPS coordinates (check permission)', { tone: 'danger' })
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    )
  }

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null)
    try {
      const parsed = workplaceFormSchema.parse(values)
      await mutation.mutateAsync({
        id: workplace?.id ?? null,
        name: parsed.name,
        latitude: parsed.latitude,
        longitude: parsed.longitude,
        radiusMeters: parsed.radiusMeters,
        timezone: parsed.timezone,
        isActive: parsed.isActive,
        reason: parsed.reason,
      })
      toast(workplace ? 'Workplace updated' : 'Workplace created', { tone: 'success' })
      onOpenChange(false)
    } catch (error) {
      setSubmitError(error)
    }
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={workplace ? 'Edit Workplace Geofence' : 'Add Workplace Geofence'}
      description="Define office coordinates, geofence radius (25m–5000m), and local timezone."
      hasUnsavedChanges={form.formState.isDirty}
      footer={
        <ModalSubmitFooter
          formId={formId}
          submitError={submitError}
          isPending={mutation.isPending}
          submitLabel={workplace ? 'Save Workplace' : 'Create Workplace'}
        />
      }
    >
      <form id={formId} onSubmit={(e) => { void onSubmit(e) }} className="space-y-4">
        <div className="flex items-center justify-between gap-2 rounded-md border border-line bg-canvas/70 px-3 py-2 text-xs">
          <span className="text-soft">Need exact on-site coordinates?</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            loading={locating}
            leftIcon={<Crosshair className="h-3.5 w-3.5" />}
            onClick={captureCurrentCoords}
          >
            Use Current GPS
          </Button>
        </div>

        <FormGroup label="Workplace Name" required error={form.formState.errors.name?.message}>
          <Input placeholder="e.g. Kampala Head Office" {...form.register('name')} />
        </FormGroup>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormGroup label="Latitude" required error={form.formState.errors.latitude?.message}>
            <Input type="number" step="0.000001" {...form.register('latitude')} />
          </FormGroup>
          <FormGroup label="Longitude" required error={form.formState.errors.longitude?.message}>
            <Input type="number" step="0.000001" {...form.register('longitude')} />
          </FormGroup>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormGroup
            label="Geofence Radius (metres)"
            required
            error={form.formState.errors.radiusMeters?.message}
          >
            <Input type="number" min={25} max={5000} {...form.register('radiusMeters')} />
          </FormGroup>
          <FormGroup label="Timezone" required error={form.formState.errors.timezone?.message}>
            <Input placeholder="Africa/Kampala" {...form.register('timezone')} />
          </FormGroup>
        </div>

        <Controller
          control={form.control}
          name="isActive"
          render={({ field }) => (
            <Switch
              checked={field.value}
              onCheckedChange={field.onChange}
              label="Workplace active for office punches"
            />
          )}
        />

        <FormGroup label="Audit Reason" required error={form.formState.errors.reason?.message}>
          <Textarea rows={2} placeholder="Reason for creating or updating workplace..." {...form.register('reason')} />
        </FormGroup>
      </form>
    </Dialog>
  )
}

/* ─── Schedule Modal ──────────────────────────────────────────────────────── */

interface ScheduleDayDraft {
  weekday: number
  is_workday: boolean
  expected_start: string
  expected_end: string
}

function buildDefaultDays(): ScheduleDayDraft[] {
  return WEEKDAY_OPTIONS.map((w) => {
    const workday = w.value >= 1 && w.value <= 5
    return {
      weekday: w.value,
      is_workday: workday,
      expected_start: workday ? '08:00' : '',
      expected_end: workday ? '17:00' : '',
    }
  })
}

export function ScheduleFormModal({
  open,
  onOpenChange,
  schedule,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  schedule: ScheduleSetup | null
}) {
  const formId = useId()
  const { toast } = useToast()
  const mutation = useSaveSchedule()

  const [name, setName] = useState('')
  const [timezone, setTimezone] = useState('Africa/Kampala')
  const [halfDayBoundary, setHalfDayBoundary] = useState('13:00')
  const [graceMinutes, setGraceMinutes] = useState(5)
  const [thresholdMinutes, setThresholdMinutes] = useState(15)
  const [isActive, setIsActive] = useState(true)
  const [days, setDays] = useState<ScheduleDayDraft[]>(buildDefaultDays)
  const [reason, setReason] = useState('')
  const [dirty, setDirty] = useState(false)
  const [submitError, setSubmitError] = useState<unknown>(null)

  useEffect(() => {
    if (!open) return
    if (schedule) {
      setName(schedule.name)
      setTimezone(schedule.timezone)
      setHalfDayBoundary(formatSqlTimeShort(schedule.half_day_boundary))
      setGraceMinutes(schedule.lateness_grace_minutes)
      setThresholdMinutes(schedule.explanation_threshold_minutes)
      setIsActive(schedule.is_active)
      setDays(
        WEEKDAY_OPTIONS.map((w) => {
          const existing = schedule.days.find((d) => d.weekday === w.value)
          const workday = Boolean(existing?.is_workday)
          return {
            weekday: w.value,
            is_workday: workday,
            expected_start: workday ? formatSqlTimeShort(existing?.expected_start) : '',
            expected_end: workday ? formatSqlTimeShort(existing?.expected_end) : '',
          }
        }),
      )
    } else {
      setName('')
      setTimezone('Africa/Kampala')
      setHalfDayBoundary('13:00')
      setGraceMinutes(5)
      setThresholdMinutes(15)
      setIsActive(true)
      setDays(buildDefaultDays())
    }
    setReason('')
    setDirty(false)
    setSubmitError(null)
  }, [open, schedule])

  const applyProposedQaDefaults = () => {
    setName((prev) => prev || 'Proposed QA Standard Shift')
    setTimezone('Africa/Kampala')
    setHalfDayBoundary('13:00')
    setGraceMinutes(5)
    setThresholdMinutes(15)
    setDays(
      WEEKDAY_OPTIONS.map((w) => ({
        weekday: w.value,
        is_workday: w.value >= 1 && w.value <= 5,
        expected_start: w.value >= 1 && w.value <= 5 ? '08:00' : '',
        expected_end: w.value >= 1 && w.value <= 5 ? '17:00' : '',
      })),
    )
    setDirty(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitError(null)
    if (name.trim().length < 2) {
      setSubmitError(new Error('Schedule name requires at least 2 characters.'))
      return
    }
    if (reason.trim().length < 3) {
      setSubmitError(new Error('Audit reason requires at least 3 characters.'))
      return
    }
    try {
      await mutation.mutateAsync({
        id: schedule?.id ?? null,
        name: name.trim(),
        timezone: timezone.trim(),
        halfDayBoundary,
        latenessGraceMinutes: Number(graceMinutes),
        explanationThresholdMinutes: Number(thresholdMinutes),
        isActive,
        days: days.map((d) => ({
          weekday: d.weekday,
          is_workday: d.is_workday,
          expected_start: d.is_workday ? d.expected_start || '08:00' : null,
          expected_end: d.is_workday ? d.expected_end || '17:00' : null,
        })),
        reason: reason.trim(),
      })
      toast(schedule ? 'Schedule updated' : 'Schedule created', { tone: 'success' })
      onOpenChange(false)
    } catch (error) {
      setSubmitError(error)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      className="sm:max-w-2xl"
      title={schedule ? 'Edit Work Schedule' : 'Create Work Schedule'}
      description="Configure 7-day shift times, lateness grace period, and extra-time threshold."
      hasUnsavedChanges={dirty}
      footer={
        <ModalSubmitFooter
          formId={formId}
          submitError={submitError}
          isPending={mutation.isPending}
          submitLabel={schedule ? 'Save Schedule' : 'Create Schedule'}
        />
      }
    >
      <form id={formId} onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber/30 bg-amber-tint px-3 py-2 text-xs">
          <span className="text-ink">
            <strong>QA Default Helper:</strong> Mon–Fri 08:00–17:00, Grace 5m, Extra 15m (unconfirmed placeholder).
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            leftIcon={<Sparkles className="h-3.5 w-3.5" />}
            onClick={applyProposedQaDefaults}
          >
            Load Proposed QA Default
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormGroup label="Schedule Name" required>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setDirty(true)
              }}
              placeholder="e.g. Standard Kampala Shift"
            />
          </FormGroup>
          <FormGroup label="Timezone" required>
            <Input
              value={timezone}
              onChange={(e) => {
                setTimezone(e.target.value)
                setDirty(true)
              }}
            />
          </FormGroup>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormGroup label="Half-Day Boundary">
            <Input
              type="time"
              value={halfDayBoundary}
              onChange={(e) => {
                setHalfDayBoundary(e.target.value)
                setDirty(true)
              }}
            />
          </FormGroup>
          <FormGroup label="Lateness Grace (mins)">
            <Input
              type="number"
              min={0}
              max={240}
              value={graceMinutes}
              onChange={(e) => {
                setGraceMinutes(Number(e.target.value))
                setDirty(true)
              }}
            />
          </FormGroup>
          <FormGroup label="Extra-Time Explain (mins)">
            <Input
              type="number"
              min={0}
              max={720}
              value={thresholdMinutes}
              onChange={(e) => {
                setThresholdMinutes(Number(e.target.value))
                setDirty(true)
              }}
            />
          </FormGroup>
        </div>

        <div className="space-y-2 rounded-lg border border-line bg-canvas/50 p-3">
          <p className="text-xs font-semibold text-ink">Weekly Day Rules</p>
          <div className="space-y-2">
            {WEEKDAY_OPTIONS.map((meta) => {
              const row = days.find((d) => d.weekday === meta.value)!
              return (
                <div
                  key={meta.value}
                  className="grid grid-cols-1 gap-2 rounded border border-line/60 bg-surface px-3 py-2 sm:grid-cols-12 sm:items-center"
                >
                  <div className="sm:col-span-4">
                    <Switch
                      checked={row.is_workday}
                      onCheckedChange={(checked) => {
                        setDays((prev) =>
                          prev.map((item) =>
                            item.weekday === meta.value
                              ? {
                                  ...item,
                                  is_workday: checked,
                                  expected_start: checked ? item.expected_start || '08:00' : '',
                                  expected_end: checked ? item.expected_end || '17:00' : '',
                                }
                              : item,
                          ),
                        )
                        setDirty(true)
                      }}
                      label={meta.label}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:col-span-8">
                    <Input
                      type="time"
                      disabled={!row.is_workday}
                      value={row.expected_start}
                      onChange={(e) => {
                        const val = e.target.value
                        setDays((prev) =>
                          prev.map((item) =>
                            item.weekday === meta.value ? { ...item, expected_start: val } : item,
                          ),
                        )
                        setDirty(true)
                      }}
                    />
                    <Input
                      type="time"
                      disabled={!row.is_workday}
                      value={row.expected_end}
                      onChange={(e) => {
                        const val = e.target.value
                        setDays((prev) =>
                          prev.map((item) =>
                            item.weekday === meta.value ? { ...item, expected_end: val } : item,
                          ),
                        )
                        setDirty(true)
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <Switch
          checked={isActive}
          onCheckedChange={(checked) => {
            setIsActive(checked)
            setDirty(true)
          }}
          label="Schedule active for staff enrolment"
        />

        <FormGroup label="Audit Reason" required>
          <Textarea
            rows={2}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value)
              setDirty(true)
            }}
            placeholder="Reason for schedule change..."
          />
        </FormGroup>
      </form>
    </Dialog>
  )
}

/* ─── Holiday Modal ───────────────────────────────────────────────────────── */

export function HolidayFormModal({
  open,
  onOpenChange,
  holiday,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  holiday: HolidaySetup | null
}) {
  const formId = useId()
  const { toast } = useToast()
  const mutation = useSaveHoliday()
  const [submitError, setSubmitError] = useState<unknown>(null)

  const form = useForm<z.input<typeof holidayFormSchema>>({
    resolver: zodResolver(holidayFormSchema),
    defaultValues: {
      localDate: getTodayIsoInZone('Africa/Kampala'),
      name: '',
      isActive: true,
      reason: '',
    },
  })

  useEffect(() => {
    if (open) {
      form.reset({
        localDate: holiday?.local_date ?? getTodayIsoInZone('Africa/Kampala'),
        name: holiday?.name ?? '',
        isActive: holiday?.is_active ?? true,
        reason: '',
      })
      setSubmitError(null)
    }
  }, [open, holiday, form])

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null)
    try {
      await mutation.mutateAsync({
        localDate: values.localDate,
        name: values.name.trim(),
        isActive: values.isActive,
        reason: values.reason.trim(),
      })
      toast('Public holiday saved', { tone: 'success' })
      onOpenChange(false)
    } catch (error) {
      setSubmitError(error)
    }
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={holiday ? 'Update Public Holiday' : 'Add Public Holiday'}
      description="Active holidays automatically update unpunched attendance days on that calendar date."
      hasUnsavedChanges={form.formState.isDirty}
      footer={
        <ModalSubmitFooter
          formId={formId}
          submitError={submitError}
          isPending={mutation.isPending}
          submitLabel="Save Holiday"
        />
      }
    >
      <form id={formId} onSubmit={(e) => { void onSubmit(e) }} className="space-y-4">
        <FormGroup label="Holiday Date" required error={form.formState.errors.localDate?.message}>
          <Input type="date" {...form.register('localDate')} />
        </FormGroup>
        <FormGroup label="Holiday Name" required error={form.formState.errors.name?.message}>
          <Input placeholder="e.g. Independence Day" {...form.register('name')} />
        </FormGroup>
        <Controller
          control={form.control}
          name="isActive"
          render={({ field }) => (
            <Switch
              checked={field.value}
              onCheckedChange={field.onChange}
              label="Holiday active"
            />
          )}
        />
        <FormGroup label="Audit Reason" required error={form.formState.errors.reason?.message}>
          <Textarea rows={2} placeholder="Official calendar / HR notice..." {...form.register('reason')} />
        </FormGroup>
      </form>
    </Dialog>
  )
}

/* ─── Global Enrolment Defaults Modal ─────────────────────────────────────── */

export function DefaultsFormModal({
  open,
  onOpenChange,
  setup,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  setup: SetupOverviewResponse
}) {
  const formId = useId()
  const { toast } = useToast()
  const mutation = useSetEnrollmentDefaults()

  const [basis, setBasis] = useState<'office' | 'arrangement'>('office')
  const [scheduleId, setScheduleId] = useState<string>('')
  const [workplaceId, setWorkplaceId] = useState<string>('')
  const [managerId, setManagerId] = useState<string>('')
  const [autoEnroll, setAutoEnroll] = useState(false)
  const [reason, setReason] = useState('')
  const [dirty, setDirty] = useState(false)
  const [submitError, setSubmitError] = useState<unknown>(null)

  useEffect(() => {
    if (!open) return
    setBasis(setup.defaults?.enrollment_basis ?? 'office')
    setScheduleId(setup.defaults?.schedule_id ?? '')
    setWorkplaceId(setup.defaults?.workplace_id ?? '')
    setManagerId(setup.defaults?.default_manager_employee_id ?? '')
    setAutoEnroll(setup.defaults?.auto_enroll_new ?? false)
    setReason('')
    setDirty(false)
    setSubmitError(null)
  }, [open, setup])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitError(null)
    if (reason.trim().length < 3) {
      setSubmitError(new Error('Audit reason requires at least 3 characters.'))
      return
    }
    try {
      await mutation.mutateAsync({
        scheduleId: scheduleId || null,
        workplaceId: basis === 'office' ? workplaceId || null : null,
        enrollmentBasis: basis,
        defaultManagerEmployeeId: managerId || null,
        autoEnrollNew: autoEnroll,
        expectedRevision: setup.defaults?.revision ?? 0,
        reason: reason.trim(),
      })
      toast('Enrolment defaults saved', { tone: 'success' })
      onOpenChange(false)
    } catch (error) {
      setSubmitError(error)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Enrolment Defaults"
      description="Configure defaults applied when new employees join."
      hasUnsavedChanges={dirty}
      footer={
        <ModalSubmitFooter
          formId={formId}
          submitError={submitError}
          isPending={mutation.isPending}
          submitLabel="Save Defaults"
        />
      }
    >
      <form id={formId} onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <FormGroup label="Default Enrolment Basis">
          <Select
            value={basis}
            onValueChange={(v) => {
              const nextBasis = v as 'office' | 'arrangement'
              setBasis(nextBasis)
              if (nextBasis === 'arrangement') setWorkplaceId('')
              setDirty(true)
            }}
            options={[
              { value: 'office', label: 'Office-based (requires workplace geofence)' },
              { value: 'arrangement', label: 'Arrangement-based (requires approved field/remote)' },
            ]}
          />
        </FormGroup>

        <FormGroup label="Default Schedule">
          <Combobox
            value={scheduleId}
            onValueChange={(v) => {
              setScheduleId(v)
              setDirty(true)
            }}
            placeholder="Choose schedule..."
            options={setup.schedules.filter((s) => s.is_active).map((s) => ({ value: s.id, label: s.name }))}
          />
        </FormGroup>

        {basis === 'office' && (
          <FormGroup label="Default Workplace">
            <Combobox
              value={workplaceId}
              onValueChange={(v) => {
                setWorkplaceId(v)
                setDirty(true)
              }}
              placeholder="Choose workplace..."
              options={setup.workplaces.filter((w) => w.is_active).map((w) => ({ value: w.id, label: w.name }))}
            />
          </FormGroup>
        )}

        <FormGroup label="Default Attendance Manager">
          <Combobox
            value={managerId}
            onValueChange={(v) => {
              setManagerId(v)
              setDirty(true)
            }}
            placeholder="None (optional)..."
            options={[
              { value: '', label: 'None' },
              ...setup.roster.map((r) => ({
                value: r.employee_id,
                label: r.legal_name,
                subtitle: r.employee_number,
              })),
            ]}
          />
        </FormGroup>

        <Switch
          checked={autoEnroll}
          onCheckedChange={(checked) => {
            setAutoEnroll(checked)
            setDirty(true)
          }}
          label="Auto-enrol new employees using these defaults"
        />

        <FormGroup label="Audit Reason" required>
          <Textarea
            rows={2}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value)
              setDirty(true)
            }}
            placeholder="Reason for updating enrolment defaults..."
          />
        </FormGroup>
      </form>
    </Dialog>
  )
}

/* ─── Bulk Enrol Staff Modal ──────────────────────────────────────────────── */

export function BulkEnrollModal({
  open,
  onOpenChange,
  setup,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  setup: SetupOverviewResponse
}) {
  const formId = useId()
  const { toast } = useToast()
  const mutation = useBulkEnroll()

  const [employeeIds, setEmployeeIds] = useState<string[]>([])
  const [basis, setBasis] = useState<'office' | 'arrangement'>('office')
  const [scheduleId, setScheduleId] = useState('')
  const [workplaceId, setWorkplaceId] = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState(() => getTodayIsoInZone('Africa/Kampala'))
  const [effectiveTo, setEffectiveTo] = useState('')
  const [managerId, setManagerId] = useState('')
  const [reason, setReason] = useState('')
  const [dirty, setDirty] = useState(false)
  const [submitError, setSubmitError] = useState<unknown>(null)

  useEffect(() => {
    if (!open) return
    setEmployeeIds([])
    setBasis(setup.defaults?.enrollment_basis ?? 'office')
    setScheduleId(setup.defaults?.schedule_id ?? setup.schedules.find((s) => s.is_active)?.id ?? '')
    setWorkplaceId(setup.defaults?.workplace_id ?? setup.workplaces.find((w) => w.is_active)?.id ?? '')
    setEffectiveFrom(getTodayIsoInZone('Africa/Kampala'))
    setEffectiveTo('')
    setManagerId('')
    setReason('')
    setDirty(false)
    setSubmitError(null)
  }, [open, setup])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitError(null)
    if (employeeIds.length === 0) {
      setSubmitError(new Error('Select at least one employee to enrol.'))
      return
    }
    if (!scheduleId) {
      setSubmitError(new Error('Select an active schedule.'))
      return
    }
    if (basis === 'office' && !workplaceId) {
      setSubmitError(new Error('Office-basis enrolment requires an active workplace.'))
      return
    }
    if (reason.trim().length < 3) {
      setSubmitError(new Error('Audit reason requires at least 3 characters.'))
      return
    }
    try {
      await mutation.mutateAsync({
        employeeIds,
        scheduleId,
        workplaceId: basis === 'office' ? workplaceId : null,
        enrollmentBasis: basis,
        effectiveFrom,
        effectiveTo: effectiveTo.trim() || null,
        managerEmployeeId: managerId || null,
        reason: reason.trim(),
      })
      toast(`Enrolled ${employeeIds.length} staff member(s)`, { tone: 'success' })
      onOpenChange(false)
    } catch (error) {
      setSubmitError(extractErrorMessage(error) ? error : error)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      className="sm:max-w-2xl"
      title="Bulk Enrol Employees"
      description="Assign schedule, office/arrangement basis, and optional attendance manager."
      hasUnsavedChanges={dirty}
      footer={
        <ModalSubmitFooter
          formId={formId}
          submitError={submitError}
          isPending={mutation.isPending}
          submitLabel={`Enrol (${employeeIds.length})`}
        />
      }
    >
      <form id={formId} onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <FormGroup label="Select Employees" required>
          <MultiCombobox
            values={employeeIds}
            onValuesChange={(vals) => {
              setEmployeeIds(vals)
              setDirty(true)
            }}
            placeholder="Pick one or more staff..."
            options={setup.roster.map((r) => ({
              value: r.employee_id,
              label: `${r.legal_name} (${r.employee_number})`,
            }))}
          />
        </FormGroup>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormGroup label="Enrolment Basis" required>
            <Select
              value={basis}
              onValueChange={(v) => {
                const next = v as 'office' | 'arrangement'
                setBasis(next)
                if (next === 'arrangement') setWorkplaceId('')
                setDirty(true)
              }}
              options={[
                { value: 'office', label: 'Office-based' },
                { value: 'arrangement', label: 'Arrangement-based' },
              ]}
            />
          </FormGroup>

          <FormGroup label="Schedule" required>
            <Combobox
              value={scheduleId}
              onValueChange={(v) => {
                setScheduleId(v)
                setDirty(true)
              }}
              placeholder="Choose active schedule..."
              options={setup.schedules.filter((s) => s.is_active).map((s) => ({ value: s.id, label: s.name }))}
            />
          </FormGroup>
        </div>

        {basis === 'office' && (
          <FormGroup label="Assigned Office Workplace" required>
            <Combobox
              value={workplaceId}
              onValueChange={(v) => {
                setWorkplaceId(v)
                setDirty(true)
              }}
              placeholder="Choose active workplace..."
              options={setup.workplaces.filter((w) => w.is_active).map((w) => ({ value: w.id, label: w.name }))}
            />
          </FormGroup>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormGroup label="Effective From" required>
            <Input
              type="date"
              value={effectiveFrom}
              onChange={(e) => {
                setEffectiveFrom(e.target.value)
                setDirty(true)
              }}
            />
          </FormGroup>
          <FormGroup label="Effective To (optional)">
            <Input
              type="date"
              value={effectiveTo}
              onChange={(e) => {
                setEffectiveTo(e.target.value)
                setDirty(true)
              }}
            />
          </FormGroup>
        </div>

        <FormGroup label="Attendance Manager (optional)">
          <Combobox
            value={managerId}
            onValueChange={(v) => {
              setManagerId(v)
              setDirty(true)
            }}
            placeholder="Leave unchanged / none..."
            options={[
              { value: '', label: 'Leave unchanged' },
              ...setup.roster.map((r) => ({
                value: r.employee_id,
                label: r.legal_name,
                subtitle: r.employee_number,
              })),
            ]}
          />
        </FormGroup>

        <FormGroup label="Audit Reason" required>
          <Textarea
            rows={2}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value)
              setDirty(true)
            }}
            placeholder="Reason for bulk enrolment..."
          />
        </FormGroup>
      </form>
    </Dialog>
  )
}

/* ─── Assign Employee Manager Modal ───────────────────────────────────────── */

export function EmployeeManagerModal({
  open,
  onOpenChange,
  employee,
  roster,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  employee: SetupRosterRow | null
  roster: SetupRosterRow[]
}) {
  const formId = useId()
  const { toast } = useToast()
  const mutation = useSetEmployeeManager()
  const [managerId, setManagerId] = useState('')
  const [reason, setReason] = useState('')
  const [dirty, setDirty] = useState(false)
  const [submitError, setSubmitError] = useState<unknown>(null)

  useEffect(() => {
    if (!open || !employee) return
    setManagerId(employee.attendance_manager_id ?? '')
    setReason('')
    setDirty(false)
    setSubmitError(null)
  }, [open, employee])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!employee) return
    setSubmitError(null)
    if (reason.trim().length < 3) {
      setSubmitError(new Error('Audit reason requires at least 3 characters.'))
      return
    }
    try {
      await mutation.mutateAsync({
        employeeId: employee.employee_id,
        managerEmployeeId: managerId || null,
        reason: reason.trim(),
      })
      toast('Attendance manager updated', { tone: 'success' })
      onOpenChange(false)
    } catch (error) {
      setSubmitError(error)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Attendance Manager — ${employee?.legal_name ?? ''}`}
      description="Controls which Project Manager or Coordinator can approve team corrections and arrangements."
      hasUnsavedChanges={dirty}
      footer={
        <ModalSubmitFooter
          formId={formId}
          submitError={submitError}
          isPending={mutation.isPending}
          submitLabel="Save Manager"
        />
      }
    >
      <form id={formId} onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <FormGroup label="Assigned Attendance Manager">
          <Combobox
            value={managerId}
            onValueChange={(v) => {
              setManagerId(v)
              setDirty(true)
            }}
            placeholder="None..."
            options={[
              { value: '', label: 'None (HR / Super Admin only)' },
              ...roster
                .filter((r) => r.employee_id !== employee?.employee_id)
                .map((r) => ({
                  value: r.employee_id,
                  label: r.legal_name,
                  subtitle: r.employee_number,
                })),
            ]}
          />
        </FormGroup>

        <FormGroup label="Audit Reason" required>
          <Textarea
            rows={2}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value)
              setDirty(true)
            }}
            placeholder="Reporting line confirmation or change..."
          />
        </FormGroup>
      </form>
    </Dialog>
  )
}
