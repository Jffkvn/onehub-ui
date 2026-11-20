import { z } from 'zod'

import {
  assertProtectedSessionCurrent,
  captureProtectedSessionSnapshot,
  type IdentityScopeRef,
} from '@/lib/idempotency/pendingOperations'
import { getSupabaseClient } from '@/lib/supabase/client'

const uuid = z.string().uuid()
const projectRole = z.enum(['pm', 'coordinator'])
const assignmentSchema = z.object({
  id: uuid,
  project_id: uuid,
  user_id: uuid,
  role_on_project: projectRole,
  display_name: z.string().trim().min(1),
  assigned_at: z.string(),
  assignment_reason: z.string(),
  unassigned_at: z.string().nullable(),
  unassignment_reason: z.string().nullable(),
})
const candidateSchema = z.object({
  profile_id: uuid,
  display_name: z.string().trim().min(1),
  role_keys: z.array(z.enum(['project_manager', 'coordinator'])),
})
const reasonSchema = z.string().trim().min(3).max(500)

export type ProjectTeamAssignment = z.infer<typeof assignmentSchema>
export type ProjectTeamCandidate = z.infer<typeof candidateSchema>
export type ProjectTeamRole = z.infer<typeof projectRole>

export class UnknownAssignmentOutcome extends Error {
  constructor() {
    super('The change could not be confirmed. Check the current team before submitting again.')
    this.name = 'UnknownAssignmentOutcome'
  }
}

async function callTeamRpc(
  scope: IdentityScopeRef,
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
  write = false,
): Promise<unknown> {
  const snapshot = captureProtectedSessionSnapshot({
    identityKey: scope.identityKey,
    authEpoch: scope.authEpoch,
    isReady: scope.isAuthReady,
  })
  const assertCurrent = () => assertProtectedSessionCurrent(snapshot, scope.latestRef.current)
  assertCurrent()
  signal?.throwIfAborted()

  let response
  try {
    const request = getSupabaseClient().rpc(name, args)
    response = await (signal ? request.abortSignal(signal) : request)
  } catch (error) {
    assertCurrent()
    signal?.throwIfAborted()
    if (write) throw new UnknownAssignmentOutcome()
    throw error
  }
  assertCurrent()
  signal?.throwIfAborted()
  if (!response.error) return response.data

  if (response.error.code === '42501') throw new Error('You do not have permission for this team action.')
  if (write && (response.status === 0 || response.status >= 500)) throw new UnknownAssignmentOutcome()
  if (response.error.code === 'P0002') throw new Error('This project or assignment is no longer available.')
  if (response.error.code === '23514') throw new Error('Enter a reason of 3 to 500 characters.')
  if (response.error.code === '22023') throw new Error('Choose a team member who still holds the required role.')
  throw new Error(write ? 'The project team change could not be saved.' : 'The project team could not be loaded.')
}

export async function listProjectTeamAssignments(
  scope: IdentityScopeRef,
  projectId: string,
  includeHistory: boolean,
  signal?: AbortSignal,
) {
  const data = await callTeamRpc(scope, 'rpc_list_project_assignments', {
    p_project_id: uuid.parse(projectId),
    p_include_history: includeHistory,
  }, signal)
  return assignmentSchema.array().parse(data)
}

export async function listProjectTeamCandidates(scope: IdentityScopeRef, signal?: AbortSignal) {
  const data = await callTeamRpc(scope, 'rpc_list_project_assignment_candidates', {}, signal)
  return candidateSchema.array().parse(data)
}

export async function assignProjectTeamMember(
  scope: IdentityScopeRef,
  projectId: string,
  userId: string,
  role: ProjectTeamRole,
  reason: string,
) {
  await callTeamRpc(scope, 'rpc_assign_project_member', {
    p_project_id: uuid.parse(projectId),
    p_user_id: uuid.parse(userId),
    p_project_role: projectRole.parse(role),
    p_reason: reasonSchema.parse(reason),
  }, undefined, true)
}

export async function removeProjectTeamMember(scope: IdentityScopeRef, assignmentId: string, reason: string) {
  await callTeamRpc(scope, 'rpc_unassign_project_member', {
    p_assignment_id: uuid.parse(assignmentId),
    p_reason: reasonSchema.parse(reason),
  }, undefined, true)
}
