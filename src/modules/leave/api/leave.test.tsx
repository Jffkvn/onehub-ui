import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  downloadLeaveEvidence,
  leavePendingStore,
  runLeaveCommand,
  uploadLeaveEvidence,
} from './leave'
import {
  type IdentityScopeRef,
  resetProtectedSessionRegistryForTest,
  syncProtectedAuthSessionFromProvider,
} from '@/lib/idempotency/pendingOperations'
const rpc = vi.fn<
  (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
>()
const upload = vi.fn<(...args: unknown[]) => Promise<{ error: unknown }>>()
const signed = vi.fn<
  (...args: unknown[]) => Promise<{ data: { signedUrl: string }; error: unknown }>
>()
vi.mock(
  '@/lib/supabase/client',
  () => ({
    getSupabaseClient: () => ({
      rpc,
      storage: { from: () => ({ upload, createSignedUrl: signed }) },
    }),
  }),
)
const actor = '85000000-0000-4000-8000-000000000001'
const id = '86000000-0000-4000-8000-000000000001'
let scope: IdentityScopeRef
function pdf(bytes = '%PDF-1.7') {
  const file = new File([bytes], 'evidence.pdf', { type: 'application/pdf' })
  Object.defineProperty(file, 'arrayBuffer', {
    configurable: true,
    value: () => Promise.resolve(new TextEncoder().encode(bytes).buffer),
  })
  return file
}
beforeEach(() => {
  resetProtectedSessionRegistryForTest()
  sessionStorage.clear()
  vi.clearAllMocks()
  scope = {
    identityKey: actor,
    authEpoch: 1,
    isAuthReady: true,
    latestRef: { current: { identityKey: actor, authEpoch: 1, isAuthReady: true } },
  }
  syncProtectedAuthSessionFromProvider({ identityKey: actor, authEpoch: 1, isReady: true })
  vi.stubEnv('VITE_SUPABASE_URL', 'https://qa.supabase.co')
  upload.mockResolvedValue({ error: null })
  rpc.mockImplementation((_name, args) =>
    Promise.resolve({
      data: { request_id: args.p_request_id, replayed: false, result: { id } },
      error: null,
    })
  )
})
describe('protected leave commands and documents', () => {
  it('freezes ambiguous submission payload and id across retry, including after reload', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'network connection lost' } })
    await expect(runLeaveCommand(scope, 'submit', { reason: 'Family break' })).rejects.toThrow()
    const pending = leavePendingStore.readByIntent(actor, 'leave:command')!
    expect(pending.status).toBe('uncertain')
    await runLeaveCommand(scope, 'submit', { reason: 'Changed input' }, pending)
    expect(rpc.mock.calls[0]?.[1]).toEqual(rpc.mock.calls[1]?.[1])
    expect(leavePendingStore.readByIntent(actor, 'leave:command')).toBeNull()
  })
  it('does not accept a malformed or mismatched success envelope as a committed confirmation', async () => {
    rpc.mockResolvedValueOnce({
      data: { request_id: id, replayed: false, result: {} },
      error: null,
    })
    await expect(runLeaveCommand(scope, 'approve', { id })).rejects.toThrow('confirmation')
    expect(leavePendingStore.readByIntent(actor, 'leave:command')?.status).toBe('uncertain')
  })
  it('retains a create command when the matched confirmation omits the created record ID', async () => {
    rpc.mockImplementationOnce((_name, args) =>
      Promise.resolve({
        data: { request_id: args.p_request_id, replayed: false, result: {} },
        error: null,
      })
    )
    await expect(runLeaveCommand(scope, 'submit', { reason: 'Family break' })).rejects.toThrow(
      'confirmation',
    )
    expect(leavePendingStore.readByIntent(actor, 'leave:command')?.status).toBe('uncertain')
  })
  it('releases a definite validation failure so it can be corrected', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '23505', message: 'Overlapping leave' },
    })
    await expect(runLeaveCommand(scope, 'submit', { id })).rejects.toThrow('Overlapping')
    expect(leavePendingStore.readByIntent(actor, 'leave:command')).toBeNull()
  })
  it('rejects a disguised PDF before anything reaches storage', async () => {
    await expect(uploadLeaveEvidence(scope, id, pdf('invalid file'))).rejects.toThrow('genuine PDF')
    expect(upload).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
  it('stops an old-account file after a session change during signature inspection', async () => {
    const file = pdf()
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: () => {
        syncProtectedAuthSessionFromProvider({ identityKey: id, authEpoch: 2, isReady: true })
        return Promise.resolve(new TextEncoder().encode('%PDF-1.7').buffer)
      },
    })
    await expect(uploadLeaveEvidence(scope, id, file)).rejects.toMatchObject({ name: 'AbortError' })
    expect(upload).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
  it('keeps the uploaded file metadata and same request key recoverable after a lost response', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'network connection lost' } })
    await expect(uploadLeaveEvidence(scope, id, pdf())).rejects.toThrow()
    expect(upload).toHaveBeenCalledTimes(1)
    const pending = leavePendingStore.readByIntent(actor, 'leave:command')!
    expect(pending.payload).toMatchObject({ p_action: 'attach' })
    await runLeaveCommand(scope, 'attach', {}, pending)
    expect(upload).toHaveBeenCalledTimes(1)
    expect(rpc.mock.calls[0]?.[1]).toEqual(rpc.mock.calls[1]?.[1])
  })
  it('does not treat a persisted in-flight record as an active call after reload', () => {
    leavePendingStore.write({
      profileId: actor,
      intentKey: 'leave:command',
      operationType: 'submit',
      rpcName: 'rpc_leave_execute',
      requestId: id,
      payload: {},
      payloadCanonical: '{}',
      createdAt: new Date().toISOString(),
      status: 'in_flight',
      instanceId: id,
      label: 'Leave submit',
    })
    const pending = leavePendingStore.readByIntent(actor, 'leave:command')!
    expect(leavePendingStore.isActivelyInFlight(pending)).toBe(false)
  })
  it('refuses a signed URL that leaves the trusted storage origin', async () => {
    signed.mockResolvedValue({
      data: { signedUrl: 'https://evil.example/evidence.pdf' },
      error: null,
    })
    await expect(downloadLeaveEvidence(scope, `${actor}/leave-evidence/${id}/${id}.pdf`)).rejects
      .toThrow('download')
  })
})
