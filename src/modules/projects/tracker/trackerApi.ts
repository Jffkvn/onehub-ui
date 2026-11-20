import { z } from 'zod'

import {
  assertProtectedSessionCurrent, captureProtectedSessionSnapshot, isProtectedSessionCurrent,
  type IdentityScopeRef,
} from '@/lib/idempotency/pendingOperations'
import { validatePrivateFileForUpload } from '@/lib/security/filePolicy'
import { createPrivateDownloadUrl, createPrivateObjectPath } from '@/lib/security/privateFiles'
import { getSupabaseClient } from '@/lib/supabase/client'

const uuid = z.string().uuid()
const status = z.enum(['draft', 'submitted', 'revision_requested', 'endorsed'])
const displayName = z.object({ display_name: z.string() })
const eventFields = {
  id: uuid,
  photo_urls: z.array(z.string()).nullish().transform((paths) => paths ?? []),
  status,
  summary: z.string(),
  pm_feedback: z.string().nullable(),
}
const updateSchema = z.object({
  ...eventFields,
  project_id: uuid,
  submitted_by: uuid,
  update_date: z.string().date(),
  profiles_submitted_by: displayName.extend({ role_name: z.string().optional() }).nullish(),
  profiles_endorsed_by: displayName.nullish(),
})
const revisionSchema = z.object({
  ...eventFields,
  created_at: z.string(),
  profiles_created_by: displayName.nullish(),
})
export const maxTrackerPhotos = 10
export type TrackerUpdate = z.infer<typeof updateSchema>
export type TrackerStatus = z.infer<typeof status>
export type ReviewDecision = 'endorse' | 'request_revision'

interface SaveTrackerUpdate {
  id: string | null
  date: string
  summary: string
  savedPhotos: string[]
  newPhotos: File[]
  submit: boolean
}

export class UnconfirmedTrackerWrite extends Error {
  constructor() {
    super('The server could not confirm this update. Close the form and refresh the tracker to check the saved state before trying again.')
    this.name = 'UnconfirmedTrackerWrite'
  }
}

function pinSession(scope: IdentityScopeRef) {
  const snapshot = captureProtectedSessionSnapshot({ identityKey: scope.identityKey, authEpoch: scope.authEpoch, isReady: scope.isAuthReady })
  const check = () => assertProtectedSessionCurrent(snapshot, scope.latestRef.current)
  check()
  return { snapshot, check }
}

export async function listTrackerUpdates(scope: IdentityScopeRef, projectId: string) {
  const { check } = pinSession(scope)
  const result: { data: unknown; error: { message: string } | null } = await getSupabaseClient()
    .rpc('rpc_list_daily_updates', { p_project_id: uuid.parse(projectId) })
  check()
  if (result.error) throw new Error('Daily updates could not be loaded.')
  return updateSchema.array().parse(result.data).filter((update) => update.project_id === projectId)
}

export async function listTrackerRoles(scope: IdentityScopeRef, projectId: string) {
  const { check, snapshot } = pinSession(scope)
  const { data, error } = await getSupabaseClient().from('project_assignments')
    .select('role_on_project').eq('project_id', uuid.parse(projectId)).eq('user_id', snapshot.identityKey).is('unassigned_at', null)
  check()
  if (error) throw new Error('Your project assignment could not be verified.')
  return z.array(z.object({ role_on_project: z.enum(['pm', 'coordinator']) })).parse(data).map(({ role_on_project }) => role_on_project)
}

export async function listTrackerRevisions(scope: IdentityScopeRef, updateId: string) {
  const { check } = pinSession(scope)
  const { data, error } = await getSupabaseClient().from('daily_update_revisions')
    .select('id,status,summary,pm_feedback,photo_urls,created_at,profiles_created_by:profiles!created_by(display_name)')
    .eq('daily_update_id', uuid.parse(updateId)).order('created_at', { ascending: false }).order('id', { ascending: false })
  check()
  if (error) throw new Error('Update history could not be loaded.')
  return revisionSchema.array().parse(data)
}

const photoPath = /^[a-f0-9-]+[.](jpe?g|png|webp|heic|heif|avif)$/i

export function isProjectEvidencePath(path: string, projectId: string, ownerId: string) {
  const parts = path.split('/')
  return parts.length === 4 && parts[0] === ownerId && parts[1] === 'daily-evidence' &&
    parts[2] === projectId && photoPath.test(parts[3])
}

