import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Plus } from 'lucide-react'
import { useId, useRef, useState, type ChangeEvent } from 'react'

import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { FieldError, FormGroup, Input, Textarea } from '@/components/ui/Input'
import { StatusPill, type StatusPillProps } from '@/components/ui/StatusPill'
import { isAbortError, useProtectedIdentityScope, type IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import { formatDateTimeInZone, formatLocalDateLabel, getTodayIsoInZone } from '@/modules/attendance/lib/zonedTime'
import { useAuth } from '@/modules/auth/AuthProvider'

import {
  getTrackerEvidenceUrl, isProjectEvidencePath, listTrackerRevisions, listTrackerRoles, listTrackerUpdates,
  maxTrackerPhotos, reviewTrackerUpdate, saveTrackerUpdate, UnconfirmedTrackerWrite,
  type ReviewDecision, type TrackerStatus, type TrackerUpdate,
} from './trackerApi'

type TrackerScope = { scope: IdentityScopeRef; projectId: string }
type TrackerDialog =
  | { kind: 'compose'; update?: TrackerUpdate }
  | { kind: 'review'; update: TrackerUpdate; decision: ReviewDecision }
  | { kind: 'history'; update: TrackerUpdate }

const states: Record<TrackerStatus, { label: string; tone: StatusPillProps['tone'] }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  submitted: { label: 'Submitted', tone: 'info' },
  revision_requested: { label: 'Revision requested', tone: 'warning' },
  endorsed: { label: 'Endorsed', tone: 'success' },
}
const selectClass = 'h-9 rounded-md border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald'
const card = 'space-y-3 rounded-lg border border-line bg-surface p-4'
const fileTypes = '.jpg,.jpeg,.png,.webp,.heic,.heif,.avif,image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif'

function trackerKey(scope: IdentityScopeRef, projectId: string) {
  return ['projects', scope.identityKey, scope.authEpoch, projectId, 'daily-tracker'] as const
}

function EvidenceButtons({ scope, projectId, update }: TrackerScope & { update: Pick<TrackerUpdate, 'submitted_by' | 'photo_urls'> }) {
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState('')
  if (!update.photo_urls.length) return null

  async function open(path: string) {
    const popup = window.open('', '_blank')
    if (!popup) {
      setError('Allow pop-ups for OneHub to open the private photo.')
      return
    }
    popup.opener = null
    setError('')
    setOpening(true)
    try {
      const url = await getTrackerEvidenceUrl(scope, path, projectId, update.submitted_by)
      if (!popup.closed) popup.location.replace(url)
    } catch (failure) {
      popup.close()
      if (!isAbortError(failure)) setError('This private photo could not be opened.')
    } finally {
      setOpening(false)
    }
  }

  return <div className="space-y-2">
    <div className="flex flex-wrap gap-2">
      {update.photo_urls.map((path, index) => isProjectEvidencePath(path, projectId, update.submitted_by)
        ? <Button key={index} type="button" size="sm" variant="outline" disabled={opening}
            leftIcon={<Camera size={14} aria-hidden="true" />} onClick={() => void open(path)}>View photo {index + 1}</Button>
        : <span key={index} className="text-xs text-muted">Photo {index + 1} unavailable</span>)}
    </div>
    <FieldError error={error} />
  </div>
}

