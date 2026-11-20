import { z } from 'zod'

import { trainingStatusSchema } from '@/_contract/schemas/hr.training'

import {
  assertProtectedSessionCurrent,
  captureProtectedSessionSnapshot,
  type IdentityScopeRef,
} from '@/lib/idempotency/pendingOperations'
import { validatePrivateFileForUpload } from '@/lib/security/filePolicy'
import { createPrivateDownloadUrl, createPrivateObjectPath } from '@/lib/security/privateFiles'
import { getSupabaseClient } from '@/lib/supabase/client'

const uuid = z.string().uuid()
const number = z.coerce.number().finite()
const status = trainingStatusSchema
const recordSchema = z.object({
  id: uuid,
  employee_id: uuid,
  employee_number: z.string(),
  employee_name: z.string(),
  topic: z.string(),
  provider: z.string().nullable(),
  completion_date: z.string().date(),
  duration_hours: number.nullable(),
  cost_ugx: number.nullable(),
  status,
  expiry_date: z.string().date().nullable(),
  certificate_reference: z.string().nullable(),
  certificate_count: number.int().nonnegative(),
})
const employeeSchema = z.object({
  id: uuid,
  legal_name: z.string(),
  employee_number: z.string(),
})
const certificateSchema = z.object({
  id: uuid,
  storage_path: z.string(),
  original_file_name: z.string(),
  size_bytes: number.int().positive(),
})
const fieldsSchema = z.object({
  topic: z.string().trim().min(2).max(200),
  provider: z.string().trim().max(200),
  completion_date: z.string().date(),
  duration_hours: z.number().min(0).max(10000).nullable(),
  cost_ugx: z.number().min(0).max(1_000_000_000).nullable(),
  status,
  expiry_date: z.string().date().nullable(),
  certificate_reference: z.string().trim().max(160),
}).refine(({ expiry_date, completion_date }) => !expiry_date || expiry_date >= completion_date)

export type TrainingRecord = z.infer<typeof recordSchema>
export type TrainingCertificate = z.infer<typeof certificateSchema>
export type TrainingFields = z.input<typeof fieldsSchema>

export class TrainingInputError extends Error {}

export interface UploadedCertificate {
  p_training_record_id: string
  p_storage_path: string
  p_original_file_name: string
  p_mime_type: string
  p_size_bytes: number
}

export function trainingKey(scope: IdentityScopeRef, manage: boolean) {
  return ['training', scope.identityKey, scope.authEpoch, manage] as const
}

export function pinTrainingSession(scope: IdentityScopeRef) {
  const snapshot = captureProtectedSessionSnapshot({
    identityKey: scope.identityKey,
    authEpoch: scope.authEpoch,
    isReady: scope.isAuthReady,
  })
  const check = () => assertProtectedSessionCurrent(snapshot, scope.latestRef.current)
  check()
  return { check, identityKey: snapshot.identityKey }
}

async function rpc(check: () => void, name: string, args?: Record<string, unknown>) {
  check()
  const result = await getSupabaseClient().rpc(name, args)
  check()
  if (result.error) throw new Error(result.error.message)
  const data: unknown = result.data
  return data
}

export async function listTrainingRecords(scope: IdentityScopeRef, manage: boolean) {
  const { check } = pinTrainingSession(scope)
  return recordSchema.array().parse(await rpc(
    check,
    manage ? 'rpc_list_training_records' : 'rpc_list_my_training_records',
  ))
}

export async function listTrainingEmployees(scope: IdentityScopeRef) {
  const { check } = pinTrainingSession(scope)
  const result = await getSupabaseClient().from('employees')
    .select('id,legal_name,employee_number').is('archived_at', null).order('legal_name')
  check()
  if (result.error) throw new Error(result.error.message)
  return employeeSchema.array().parse(result.data)
}

