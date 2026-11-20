import { useId, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ChevronDown, Megaphone, Pencil, Pin, Plus } from 'lucide-react'

import { EmptyState } from '@/components/patterns/EmptyState'
import { PageHeader } from '@/components/patterns/PageHeader'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { FieldError, Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { StatusPill } from '@/components/ui/StatusPill'
import { isAbortError, type IdentityScopeRef, useProtectedIdentityScope } from '@/lib/idempotency/pendingOperations'
import {
  formatDateTimeInZone, formatWallClockDateInput, formatWallClockTimeInput, zonedDateTimeInputToIso,
} from '@/modules/attendance/lib/zonedTime'
import { useAuth } from '@/modules/auth/AuthProvider'
import { ForbiddenPage } from '@/modules/auth/ForbiddenPage'
import { announcementListKey, announcementsApi, type Announcement } from './api'

const timezone = 'Africa/Kampala'
const statusLabels = { scheduled: 'Scheduled', published: 'Published', expired: 'Expired' } as const
const statusTones = { scheduled: 'warning', published: 'success', expired: 'neutral' } as const
const card = 'rounded-xl border border-line bg-surface px-4 py-3 sm:px-5'

function mutationError(error: unknown) {
  if (isAbortError(error)) return null
  return error instanceof Error ? error.message : 'The announcement request could not be completed.'
}

function asLocalInput(value?: string | null) {
  return value ? formatWallClockDateInput(value, timezone) + 'T' + formatWallClockTimeInput(value, timezone) : ''
}

function EditAnnouncement({ announcement, api, onClose, onSaved }: {
  announcement: Announcement | null
  api: ReturnType<typeof announcementsApi>
  onClose: () => void
  onSaved: () => void
}) {
  const formId = useId()
  const existingPublished = asLocalInput(announcement?.published_at)
  const existingExpires = asLocalInput(announcement?.expires_at)
  const [title, setTitle] = useState(announcement?.title ?? '')
  const [body, setBody] = useState(announcement?.body ?? '')
  const [pinned, setPinned] = useState(announcement?.is_pinned ?? false)
  const [published, setPublished] = useState(existingPublished)
  const [expires, setExpires] = useState(existingExpires)
  const [validationError, setValidationError] = useState('')
  const dirty = title !== (announcement?.title ?? '') || body !== (announcement?.body ?? '')
    || pinned !== (announcement?.is_pinned ?? false) || published !== existingPublished || expires !== existingExpires
  const save = useMutation({
    mutationFn: (input: Parameters<typeof api.save>[1]) => api.save(announcement, input),
    onSuccess: onSaved,
  })
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (save.isPending) return
    setValidationError('')
    save.reset()
    const publishTime = published === existingPublished
      ? announcement?.published_at ?? null : zonedDateTimeInputToIso(published, timezone)
    const expiryTime = expires === existingExpires
      ? announcement?.expires_at ?? null : zonedDateTimeInputToIso(expires, timezone)
    if (!title.trim() || !body.trim()) {
      setValidationError('Enter a title and message.')
      return
    }
    if ((published && !publishTime) || (expires && !expiryTime)) {
      setValidationError('Enter valid publication and expiration times.')
      return
    }
    if (expiryTime && Date.parse(expiryTime) <= (publishTime ? Date.parse(publishTime) : Date.now())) {
      setValidationError('Expiration must be after publication.')
      return
    }
    save.mutate({ title, body, pinned, published: publishTime, expires: expiryTime })
  }
  const error = validationError || (save.isError && mutationError(save.error))
  return (
    <Dialog
      open
      onOpenChange={(open) => { if (!open && !save.isPending) onClose() }}
      hasUnsavedChanges={dirty && !save.isPending}
      title={announcement ? 'Edit announcement' : 'New announcement'}
      description="Published notices appear in the staff announcement feed. Times use Kampala local time."
      footer={<Button type="submit" form={formId} disabled={save.isPending}>
        {save.isPending ? 'Saving…' : announcement ? 'Save changes' : published ? 'Schedule announcement' : 'Publish announcement'}
      </Button>}
    >
      <form id={formId} onSubmit={submit} className="space-y-4">
        <label className="block space-y-1 text-sm font-medium text-ink">
          <span>Title</span>
          <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} required disabled={save.isPending} />
        </label>
        <label className="block space-y-1 text-sm font-medium text-ink">
          <span>Message</span>
          <textarea
            className="min-h-32 w-full rounded-lg border border-line bg-surface px-3 py-2 text-base text-ink focus-visible:outline-emerald sm:text-sm"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={6000}
            required
            disabled={save.isPending}
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block min-w-0 space-y-1 text-sm font-medium text-ink">
            <span>Publish at</span>
            <Input type="datetime-local" value={published} onChange={(event) => setPublished(event.target.value)} disabled={save.isPending} />
            <span className="block text-xs font-normal text-muted">Leave blank to publish now.</span>
          </label>
          <label className="block min-w-0 space-y-1 text-sm font-medium text-ink">
            <span>Expire at</span>
            <Input type="datetime-local" value={expires} onChange={(event) => setExpires(event.target.value)} disabled={save.isPending} />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-ink">
          <input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} disabled={save.isPending} />
          Pin to the top of the feed
        </label>
        {error && <FieldError>{error}</FieldError>}
      </form>
    </Dialog>
  )
}