export async function getTrackerEvidenceUrl(scope: IdentityScopeRef, path: string, projectId: string, ownerId: string) {
  const { check } = pinSession(scope)
  if (!isProjectEvidencePath(path, projectId, ownerId)) throw new Error('This saved photo is unavailable.')
  const storage = getSupabaseClient().storage.from('private-files')
  const url = await createPrivateDownloadUrl(path, {
    allowedOrigin: new URL(import.meta.env.VITE_SUPABASE_URL).origin,
    createSignedUrl: (objectPath, expiry) => storage.createSignedUrl(objectPath, expiry),
  })
  check()
  return url
}

async function mutateTracker(check: () => void, name: string, args: Record<string, unknown>) {
  check()
  let response
  try {
    response = await getSupabaseClient().rpc(name, args)
  } catch {
    check()
    throw new UnconfirmedTrackerWrite()
  }

  check()
  if (response.error) {
    const { code } = response.error
    if (code === '42501' || code === 'P0002') throw new Error('This update or action is no longer available to you.')
    if (code === 'L0201') throw new Error('This update has changed. Refresh the tracker to see its current status.')
    if (response.status === 0 || response.status >= 500) throw new UnconfirmedTrackerWrite()
    if (code === '23514' || code === '23502' || code === '22023') throw new Error('The server rejected the update. Check the date, summary, evidence and feedback.')
    throw new Error('The daily tracker could not save this action.')
  }

  return response.data as unknown
}

export async function saveTrackerUpdate(scope: IdentityScopeRef, projectId: string, command: SaveTrackerUpdate) {
  const { check, snapshot } = pinSession(scope)
  const actor = uuid.parse(snapshot.identityKey)
  const id = uuid.nullable().parse(command.id)
  const date = z.string().date().safeParse(command.date)
  const summary = command.summary.trim()
  if (!date.success || !summary) throw new Error('Enter a valid update date and work summary.')
  if (command.savedPhotos.length + command.newPhotos.length > maxTrackerPhotos) {
    throw new Error('You can attach up to 10 photos to one daily update.')
  }
  uuid.parse(projectId)

  const photoEntries = await Promise.all(command.newPhotos.map(async (file) => {
    const valid = await validatePrivateFileForUpload(file)
    if (!valid.ok || valid.extension === 'pdf') {
      throw new Error('Choose a valid JPG, PNG, WebP, HEIC, HEIF or AVIF photo no larger than 10 MB.')
    }
    return { file, extension: valid.extension }
  }))
  check()

  const storage = getSupabaseClient().storage.from('private-files')
  const uploaded: string[] = []
  try {
    for (const { file, extension } of photoEntries) {
      check()
      const path = createPrivateObjectPath({ ownerId: actor, category: 'daily-evidence', recordId: projectId, extension })
      uploaded.push(path)
      const { error } = await storage.upload(path, file, { upsert: false, contentType: file.type })
      check()
      if (error) throw new Error('A photo could not be uploaded. Check your connection and try again.')
    }

    const result = await mutateTracker(check, 'rpc_save_daily_update', {
      p_update_id: id, p_project_id: projectId, p_update_date: date.data, p_summary: summary,
      p_photo_urls: [...command.savedPhotos, ...uploaded], p_submit: command.submit,
    })
    if (!uuid.safeParse(result).success) throw new UnconfirmedTrackerWrite()
  } catch (error) {
    // A lost RPC response can mean the saved update already references these photos.
    if (!(error instanceof UnconfirmedTrackerWrite) && uploaded.length > 0 && isProtectedSessionCurrent(snapshot, scope.latestRef.current)) {
      try { await storage.remove(uploaded) } catch { /* Preserve the original failure. */ }
    }
    throw error
  }
}

export async function reviewTrackerUpdate(
  scope: IdentityScopeRef, projectId: string, updateId: string, decision: ReviewDecision, feedback: string,
) {
  const { check, snapshot } = pinSession(scope)
  const message = feedback.trim()
  if (decision === 'request_revision' && !message) throw new Error('Feedback is required when requesting revision.')
  const result = await listTrackerUpdates(scope, projectId)
  check()

  const current = result.find(({ id }) => id === updateId)
  if (!current || current.status !== 'submitted' || current.submitted_by === snapshot.identityKey) {
    throw new Error('This update is no longer available for review. Refresh the tracker to see its current status.')
  }

  await mutateTracker(check, 'rpc_review_daily_update', {
    p_update_id: uuid.parse(updateId), p_decision: decision, p_feedback: message || null,
  })
}
