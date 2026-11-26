import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { z } from 'zod'

import { PageHeader } from '@/components/patterns/PageHeader'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { useProtectedIdentityScope, type IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import { getSupabaseClient } from '@/lib/supabase/client'
import { formatDateTimeInZone } from '@/modules/attendance/lib/zonedTime'
import { useAuth } from '@/modules/auth/AuthProvider'
import { systemSessionGuard } from './systemSession'

const pageSize = 25
const rowSchema = z.object({
  id: z.string().uuid(),
  occurred_at: z.string(),
  event_type: z.string(),
  entity_type: z.string(),
  entity_id: z.string().nullable(),
  reason: z.string().nullable(),
  actor_profile_id: z.string().uuid().nullable(),
  actor: z.object({ display_name: z.string() }).nullable(),
})
const changesSchema = z.object({ previous_values: z.unknown(), new_values: z.unknown() })
type AuditRow = z.infer<typeof rowSchema>
const section = 'rounded-xl border border-line bg-surface p-4'

const activityLabels = new Map([
  ['inventory.router_float_issued', 'Router issued to technician'],
])

function readableLabel(key: string) {
  const words = key.replace(/[._]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function activityLabel(eventType: string) {
  return activityLabels.get(eventType) ?? readableLabel(eventType)
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, '\\$&')
}

function activitySearchPattern(search: string) {
  const words = search.split(/[.\s_]+/).filter(Boolean)
  const phrase = words.join(' ').toLowerCase()
  const match = [...activityLabels].find(([, label]) => label.toLowerCase() === phrase)
  return match ? escapeLike(match[0]) : '%' + words.map(escapeLike).join('%') + '%'
}

async function loadAudit(scope: IdentityScopeRef, search: string, page: number, signal: AbortSignal) {
  const check = systemSessionGuard(scope)
  const start = page * pageSize
  const query = getSupabaseClient().from('audit_events')
    .select('id,occurred_at,event_type,entity_type,entity_id,reason,actor_profile_id,actor:profiles!audit_events_actor_profile_id_fkey(display_name)')
    .order('occurred_at', { ascending: false }).order('id', { ascending: false }).range(start, start + pageSize)
  if (search) query.ilike('event_type', activitySearchPattern(search))
  const { data, error } = await query.abortSignal(signal)
  check()
  if (error) throw new Error('The audit log could not be loaded.')
  const rows = rowSchema.array().parse(data)
  return { rows: rows.slice(0, pageSize), hasNext: rows.length > pageSize }
}

function AuditDetail({ scope, entry, close }: { scope: IdentityScopeRef; entry: AuditRow; close: () => void }) {
  const query = useQuery({
    queryKey: ['system-audit', scope.identityKey, scope.authEpoch, 'event', entry.id],
    queryFn: async ({ signal }) => {
      const check = systemSessionGuard(scope)
      const { data, error } = await getSupabaseClient().from('audit_events').select('previous_values,new_values')
        .eq('id', entry.id).abortSignal(signal).single()
      check()
      if (error) throw new Error('Recorded changes could not be loaded.')
      return changesSchema.parse(data)
    },
    enabled: scope.isAuthReady,
  })
  return (
    <Dialog open title={activityLabel(entry.event_type)} description={formatDateTimeInZone(entry.occurred_at, 'Africa/Kampala')}
      onOpenChange={(open) => { if (!open) close() }}>
      <div className="space-y-4">
        {entry.reason && <p className="whitespace-pre-wrap break-words text-sm text-soft">{entry.reason}</p>}
        <p className="break-all text-sm text-soft">{readableLabel(entry.entity_type)}{entry.entity_id && ' · ' + entry.entity_id}</p>
        {query.isPending && <p role="status" className="text-sm text-soft">Loading recorded changes…</p>}
        {query.isError && <div role="alert" className="space-y-2 text-sm">
          <p>{query.error.message}</p>
          <Button variant="outline" onClick={() => void query.refetch()}>Try again</Button>
        </div>}
        {query.data && (
          <div className="grid gap-3 sm:grid-cols-2">
            {[['Before', query.data.previous_values], ['After', query.data.new_values]].map(([label, data]) => (
              <section key={String(label)} className="min-w-0 rounded-lg border border-line bg-canvas p-3">
                <h3 className="text-sm font-semibold">{String(label)}</h3>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs text-soft">
                  {data == null ? 'No recorded values' : JSON.stringify(data, null, 2)}
                </pre>
              </section>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  )
}

export default function AuditLogPage() {
  const scope = useProtectedIdentityScope(useAuth())
  return <AuditWorkspace key={String(scope.identityKey) + ':' + scope.authEpoch} scope={scope} />
}

function AuditWorkspace({ scope }: { scope: IdentityScopeRef }) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<AuditRow>()
  const audit = useQuery({
    queryKey: ['system-audit', scope.identityKey, scope.authEpoch, search, page],
    enabled: scope.isAuthReady,
    queryFn: ({ signal }) => loadAudit(scope, search, page, signal),
  })
  function searchEvents(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const eventType = new FormData(event.currentTarget).get('eventType')
    setSearch(typeof eventType === 'string' ? eventType.trim() : '')
    setPage(0)
  }
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader eyebrow="System" title="Audit Log" />
      <form onSubmit={searchEvents} className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-52 flex-1 flex-col gap-1.5 text-sm font-medium">Search activity
          <Input type="search" name="eventType" placeholder="e.g. router, payroll, role" maxLength={100} />
        </label>
        <Button type="submit" variant="outline">Search</Button>
      </form>
      {audit.isPending && <p role="status" className="text-sm text-soft">Loading audit events…</p>}
      {audit.isError && <div role="alert" className={section + ' space-y-2'}>
        <p>{audit.error.message}</p>
        <Button variant="outline" onClick={() => void audit.refetch()}>Try again</Button>
      </div>}
      {audit.data && (
        <section aria-label="Audit events" className="space-y-3">
          {audit.data.rows.length === 0 && <p className={section}>No matching events.</p>}
          {audit.data.rows.map((event) => (
            <article key={event.id} className={section + ' flex flex-wrap items-start justify-between gap-3'}>
              <div className="min-w-0 space-y-1">
                <h2 className="break-words font-medium text-ink">{activityLabel(event.event_type)}</h2>
                <p className="text-sm text-soft">{event.actor?.display_name ?? (event.actor_profile_id ? 'Name unavailable' : 'System')} · {formatDateTimeInZone(event.occurred_at, 'Africa/Kampala')}</p>
                <p className="break-all text-sm text-soft">{readableLabel(event.entity_type)}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setSelected(event)}>View details</Button>
            </article>
          ))}
          {(page > 0 || audit.data.hasNext) && <nav aria-label="Audit log pages" className="flex items-center gap-3 text-sm">
            <Button variant="outline" disabled={page === 0} onClick={() => setPage(Math.max(0, page - 1))}>Previous</Button>
            <span>Page {page + 1}</span>
            <Button variant="outline" disabled={!audit.data.hasNext} onClick={() => setPage(page + 1)}>Next</Button>
          </nav>}
        </section>
      )}
      {selected && scope.isAuthReady && <AuditDetail scope={scope} entry={selected} close={() => setSelected(undefined)} />}
    </div>
  )
}
