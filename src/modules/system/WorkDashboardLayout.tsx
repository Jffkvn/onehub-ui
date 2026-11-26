import { ArrowLeft, ArrowUpRight, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/patterns/PageHeader'
import { cn } from '@/lib/utils'

export const workPanel = 'min-w-0 rounded-xl border border-line bg-surface p-4 sm:p-5'

export type WorkRow = {
  id: string
  title: string
  detail?: ReactNode
  href?: string
  action?: string
}

export type WorkLoad = {
  isPending: boolean
  isError: boolean
  refetch: () => unknown
}

export type WorkQueue = {
  key: string
  title: string
  context: string
  empty: string
  rows: WorkRow[]
  load: WorkLoad
  priority?: boolean
  href?: string
}

export function QueueState({ load, children }: { load: WorkLoad; children: ReactNode }) {
  if (load.isError) return (
    <div role="alert" className="flex items-center gap-3 text-sm text-soft">
      <span>Couldn’t load this section.</span>
      <Button size="sm" variant="outline" onClick={() => void load.refetch()}>Retry</Button>
    </div>
  )
  if (load.isPending) return <p role="status" className="text-sm text-muted">Loading…</p>
  return children
}

export function QueuePanel({ queue, limit, embedded = false }: {
  queue: WorkQueue
  limit?: number
  embedded?: boolean
}) {
  const visibleRows = queue.rows.slice(0, limit)
  return (
    <section className={embedded ? 'min-w-0' : workPanel} aria-label={queue.title}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-display text-base font-semibold text-ink">{queue.title}</h2>
          <p className="text-xs text-muted">{queue.context}</p>
        </div>
        {!queue.load.isPending && !queue.load.isError && limit !== undefined && queue.rows.length > 0 && (
          <Link className="text-sm font-medium text-emerald-600 hover:underline" to={'?focus=' + queue.key}>
            {queue.rows.length > limit ? `View all ${queue.rows.length}` : `Open queue (${queue.rows.length})`}
          </Link>
        )}
      </div>
      <QueueState load={queue.load}>
        {visibleRows.length ? (
          <ul className="divide-y divide-line">
            {visibleRows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
                <div className="min-w-0">
                  <p className="break-words text-sm font-medium text-ink">{row.title}</p>
                  {row.detail && <div className="mt-0.5 text-xs text-soft">{row.detail}</div>}
                </div>
                {row.href && <Link aria-label={(row.action ?? 'Open') + ' ' + row.title}
                  to={row.href} className="inline-flex items-center gap-1 rounded px-1 py-1 text-sm font-medium text-emerald-600 hover:underline">
                  {row.action ?? 'Open'} <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
                </Link>}
              </li>
            ))}
          </ul>
        ) : <p className="py-2 text-sm text-soft">{queue.empty}</p>}
      </QueueState>
      {queue.href && <Link className="mt-3 inline-block text-sm font-medium text-emerald-600 hover:underline" to={queue.href}>Open workspace</Link>}
    </section>
  )
}

export function WorkDashboard({
  title, description, queues, children, action, overviewQueues = [], queuesAfterContent = false,
}: {
  title: string
  description: string
  queues: WorkQueue[]
  children?: ReactNode
  action?: ReactNode
  overviewQueues?: WorkQueue[]
  queuesAfterContent?: boolean
}) {
  const [params] = useSearchParams()
  const focused = [...queues, ...overviewQueues].find((queue) => queue.key === params.get('focus'))
  if (focused) return (
    <div className="space-y-4">
      <Link to="/dashboard" className="inline-flex items-center gap-2 text-sm font-medium text-emerald-600 hover:underline">
        <ArrowLeft aria-hidden="true" className="h-4 w-4" /> Back to dashboard
      </Link>
      <QueuePanel queue={focused} />
    </div>
  )
  const cards = queues.length > 0 && (
    <section aria-label="Work queues" className={cn('grid gap-3 sm:grid-cols-2',
      queues.length === 3 ? 'lg:grid-cols-3' : 'xl:grid-cols-4')}>
      {queues.map((queue) => (
        <Link key={queue.key} to={'?focus=' + queue.key}
          className={cn(workPanel, 'group flex items-start justify-between gap-2 hover:border-emerald focus-visible:outline focus-visible:outline-emerald',
            queue.priority && queue.rows.length > 0 && !queue.load.isError && 'border-amber/60')}>
          <div>
            <p className="text-sm font-medium text-soft">{queue.title}</p>
            <p className="mt-1 font-display text-3xl font-semibold tabular-nums text-ink">
              {queue.load.isPending || queue.load.isError ? '—' : queue.rows.length.toLocaleString('en-UG')}
            </p>
            <p className="mt-0.5 text-xs text-muted">{queue.context}</p>
          </div>
          <ArrowUpRight className="h-4 w-4 shrink-0 text-muted group-hover:text-emerald" aria-hidden="true" />
        </Link>
      ))}
    </section>
  )
  return (
    <div className="space-y-5">
      <PageHeader title={title} subtitle={description} actions={action} />
      {!queuesAfterContent && cards}
      {children}
      {queuesAfterContent && cards}
    </div>
  )
}
