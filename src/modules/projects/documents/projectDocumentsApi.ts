import { z } from 'zod'

import {
  assertProtectedSessionCurrent,
  captureProtectedSessionSnapshot,
  type IdentityScopeRef,
} from '@/lib/idempotency/pendingOperations'
import { validatePrivateFileForUpload } from '@/lib/security/filePolicy'
import { createPrivateDownloadUrl, createPrivateObjectPath } from '@/lib/security/privateFiles'
import { getSupabaseClient } from '@/lib/supabase/client'

const uuid = z.string().uuid()
const documentRowSchema = z.object({
  id: uuid,
  project_id: uuid,
  display_name: z.string(),
  storage_path: z.string(),
  created_at: z.string().datetime({ offset: true }),
})
const documentMime = z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
export const projectDocumentAccept = documentMime.options.join(',')
export type ProjectDocument = z.infer<typeof documentRowSchema>

export interface ProjectDocumentDraft {
  ownerId: string
  projectId: string
  documentId: string
  displayName: string
  storagePath: string
  mimeType: z.infer<typeof documentMime>
  sizeBytes: number
}

function pinSession(scope: IdentityScopeRef, ownerId?: string) {
  const snapshot = captureProtectedSessionSnapshot({
    identityKey: scope.identityKey,
    authEpoch: scope.authEpoch,
    isReady: scope.isAuthReady,
  })
  const check = () => assertProtectedSessionCurrent(snapshot, scope.latestRef.current)
  check()
  if (ownerId && snapshot.identityKey !== ownerId) {
    throw new DOMException('The active account changed.', 'AbortError')
  }
  return { check, identityKey: snapshot.identityKey }
}

export async function listProjectDocuments(scope: IdentityScopeRef, projectId: string) {
  const { check } = pinSession(scope)
  const { data, error } = await getSupabaseClient().from('project_documents')
    .select('id,project_id,display_name,storage_path,created_at')
    .eq('project_id', uuid.parse(projectId)).is('archived_at', null)
    .order('created_at', { ascending: false })
  check()
  if (error) throw new Error('Project documents could not be loaded.')
  return documentRowSchema.array().parse(data ?? []).filter((item) => item.project_id === projectId.toLowerCase())
}

export async function prepareProjectDocument(scope: IdentityScopeRef, projectId: string, file: File): Promise<ProjectDocumentDraft> {
  const { check, identityKey } = pinSession(scope)
  if (!identityKey) throw new Error('Sign in to upload a project document.')
  const mime = documentMime.safeParse(file.type.toLowerCase())
  const validation = mime.success ? await validatePrivateFileForUpload(file) : null
  check()
  if (!mime.success || !validation?.ok) throw new Error('Choose a valid PDF, JPG, PNG or WebP file up to 10 MB.')

  const displayName = file.name.trim()
  if (displayName.length < 1 || displayName.length > 200) {
    throw new Error('Use a file name of 1 to 200 characters.')
  }
  const documentId = crypto.randomUUID()
  const storagePath = createPrivateObjectPath({
    ownerId: identityKey,
    category: 'projects',
    recordId: projectId,
    objectId: documentId,
    extension: validation.extension,
  })
  return { ownerId: identityKey, projectId, documentId, displayName, storagePath, mimeType: mime.data, sizeBytes: file.size }
}

export async function storeProjectDocument(scope: IdentityScopeRef, draft: ProjectDocumentDraft, file: File) {
  const { check } = pinSession(scope, draft.ownerId)
  const storage = getSupabaseClient().storage.from('private-files')
  const uploaded = await storage.upload(draft.storagePath, file, {
    upsert: false, contentType: draft.mimeType,
  }).then((result) => !result.error, () => false)
  check()
  if (uploaded) return

  // A duplicate-path response can mean this upload's first response was lost.
  const found = await storage.exists(draft.storagePath).catch(() => null)
  check()
  if (!found?.data || found.error) {
    throw new Error('The private file upload could not be confirmed. Retry saving the same document.')
  }
}

export async function registerProjectDocument(scope: IdentityScopeRef, draft: ProjectDocumentDraft) {
  const { check } = pinSession(scope, draft.ownerId)
  const client = getSupabaseClient()
  const registered = await client.rpc('rpc_register_project_document', {
    p_project_id: draft.projectId,
    p_document_id: draft.documentId,
    p_display_name: draft.displayName,
    p_storage_path: draft.storagePath,
    p_mime_type: draft.mimeType,
    p_size_bytes: draft.sizeBytes,
  }).then((result) => !result.error && result.data === draft.documentId, () => false)
  check()
  if (registered) return

  // A failed response can occur after the row commits. Resolve against this exact document.
  const found = await client.from('project_documents').select('id,storage_path')
    .eq('id', draft.documentId).eq('project_id', draft.projectId).is('archived_at', null).maybeSingle()
    .then((result) => result.error ? null : result.data, () => null)
  check()
  if (found?.id !== draft.documentId || found.storage_path !== draft.storagePath) {
    throw new Error('The document record could not be confirmed. Retry saving the same document.')
  }
}

export async function projectDocumentDownloadUrl(scope: IdentityScopeRef, projectId: string, item: ProjectDocument) {
  const { check } = pinSession(scope)
  const [, category, recordId, filename] = item.storage_path.split('/')
  if (category !== 'projects' || recordId !== projectId || item.project_id !== projectId
    || !filename?.startsWith(`${item.id}.`) || !/\.(pdf|jpe?g|png|webp)$/i.test(filename)) {
    throw new Error('The private document could not be opened.')
  }
  const storage = getSupabaseClient().storage.from('private-files')
  const url = await createPrivateDownloadUrl(item.storage_path, {
    allowedOrigin: new URL(import.meta.env.VITE_SUPABASE_URL).origin,
    createSignedUrl: (path, expiry) => storage.createSignedUrl(path, expiry),
  })
  check()
  return url
}
