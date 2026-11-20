import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Coins, Plus, Search } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { z } from 'zod'

import { EmptyState } from '@/components/patterns/EmptyState'
import { PageHeader } from '@/components/patterns/PageHeader'
import { Button } from '@/components/ui/Button'
import { FieldError, Input } from '@/components/ui/Input'
import { StatusPill } from '@/components/ui/StatusPill'
import { CASH_ALLOWED_ROLES } from '@/config/navigation'
import { useProtectedIdentityScope, type IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import { formatDateTimeInZone } from '@/modules/attendance/lib/zonedTime'
import { useAuth } from '@/modules/auth/AuthProvider'
import { ForbiddenPage } from '@/modules/auth/ForbiddenPage'

import { CashAccountabilityPanel } from './accountability/CashAccountabilityPanel'
import { cashAmount, cashCard, cashField, cashLink, cashSelect, cashStateLabels } from './cashDisplay'
import { CashRequestDialog } from './CashRequestDialog'
import { CashFinanceActions } from './finance/CashFinanceActions'
import { cashKey, cashStatuses, readCashAdvances, readCashBalance, type CashAdvance, type CashStatus } from './projectCashApi'

const listPath = '/ops/cash'
const pageSize = 20
const zone = 'Africa/Kampala'

function detailPath(advanceId: string) {
  return listPath + '/' + advanceId
}

function useCashAccess() {
  const auth = useAuth()
  const scope = useProtectedIdentityScope(auth)
  const permissions = auth.access?.permissionKeys ?? []
  const rolePermitted = auth.access?.roleKeys.some((role) => CASH_ALLOWED_ROLES.includes(role))
  const canRequest = permissions.includes('cash_advances.request')
  const canManage = permissions.includes('cash_advances.manage')
  return {
    scope, canRequest, canManage,
    allowed: Boolean(rolePermitted && (canRequest || canManage || permissions.includes('cash_advances.view_all'))),
  }
}

function RetryNotice({ message, retry }: { message: string; retry: () => void }) {
  return <div className={cashCard + ' flex flex-wrap items-center justify-between gap-3'}>
    <FieldError>{message}</FieldError>
    <Button type="button" size="sm" variant="outline" onClick={retry}>Retry</Button>
  </div>
}

function CashStatusTag({ status }: { status: CashStatus }) {
  const { label, tone } = cashStateLabels[status]
  return <StatusPill tone={tone}>{label}</StatusPill>
}

function CashList({ scope, canRequest, canManage }: { scope: IdentityScopeRef; canRequest: boolean; canManage: boolean }) {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const project = z.string().uuid().safeParse(params.get('project')).data ?? ''
  const [status, setStatus] = useState<CashStatus | ''>('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [creating, setCreating] = useState(false)
  const query = useQuery({
    queryKey: [...cashKey(scope), 'requests'], queryFn: () => readCashAdvances(scope), retry: false,
  })
  const requests = query.data ?? []
  const projects = new Map(requests.map((item) => [item.project_id, item.projects?.name ?? 'Project']))
  if (project && !projects.has(project)) projects.set(project, 'Selected project')

  const needle = search.trim().toLowerCase()
  const matching = requests.filter((item) => {
    return (!project || item.project_id === project) && (!status || item.status === status)
      && (!needle || [item.purpose, item.projects?.name, item.profiles_user?.display_name].some((text) => text?.toLowerCase().includes(needle)))
  })
  const currentPage = Math.min(page, Math.max(0, Math.ceil(matching.length / pageSize) - 1))
  const start = currentPage * pageSize
  const rows = matching.slice(start, start + pageSize)
  const hasFilters = Boolean(project || status || needle)

  function selectProject(value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set('project', value)
    else next.delete('project')
    setParams(next, { replace: true })
    setPage(0)
  }

  return <div className="space-y-5">
    <PageHeader title="Project Cash" subtitle="Request advances and track disbursements, expenses and cash returns."
      actions={canRequest && <Button type="button" onClick={() => setCreating(true)} leftIcon={<Plus size={16} aria-hidden="true" />}>
        Request cash advance
      </Button>} />
    <div className={cashCard + ' grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_auto]'}>
      <label className={cashField}><span>Find an advance</span>
        <Input type="search" value={search} maxLength={100} placeholder="Purpose, project or recipient"
          leftIcon={<Search size={16} aria-hidden="true" />} onChange={(event) => { setSearch(event.target.value); setPage(0) }} />
      </label>
      <label className={cashField}><span>Project</span>
        <select value={project} className={cashSelect} onChange={(event) => selectProject(event.target.value)}>
          <option value="">All projects</option>
          {[...projects.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </label>
      <label className={cashField}><span>Status</span>
        <select value={status} className={cashSelect} onChange={(event) => {
          const value = cashStatuses.find((option) => option === event.target.value)
          setStatus(value ?? '')
          setPage(0)
        }}>
          <option value="">All statuses</option>
          {cashStatuses.map((option) => <option key={option} value={option}>{cashStateLabels[option].label}</option>)}
        </select>
      </label>
      {hasFilters && <Button type="button" variant="outline" onClick={() => {
        selectProject(''); setStatus(''); setSearch('')
      }}>Clear filters</Button>}
    </div>

    {query.isPending && <p role="status" className="text-sm text-muted">Loading project cash…</p>}
    {query.isError && <RetryNotice message="Could not load cash advances." retry={() => void query.refetch()} />}
    {query.isSuccess && !rows.length && <EmptyState icon={<Coins size={22} />}
      title={hasFilters ? 'No requests match the filters.' : 'No cash advances yet'}
      description={hasFilters ? 'Clear or change the filters.' : 'Cash advances you have access to will appear here.'} />}
    {rows.length > 0 && <ul className="grid gap-3 lg:grid-cols-2">
      {rows.map((item) => <li key={item.id}>
        <Link to={detailPath(item.id)}
          className={cashCard + ' block h-full space-y-2 text-ink hover:border-emerald focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald'}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CashStatusTag status={item.status} />
            <span className="whitespace-nowrap text-sm font-semibold tabular-nums">{cashAmount(item.amount_requested)}</span>
          </div>
          <h2 className="break-words font-display text-base font-semibold">{item.purpose}</h2>
          <p className="break-words text-sm text-muted">{item.projects?.name ?? 'Project'} · {item.profiles_user?.display_name ?? 'Recipient unavailable'}</p>
          <div className="flex items-center justify-between gap-3 text-muted">
            <span className="text-xs">{formatDateTimeInZone(item.requested_at, zone)}</span>
            <ArrowRight size={16} aria-hidden="true" />
          </div>
        </Link>
      </li>)}
    </ul>}
    {matching.length > pageSize && <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
      <span>{start + 1}–{Math.min(start + pageSize, matching.length)} of {matching.length} requests</span>
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button>
        <Button type="button" size="sm" variant="outline" disabled={start + pageSize >= matching.length}
          onClick={() => setPage(currentPage + 1)}>Next</Button>
      </div>
    </div>}
    {creating && canRequest && <CashRequestDialog scope={scope} canManage={canManage} initialProject={project}
      onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); void navigate(detailPath(id)) }} />}
  </div>
}

export function ProjectCashListPage() {
  const access = useCashAccess()
  if (!access.scope.isAuthReady || !access.scope.identityKey) return null
  if (!access.allowed) return <ForbiddenPage />
  return <CashList key={JSON.stringify([access.scope.identityKey, access.scope.authEpoch])}
    scope={access.scope} canRequest={access.canRequest} canManage={access.canManage} />
}

function CashFacts({ fields }: { fields: Array<[string, ReactNode]> }) {
  return <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
    {fields.map(([label, value]) => <div key={label} className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium text-ink">{value ?? '—'}</dd>
    </div>)}
  </dl>
}

function CashRecord({ scope, advance, canManage }: { scope: IdentityScopeRef; advance: CashAdvance; canManage: boolean }) {
  const balance = useQuery({
    queryKey: [...cashKey(scope), 'balance', advance.id], queryFn: () => readCashBalance(scope, advance.id), retry: false,
  })
  const amount = (value: number) => <span className="whitespace-nowrap font-display text-lg font-semibold tabular-nums">{cashAmount(value)}</span>
  const date = (value?: string | null) => value ? formatDateTimeInZone(value, zone) : undefined

  const activity: Array<[string, string | undefined]> = [
    ['Requested by', advance.profiles_entered_by?.display_name],
    ['Requested at', date(advance.requested_at)],
    ['Approved by', advance.profiles_approved_by?.display_name],
    ['Approved at', date(advance.approved_at)],
    ['Disbursed by', advance.profiles_disbursed_by?.display_name],
    ['Disbursed at', date(advance.disbursed_at)],
    ['Disbursement reference', advance.disbursement_reference ?? undefined],
    [advance.status === 'rejected' ? 'Rejected by' : 'Closed by', advance.profiles_closed_by?.display_name],
    [advance.status === 'rejected' ? 'Rejected at' : 'Closed at', date(advance.closed_at)],
    ['Approval override reason', advance.override_reason ?? undefined],
  ]

  return <div className="space-y-5">
    <Link to={listPath} className={cashLink}><ArrowLeft size={16} aria-hidden="true" /> All cash advances</Link>
    <section className={cashCard + ' space-y-4'}>
      <PageHeader title={advance.purpose} eyebrow="Project cash advance" subtitle={advance.projects?.name}
        actions={<CashStatusTag status={advance.status} />} />
      <CashFacts fields={[
        ['Recipient', [advance.profiles_user?.display_name, advance.requester_role].filter(Boolean).join(' · ') || undefined],
        ['Amount requested', amount(advance.amount_requested)],
        ['Amount disbursed', advance.amount_disbursed == null ? undefined : amount(advance.amount_disbursed)],
        ['Outstanding balance', balance.isPending ? <span role="status">Loading…</span> : balance.isError ? <span>Unavailable</span> : amount(balance.data)],
      ]} />
      {balance.isError && <RetryNotice message="Could not check the outstanding balance." retry={() => void balance.refetch()} />}
    </section>
    {canManage && <CashFinanceActions advanceId={advance.id} recipientId={advance.user_id} status={advance.status}
      amountRequested={advance.amount_requested} scope={scope} />}
    {(advance.status === 'disbursed' || advance.status === 'completed') && (
      <CashAccountabilityPanel advanceId={advance.id} recipientId={advance.user_id} status={advance.status}
        canManage={canManage} scope={scope} />
    )}
    <section className={cashCard + ' space-y-4'}>
      <h2 className="font-display text-base font-semibold text-ink">Activity details</h2>
      <CashFacts fields={activity.filter(([, value]) => Boolean(value))} />
    </section>
  </div>
}

function MissingCashAdvance() {
  return <EmptyState title="Cash advance unavailable" description="This advance may be outside your access."
    action={<Link to={listPath} className={cashLink}>Return to project cash</Link>} />
}

function CashDetail({ scope, advanceId, canManage }: { scope: IdentityScopeRef; advanceId: string; canManage: boolean }) {
  const query = useQuery({
    queryKey: [...cashKey(scope), 'request', advanceId],
    queryFn: async () => (await readCashAdvances(scope, advanceId)).find((item) => item.id === advanceId) ?? null,
    retry: false,
  })
  if (query.isPending) return <p role="status" className="text-sm text-muted">Opening cash advance…</p>
  if (query.isError) return <RetryNotice message="Could not load this cash advance." retry={() => void query.refetch()} />
  if (!query.data) return <MissingCashAdvance />
  return <CashRecord scope={scope} advance={query.data} canManage={canManage} />
}

export function ProjectCashDetailPage() {
  const { advanceId = '' } = useParams()
  const { scope, allowed, canManage } = useCashAccess()
  if (!scope.isAuthReady || !scope.identityKey) return null
  if (!allowed) return <ForbiddenPage />
  const id = z.string().uuid().safeParse(advanceId).data?.toLowerCase()
  if (!id) return <MissingCashAdvance />
  return <CashDetail key={JSON.stringify([scope.identityKey, scope.authEpoch, id])} scope={scope} advanceId={id} canManage={canManage} />
}
