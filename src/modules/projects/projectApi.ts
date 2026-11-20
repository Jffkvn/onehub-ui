import { z } from 'zod'

import {
  assertProtectedSessionCurrent,
  captureProtectedSessionSnapshot,
  type IdentityScopeRef,
} from '@/lib/idempotency/pendingOperations'
import { getSupabaseClient } from '@/lib/supabase/client'

export const projectStatuses = ['planned', 'active', 'on_hold', 'completed', 'cancelled', 'archived'] as const
export const initialProjectStatuses = ['planned', 'active', 'on_hold'] as const
export const projectHealths = ['on_track', 'needs_attention', 'at_risk'] as const
export const projectPageSize = 24

const id = z.string().uuid()
const date = z.string().date().nullable()
const nullableText = z.string().nullable()
const money = z.coerce.number().finite().nonnegative()
const count = money.int()

const identitySchema = z.object({
  id,
  project_code: z.string(),
  name: z.string(),
  status: z.enum(projectStatuses),
})
const detailsSchema = z.object({
  client_name: nullableText,
  site_location: nullableText,
  planned_start_date: date,
  expected_end_date: date,
  actual_completion_date: date,
  contract_reference: nullableText,
  budget_reference: nullableText,
  operational_notes: nullableText,
  estimated_budget_ugx: z.union([z.null(), money]),
  budget_notes: nullableText,
  health_status: z.enum(projectHealths),
})
const projectSchema = identitySchema.merge(detailsSchema)

const identityColumns = 'id,project_code,name,status'
const detailColumns = [
  identityColumns, 'client_name', 'site_location', 'planned_start_date', 'expected_end_date', 'actual_completion_date',
  'contract_reference', 'budget_reference', 'operational_notes', 'estimated_budget_ugx', 'budget_notes', 'health_status',
].join(',')

export type ProjectIdentity = z.infer<typeof identitySchema>
export type ProjectDetails = z.infer<typeof projectSchema>
export type ProjectStatus = ProjectIdentity['status']
export type ProjectHealth = ProjectDetails['health_status']
export type ProjectWorkspace = {
  identity: ProjectIdentity
  details: ProjectDetails | null
  isAssigned: boolean
  isPrimaryPm: boolean
}

export const projectFields = z.object({
  project_code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9._/-]{1,49}$/, 'Enter a valid project code.'),
  name: z.string().trim().min(1, 'Project name is required.').max(250),
  client_name: nullableText,
  site_location: nullableText,
  planned_start_date: date,
  expected_end_date: date,
  contract_reference: nullableText,
  budget_reference: nullableText,
  operational_notes: nullableText,
  estimated_budget_ugx: z.number().finite().nonnegative().nullable(),
  budget_notes: nullableText,
  health_status: z.enum(projectHealths),
}).superRefine((fields, context) => {
  if (fields.planned_start_date && fields.expected_end_date && fields.expected_end_date < fields.planned_start_date) {
    context.addIssue({ code: 'custom', path: ['expected_end_date'], message: 'Expected end date cannot be before the planned start date.' })
  }
})

export type ProjectFields = z.infer<typeof projectFields>

const reasonSchema = z.string().trim().min(3, 'Enter a reason of at least three characters.').max(500)

export class ProjectWriteUnconfirmed extends Error {
  constructor() {
    super('OneHub could not confirm the change. Check the project and its history before submitting again.')
    this.name = 'ProjectWriteUnconfirmed'
  }
}

export function projectKey(scope: IdentityScopeRef) {
  return ['projects', scope.identityKey, scope.authEpoch] as const
}

function sessionGuard(scope: IdentityScopeRef) {
  const snapshot = captureProtectedSessionSnapshot({
    identityKey: scope.identityKey, authEpoch: scope.authEpoch, isReady: scope.isAuthReady,
  })
  const check = () => assertProtectedSessionCurrent(snapshot, scope.latestRef.current)
  check()
  return check
}

export async function listProjects(scope: IdentityScopeRef, signal: AbortSignal, filter: {
  status: ProjectStatus | ''
  name: string
  page: number
}) {
  const check = sessionGuard(scope)
  const first = filter.page * projectPageSize
  const query = getSupabaseClient().from('projects').select(identityColumns, { count: 'exact' })
    .order('name').order('id').range(first, first + projectPageSize - 1)
  if (filter.name) query.ilike('name', '%' + filter.name.replace(/[\\%_]/g, '\\$&') + '%')
  if (filter.status) query.eq('status', filter.status)
  const result = await query.abortSignal(signal)
  check()
  if (result.error || result.count == null) throw new Error('Projects could not be loaded.')
  return { rows: identitySchema.array().parse(result.data), count: result.count }
}

