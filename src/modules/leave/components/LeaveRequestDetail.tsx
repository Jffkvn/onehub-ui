import { useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Input'
import { allocateByYear, formatDays, formatLeaveDuration } from '../lib/leave'
import {
  downloadLeaveEvidence,
  type LeaveAction,
  type LeaveRequest,
  uploadLeaveEvidence,
  useLeaveCommand,
  useLeaveDetail,
} from '../api/leave'

export function LeaveRequestDetail(
  { request, manage, onBack }: { request: LeaveRequest; manage: boolean; onBack: () => void },
) {
  const detail = useLeaveDetail(request.id)
  const command = useLeaveCommand()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [action, setAction] = useState<LeaveAction | null>(null)
  const uploadLock = useRef(false)
  const busy = command.isPending || uploading || downloading || command.pending.length > 0
  const docs = detail.data?.documents ?? []
  // Workspace and history refresh independently. A recorded transition can
  // advance an older workspace status, but stale history cannot reverse it.
  const status = (detail.data?.events ?? []).reduce<LeaveRequest['status']>((current, event) => {
    const next = event.event_type
    if (current === 'pending' &&
      (next === 'approved' || next === 'rejected' || next === 'withdrawn' || next === 'cancelled')) {
      return next
    }
    return current === 'approved' && next === 'cancelled' ? next : current
  }, request.status)
  async function decide(next: LeaveAction) {
    setError(null)
    if (next !== 'approve' && reason.trim().length < 3) {
      setError('Add a reason of at least 3 characters.')
      return
    }
    try {
      await command.mutateAsync({
        action: next,
        payload: { id: request.id, reason: reason.trim() || null },
      })
      setAction(null)
      setReason('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The action could not be saved.')
    }
  }
  async function upload(file: File) {
    if (uploadLock.current) return
    uploadLock.current = true
    setUploading(true)
    setError(null)
    try {
      await uploadLeaveEvidence(command.scope, request.id, file)
      await detail.refetch()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The upload could not be completed.')
    } finally {
      uploadLock.current = false
      setUploading(false)
    }
  }
  async function download(path: string) {
    setDownloading(true)
    setError(null)
    try {
      const url = await downloadLeaveEvidence(command.scope, path)
      const link = document.createElement('a')
      link.href = url
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      link.click()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The private document could not be opened.')
    } finally {
      setDownloading(false)
    }
  }
  return (
    <section className='mx-auto max-w-3xl rounded-xl border border-line bg-surface p-5 sm:p-7'>
      <Button variant='ghost' onClick={onBack} disabled={uploading}>← All leave requests</Button>
      <div className='mt-5 flex flex-wrap items-start justify-between gap-3'>
        <div>
          <p className='text-xs font-medium uppercase tracking-wider text-muted'>
            {manage ? request.employee_name : 'Your request'}
          </p>
          <h2 className='mt-1 font-display text-2xl font-bold text-ink'>
            {request.leave_type_name}
          </h2>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            status === 'pending'
              ? 'bg-amber/10 text-amber'
              : status === 'approved'
              ? 'bg-emerald/10 text-emerald'
              : 'bg-canvas text-muted'
          }`}
        >
          {status}
        </span>
      </div>
      <div className='my-5 rounded-lg bg-canvas p-4'>
        <p className='font-medium text-ink'>
          {request.start_date}
          {request.end_date !== request.start_date ? ` → ${request.end_date}` : ''}
        </p>
        <p className='mt-1 text-sm text-soft'>
          {formatLeaveDuration(request.total_days, request.day_portion, request.requested_minutes)}
        </p>
        {request.day_portion === 'exact' && (
          <p className='mt-2 text-xs text-muted'>
            {request.exact_start_at &&
              new Date(request.exact_start_at).toLocaleString('en-UG', {
                timeZone: 'Africa/Kampala',
              })} → {request.exact_end_at &&
              new Date(request.exact_end_at).toLocaleTimeString('en-UG', {
                timeZone: 'Africa/Kampala',
                hour: '2-digit',
                minute: '2-digit',
              })} (Kampala display) · {request.scheduled_minutes} scheduled minutes
          </p>
        )}
        <p className='mt-2 text-xs text-muted'>
          {allocateByYear(request.allocations ?? []).map((item) =>
            `${item.year}: ${formatDays(item.days)} days`
          ).join(' · ')}
        </p>
      </div>
      <h3 className='text-sm font-semibold text-ink'>Reason</h3>
      <p className='mt-2 whitespace-pre-wrap break-words text-sm text-soft'>{request.reason}</p>
      {request.source === 'hr_on_behalf' && (
        <p className='mt-3 text-xs text-muted'>Logged on behalf by HR.</p>
      )}
      <section className='mt-7 border-t border-line pt-5'>
        <h3 className='font-semibold text-ink'>
          Supporting documents <span className='font-normal text-muted'>{docs.length}/10</span>
        </h3>
        {request.requires_evidence && status === 'pending' && (
          <p className='mt-1 text-sm text-muted'>
            Evidence is required before this request can be approved.
          </p>
        )}
        {detail.isPending
          ? <p className='mt-3 text-sm text-muted'>Loading private documents…</p>
          : detail.error
          ? (
            <div className='mt-3'>
              <p role='alert' className='text-sm text-rose'>
                Documents and history could not be loaded.
              </p>
              <Button variant='outline' onClick={() => void detail.refetch()}>Try again</Button>
            </div>
          )
          : (
            <>
              {!docs.length && (
                <p className='mt-3 text-sm text-muted'>
                  No documents attached yet.
                </p>
              )}
              <ul className='mt-3 space-y-2'>
                {docs.map((doc) => (
                  <li
                    key={doc.id}
                    className='flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3'
                  >
                    <div className='min-w-0'>
                      <p className='break-all text-sm font-medium text-ink'>
                        {doc.original_file_name}
                      </p>
                      <p className='text-xs text-muted'>
                        {formatDays(doc.size_bytes / 1024)} KB · Private
                      </p>
                    </div>
                    <div className='flex gap-2'>
                      <Button
                        variant='outline'
                        disabled={busy}
                        onClick={() => void download(doc.storage_path)}
                      >
                        Open
                      </Button>
                      {status === 'pending' && (
                        <Button
                          variant='ghost'
                          disabled={busy}
                          onClick={() => {
                            void command.mutateAsync({
                              action: 'remove_document',
                              payload: { id: doc.id },
                            }).catch((cause: unknown) =>
                              setError(
                                cause instanceof Error
                                  ? cause.message
                                  : 'Could not remove the document.',
                              )
                            )
                          }}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {status === 'pending' && docs.length < 10 && (
                <label className='mt-4 block text-sm font-medium text-ink'>
                  {uploading ? 'Uploading private evidence…' : 'Attach a document'}
                  <input
                    aria-label='Attach a document'
                    className='mt-2 block w-full text-sm text-muted file:mr-3 file:rounded-md file:border file:border-line file:bg-canvas file:px-3 file:py-2 file:text-ink'
                    type='file'
                    accept='.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.avif'
                    disabled={busy}
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      event.target.value = ''
                      if (file) void upload(file)
                    }}
                  />
                  <span className='mt-1 block text-xs text-muted'>
                    PDF or supported photo · 10 MB per file · only while pending
                  </span>
                </label>
              )}
            </>
          )}
      </section>
      <section className='mt-6 border-t border-line pt-5'>
        <h3 className='font-semibold text-ink'>History</h3>
        <ol className='mt-3 space-y-4'>
          {detail.data?.events.map((item) => (
            <li key={item.id} className='border-l-2 border-line pl-4'>
              <p className='text-sm font-medium capitalize text-ink'>
                {item.event_type.replaceAll('_', ' ')}
              </p>
              <p className='text-xs text-muted'>
                {item.actor_name ?? 'OneHub'} · {new Date(item.occurred_at).toLocaleString('en-UG')}
              </p>
              {item.reason && (
                <p className='mt-1 whitespace-pre-wrap break-words text-sm text-soft'>
                  {item.reason}
                </p>
              )}
            </li>
          ))}
        </ol>
      </section>
      {!manage && status === 'approved' && (
        <p className='mt-5 text-sm text-muted'>Contact HR if you need to cancel approved leave.</p>
      )}
      <div className='mt-7 flex flex-wrap gap-3'>
        {manage && status === 'pending' && (
          <>
            <Button
              disabled={busy || !detail.isSuccess || (request.requires_evidence && !docs.length)}
              onClick={() => setAction('approve')}
            >
              Approve
            </Button>
            <Button variant='outline' disabled={busy} onClick={() => setAction('reject')}>
              Reject
            </Button>
          </>
        )}
        {!manage && status === 'pending' && (
          <Button
            variant='outline'
            disabled={busy}
            onClick={() => setAction('withdraw')}
          >
            Withdraw request
          </Button>
        )}
        {manage && status === 'approved' && (
          <Button
            variant='outline'
            disabled={busy}
            onClick={() => setAction('cancel')}
          >
            Cancel approved leave
          </Button>
        )}
      </div>
      {action && (
        <div className='mt-4 rounded-lg border border-line bg-canvas p-4'>
          <h3 className='font-semibold capitalize text-ink'>{action} this request?</h3>
          <label className='mt-3 block text-sm text-ink'>
            {action === 'approve' ? 'Review note (optional)' : 'Reason (required)'}
            <Textarea
              aria-label='Action reason'
              className='mt-2'
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={2000}
              disabled={busy}
            />
          </label>
          <div className='mt-3 flex gap-2'>
            <Button disabled={busy} onClick={() => void decide(action)}>Confirm {action}</Button>
            <Button variant='ghost' disabled={busy} onClick={() => setAction(null)}>
              Keep request
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role='alert' className='mt-4 rounded-lg bg-rose/10 p-3 text-sm text-rose'>{error}</p>
      )}
    </section>
  )
}
