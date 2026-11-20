import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { type LeaveWorkspace, useLeaveCommand } from '../api/leave'

export function LeaveSetup(
  { workspace, onBack }: { workspace: LeaveWorkspace; onBack: () => void },
) {
  const command = useLeaveCommand()
  const [task, setTask] = useState<'type' | 'holiday' | 'entitlement' | 'adjust' | 'reminders'>(
    'type',
  )
  const [employeeId, setEmployeeId] = useState(workspace.employee_id ?? '')
  const [balanceTypeId, setBalanceTypeId] = useState(workspace.types[0]?.id ?? '')
  const selectedBalanceType = workspace.types.find((type) => type.id === balanceTypeId)
  const [year, setYear] = useState(workspace.year)
  const [days, setDays] = useState('')
  const [reason, setReason] = useState('')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [paid, setPaid] = useState(true)
  const [evidence, setEvidence] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const busy = command.isPending || command.pending.length > 0
  async function save(event: React.FormEvent) {
    event.preventDefault()
    setMessage(null)
    setError(null)
    let payload: Record<string, unknown>
    if (task === 'type') {
      payload = {
        code: code.trim(),
        name: name.trim(),
        is_paid: paid,
        requires_evidence: evidence,
        default_days: days === '' ? null : Number(days),
      }
    } else if (task === 'holiday') payload = { date, name: name.trim() }
    else if (task === 'reminders') payload = { year }
    else {
      if (!selectedBalanceType) {
        setError('Choose a leave type.')
        return
      }
      payload = {
        employee_id: employeeId,
        leave_type_id: selectedBalanceType.id,
        year,
        days: Number(days),
        reason: reason.trim(),
      }
    }
    try {
      const result = await command.mutateAsync({ action: task, payload })
      setMessage(
        task === 'reminders'
          ? `${result.result.sent ?? 0} in-app reminders sent. ${
            result.result.skipped ?? 0
          } skipped (no available balance or recent reminder).`
          : 'Leave setup saved.',
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Setup could not be saved.')
    }
  }
  function pickType(id: string) {
    const type = workspace.types.find((item) => item.id === id)
    setCode(type?.code ?? '')
    setName(type?.name ?? '')
    setDays(type?.default_entitlement_days?.toString() ?? '')
    setPaid(type?.is_paid ?? true)
    setEvidence(type?.requires_evidence ?? false)
  }
  return (
    <section className='mx-auto max-w-2xl rounded-xl border border-line bg-surface p-5 sm:p-7'>
      <Button variant='ghost' onClick={onBack} disabled={command.isPending}>← Back to leave</Button>
      <h2 className='mt-4 font-display text-xl font-bold text-ink'>Leave setup</h2>
      <label className='mt-5 block text-sm font-medium text-ink'>
        What would you like to manage?<select
          aria-label='Setup task'
          className='mt-2 h-11 w-full rounded-md border border-line bg-surface px-3'
          value={task}
          disabled={busy}
          onChange={(e) => {
            setTask(e.target.value as typeof task)
            setDays('')
            setName('')
            setCode('')
            setMessage(null)
            setError(null)
          }}
        >
          <option value='type'>Leave types</option>
          <option value='holiday'>Public holidays</option>
          <option value='entitlement'>Employee entitlement</option>
          <option value='adjust'>Balance adjustment / carryover</option>
          <option value='reminders'>Year-end reminders</option>
        </select>
      </label>
      <form
        className='mt-5 space-y-4'
        onSubmit={(event) => {
          void save(event)
        }}
      >
        {task === 'type' && (
          <>
            <label className='block text-sm text-ink'>
              Edit a type or create one<select
                aria-label='Existing leave type'
                className='mt-2 h-11 w-full rounded-md border border-line bg-surface px-3'
                defaultValue=''
                onChange={(e) => pickType(e.target.value)}
                disabled={busy}
              >
                <option value=''>New leave type</option>
                {workspace.types.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
            <label className='block text-sm text-ink'>
              Code<Input
                className='mt-2'
                aria-label='Type code'
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                pattern='[a-z][a-z0-9_]{1,39}'
                maxLength={40}
                disabled={busy}
              />
            </label>
          </>
        )}
        {(task === 'type' || task === 'holiday') && (
          <label className='block text-sm text-ink'>
            Name<Input
              className='mt-2'
              aria-label='Name'
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              maxLength={120}
              disabled={busy}
            />
          </label>
        )}
        {task === 'holiday' && (
          <label className='block text-sm text-ink'>
            Holiday date<Input
              className='mt-2'
              aria-label='Holiday date'
              type='date'
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              disabled={busy}
            />
          </label>
        )}
        {(task === 'adjust' || task === 'entitlement') && (
          <>
            <label className='block text-sm text-ink'>
              Employee<select
                aria-label='Setup employee'
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
            <label className='block text-sm text-ink'>
              Leave type<select
                aria-label='Setup leave type'
                className='mt-2 h-11 w-full rounded-md border border-line bg-surface px-3'
                value={selectedBalanceType?.id ?? ''}
                onChange={(e) => setBalanceTypeId(e.target.value)}
                required
                disabled={busy}
              >
                <option value=''>Choose leave type</option>
                {workspace.types.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
          </>
        )}
        {['entitlement', 'adjust', 'reminders'].includes(task) && (
          <label className='block text-sm text-ink'>
            Leave year<Input
              aria-label='Setup leave year'
              className='mt-2'
              type='number'
              min={2000}
              max={2200}
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              required
              disabled={busy}
            />
          </label>
        )}
        {['type', 'adjust', 'entitlement'].includes(task) && (
          <label className='block text-sm text-ink'>
            {task === 'type'
              ? 'Default annual entitlement (blank for untracked)'
              : task === 'adjust'
              ? 'Days to add or deduct'
              : 'Annual entitlement days'}
            <Input
              aria-label='Days'
              className='mt-2'
              type='number'
              step='0.01'
              min={task === 'adjust' ? undefined : 0}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              required={task !== 'type'}
              disabled={busy}
            />
          </label>
        )}
        {task === 'adjust' && (
          <>
            <label className='block text-sm text-ink'>
              Adjustment reason<Input
                aria-label='Adjustment reason'
                className='mt-2'
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                minLength={3}
                maxLength={2000}
                required
                disabled={busy}
              />
            </label>
            <p className='text-xs text-muted'>
              Carryover is an explicit approved adjustment. No automatic forfeiture or rollover rule
              is assumed.
            </p>
          </>
        )}
        {task === 'type' && (
          <div className='flex flex-wrap gap-4 text-sm text-ink'>
            <label>
              <input
                type='checkbox'
                checked={paid}
                onChange={(e) => setPaid(e.target.checked)}
                disabled={busy}
                className='mr-2 accent-emerald'
              />Paid leave
            </label>
            <label>
              <input
                type='checkbox'
                checked={evidence}
                onChange={(e) => setEvidence(e.target.checked)}
                disabled={busy}
                className='mr-2 accent-emerald'
              />Evidence required
            </label>
          </div>
        )}
        {task === 'reminders' && (
          <p className='rounded-lg bg-canvas p-4 text-sm text-soft'>
            Send an in-app reminder to active linked employees with available annual leave in the
            current year. Recipients reminded in the last 7 days are skipped. This action is
            audited. Email delivery remains disabled.
          </p>
        )}
        {error && <p role='alert' className='text-sm text-rose'>{error}</p>}
        {message && <p role='status' className='text-sm text-emerald'>{message}</p>}
        <Button type='submit' disabled={busy}>
          {command.isPending
            ? 'Saving…'
            : task === 'reminders'
            ? 'Send in-app reminders'
            : 'Save changes'}
        </Button>
      </form>
      {task === 'holiday' && (
        <div className='mt-6 border-t border-line pt-4'>
          <h3 className='text-sm font-semibold text-ink'>Configured public holidays</h3>
          <ul className='mt-2 space-y-2 text-sm text-soft'>
            {workspace.holidays.map((item) => (
              <li key={item.id}>
                {item.holiday_date} · {item.name}
                {!item.is_active && ' (inactive)'}
              </li>
            ))}
          </ul>
          <p className='mt-3 text-xs text-muted'>
            Saving an existing date updates its name. Changes affect new requests; approved
            allocations remain unchanged.
          </p>
        </div>
      )}
    </section>
  )
}
