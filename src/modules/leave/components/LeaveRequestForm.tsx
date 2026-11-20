import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import {
  allocateByYear,
  formatDays,
  leaveDraftSchema,
  leaveEligibility,
  localToday,
  type Portion,
} from '../lib/leave'
import { type LeaveWorkspace, useLeaveCommand, useLeavePreview } from '../api/leave'

export function LeaveRequestForm(
  { workspace, manage, onSaved, onBack }: {
    workspace: LeaveWorkspace
    manage: boolean
    onSaved: (id: string) => void
    onBack: () => void
  },
) {
  const [employeeId, setEmployeeId] = useState(workspace.employee_id ?? '')
  const [typeId, setTypeId] = useState(workspace.types[0]?.id ?? '')
  const [start, setStart] = useState(localToday())
  const [end, setEnd] = useState(localToday())
  const [portion, setPortion] = useState<Portion>('full')
  const [leaving, setLeaving] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const command = useLeaveCommand()
  const type = workspace.types.find((item) => item.id === typeId)
  const gender = manage
    ? workspace.employees.find((item) => item.id === employeeId)?.gender ?? null
    : workspace.gender
  const eligibility = leaveEligibility(type?.code ?? '', gender)
  const partialMissingTime = portion === 'exact' && !leaving
  const previewValid = leaveDraftSchema.safeParse({
    employeeId,
    leaveTypeId: typeId,
    startDate: start,
    endDate: end,
    portion: partialMissingTime ? 'full' : portion,
    leavingTime: leaving,
    reason: 'Preview',
  }).success
  const preview = useLeavePreview(
    employeeId,
    start,
    end,
    partialMissingTime ? 'full' : portion,
    leaving,
    previewValid,
  )
  const allocations = preview.data?.allocations ?? []
  const durationReady = !partialMissingTime && preview.isSuccess && allocations.length > 0
  const busy = command.isPending
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    const parsed = leaveDraftSchema.safeParse({
      employeeId,
      leaveTypeId: typeId,
      startDate: start,
      endDate: end,
      portion,
      leavingTime: leaving,
      reason,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the request.')
      return
    }
    if (!eligibility.allowed || !durationReady) return
    try {
      const result = await command.mutateAsync({
        action: manage ? 'log' : 'submit',
        payload: {
          employee_id: employeeId,
          leave_type_id: typeId,
          start_date: start,
          end_date: end,
          day_portion: portion,
          leaving_time: portion === 'exact' ? leaving : null,
          reason: parsed.data.reason,
        },
      })
      if (result.result.id) onSaved(result.result.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The leave request could not be saved.')
    }
  }
  return (
    <section className='mx-auto max-w-2xl rounded-xl border border-line bg-surface p-5 sm:p-7'>
      <Button variant='ghost' onClick={onBack} disabled={busy}>← Back to leave</Button>
      <h2 className='mt-4 font-display text-xl font-bold text-ink'>
        {manage ? 'Log leave on behalf' : 'Request time off'}
      </h2>
      <p className='mt-1 text-sm text-muted'>
        {manage
          ? 'Save a pending entry, attach evidence, then approve it after review.'
          : 'Check the dates, add a reason and send to HR.'}
      </p>
      <form
        className='mt-6 space-y-5'
        onSubmit={(event) => {
          void submit(event)
        }}
      >
        {manage && (
          <label className='block text-sm font-medium text-ink'>
            Employee<select
              aria-label='Employee'
              className='mt-2 h-11 w-full rounded-md border border-line bg-surface px-3'
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              required
              disabled={busy}
            >
              <option value=''>Choose employee</option>
              {workspace.employees.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
        )}
        <label className='block text-sm font-medium text-ink'>
          Leave type<select
            aria-label='Leave type'
            className='mt-2 h-11 w-full rounded-md border border-line bg-surface px-3'
            value={typeId}
            onChange={(e) => setTypeId(e.target.value)}
            required
            disabled={busy}
          >
            {workspace.types.map((item) => (
              <option
                key={item.id}
                value={item.id}
                disabled={!leaveEligibility(item.code, gender).allowed}
              >
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {eligibility.guidance && (
          <p role={eligibility.allowed ? 'status' : 'alert'} className='text-sm text-amber'>
            {eligibility.guidance}
          </p>
        )}
        <fieldset disabled={busy}>
          <legend className='mb-2 text-sm font-medium text-ink'>How much time?</legend>
          <div className='grid grid-cols-2 gap-2'>
            {(['full', 'morning', 'afternoon', 'exact'] as const).map((value) => (
              <label
                key={value}
                className={`cursor-pointer rounded-lg border p-3 text-sm ${
                  portion === value
                    ? 'border-emerald bg-emerald/5 text-ink'
                    : 'border-line text-soft'
                }`}
              >
                <input
                  type='radio'
                  name='portion'
                  value={value}
                  checked={portion === value}
                  onChange={() => {
                    setPortion(value)
                    if (value !== 'full') setEnd(start)
                  }}
                  className='mr-2 accent-emerald'
                />
                {{
                  full: 'Full day(s)',
                  morning: 'Morning',
                  afternoon: 'Afternoon',
                  exact: 'Rest of my shift',
                }[value]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className='grid gap-4 sm:grid-cols-2'>
          <label className='block text-sm font-medium text-ink'>
            Start date<Input
              aria-label='Start date'
              className='mt-2'
              type='date'
              value={start}
              onChange={(e) => {
                setStart(e.target.value)
                if (portion !== 'full' || end < e.target.value) setEnd(e.target.value)
              }}
              required
              disabled={busy}
            />
          </label>
          <label className='block text-sm font-medium text-ink'>
            End date<Input
              aria-label='End date'
              className='mt-2'
              type='date'
              min={start}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              required
              disabled={busy || portion !== 'full'}
            />
          </label>
        </div>
        {portion === 'exact' && (
          <div className='rounded-lg bg-canvas p-4'>
            <label className='block text-sm font-medium text-ink'>
              Leaving at<Input
                aria-label='Leaving at'
                className='mt-2'
                type='time'
                value={leaving}
                onChange={(e) => setLeaving(e.target.value)}
                disabled={busy}
                required
              />
            </label>
            <p className='mt-2 text-xs text-muted'>
              Until {preview.data?.schedule.local_end?.slice(0, 5) ?? 'your assigned shift end'} ·
              {' '}
              {preview.data?.schedule.timezone ?? 'schedule time zone'}. The remaining time is
              calculated from your assigned shift.
            </p>
          </div>
        )}
        <div className='rounded-lg border border-line bg-canvas p-4' aria-live='polite'>
          {preview.isFetching
            ? <p className='text-sm text-muted'>Checking your working days…</p>
            : preview.error
            ? <p role='alert' className='text-sm text-rose'>{preview.error.message}</p>
            : partialMissingTime
            ? (
              <p className='text-sm text-muted'>
                Choose your leaving time to calculate the remaining shift.
              </p>
            )
            : allocations.length
            ? (
              <>
                <p className='font-semibold text-ink'>
                  {formatDays(allocations.reduce((sum, item) => sum + item.days, 0))} leave days
                </p>
                <p className='mt-1 text-xs text-muted'>
                  {allocateByYear(allocations).map((item) =>
                    `${item.year}: ${formatDays(item.days)} days`
                  ).join(' · ')} · Scheduled non-working days and holidays excluded.
                </p>
              </>
            )
            : <p className='text-sm text-muted'>Select an employee and working dates.</p>}
        </div>
        <label className='block text-sm font-medium text-ink'>
          Reason<Textarea
            aria-label='Reason'
            className='mt-2'
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            minLength={3}
            maxLength={2000}
            required
            disabled={busy}
          />
        </label>
        {type?.requires_evidence && (
          <p className='text-sm text-muted'>
            Supporting evidence is required before approval. After saving, attach a private PDF or
            photo to this request.
          </p>
        )}
        {error && (
          <p role='alert' className='rounded-lg bg-rose/10 p-3 text-sm text-rose'>{error}</p>
        )}
        <div className='flex flex-wrap justify-end gap-2'>
          <Button type='button' variant='outline' onClick={onBack} disabled={busy}>Cancel</Button>
          <Button
            type='submit'
            disabled={busy || !eligibility.allowed || !durationReady || command.pending.length > 0}
          >
            {busy ? 'Saving…' : manage ? 'Save pending leave' : 'Send to HR'}
          </Button>
        </div>
      </form>
    </section>
  )
}
