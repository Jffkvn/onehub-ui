import { z } from 'zod'
import {
  assertProtectedSessionCurrent,
  captureProtectedSessionSnapshot,
  classifyRpcError,
  type IdentityScopeRef,
} from '@/lib/idempotency/pendingOperations'
import { validatePrivateFileForUpload } from '@/lib/security/filePolicy'
import { createPrivateDownloadUrl, createPrivateObjectPath } from '@/lib/security/privateFiles'
import { getSupabaseClient } from '@/lib/supabase/client'

const PHOTO_BUCKET = 'employee-profile-photos'
const PHOTO_CATEGORY = 'employee-portraits'
const JPEG_LIMIT = 2 * 1024 * 1024
const validVersion = z.number().int().nonnegative()
const metadataSchema = z.object({ version: validVersion, storage_path: z.string().nullable() })

interface PhotoData {
  version: number
  path: string | null
  url: string | null
}

export interface EmployeePhotoChange {
  version: number
  oldPath: string | null
  path: string | null
  image: Blob | null
}

export class EmployeePhotoSaveError extends Error {
  constructor(message: string, public readonly retryable: boolean) {
    super(message)
    this.name = 'EmployeePhotoSaveError'
  }
}

function guardPhotoSession(scope: IdentityScopeRef) {
  const snapshot = captureProtectedSessionSnapshot({
    identityKey: scope.identityKey, authEpoch: scope.authEpoch, isReady: scope.isAuthReady,
  })
  const check = () => assertProtectedSessionCurrent(snapshot, scope.latestRef.current)
  check()
  return check
}

export async function loadEmployeePhoto(scope: IdentityScopeRef, employeeId: string): Promise<PhotoData> {
  const check = guardPhotoSession(scope)
  const client = getSupabaseClient()
  const result = await client.rpc('rpc_get_employee_profile_photo', { p_employee_id: employeeId })
  check()
  if (result.error) throw new Error('The current photo could not be loaded.')
  const { storage_path: path, version } = metadataSchema.parse(result.data)
  if (!path) return { version, path, url: null }

  const [, category, record] = path.split('/')
  if (record !== employeeId || category !== PHOTO_CATEGORY || !path.endsWith('.jpg')) {
    throw new Error('The current photo is unavailable.')
  }
  const storage = client.storage.from(PHOTO_BUCKET)
  const url = await createPrivateDownloadUrl(path, {
    allowedOrigin: import.meta.env.VITE_SUPABASE_URL,
    createSignedUrl: (name, expiry) => storage.createSignedUrl(name, expiry),
  }).catch(() => null)
  check()
  return { version, path, url }
}

export async function prepareEmployeePhoto(file: File): Promise<Blob> {
  const allowedImages = ['image/jpeg', 'image/png', 'image/webp']
  const valid = allowedImages.includes(file.type) && (await validatePrivateFileForUpload(file)).ok
  if (!valid) throw new Error('Choose a valid JPEG, PNG or WebP image up to 10 MB.')

  let image: ImageBitmap
  try {
    image = await createImageBitmap(file)
  } catch {
    throw new Error('This image could not be opened. Choose another file.')
  }

  try {
    if (image.width * image.height > 40_000_000) {
      throw new Error('Choose an image smaller than 40 megapixels.')
    }
    const size = 768
    const side = Math.min(image.width, image.height)
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('This browser could not prepare the image.')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, size, size)
    ctx.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, size, size)
    const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
    if (!jpeg || jpeg.type !== 'image/jpeg' || !jpeg.size || jpeg.size > JPEG_LIMIT) {
      throw new Error('The image could not be prepared. Choose another file.')
    }
    return jpeg
  } finally {
    image.close()
  }
}

export function createEmployeePhotoChange(
  scope: IdentityScopeRef,
  employeeId: string,
  current: PhotoData,
  image: Blob | null,
): EmployeePhotoChange {
  const check = guardPhotoSession(scope)
  check()
  const path = image ? createPrivateObjectPath({
    ownerId: scope.identityKey ?? '',
    category: PHOTO_CATEGORY,
    recordId: employeeId,
    extension: 'jpg',
  }) : null
  return { version: current.version, oldPath: current.path, path, image }
}

export async function saveEmployeePhoto(scope: IdentityScopeRef, employeeId: string, change: EmployeePhotoChange) {
  const check = guardPhotoSession(scope)
  const client = getSupabaseClient()
  const storage = client.storage.from(PHOTO_BUCKET)
  const remove = async (path: string) => {
    check()
    const failed = await storage.remove([path]).then(({ error }) => Boolean(error), () => true)
    check()
    return failed
  }

  if (change.path && change.image) {
    const stored = await storage.upload(change.path, change.image, {
      contentType: 'image/jpeg', cacheControl: '0', upsert: false,
    }).catch(() => ({ error: new Error('Upload interrupted') }))
    check()
    if (stored.error) {
      const serviceCode = 'statusCode' in stored.error ? String(stored.error.statusCode) : ''
      const httpStatus = 'status' in stored.error ? String(stored.error.status) : ''
      const duplicate = httpStatus === '409' || ['409', 'Duplicate', 'ResourceAlreadyExists'].includes(serviceCode)
      if (!duplicate) {
        const failedStatuses = ['400', '401', '403', '413', '422']
        if (failedStatuses.includes(httpStatus) || failedStatuses.includes(serviceCode)) {
          throw new EmployeePhotoSaveError('The image upload was refused. Check access or choose another image.', false)
        }
        throw new EmployeePhotoSaveError('The upload could not be confirmed. Retry the same photo.', true)
      }
    }
  }

  const result = await client.rpc('rpc_save_employee_profile_photo', {
    p_employee_id: employeeId, p_storage_path: change.path, p_expected_version: change.version,
  }).then((response) => response, () => ({ data: null, error: new Error('Save interrupted') }))
  check()
  if (result.error) {
    const code = 'code' in result.error ? result.error.code : null
    const conflict = code === '40001'
    if (conflict || code === '55000' || classifyRpcError(result.error) === 'definite') {
      if (change.path) await remove(change.path)
      throw new EmployeePhotoSaveError(
        conflict ? 'The photo was changed by someone else. Review the current photo before trying again.'
          : 'The photo was not accepted. Reload the employee record before trying again.',
        false,
      )
    }
    throw new EmployeePhotoSaveError('The save could not be confirmed. Retry the same change.', true)
  }

  const saved = validVersion.safeParse(result.data)
  if (!saved.success || saved.data !== change.version + 1) {
    throw new EmployeePhotoSaveError('The save could not be confirmed. Retry the same change.', true)
  }

  // Keep the old file until the pointer update is confirmed. The database also
  // protects whichever photo is currently selected against deletion.
  const cleanupFailed = change.oldPath && change.oldPath !== change.path ? await remove(change.oldPath) : false
  return { cleanupFailed }
}
