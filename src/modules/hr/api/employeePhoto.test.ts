import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resetProtectedSessionRegistryForTest, syncProtectedAuthSessionFromHook,
  type IdentityScopeRef,
} from '@/lib/idempotency/pendingOperations'
import { loadEmployeePhoto, prepareEmployeePhoto, saveEmployeePhoto } from './employeePhoto'

const { rpc, upload, remove, signed } = vi.hoisted(() => ({
  rpc: vi.fn(), upload: vi.fn(), remove: vi.fn(), signed: vi.fn(),
}))
vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: () => ({
    rpc, storage: { from: () => ({ createSignedUrl: signed, upload, remove }) },
  }),
}))

const actor = 'b5040000-0000-4000-8000-000000000001'
const employee = 'b5040000-0000-4000-8000-000000000002'
const oldPath = `${actor}/employee-portraits/${employee}/b5040000-0000-4000-8000-000000000003.jpg`
const path = `${actor}/employee-portraits/${employee}/b5040000-0000-4000-8000-000000000004.jpg`
const scope: IdentityScopeRef = {
  identityKey: actor, authEpoch: 1, isAuthReady: true,
  latestRef: { current: { identityKey: actor, authEpoch: 1, isAuthReady: true } },
}
const change = {
  version: 1, oldPath, path, image: new Blob(['jpeg'], { type: 'image/jpeg' }),
}

describe('employee dossier portrait', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('VITE_SUPABASE_URL', 'https://photos.example.com')
    resetProtectedSessionRegistryForTest()
    syncProtectedAuthSessionFromHook({ identityKey: actor, authEpoch: 1, isReady: true })
    scope.latestRef.current = { identityKey: actor, authEpoch: 1, isAuthReady: true }
    rpc.mockResolvedValue({ data: { version: 1, storage_path: path }, error: null })
    upload.mockResolvedValue({ error: null })
    remove.mockResolvedValue({ error: null })
    signed.mockResolvedValue({
      data: { signedUrl: 'https://photos.example.com/storage/v1/object/sign/employee-profile-photos/portrait?token=prepared' }, error: null,
    })
  })

  it('rejects an SVG before attempting image decode or upload', async () => {
    await expect(prepareEmployeePhoto(new File(['<svg />'], 'portrait.svg', { type: 'image/svg+xml' })))
      .rejects.toThrow('JPEG, PNG or WebP')
    expect(upload).not.toHaveBeenCalled()
  })

  it('does not display a signed URL from another host', async () => {
    signed.mockResolvedValue({ data: { signedUrl: 'https://unexpected.example.com/portrait' }, error: null })
    await expect(loadEmployeePhoto(scope, employee)).resolves.toEqual({ version: 1, path, url: null })
    expect(signed).toHaveBeenCalledWith(path, 60)
  })

  it('drops a photo response when the active identity changes', async () => {
    signed.mockImplementation(() => {
      syncProtectedAuthSessionFromHook({ identityKey: employee, authEpoch: 2, isReady: true })
      scope.latestRef.current = { identityKey: employee, authEpoch: 2, isAuthReady: true }
      return Promise.resolve({ data: { signedUrl: 'https://photos.example.com/portrait' }, error: null })
    })
    await expect(loadEmployeePhoto(scope, employee)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('keeps the previous file until a save succeeds on the original upload path', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'FETCH_ERROR' } })
    await expect(saveEmployeePhoto(scope, employee, change)).rejects.toMatchObject({ retryable: true })
    expect(remove).not.toHaveBeenCalled()
    upload.mockResolvedValueOnce({ error: { status: 409, statusCode: 'ResourceAlreadyExists' } })
    rpc.mockResolvedValueOnce({ data: 2, error: null })
    await expect(saveEmployeePhoto(scope, employee, change)).resolves.toEqual({ cleanupFailed: false })
    expect(upload.mock.calls.map(([name]) => String(name))).toEqual([path, path])
    expect(rpc).toHaveBeenLastCalledWith('rpc_save_employee_profile_photo', {
      p_employee_id: employee, p_storage_path: path, p_expected_version: 1,
    })
    expect(remove).toHaveBeenCalledExactlyOnceWith([oldPath])
  })

  it('cleans a rejected upload without deleting the previous photo', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '40001' } })
    await expect(saveEmployeePhoto(scope, employee, change)).rejects.toMatchObject({
      retryable: false, message: 'The photo was changed by someone else. Review the current photo before trying again.',
    })
    expect(remove).toHaveBeenCalledExactlyOnceWith([path])
  })
})
