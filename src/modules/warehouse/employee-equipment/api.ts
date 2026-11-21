import { z } from 'zod'

import { assertProtectedSessionCurrent, captureProtectedSessionSnapshot, type IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import { validatePrivateFileForUpload } from '@/lib/security/filePolicy'
import { createPrivateDownloadUrl, createPrivateObjectPath, openPrivateDownloadInNewTab } from '@/lib/security/privateFiles'
import { getSupabaseClient } from '@/lib/supabase/client'

export const employeeEquipmentPageSize = 25
const uuid = z.string().uuid()
const attachment = z.object({
  storage_path: z.string(),
  original_file_name: z.string(),
})
const equipmentRequest = z.object({
  id: uuid,
  category: z.string(),
  description: z.string(),
  business_reason: z.string(),
  urgency: z.enum(['normal', 'urgent']),
  status: z.enum(['pending', 'needs_information', 'awaiting_approval', 'approved', 'rejected', 'cancelled', 'fulfilled', 'returned', 'transferred']),
  version: z.number().int().positive(),
  review_note: z.string().nullable(),
  attachments: attachment.array(),
  employee_name: z.string().nullable(),
  own_request: z.boolean(),
  stock_request_id: uuid.nullable(),
  equipment_asset_id: uuid.nullable(),
  expected_return_date: z.string().nullable(),
})
const issuedEquipment = z.object({
  id: uuid, model_name: z.string(), serial_number: z.string(), expected_return_date: z.string().nullable(),
})
const equipmentResult = z.object({
  linked: z.boolean(), requests: equipmentRequest.array(), issued: issuedEquipment.array(), total: z.number().int().nonnegative(),
})
const toolChoice = z.object({ id: uuid, model_name: z.string(), serial_number: z.string() })
export type EmployeeEquipmentRequest = z.infer<typeof equipmentRequest>
type Attachment = z.infer<typeof attachment>
type RequestFields = Pick<EmployeeEquipmentRequest, 'category' | 'description' | 'business_reason' | 'urgency'>
type Action = 'needs_information' | 'rejected'

class UnconfirmedEquipmentChange extends Error {
  constructor() {
    super('OneHub could not confirm the change. Reopen the request list before trying again.')
    this.name = 'UnconfirmedEquipmentChange'
  }
}

function pinSession(scope: IdentityScopeRef) {
  const snapshot = captureProtectedSessionSnapshot({
    identityKey: scope.identityKey, authEpoch: scope.authEpoch, isReady: scope.isAuthReady,
  })
  const check = () => assertProtectedSessionCurrent(snapshot, scope.latestRef.current)
  check()
  return check
}

export function employeeEquipmentApi(scope: IdentityScopeRef) {
  async function call(name: string, args: Record<string, unknown>, signal?: AbortSignal) {
    const check = pinSession(scope)
    const request = getSupabaseClient().rpc(name, args)
    const { error, data, status } = (await (signal ? request.abortSignal(signal) : request)) as {
      error: { code: string; message: string } | null
      data: unknown
      status: number
    }
    check()
    if (!error) return data
    if (error.code === '42501') throw new Error('Your account cannot perform this equipment action.')
    if (error.code === '40001' || error.code === '23505') throw new Error('This request changed. Reopen its current record.')
    if (error.code === '22023') throw new Error(error.message)
    if (status === 0 || status >= 500) throw new UnconfirmedEquipmentChange()
    throw new Error('The equipment service could not finish this action.')
  }

  return {
    async list(manage: boolean, offset: number, signal: AbortSignal) {
      return equipmentResult.parse(await call('rpc_list_employee_equipment', { p_manage: manage, p_offset: offset }, signal))
    },
    async choices(search: string, signal: AbortSignal) {
      const check = pinSession(scope)
      const query = getSupabaseClient().from('equipment_assets')
        .select('id,model_name,serial_number').eq('status', 'available').not('current_warehouse_id', 'is', null)
      if (search) query.ilike('serial_number', '%' + search.replace(/[\\%_]/g, '\\$&') + '%')
      const { data, error } = await query.order('model_name').order('id').limit(40).abortSignal(signal)
      check()
      if (error) throw new Error('Available equipment could not be loaded.')
      return toolChoice.array().parse(data)
    },
    async save(id: string, version: number | null, fields: RequestFields, keep: Attachment[], files: File[]) {
      const check = pinSession(scope)
      const owner = scope.identityKey
      if (!owner || keep.length + files.length > 5) throw new Error('Attach up to five files.')
      const verified = await Promise.all(files.map(async (file) => {
        const info = await validatePrivateFileForUpload(file)
        if (!info.ok || !['pdf', 'jpg', 'jpeg', 'png', 'webp'].includes(info.extension)) {
          throw new Error('Choose a genuine PDF, JPEG, PNG or WebP file up to 10 MB.')
        }
        return { file, extension: info.extension }
      }))
      check()

      const storage = getSupabaseClient().storage.from('private-files')
      const uploaded: Attachment[] = []
      try {
        for (const { file, extension } of verified) {
          const path = createPrivateObjectPath({ ownerId: owner, category: 'employee-equipment', recordId: id, extension })
          const { error } = await storage.upload(path, file, { contentType: file.type.toLowerCase(), upsert: false })
          check()
          if (error) throw new Error('An equipment attachment could not be uploaded.')
          uploaded.push({ storage_path: path, original_file_name: file.name.slice(0, 255) })
        }

        return uuid.parse(await call('rpc_save_employee_equipment_request', {
          p_request_id: id,
          p_expected_version: version,
          p_category: fields.category,
          p_description: fields.description,
          p_business_reason: fields.business_reason,
          p_urgency: fields.urgency,
          p_attachments: [...keep, ...uploaded],
        }))
      } catch (error) {
        check()
        if (!(error instanceof UnconfirmedEquipmentChange) && uploaded.length > 0) {
          // The Storage policy also protects files already linked by a successful request.
          void storage.remove(uploaded.map(({ storage_path }) => storage_path)).then(() => null, () => null)
        }
        throw error
      }
    },
    cancel(request: EmployeeEquipmentRequest) {
      return call('rpc_cancel_employee_equipment_request', { p_request_id: request.id, p_expected_version: request.version })
    },
    review(request: EmployeeEquipmentRequest, decision: Action, note: string) {
      return call('rpc_review_employee_equipment_request', {
        p_request_id: request.id, p_expected_version: request.version, p_decision: decision, p_note: note,
      })
    },
    async prepare(request: EmployeeEquipmentRequest, equipmentId: string, returnBy: string) {
      return uuid.parse(await call('rpc_prepare_employee_equipment_request', {
        p_request_id: request.id, p_expected_version: request.version,
        p_equipment_asset_id: equipmentId, p_return_by: returnBy,
      }))
    },
    async openAttachment(requestId: string, file: Attachment) {
      const check = pinSession(scope)
      const [, category, record] = file.storage_path.split('/')
      if (category !== 'employee-equipment' || record !== requestId) throw new Error('This attachment does not match the request.')
      const storage = getSupabaseClient().storage.from('private-files')
      const opened = await openPrivateDownloadInNewTab(async () => {
        const url = await createPrivateDownloadUrl(file.storage_path, {
          allowedOrigin: new URL(import.meta.env.VITE_SUPABASE_URL).origin,
          createSignedUrl: (path, expiry) => storage.createSignedUrl(path, expiry),
        })
        check()
        return url
      })
      if (!opened) throw new Error('Allow OneHub to open a new browser tab for this attachment.')
    },
  }
}