export async function readProjectWorkspace(
  scope: IdentityScopeRef,
  projectId: string,
  canReadAll: boolean,
  signal: AbortSignal,
): Promise<ProjectWorkspace | null> {
  const check = sessionGuard(scope)
  const client = getSupabaseClient()
  const assignments = await client.from('project_assignments').select('role_on_project').eq('project_id', projectId)
    .eq('user_id', scope.identityKey ?? '').is('unassigned_at', null).abortSignal(signal)
  check()
  if (assignments.error) throw new Error('Project access could not be confirmed.')
  const roles = z.object({ role_on_project: z.enum(['pm', 'coordinator']) }).array().parse(assignments.data)
  const project = await client.from('projects').select(canReadAll || roles.length > 0 ? detailColumns : identityColumns)
    .eq('id', projectId).abortSignal(signal).maybeSingle()
  check()
  if (project.error) throw new Error('This project could not be loaded.')
  if (!project.data) return null
  return {
    identity: identitySchema.parse(project.data),
    details: canReadAll || roles.length > 0 ? projectSchema.parse(project.data) : null,
    isAssigned: roles.length > 0,
    isPrimaryPm: roles.some(({ role_on_project }) => role_on_project === 'pm'),
  }
}

async function rpc(scope: IdentityScopeRef, name: string, args: Record<string, unknown>, write = false): Promise<unknown> {
  const check = sessionGuard(scope)
  let result
  try {
    result = await getSupabaseClient().rpc(name, args)
  } catch {
    check()
    if (write) throw new ProjectWriteUnconfirmed()
    throw new Error('Project information could not be loaded.')
  }

  check()
  if (!result.error) return result.data
  if (result.error.code === '42501') throw new Error('You do not have permission for this project action.')
  if (write && (result.status === 0 || result.status >= 500)) throw new ProjectWriteUnconfirmed()
  if (['23505', '23514', '22023', '22000'].includes(result.error.code)) throw new Error(result.error.message)
  throw new Error(write ? 'OneHub could not save this change.' : 'Project information could not be loaded.')
}

export async function createProject(scope: IdentityScopeRef, fields: ProjectFields, status: typeof initialProjectStatuses[number], team: {
  primaryId: string | null
  coordinators: string[]
}, reason: string) {
  const projectId = await rpc(scope, 'rpc_create_project', {
    p_project: { ...projectFields.parse(fields), status },
    p_primary_pm_id: id.nullable().parse(team.primaryId),
    p_coordinator_ids: [...new Set(id.array().parse(team.coordinators))],
    p_reason: reasonSchema.parse(reason),
  }, true)
  const result = id.safeParse(projectId)
  if (!result.success) throw new ProjectWriteUnconfirmed()
  return result.data
}

export async function updateProject(scope: IdentityScopeRef, projectId: string, fields: Partial<ProjectFields>, reason: string) {
  await rpc(scope, 'rpc_update_project', {
    p_project_id: id.parse(projectId), p_changes: fields, p_reason: reasonSchema.parse(reason),
  }, true)
}

const completionSchema = z.object({
  can_complete: z.boolean(),
  warnings: z.object({ domain: z.string(), message: z.string() }).array(),
})

export async function readProjectCompletion(scope: IdentityScopeRef, projectId: string) {
  return completionSchema.parse(await rpc(scope, 'rpc_check_project_completion', { p_project_id: projectId }))
}

export async function changeProjectStatus(scope: IdentityScopeRef, projectId: string, target: ProjectStatus, reason: string) {
  await rpc(scope, 'rpc_transition_project_status', {
    p_project_id: projectId, p_target_status: target, p_reason: reasonSchema.parse(reason),
    p_override_domain: null, p_override_reason: null,
  }, true)
}

const historyEntry = z.object({
  event_type: z.string(),
  occurred_at: z.string().datetime({ offset: true }),
  actor_name: nullableText,
  reason: nullableText,
})

export async function readProjectHistory(scope: IdentityScopeRef, projectId: string) {
  const result = await rpc(scope, 'rpc_get_project_history', { p_project_id: projectId })
  return historyEntry.array().parse(result)
}

const cashSummary = z.object({
  requested: money, approved: money, disbursed: money, accepted_expenses: money, returned_cash: money,
  outstanding_balance: money, pending_accountability_count: count, receipt_exception_count: count,
})
const stockSummary = z.object({
  pending_request_count: count, approved_request_count: count, fulfilled_request_count: count,
  issued_consumable_quantity: count, active_equipment_custody_count: count, overdue_return_count: count,
})

export async function readProjectCashSummary(scope: IdentityScopeRef, projectId: string) {
  const data = await rpc(scope, 'rpc_get_project_cash_summary', { p_project_id: projectId })
  return cashSummary.array().parse(data)[0] ?? null
}

export async function readProjectInventorySummary(scope: IdentityScopeRef, projectId: string) {
  const data = await rpc(scope, 'rpc_get_project_inventory_summary', { p_project_id: projectId })
  return stockSummary.array().parse(data)[0] ?? null
}

const missedUpdate = z.object({
  project_id: id,
  project_name: z.string(),
  user_id: id,
  user_full_name: z.string(),
})

export async function readMissedProjectUpdates(scope: IdentityScopeRef, day: string) {
  const result = await rpc(scope, 'rpc_check_missed_daily_updates', { p_date: z.string().date().parse(day) })
  return missedUpdate.array().parse(result).sort((first, second) =>
    first.project_name.localeCompare(second.project_name) || first.user_full_name.localeCompare(second.user_full_name))
}