function FormDialog({ scope, projectId, update, onClose, onSaved }: TrackerScope & {
  update?: TrackerUpdate; onClose: () => void; onSaved: (message: string) => void
}) {
  const today = getTodayIsoInZone('Africa/Kampala')
  const [date, setDate] = useState(update?.update_date ?? today)
  const [summary, setSummary] = useState(update?.summary ?? '')
  const [savedPhotos, setSavedPhotos] = useState(update?.photo_urls ?? [])
  const [newPhotos, setNewPhotos] = useState<File[]>([])
  const [fileError, setFileError] = useState('')
  const lock = useRef(false)
  const queryClient = useQueryClient()
  const dateField = useId()
  const summaryField = useId()
  const photosField = useId()
  const mutation = useMutation({
    mutationFn: (submit: boolean) => saveTrackerUpdate(scope, projectId, { id: update?.id ?? null, date, summary, savedPhotos, newPhotos, submit }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
    retry: false,
  })
  const unconfirmed = mutation.error instanceof UnconfirmedTrackerWrite
  const canSave = Boolean(date && summary.trim()) && !mutation.isPending && !unconfirmed
  const dirty = date !== (update?.update_date ?? today) || summary !== (update?.summary ?? '')
    || savedPhotos.length !== (update?.photo_urls.length ?? 0) || newPhotos.length > 0

  function selectPhotos(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    if (savedPhotos.length + newPhotos.length + selected.length > maxTrackerPhotos) {
      setFileError('You can attach up to 10 photos to one daily update.')
      return
    }
    setFileError('')
    setNewPhotos((current) => [...current, ...selected])
  }

  async function save(submit: boolean) {
    if (!canSave || lock.current) return
    lock.current = true
    try {
      await mutation.mutateAsync(submit)
      onSaved(submit ? 'Daily update submitted.' : 'Daily update saved as a draft.')
    } catch { /* The form shows the error and keeps the entered values. */ }
    finally { lock.current = false }
  }

  return <Dialog open title={update ? 'Edit daily update' : 'New daily update'}
    description="Record the work completed and add photos if needed."
    hasUnsavedChanges={dirty && !mutation.isPending && !unconfirmed}
    onOpenChange={(open) => { if (!open && !lock.current) onClose() }}
    footer={<>
      <Button type="button" variant="outline" disabled={!canSave} onClick={() => void save(false)}>Save draft</Button>
      <Button type="button" disabled={!canSave} loading={mutation.isPending} onClick={() => void save(true)}>
        {update?.status === 'revision_requested' ? 'Resubmit update' : 'Submit update'}
      </Button>
    </>}>
    <fieldset className="space-y-4" disabled={mutation.isPending || unconfirmed}>
      {update?.pm_feedback && <p className="rounded-md bg-amber-tint p-3 text-sm text-ink whitespace-pre-wrap">{update.pm_feedback}</p>}
      <FormGroup label="Update date" htmlFor={dateField}>
        <Input id={dateField} type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
      </FormGroup>
      <FormGroup label="Work summary" htmlFor={summaryField}>
        <Textarea id={summaryField} value={summary} onChange={(event) => setSummary(event.target.value)} rows={4} required />
      </FormGroup>
      <FormGroup label="Attach photos" htmlFor={photosField} hint="Up to 10 photos, 10 MB each.">
        <Input id={photosField} type="file" accept={fileTypes} multiple onChange={selectPhotos} />
      </FormGroup>
      {(savedPhotos.length > 0 || newPhotos.length > 0) && <ul className="divide-y divide-line rounded-md border border-line px-3 text-sm">
        {savedPhotos.map((_, index) => <li className="flex items-center justify-between gap-2 py-1" key={'saved-' + index}>
          <span>Saved photo {index + 1}</span>
          <Button type="button" size="sm" variant="ghost" aria-label={'Remove saved photo ' + (index + 1)}
            onClick={() => setSavedPhotos((list) => list.filter((__, position) => position !== index))}>Remove</Button>
        </li>)}
        {newPhotos.map((file, index) => <li className="flex items-center justify-between gap-2 py-1" key={'new-' + index}>
          <span className="min-w-0 break-words">{file.name}</span>
          <Button type="button" size="sm" variant="ghost" aria-label={'Remove ' + file.name}
            onClick={() => setNewPhotos((list) => list.filter((_, position) => position !== index))}>Remove</Button>
        </li>)}
      </ul>}
    </fieldset>
    <div className="mt-3">
      <FieldError error={mutation.isError && !isAbortError(mutation.error) ? mutation.error.message : fileError} />
    </div>
  </Dialog>
}

function ReviewDialog({ scope, projectId, update, decision, onClose, onSaved }: TrackerScope & {
  update: TrackerUpdate; decision: ReviewDecision; onClose: () => void; onSaved: (message: string) => void
}) {
  const [feedback, setFeedback] = useState('')
  const feedbackField = useId()
  const locked = useRef(false)
  const queryClient = useQueryClient()
  const revision = decision === 'request_revision'
  const label = revision ? 'Request revision' : 'Endorse'
  const mutation = useMutation({
    mutationFn: () => reviewTrackerUpdate(scope, projectId, update.id, decision, feedback),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
    retry: false,
  })
  const disabled = mutation.isPending || mutation.error instanceof UnconfirmedTrackerWrite || (revision && !feedback.trim())

  async function save() {
    if (disabled || locked.current) return
    locked.current = true
    try {
      await mutation.mutateAsync()
      onSaved(revision ? 'Revision requested.' : 'Daily update endorsed.')
    } catch { /* The form shows the error and keeps the feedback. */ }
    finally { locked.current = false }
  }

  return <Dialog open title={label} description={revision ? 'Tell the author what needs to change.' : 'Confirm that you reviewed this field update.'}
    onOpenChange={(open) => { if (!open && !locked.current) onClose() }}
    hasUnsavedChanges={Boolean(feedback.trim()) && !mutation.isPending && !(mutation.error instanceof UnconfirmedTrackerWrite)}
    footer={<Button type="button" disabled={disabled} loading={mutation.isPending} onClick={() => void save()}>{label}</Button>}>
    <FormGroup label="Feedback" htmlFor={feedbackField}>
      <Textarea id={feedbackField} disabled={mutation.isPending} value={feedback} onChange={(event) => setFeedback(event.target.value)}
        placeholder={revision ? 'Describe the revision needed' : 'Optional note'} rows={3} required={revision} />
    </FormGroup>
    <FieldError error={mutation.isError && !isAbortError(mutation.error) ? mutation.error.message : undefined} />
  </Dialog>
}

function HistoryDialog({ scope, projectId, update, onClose }: TrackerScope & { update: TrackerUpdate; onClose: () => void }) {
  const history = useQuery({
    queryKey: [...trackerKey(scope, projectId), update.id, 'history'],
    queryFn: () => listTrackerRevisions(scope, update.id),
    retry: false,
  })
  return <Dialog open title="Update history" description="Status and summary recorded at each change."
    onOpenChange={(open) => { if (!open) onClose() }}>
    {history.isPending && <p role="status" className="text-sm text-muted">Loading update history…</p>}
    {history.isError && <FieldError>Update history could not be loaded.</FieldError>}
    {history.data?.length === 0 && <p className="text-sm text-muted">No revisions recorded yet.</p>}
    <ol className="space-y-3">
      {history.data?.map((revision) => <li key={revision.id} className={card}>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={states[revision.status].tone}>{states[revision.status].label}</StatusPill>
          <span className="text-xs text-muted">{formatDateTimeInZone(revision.created_at)} · {revision.profiles_created_by?.display_name ?? 'Team member'}</span>
        </div>
        <p className="whitespace-pre-wrap break-words text-sm text-ink">{revision.summary}</p>
        {revision.pm_feedback && <p className="whitespace-pre-wrap break-words text-sm text-muted">{revision.pm_feedback}</p>}
        {revision.photo_urls.length > 0 && <p className="text-xs text-muted">{revision.photo_urls.length} photos recorded</p>}
      </li>)}
    </ol>
  </Dialog>
}

function TrackerContent({ scope, projectId, projectStatus, permissions }: TrackerScope & {
  projectStatus: string; permissions: string[]
}) {
  const [status, setStatus] = useState('')
  const [dialog, setDialog] = useState<TrackerDialog>()
  const [notice, setNotice] = useState('')
  const key = trackerKey(scope, projectId)
  const updates = useQuery({ queryKey: key, queryFn: () => listTrackerUpdates(scope, projectId), retry: false })
  const canEndorse = permissions.includes('daily_updates.endorse')
  const roles = useQuery({
    queryKey: [...key, 'assignment'], queryFn: () => listTrackerRoles(scope, projectId),
    enabled: permissions.includes('daily_updates.create') || canEndorse, retry: false,
  })
  const isAssigned = Boolean(roles.data?.length) && roles.isSuccess
  const canCompose = projectStatus === 'active' && isAssigned
  const canReview = canEndorse && (permissions.includes('projects.update_all') || (roles.isSuccess && roles.data.includes('pm')))
  const visible = updates.data?.filter((update) => !status || update.status === status) ?? []

  function saved(message: string) {
    setDialog(undefined)
    setNotice(message)
  }

  return <section className="space-y-4" aria-label="Daily tracker">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-display text-xl font-semibold text-ink">Daily updates</h2>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Filter updates by status" className={selectClass} value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(states).map(([value, { label }]) => <option value={value} key={value}>{label}</option>)}
        </select>
        {canCompose && <Button type="button" leftIcon={<Plus size={16} aria-hidden="true" />}
          onClick={() => { setDialog({ kind: 'compose' }); setNotice('') }}>New daily update</Button>}
      </div>
    </div>
    {notice && <p role="status" className="rounded-md bg-emerald-tint p-3 text-sm text-ink">{notice}</p>}
    {(updates.isError || roles.isError) && <div className="flex flex-wrap items-center gap-3">
      <FieldError>{updates.isError ? 'Daily updates could not be loaded.' : 'Your project assignment could not be verified.'}</FieldError>
      <Button type="button" variant="outline" size="sm" onClick={() => {
        if (updates.isError) void updates.refetch()
        if (roles.isError) void roles.refetch()
      }}>Retry</Button>
    </div>}
    {updates.isPending && <p role="status" className="text-sm text-muted">Loading daily updates…</p>}
    {updates.isSuccess && (
      visible.length > 0 ? <ul className="space-y-3">{visible.map((update) => {
        const own = update.submitted_by === scope.identityKey
        const canEdit = isAssigned && own && (update.status === 'draft' || update.status === 'revision_requested')
        const canReviewUpdate = canReview && !own && update.status === 'submitted'
        return <li key={update.id} className={card}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-ink">{formatLocalDateLabel(update.update_date)}</h3>
            <StatusPill tone={states[update.status].tone}>{states[update.status].label}</StatusPill>
          </div>
          <p className="text-xs text-muted">
            {update.profiles_submitted_by?.display_name ?? 'Team member'}
            {update.profiles_submitted_by?.role_name ? ' · ' + update.profiles_submitted_by.role_name : ''}
            {update.profiles_endorsed_by && update.status === 'endorsed' ? ' · Endorsed by ' + update.profiles_endorsed_by.display_name : ''}
          </p>
          <p className="whitespace-pre-wrap break-words text-sm text-ink">{update.summary}</p>
          {update.pm_feedback && <div className="rounded-md bg-canvas px-3 py-2 text-sm text-ink">
            <p className="mb-1 text-xs font-medium text-muted">Reviewer feedback</p>
            <p className="whitespace-pre-wrap break-words">{update.pm_feedback}</p>
          </div>}
          <EvidenceButtons scope={scope} projectId={projectId} update={update} />
          <div className="flex flex-wrap gap-2 border-t border-line pt-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setDialog({ kind: 'history', update })}>Update history</Button>
            {canEdit && <Button type="button" variant="outline" size="sm" onClick={() => { setDialog({ kind: 'compose', update }); setNotice('') }}>Edit update</Button>}
            {canReviewUpdate && <>
              <Button type="button" variant="outline" size="sm" onClick={() => { setDialog({ kind: 'review', update, decision: 'request_revision' }); setNotice('') }}>Request revision</Button>
              <Button type="button" size="sm" onClick={() => { setDialog({ kind: 'review', update, decision: 'endorse' }); setNotice('') }}>Endorse</Button>
            </>}
          </div>
        </li>
      })}</ul> : <p className={card + ' text-sm text-muted'}>{status ? 'No updates match this status.' : 'No daily updates yet.'}</p>
    )}
    {dialog?.kind === 'history' && <HistoryDialog scope={scope} projectId={projectId} update={dialog.update} onClose={() => setDialog(undefined)} />}
    {dialog?.kind === 'compose' && <FormDialog scope={scope} projectId={projectId} update={dialog.update} onClose={() => setDialog(undefined)} onSaved={saved} />}
    {dialog?.kind === 'review' && <ReviewDialog scope={scope} projectId={projectId} decision={dialog.decision}
      update={dialog.update} onClose={() => setDialog(undefined)} onSaved={saved} />}
  </section>
}

export function DailyTrackerPanel({ projectId, projectStatus }: { projectId: string; projectStatus: string }) {
  const auth = useAuth()
  const scope = useProtectedIdentityScope(auth)
  if (!scope.isAuthReady || !scope.identityKey) return null

  return <TrackerContent key={JSON.stringify([scope.identityKey, scope.authEpoch, projectId])}
    scope={scope} projectId={projectId} projectStatus={projectStatus} permissions={auth.access?.permissionKeys ?? []} />
}
