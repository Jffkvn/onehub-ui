import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CalendarDays, ChevronRight, Plus, Settings2 } from 'lucide-react'
import { PageHeader } from '@/components/patterns/PageHeader'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useAuth } from '@/modules/auth/AuthProvider'
import { useProtectedIdentityScope } from '@/lib/idempotency/pendingOperations'
import { leavePendingStore, useLeaveCommand, useLeaveWorkspace } from '../api/leave'
import { formatDays, formatLeaveDuration, localToday } from '../lib/leave'
import { LeaveRequestForm } from '../components/LeaveRequestForm'
import { LeaveRequestDetail } from '../components/LeaveRequestDetail'
import { LeaveSetup } from '../components/LeaveSetup'

export default function LeavePage({ manage = false }: { manage?: boolean }) {
  const scope = useProtectedIdentityScope(useAuth())
  return (
    <LeaveWorkspacePage key={`${scope.identityKey}:${scope.authEpoch}:${manage}`} manage={manage} />
  )
}
function LeaveWorkspacePage({ manage }: { manage: boolean }) {
  const [params, setParams] = useSearchParams()
  const [view, setView] = useState<'list' | 'new' | 'setup'>('list')
  const [year, setYear] = useState(Number(localToday().slice(0, 4)))
  const [yearDraft, setYearDraft] = useState(String(year))
  const [page, setPage] = useState(0)
  const [employee, setEmployee] = useState('')
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const data = useLeaveWorkspace(manage, employee, year, {
    offset: page * 50,
    status,
    search,
    request: params.get('request'),
  })
  const command = useLeaveCommand()
  const [retryError, setRetryError] = useState<string | null>(null)
  const selectedId = params.get('request')
  const selected = data.data?.requests.find((request) => request.id === selectedId)
  const list =
    data.data?.requests.filter((request) =>
      (status === 'all' || request.status === status) &&
      (!employee || request.employee_id === employee) &&
      request.start_date.slice(0, 4) <= String(year) &&
      request.end_date.slice(0, 4) >= String(year) &&
      `${request.employee_name} ${request.leave_type_name}`.toLowerCase().includes(
        search.toLowerCase(),
      )
    ) ?? []
  function back() {
    setView('list')
    setParams({}, { replace: true })
  }
  function open(id: string) {
    setView('list')
    setPage(0)
    setParams({ request: id })
  }
  const pending = command.pending[0]
  return (
    <div className='space-y-6 pb-8'>
      <PageHeader
        eyebrow={manage ? 'People / Leave' : 'My workspace'}
        title={manage ? 'Leave management' : 'My leave'}
        subtitle={manage
          ? 'Review time off. Keep the team covered.'
          : 'Plan your time off and follow each request.'}
        actions={view === 'list' && !selectedId && data.isSuccess
          ? (
            <>
              <Button
                variant='outline'
                onClick={() => setView('new')}
                leftIcon={<Plus size={16} />}
              >
                {manage ? 'Log leave' : 'Request leave'}
              </Button>
              {manage && (
                <Button
                  variant='ghost'
                  onClick={() => setView('setup')}
                  leftIcon={<Settings2 size={16} />}
                >
                  Setup
                </Button>
              )}
            </>
          )
          : undefined}
      />
      {pending && (
        <div role='status' className='rounded-lg border border-amber/40 bg-amber/5 p-4'>
          <p className='text-sm font-semibold text-ink'>
            {leavePendingStore.isActivelyInFlight(pending)
              ? 'Saving your leave action…'
              : 'A leave action needs confirmation'}
          </p>
          <p className='mt-1 text-sm text-soft'>
            {pending.label}. Retry checks the saved action using the same reference. Other leave
            actions stay paused until it is resolved.
          </p>
          <Button
            className='mt-3'
            variant='outline'
            disabled={command.isPending ||
              command.pending.some(leavePendingStore.isActivelyInFlight)}
            onClick={() => {
              setRetryError(null)
              void command.mutateAsync({
                action: pending.operationType,
                payload: {},
                retry: pending,
              }).then((result) => {
                if (['submit', 'log'].includes(pending.operationType) && result.result.id) {
                  open(result.result.id)
                }
              }).catch((cause: unknown) =>
                setRetryError(cause instanceof Error ? cause.message : 'Retry failed.')
              )
            }}
          >
            Retry saved action
          </Button>
          {retryError && <p role='alert' className='mt-2 text-sm text-rose'>{retryError}</p>}
        </div>
      )}
      {data.isPending
        ? (
          <div className='rounded-xl border border-line bg-surface p-8 text-sm text-muted'>
            Loading leave records…
          </div>
        )
        : data.error
        ? (
          <div className='rounded-xl border border-line bg-surface p-6'>
            <h2 className='font-semibold text-ink'>Leave records are unavailable</h2>
            <p className='mt-2 text-sm text-muted'>
              {data.error.message.includes('linked employee')
                ? 'Ask HR to link your account to an active employee record.'
                : 'The leave workspace could not load. Check your connection or contact OneHub support.'}
            </p>
            <Button variant='outline' className='mt-4' onClick={() => void data.refetch()}>
              Try again
            </Button>
          </div>
        )
        : data.data && (
          <>
            {view === 'new'
              ? (
                <LeaveRequestForm
                  workspace={data.data}
                  manage={manage}
                  onSaved={open}
                  onBack={back}
                />
              )
              : view === 'setup' && manage
              ? <LeaveSetup workspace={data.data} onBack={back} />
              : selected
              ? (
                <LeaveRequestDetail
                  key={selected.id}
                  request={selected}
                  manage={manage}
                  onBack={back}
                />
              )
              : selectedId
              ? (
                <section className='rounded-xl border border-line bg-surface p-7'>
                  <h2 className='font-semibold text-ink'>This request is unavailable</h2>
                  <p className='mt-2 text-sm text-muted'>
                    It may belong to another employee or be outside your access.
                  </p>
                  <Button variant='outline' className='mt-4' onClick={back}>Back to leave</Button>
                </section>
              )
              : (
                <>
                  {manage && (
                    <div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
                      {[
                        {
                          label: 'Awaiting review',
                          count: data.data.summary.pending,
                          tone: 'text-amber',
                        },
                        {
                          label: 'On leave today',
                          count: data.data.summary.on_leave_today,
                          tone: 'text-emerald',
                        },
                        { label: 'Approved', count: data.data.summary.approved, tone: 'text-ink' },
                        { label: 'All requests', count: data.data.summary.total, tone: 'text-ink' },
                      ].map((item) => (
                        <div
                          key={item.label}
                          className='rounded-xl border border-line bg-surface p-5'
                        >
                          <p className={`text-3xl font-bold ${item.tone}`}>{item.count}</p>
                          <p className='mt-1 text-xs text-muted'>{item.label}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className='flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-4'>
                    <label className='text-xs font-medium text-muted'>
                      Leave year<Input
                        aria-label='Leave year'
                        className='mt-1 w-28'
                        type='number'
                        min={2000}
                        max={2200}
                        value={yearDraft}
                        onChange={(e) => setYearDraft(e.target.value)}
                        onBlur={() => {
                          const value = Number(yearDraft)
                          if (Number.isInteger(value) && value >= 2000 && value <= 2200) {
                            setYear(value)
                            setPage(0)
                          } else setYearDraft(String(year))
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur()
                        }}
                      />
                    </label>
                    {manage && (
                      <label className='min-w-48 flex-1 text-xs font-medium text-muted'>
                        Balances for<select
                          aria-label='Balances for employee'
                          className='mt-1 h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink'
                          value={employee}
                          onChange={(e) => {
                            setEmployee(e.target.value)
                            setPage(0)
                          }}
                        >
                          <option value=''>All employees · select for balances</option>
                          {data.data.employees.map((item) => (
                            <option key={item.id} value={item.id}>{item.name}</option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                  {data.data.balances.length > 0 && (
                    <section
                      aria-label='Leave balances'
                      className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'
                    >
                      {data.data.balances.map((balance) => (
                        <div
                          key={balance.leave_type_id}
                          className='rounded-xl border border-line bg-surface p-5'
                        >
                          <p className='text-sm font-medium text-ink'>{balance.name}</p>
                          <p className='mt-2 text-2xl font-bold text-ink'>
                            {balance.available_days === null
                              ? 'Untracked'
                              : `${formatDays(balance.available_days)} days`}{' '}
                            <span className='text-xs font-normal text-muted'>available</span>
                          </p>
                          <p className='mt-2 text-xs text-muted'>
                            {formatDays(balance.used_days)} used ·{' '}
                            {formatDays(balance.pending_days)} pending ·{' '}
                            {balance.entitled_days === null
                              ? 'No fixed entitlement'
                              : `${formatDays(balance.entitled_days)} entitled`}
                            {balance.adjustment_days !== 0 &&
                              ` · ${formatDays(balance.adjustment_days)} adjusted`}
                          </p>
                        </div>
                      ))}
                    </section>
                  )}
                  <section>
                    <div className='mb-4 flex flex-wrap items-center justify-between gap-3'>
                      <h2 className='font-display text-lg font-semibold text-ink'>
                        {manage ? 'Requests' : 'Your requests'}
                      </h2>
                      <div className='flex w-full flex-wrap gap-2 sm:w-auto'>
                        <div className='w-full sm:w-56'>
                          <Input
                            aria-label='Search leave'
                            placeholder={manage ? 'Find employee or leave type' : 'Find leave type'}
                            value={search}
                            onChange={(e) => {
                              setSearch(e.target.value)
                              setPage(0)
                            }}
                          />
                        </div>
                        <select
                          aria-label='Request status'
                          className='h-10 rounded-md border border-line bg-surface px-3 text-sm text-ink'
                          value={status}
                          onChange={(e) => {
                            setStatus(e.target.value)
                            setPage(0)
                          }}
                        >
                          {['all', 'pending', 'approved', 'rejected', 'withdrawn', 'cancelled'].map(
                            (item) => (
                              <option key={item} value={item}>
                                {item === 'all' ? 'All statuses' : item}
                              </option>
                            ),
                          )}
                        </select>
                      </div>
                    </div>
                    {!list.length
                      ? (
                        <div className='rounded-xl border border-dashed border-line bg-surface p-10 text-center'>
                          <CalendarDays className='mx-auto h-8 w-8 text-muted' />
                          <p className='mt-3 font-medium text-ink'>No leave requests to show</p>
                          <p className='mt-1 text-sm text-muted'>
                            Try another year or filter, or start a leave request.
                          </p>
                        </div>
                      )
                      : (
                        <div className='grid gap-3 md:grid-cols-2'>
                          {list.map((request) => (
                            <button
                              key={request.id}
                              onClick={() => open(request.id)}
                              className='group rounded-xl border border-line bg-surface p-5 text-left transition hover:border-emerald/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald'
                            >
                              <div className='flex items-start justify-between gap-3'>
                                <div>
                                  <p className='text-xs text-muted'>
                                    {manage ? request.employee_name : request.start_date}
                                  </p>
                                  <h3 className='mt-1 font-semibold text-ink'>
                                    {request.leave_type_name}
                                  </h3>
                                </div>
                                <span
                                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                                    request.status === 'pending'
                                      ? 'bg-amber/10 text-amber'
                                      : request.status === 'approved'
                                      ? 'bg-emerald/10 text-emerald'
                                      : 'bg-canvas text-muted'
                                  }`}
                                >
                                  {request.status}
                                </span>
                              </div>
                              <p className='mt-3 text-xs text-muted'>
                                {manage && `${request.start_date} · `}
                                {formatLeaveDuration(
                                  request.total_days,
                                  request.day_portion,
                                  request.requested_minutes,
                                )}
                              </p>
                              <div className='mt-3 flex justify-end text-muted'>
                                <ChevronRight size={16} />
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    <div className='mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted'>
                      <p aria-live='polite'>
                        {data.isFetching
                          ? 'Updating requests…'
                          : `${data.data.request_total} matching requests · Page ${page + 1}`}
                      </p>
                      <div className='flex gap-2'>
                        <Button
                          variant='outline'
                          disabled={page === 0 || data.isFetching}
                          onClick={() => setPage(page - 1)}
                        >
                          Previous
                        </Button>
                        <Button
                          variant='outline'
                          disabled={(page + 1) * 50 >= data.data.request_total || data.isFetching}
                          onClick={() => setPage(page + 1)}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  </section>
                </>
              )}
          </>
        )}
    </div>
  )
}