function AnnouncementsBoard({ manage, scope }: { manage: boolean; scope: IdentityScopeRef }) {
  const [page, setPage] = useState(0)
  const [openId, setOpenId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Announcement | null | undefined>(undefined)
  const [archiving, setArchiving] = useState<Announcement | null>(null)
  const api = announcementsApi(scope)
  const client = useQueryClient()
  const key = announcementListKey(scope, manage, page)
  const keyRoot = key.slice(0, 3)
  const list = useQuery({
    queryKey: key,
    queryFn: () => api.list(manage, page),
    retry: false,
    refetchInterval: 60_000,
  })

  function refresh() {
    setPage(0)
    void client.invalidateQueries({ queryKey: keyRoot })
  }

  const acknowledge = useMutation({
    mutationFn: ({ id }: { id: string; page: number }) => api.markRead(id),
    onSuccess: (readAt, source) => {
      const recordedKey = announcementListKey(scope, false, source.page)
      client.setQueryData<Awaited<ReturnType<typeof api.list>>>(recordedKey, (previous) =>
        previous && { ...previous, items: previous.items.map((item) => item.id === source.id ? { ...item, read_at: readAt } : item) },
      )
      void client.invalidateQueries({ queryKey: [...keyRoot, true] })
    },
  })
  const archive = useMutation({
    mutationFn: (item: Announcement) => api.archive(item),
    onSuccess: () => {
      setArchiving(null)
      refresh()
    },
  })

  function toggle(item: Announcement) {
    const next = openId === item.id ? null : item.id
    setOpenId(next)
    if (next && !item.read_at && (!acknowledge.isPending || acknowledge.variables?.id !== item.id)) acknowledge.mutate({ id: item.id, page })
  }

  return (
    <main className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <PageHeader
        title={manage ? 'Manage announcements' : 'Announcements'}
        actions={manage && <Button type="button" leftIcon={<Plus size={16} />} onClick={() => setEditing(null)}>New announcement</Button>}
      />
      {list.isPending ? <Skeleton shape="card" className="h-36" /> : list.isError ? (
        <EmptyState title="Announcements could not load" description={mutationError(list.error) ?? undefined}
          icon={<Megaphone size={20} />} action={<Button type="button" variant="outline" onClick={() => void list.refetch()}>Retry</Button>} />
      ) : list.data.items.length === 0 ? (
        <EmptyState title="No announcements" icon={<Megaphone size={20} />} />
      ) : (
        <div className="space-y-3">
          {list.data.items.map((item) => manage ? (
            <article key={item.id} className={card}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="break-words font-semibold text-ink">{item.title}</h2>
                    <StatusPill tone={statusTones[item.status]}>{statusLabels[item.status]}</StatusPill>
                    {item.is_pinned && <Pin size={14} aria-label="Pinned" className="text-amber" />}
                  </div>
                  <p className="text-xs text-muted">
                    {formatDateTimeInZone(item.published_at, timezone)}
                    {item.expires_at && ` · Expires ${formatDateTimeInZone(item.expires_at, timezone)}`}
                    {` · ${item.read_count} ${item.read_count === 1 ? 'read' : 'reads'}`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" leftIcon={<Pencil size={14} />} aria-label={`Edit ${item.title}`} onClick={() => setEditing(item)}>Edit</Button>
                  <Button size="sm" variant="ghost" leftIcon={<Archive size={14} />} aria-label={`Archive ${item.title}`}
                    onClick={() => { archive.reset(); setArchiving(item) }}>Archive</Button>
                </div>
              </div>
            </article>
          ) : (
            <article key={item.id} className={card}>
              <button type="button" aria-expanded={openId === item.id} aria-label={item.title}
                className="flex w-full items-center gap-3 rounded-md py-1 text-left focus-visible:outline-emerald"
                onClick={() => toggle(item)}>
                {item.is_pinned ? <Pin size={18} aria-label="Pinned" className="shrink-0 text-amber" />
                  : <Megaphone size={18} aria-hidden="true" className="shrink-0 text-muted" />}
                <span className="min-w-0 grow break-words">
                  <strong className="block text-sm text-ink">{item.title}</strong>
                  <span className="block text-xs text-muted">{formatDateTimeInZone(item.published_at, timezone)}</span>
                </span>
                {!item.read_at && <StatusPill tone="info">Unread</StatusPill>}
                <ChevronDown size={17} aria-hidden="true" className={openId === item.id ? 'shrink-0 rotate-180' : 'shrink-0'} />
              </button>
              {openId === item.id && (
                <div className="space-y-2 border-t border-line pt-3">
                  <p className="whitespace-pre-wrap break-words text-sm text-ink">{item.body}</p>
                  {acknowledge.isError && acknowledge.variables?.id === item.id && mutationError(acknowledge.error) && (
                    <div className="space-y-1">
                      <FieldError>The read receipt could not be saved.</FieldError>
                      <Button size="sm" variant="outline" onClick={() => acknowledge.mutate({ id: item.id, page })}>Retry receipt</Button>
                    </div>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {!list.isError && (page > 0 || list.data?.has_more) && (
        <div className="flex items-center justify-between gap-3">
          <Button type="button" size="sm" variant="outline" disabled={page === 0 || list.isPending}
            onClick={() => { setPage(page - 1); setOpenId(null) }}>Previous page</Button>
          <Button type="button" size="sm" variant="outline" disabled={!list.data?.has_more}
            onClick={() => { setPage(page + 1); setOpenId(null) }}>Next page</Button>
        </div>
      )}
      {editing !== undefined && <EditAnnouncement announcement={editing} api={api}
        onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); refresh() }} />}
      {archiving && (
        <Dialog open onOpenChange={(open) => { if (!open && !archive.isPending) setArchiving(null) }} title="Archive announcement"
          description={`“${archiving.title}” will leave the staff feed. Existing read receipts will be retained.`}
          footer={<>
            <Button type="button" variant="outline" disabled={archive.isPending} onClick={() => setArchiving(null)}>Cancel</Button>
            <Button type="button" variant="danger" disabled={archive.isPending} onClick={() => archive.mutate(archiving)}>Archive announcement</Button>
          </>}>
          {archive.isError && mutationError(archive.error) && <FieldError>{mutationError(archive.error)}</FieldError>}
        </Dialog>
      )}
    </main>
  )
}

export default function AnnouncementsPage({ manage = false }: { manage?: boolean }) {
  const auth = useAuth()
  const scope = useProtectedIdentityScope(auth)
  const permission = manage ? 'announcements.manage' : 'announcements.read'
  if (!scope.isAuthReady || !auth.access?.permissionKeys.includes(permission)) return <ForbiddenPage />
  return <AnnouncementsBoard key={`${scope.identityKey}:${scope.authEpoch}:${manage}`} manage={manage} scope={scope} />
}