export async function saveTrainingRecord(
  scope: IdentityScopeRef,
  fields: TrainingFields,
  target: { employeeIds: string[] } | { recordId: string },
) {
  const { check } = pinTrainingSession(scope)
  const parsed = fieldsSchema.safeParse(fields)
  if (!parsed.success) throw new TrainingInputError('Check the training details. Expiry must be on or after the training date.')
  const value = parsed.data
  const args = {
    p_topic: value.topic,
    p_provider: value.provider || null,
    p_completion_date: value.completion_date,
    p_duration_hours: value.duration_hours,
    p_cost_ugx: value.cost_ugx,
    p_status: value.status,
    p_expiry_date: value.expiry_date,
    p_certificate_reference: value.certificate_reference || null,
  }
  if ('recordId' in target) {
    await rpc(check, 'rpc_update_training_record', { ...args, p_record_id: uuid.parse(target.recordId) })
    return [target.recordId]
  }
  const ids = uuid.array().min(1).parse([...new Set(target.employeeIds)])
  const saved = uuid.array().parse(await rpc(check, 'rpc_log_training_records', { ...args, p_employee_ids: ids }))
  if (saved.length !== ids.length) throw new Error('The saved training records could not be confirmed.')
  return saved
}

export async function refreshTrainingExpiryAlerts(scope: IdentityScopeRef) {
  const { check } = pinTrainingSession(scope)
  return number.int().nonnegative().parse(await rpc(check, 'rpc_refresh_training_expiry_alerts'))
}

function isCertificateForRecord(path: string, recordId: string) {
  const [, category, target] = path.split('/')
  return category === 'training-certificates' && target === recordId
}

export async function listTrainingCertificates(scope: IdentityScopeRef, recordId: string) {
  const { check } = pinTrainingSession(scope)
  return certificateSchema.array().parse(await rpc(
    check, 'rpc_list_training_documents', { p_training_record_id: uuid.parse(recordId) },
  )).filter((document) => isCertificateForRecord(document.storage_path, recordId))
}

export async function openTrainingCertificate(scope: IdentityScopeRef, recordId: string, document: TrainingCertificate) {
  const { check } = pinTrainingSession(scope)
  if (!isCertificateForRecord(document.storage_path, recordId)) {
    throw new Error('This certificate is unavailable.')
  }
  const storage = getSupabaseClient().storage.from('private-files')
  const url = await createPrivateDownloadUrl(document.storage_path, {
    allowedOrigin: new URL(import.meta.env.VITE_SUPABASE_URL).origin,
    createSignedUrl: (path, expiry) => storage.createSignedUrl(path, expiry),
  })
  check()
  window.open(url, '_blank', 'noopener,noreferrer')
}

export async function uploadTrainingCertificate(scope: IdentityScopeRef, recordId: string, file: File) {
  const { check, identityKey } = pinTrainingSession(scope)
  if (!identityKey) throw new Error('Sign in to upload a certificate.')
  const valid = await validatePrivateFileForUpload(file)
  check()
  if (!valid.ok) throw new Error('Choose a valid PDF or image no larger than 10 MB.')
  const path = createPrivateObjectPath({
    ownerId: identityKey, category: 'training-certificates', recordId, extension: valid.extension,
  })
  const stored = await getSupabaseClient().storage.from('private-files').upload(path, file, {
    contentType: file.type, upsert: false,
  })
  check()
  if (stored.error) throw new Error('The certificate upload could not be confirmed.')
  return {
    p_training_record_id: recordId,
    p_storage_path: path,
    p_original_file_name: file.name,
    p_mime_type: file.type.toLowerCase(),
    p_size_bytes: file.size,
  }
}

export async function attachUploadedCertificate(scope: IdentityScopeRef, attachment: UploadedCertificate) {
  const { check } = pinTrainingSession(scope)
  try {
    uuid.parse(await rpc(check, 'rpc_attach_training_document', { ...attachment }))
  } catch {
    check()
    // The server may have saved the metadata even if the client lost the response.
    // Preserve the uploaded object and reconcile by its original private path.
    const attached = await listTrainingCertificates(scope, attachment.p_training_record_id)
      .catch(() => [])
    check()
    if (!attached.some((row) => row.storage_path === attachment.p_storage_path)) {
      throw new Error('The attachment could not be confirmed. Retry attaching the same uploaded file.')
    }
  }
}

export async function removeTrainingCertificate(scope: IdentityScopeRef, documentId: string) {
  const { check } = pinTrainingSession(scope)
  await rpc(check, 'rpc_remove_training_document', { p_document_id: uuid.parse(documentId) })
}
