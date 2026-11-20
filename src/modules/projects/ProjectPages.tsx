import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, ClipboardList, FolderKanban, Plus, Search } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom'
import { z } from 'zod'

import { CASH_ALLOWED_ROLES } from '@/config/navigation'
import { EmptyState } from '@/components/patterns/EmptyState'
import { PageHeader } from '@/components/patterns/PageHeader'
import { Button } from '@/components/ui/Button'
import { FieldError, Input } from '@/components/ui/Input'
import { StatusPill } from '@/components/ui/StatusPill'
import { useProtectedIdentityScope, type IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import { formatDateTimeInZone, formatLocalDateLabel, getTodayIsoInZone } from '@/modules/attendance/lib/zonedTime'
import { useAuth } from '@/modules/auth/AuthProvider'
import { ForbiddenPage } from '@/modules/auth/ForbiddenPage'
import { ProjectDocumentsPanel } from './documents/ProjectDocumentsPanel'
import { ProjectTeamPanel } from './team/ProjectTeamPanel'
import { DailyTrackerPanel } from './tracker/DailyTrackerPanel'
import {
  initialProjectStatuses, listProjects, projectKey, projectPageSize, projectStatuses, readProjectCashSummary,
  readMissedProjectUpdates, readProjectHistory, readProjectInventorySummary, readProjectWorkspace,
  type ProjectDetails, type ProjectStatus, type ProjectWorkspace,
} from './projectApi'
import {
  healthOptions, projectAmount, projectCardClass, projectFieldClass, projectLinkClass, projectSelectClass, statusOptions,
} from './projectDisplay'
import { ProjectEditor } from './ProjectEditor'
import { ProjectStatusChange } from './ProjectStatusChange'

const projectListPath = '/ops/projects'
const trackerPath = '/ops/projects/tracker'
const missedUpdatesPath = '/tracker/missed-updates'
const tabs = [
  { key: 'summary', label: 'Summary' },
  { key: 'team', label: 'Team' },
  { key: 'updates', label: 'Daily updates' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'cash', label: 'Project cash' },
  { key: 'documents', label: 'Documents' },
  { key: 'history', label: 'History' },
] as const

type ProjectTab = typeof tabs[number]['key']
type ProjectAccess = ReturnType<typeof useProjectsAccess>

function detailsPath(projectId: string, tab: ProjectTab = 'summary') {
  return '/projects/' + projectId + '/' + tab
}

function useProjectsAccess() {
  const auth = useAuth()
  const scope = useProtectedIdentityScope(auth)
  const permissions = auth.access?.permissionKeys ?? []
  const roles = auth.access?.roleKeys ?? []
  const has = (permission: string) => permissions.includes(permission)
  const canAssignAll = has('projects.assign_all')
  return {
    scope,
    canReadAll: has('projects.read_all'),
    canManageProjects: has('projects.manage'),
    canReadOperational: has('projects.read_operational'),
    canAssignAll,
    canCreate: has('projects.create') && (canAssignAll || roles.includes('project_manager')),
    canUpdateAll: has('projects.update_all'),
    canTrack: ['daily_updates.read', 'daily_updates.read_all', 'daily_updates.create', 'daily_updates.endorse'].some(has),
    canTrackAll: has('daily_updates.read_all'),
    canReadInventory: has('inventory.read'),
    canRequestStock: has('inventory.request'),
    mustBeAssignedForStock: roles.includes('project_manager') || roles.includes('coordinator'),
    canReadCashAll: !roles.includes('warehouse_manager') && (has('cash_advances.view_all') || roles.includes('super_admin')),
    canReadProjectCash: !roles.includes('warehouse_manager'),
    canOpenCash: roles.some((role) => CASH_ALLOWED_ROLES.includes(role))
      && ['cash_advances.manage', 'cash_advances.view_all', 'cash_advances.request'].some(has),
  }
}

function ProjectNotice({ message, retry }: { message: string; retry: () => void }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface p-4">
    <FieldError>{message}</FieldError>
    <Button type="button" size="sm" variant="outline" onClick={retry}>Retry</Button>
  </div>
}

function ProjectIndex({ access, tracker }: { access: ProjectAccess; tracker: boolean }) {
  const { scope } = access
  const [name, setName] = useState('')
  const [filters, setFilters] = useState({ name: '', status: '' as ProjectStatus | '', page: 0 })
  const query = useQuery({
    queryKey: [...projectKey(scope), 'list', filters], queryFn: ({ signal }) => listProjects(scope, signal, filters),
    retry: false,
  })
  const count = query.data?.count ?? 0
  const more = (filters.page + 1) * projectPageSize < count

  return <div className="space-y-5">
    <PageHeader title={tracker ? 'Daily tracker' : 'Projects'}
      subtitle={tracker ? 'Choose a construction project to open its daily updates.' : 'Construction sites, teams and daily progress.'}
      actions={<>
        {tracker ? <Link to={projectListPath} className={projectLinkClass}><ArrowLeft size={16} /> All projects</Link>
          : access.canTrack && <Link to={trackerPath} className={projectLinkClass}><ClipboardList size={16} /> Daily tracker</Link>}
        {tracker && access.canTrackAll && <Link to={missedUpdatesPath} className={projectLinkClass}>Missed updates</Link>}
        {!tracker && access.canCreate && <Link to="/projects/new"
          className="inline-flex h-10 items-center gap-2 rounded-md bg-emerald px-4 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald focus-visible:ring-offset-2">
          <Plus size={16} aria-hidden="true" /> Create project
        </Link>}
      </>} />
    <form className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4"
      onSubmit={(event) => { event.preventDefault(); setFilters({ ...filters, name: name.trim(), page: 0 }) }}>
      <label className={projectFieldClass + ' w-full max-w-sm'}>
        <span>Find a project</span>
        <Input type="search" value={name} maxLength={100} placeholder="Search by project name"
          leftIcon={<Search size={16} aria-hidden="true" />} onChange={(event) => {
            setName(event.target.value)
            if (!event.target.value) setFilters((current) => ({ ...current, name: '', page: 0 }))
          }} />
      </label>
      <label className={projectFieldClass + ' min-w-36'}>
        <span>Status</span>
        <select className={projectSelectClass} value={filters.status}
          onChange={(event) => setFilters({ ...filters, status: event.target.value as ProjectStatus | '', page: 0 })}>
          <option value="">All statuses</option>
          {projectStatuses.map((status) => <option key={status} value={status}>{statusOptions[status].label}</option>)}
        </select>
      </label>
      <Button type="submit" variant="outline">Search</Button>
    </form>

    {query.isPending && <p role="status" className="text-sm text-muted">Loading projects…</p>}
    {query.isError && <ProjectNotice message="Could not load projects." retry={() => void query.refetch()} />}
    {query.isSuccess && query.data.rows.length === 0 && (
      <EmptyState icon={<FolderKanban size={22} />} title={filters.name || filters.status ? 'No matching projects' : 'No projects to show'}
        description={filters.name || filters.status ? 'Try another project name or status.' : 'Projects you can access will appear here.'} />
    )}
    {query.isSuccess && <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
      {query.data.rows.map((project) => {
        const { label, tone } = statusOptions[project.status]
        return <li key={project.id}>
          <Link to={detailsPath(project.id, tracker ? 'updates' : 'summary')} aria-label={project.name}
            className="block h-full space-y-2 rounded-xl border border-line bg-surface p-4 text-ink transition-colors hover:border-emerald focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="break-all font-mono text-xs text-muted">{project.project_code}</span>
              <StatusPill tone={tone}>{label}</StatusPill>
            </div>
            <div className="flex items-center justify-between gap-3">
              <h2 className="break-words font-display text-base font-semibold">{project.name}</h2>
              <ArrowRight size={17} aria-hidden="true" className="shrink-0 text-muted" />
            </div>
          </Link>
        </li>
      })}
    </ul>}
    {(count > projectPageSize || filters.page > 0) && <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted">{count.toLocaleString()} {count === 1 ? 'project' : 'projects'}</p>
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" disabled={filters.page === 0}
          onClick={() => setFilters({ ...filters, page: filters.page - 1 })}>Previous</Button>
        <Button type="button" size="sm" variant="outline" disabled={!more}
          onClick={() => setFilters({ ...filters, page: filters.page + 1 })}>Next</Button>
      </div>
    </div>}
  </div>
}

export function ProjectListPage({ tracker = false }: { tracker?: boolean }) {
  const access = useProjectsAccess()
  if (!access.scope.isAuthReady || !access.scope.identityKey) return null
  if (tracker && !access.canTrack) return <ForbiddenPage />
  return <ProjectIndex key={JSON.stringify([access.scope.identityKey, access.scope.authEpoch, tracker])} access={access} tracker={tracker} />
}

export function ProjectCreatePage() {
  const access = useProjectsAccess()
  const navigate = useNavigate()
  if (!access.scope.isAuthReady || !access.scope.identityKey) return null
  if (!access.canCreate) return <ForbiddenPage />
  return <div className="mx-auto max-w-4xl space-y-5">
    <Link to={projectListPath} className={projectLinkClass}><ArrowLeft size={16} /> All projects</Link>
    <PageHeader title="Create project" />
    <ProjectEditor key={JSON.stringify([access.scope.identityKey, access.scope.authEpoch])}
      scope={access.scope} canAssignAll={access.canAssignAll}
      onSaved={(id) => { void navigate(detailsPath(id)) }} />
  </div>
}

function ProjectFacts({ heading, facts }: { heading: string; facts: Array<[string, ReactNode]> }) {
  return <section className={projectCardClass}>
    <h2 className="font-display text-lg font-semibold text-ink">{heading}</h2>
    <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {facts.map(([label, value]) => <div key={label} className="min-w-0 space-y-1">
        <dt className="text-xs font-medium text-muted">{label}</dt>
        <dd className="break-words text-sm font-medium text-ink">{value ?? '—'}</dd>
      </div>)}
    </dl>
  </section>
}

function ProjectSummary({ details }: { details: ProjectDetails }) {
  return <>
    <ProjectFacts heading="Project details" facts={[
      ['Client', details.client_name],
      ['Site location', details.site_location],
      ['Planned start', details.planned_start_date && formatLocalDateLabel(details.planned_start_date)],
      ['Expected end', details.expected_end_date && formatLocalDateLabel(details.expected_end_date)],
      ['Completed', details.actual_completion_date && formatLocalDateLabel(details.actual_completion_date)],
      ['Health', <StatusPill tone={healthOptions[details.health_status].tone}>{healthOptions[details.health_status].label}</StatusPill>],
      ['Contract reference', details.contract_reference],
      ['Budget reference', details.budget_reference],
      ['Estimated budget', details.estimated_budget_ugx === null ? null :
        <span className="whitespace-nowrap tabular-nums">{projectAmount.format(details.estimated_budget_ugx)}</span>],
    ]} />
    {(details.operational_notes || details.budget_notes) && <section className={projectCardClass}>
      {details.operational_notes && <div><h2 className="font-display font-semibold text-ink">Operational notes</h2>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm text-soft">{details.operational_notes}</p></div>}
      {details.budget_notes && <div><h2 className="font-display font-semibold text-ink">Budget notes</h2>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm text-soft">{details.budget_notes}</p></div>}
    </section>}
  </>
}

function InventorySummary({ scope, projectId }: { scope: IdentityScopeRef; projectId: string }) {
  const query = useQuery({
    queryKey: [...projectKey(scope), projectId, 'inventory-summary'], queryFn: () => readProjectInventorySummary(scope, projectId),
    retry: false,
  })
  if (query.isPending) return <p role="status" className="text-sm text-muted">Loading project inventory…</p>
  if (query.isError) return <ProjectNotice message="Could not load project inventory." retry={() => void query.refetch()} />
  const summary = query.data
  if (!summary) return <EmptyState title="No inventory activity" />
  return <ProjectFacts heading="Inventory and equipment" facts={[
    ['Requests pending', summary.pending_request_count],
    ['Requests approved', summary.approved_request_count],
    ['Requests fulfilled', summary.fulfilled_request_count],
    ['Consumables issued', summary.issued_consumable_quantity],
    ['Equipment on issue', summary.active_equipment_custody_count],
    ['Overdue returns', summary.overdue_return_count],
  ]} />
}

function CashSummary({ scope, projectId }: { scope: IdentityScopeRef; projectId: string }) {
  const query = useQuery({
    queryKey: [...projectKey(scope), projectId, 'cash-summary'], queryFn: () => readProjectCashSummary(scope, projectId),
    retry: false,
  })
  if (query.isPending) return <p role="status" className="text-sm text-muted">Loading project cash…</p>
  if (query.isError) return <ProjectNotice message="Could not load project cash." retry={() => void query.refetch()} />
  const summary = query.data
  if (!summary) return <EmptyState title="No project cash activity" />
  const money = (value: number) => <span className="whitespace-nowrap tabular-nums">{projectAmount.format(value)}</span>
  return <ProjectFacts heading="Project cash summary" facts={[
    ['Requested', money(summary.requested)],
    ['Approved', money(summary.approved)],
    ['Disbursed', money(summary.disbursed)],
    ['Accepted expenses', money(summary.accepted_expenses)],
    ['Cash returned', money(summary.returned_cash)],
    ['Outstanding', money(summary.outstanding_balance)],
    ['Pending accountability', summary.pending_accountability_count],
    ['Receipt exceptions', summary.receipt_exception_count],
  ]} />
}

const historyLabels: Record<string, string> = {
  'projects.created': 'Project created',
  'projects.updated': 'Project details changed',
  'projects.status_changed': 'Project status changed',
  'projects.member_assigned': 'Team member assigned',
  'projects.member_unassigned': 'Team member removed',
}

function ProjectHistory({ scope, projectId }: { scope: IdentityScopeRef; projectId: string }) {
  const query = useQuery({
    queryKey: [...projectKey(scope), projectId, 'history'], queryFn: () => readProjectHistory(scope, projectId),
    retry: false,
  })
  if (query.isPending) return <p role="status" className="text-sm text-muted">Loading project history…</p>
  if (query.isError) return <ProjectNotice message="Could not load project history." retry={() => void query.refetch()} />
  if (!query.data.length) return <EmptyState title="No project activity recorded" />
  return <section className={projectCardClass} aria-label="Project history">
    <h2 className="font-display text-lg font-semibold text-ink">Project history</h2>
    <ul className="divide-y divide-line">
      {query.data.map((event, index) => <li key={event.occurred_at + ':' + index} className="space-y-1 py-3">
        <p className="text-sm font-semibold text-ink">{historyLabels[event.event_type] ?? event.event_type.replace(/[._]/g, ' ')}</p>
        <p className="text-xs text-muted">{formatDateTimeInZone(event.occurred_at, 'Africa/Kampala')}{event.actor_name && ' · ' + event.actor_name}</p>
        {event.reason && <p className="whitespace-pre-wrap break-words text-sm text-soft">{event.reason}</p>}
      </li>)}
    </ul>
  </section>
}

function WorkspaceContent({ access, workspace, tab }: { access: ProjectAccess; workspace: ProjectWorkspace; tab: ProjectTab }) {
  const [edit, setEdit] = useState(false)
  const [transition, setTransition] = useState(false)
  const [message, setMessage] = useState('')
  const { scope } = access
  const { identity, details, isAssigned, isPrimaryPm } = workspace
  const projectId = identity.id
  const canEdit = Boolean(details && (access.canUpdateAll || isPrimaryPm))
  const canTransition = access.canUpdateAll || access.canAssignAll || isPrimaryPm
  const isOperational = initialProjectStatuses.some((status) => status === identity.status)
  const status = statusOptions[identity.status]
  const visible = {
    summary: true,
    team: access.canReadAll || access.canManageProjects || access.canReadOperational || isAssigned,
    updates: access.canTrack && (access.canTrackAll || isAssigned),
    inventory: access.canReadInventory || access.canReadAll || isAssigned,
    cash: access.canReadCashAll || (access.canReadProjectCash && isAssigned),
    documents: access.canReadAll || isAssigned,
    history: access.canReadAll || access.canReadOperational || isAssigned,
  }

  if (!visible[tab]) return <ForbiddenPage />

  return <div className="space-y-5">
    <Link to={projectListPath} className={projectLinkClass}><ArrowLeft size={16} aria-hidden="true" /> All projects</Link>
    <div className="space-y-4 rounded-xl border border-line bg-surface p-4 sm:p-6">
      <PageHeader title={identity.name} eyebrow={identity.project_code}
        subtitle={[details?.client_name, details?.site_location].filter(Boolean).join(' · ') || undefined}
        actions={<>
          {canEdit && <Button type="button" variant="outline" onClick={() => { setMessage(''); setEdit(true) }}>Edit project</Button>}
          {canTransition && <Button type="button" variant="outline" onClick={() => { setMessage(''); setTransition(true) }}>Change status</Button>}
        </>} />
      <StatusPill tone={status.tone}>{status.label}</StatusPill>
    </div>
    {message && <p role="status" className="rounded-lg bg-emerald-tint p-3 text-sm text-ink">{message}</p>}
    <nav aria-label="Project sections" className="flex flex-wrap gap-2 border-b border-line pb-3">
      {tabs.filter(({ key }) => visible[key]).map(({ key, label }) => (
        <NavLink key={key} to={detailsPath(projectId, key)} end
          className={({ isActive }) => 'rounded-md px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald '
            + (isActive ? 'bg-emerald-tint text-emerald-600' : 'text-soft hover:bg-surface hover:text-ink')}>{label}</NavLink>
      ))}
    </nav>

    {tab === 'summary' && (details
      ? <ProjectSummary details={details} />
      : <ProjectFacts heading="Project details" facts={[['Project code', identity.project_code], ['Status', status.label]]} />)}
    {tab === 'team' && <ProjectTeamPanel projectId={projectId} projectStatus={identity.status} />}
    {tab === 'updates' && <DailyTrackerPanel projectId={projectId} projectStatus={identity.status} />}
    {tab === 'inventory' && <>
      {access.canRequestStock && isOperational && (!access.mustBeAssignedForStock || isAssigned) && (
        <Link to={'/inventory/requests?project=' + projectId} className={projectLinkClass}>Request stock for this project <ArrowRight size={15} /></Link>
      )}
      <InventorySummary scope={scope} projectId={projectId} />
    </>}
    {tab === 'cash' && <>
      {access.canOpenCash && (
        <Link to={'/ops/cash?project=' + projectId} className={projectLinkClass}>Open project cash <ArrowRight size={15} /></Link>
      )}
      <CashSummary scope={scope} projectId={projectId} />
    </>}
    {tab === 'documents' && (
      <ProjectDocumentsPanel projectId={projectId} canUpload={access.canAssignAll || access.canUpdateAll || isPrimaryPm} />
    )}
    {tab === 'history' && <ProjectHistory scope={scope} projectId={projectId} />}
    {edit && canEdit && details && <ProjectEditor scope={scope} project={details} canAssignAll={access.canAssignAll}
      onSaved={() => { setEdit(false); setMessage('Project details saved.') }} onCancel={() => setEdit(false)} />}
    {transition && canTransition && <ProjectStatusChange project={identity} scope={scope} onClose={() => setTransition(false)} />}
  </div>
}

function WorkspaceRoute({ projectId, tab, access }: { projectId: string; tab: ProjectTab; access: ProjectAccess }) {
  const { scope } = access
  const mayReadDetails = access.canReadAll || access.canManageProjects
  const query = useQuery({
    queryKey: [...projectKey(scope), projectId, 'workspace', mayReadDetails],
    queryFn: ({ signal }) => readProjectWorkspace(scope, projectId, mayReadDetails, signal),
    retry: false,
  })

  if (query.isPending) return <p role="status" className="text-sm text-muted">Opening project…</p>
  if (query.isError) return <ProjectNotice message="Could not load this project." retry={() => void query.refetch()} />
  if (!query.data) return <MissingProject />
  return <WorkspaceContent access={access} workspace={query.data} tab={tab} />
}

function MissingProject() {
  return <EmptyState icon={<FolderKanban size={22} />} title="Project unavailable"
    description="This project may be missing or outside your access."
    action={<Link to={projectListPath} className={projectLinkClass}>Return to projects</Link>} />
}

export function ProjectWorkspacePage() {
  const { projectId = '', projectTab = 'summary' } = useParams()
  const access = useProjectsAccess()
  const tab = tabs.find(({ key }) => key === projectTab)?.key
  if (!access.scope.isAuthReady || !access.scope.identityKey) return null
  if (!tab || !z.string().uuid().safeParse(projectId).success) return <MissingProject />
  return <WorkspaceRoute key={JSON.stringify([access.scope.identityKey, access.scope.authEpoch, projectId])}
    access={access} projectId={projectId} tab={tab} />
}

function MissedUpdatesContent({ scope }: { scope: IdentityScopeRef }) {
  const today = getTodayIsoInZone('Africa/Kampala')
  const [date, setDate] = useState(today)
  const [selected, setSelected] = useState('')
  const query = useQuery({
    queryKey: [...projectKey(scope), 'missed-updates', selected],
    queryFn: () => readMissedProjectUpdates(scope, selected),
    enabled: Boolean(selected),
    retry: false,
  })

  return <div className="space-y-5">
    <Link to={trackerPath} className={projectLinkClass}><ArrowLeft size={16} /> Daily tracker</Link>
    <PageHeader title="Missed updates" subtitle="Check which active project assignments are missing a submitted daily update." />
    <form className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!date || date > today) return
        if (date === selected) void query.refetch()
        else setSelected(date)
      }}>
      <label className={projectFieldClass}>
        <span>Update date</span>
        <Input type="date" required value={date} max={today} onChange={(event) => setDate(event.target.value)} />
      </label>
      <Button type="submit" disabled={!date || date > today} loading={query.isFetching}>Check updates</Button>
    </form>
    {query.isError && <ProjectNotice message="Could not check missed updates." retry={() => void query.refetch()} />}
    {query.isSuccess && <section className={projectCardClass} aria-label="Missed update results">
      <h2 className="font-display text-lg font-semibold text-ink">{formatLocalDateLabel(selected)}</h2>
      {query.data.length === 0 ? <p className="text-sm text-soft">No missed updates recorded for this date.</p>
        : <ul className="divide-y divide-line">{query.data.map((row) => (
          <li key={row.project_id + ':' + row.user_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <span className="break-words text-sm text-ink">{row.user_full_name}</span>
            <Link to={detailsPath(row.project_id, 'updates')} className={projectLinkClass}>{row.project_name}</Link>
          </li>
        ))}</ul>}
    </section>}
  </div>
}

export function ProjectMissedUpdatesPage() {
  const { scope, canTrackAll } = useProjectsAccess()
  if (!scope.isAuthReady || !scope.identityKey) return null
  if (!canTrackAll) return <ForbiddenPage />
  return <MissedUpdatesContent key={JSON.stringify([scope.identityKey, scope.authEpoch])} scope={scope} />
}
