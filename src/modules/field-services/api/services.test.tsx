import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, renderHook, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/ui/Toast'
import {
  clearAllProtectedPendingOperations,
  writePendingOperationForTest,
} from '@/modules/field-services/__tests__/testHelpers'
import { PendingServiceOperationsBanner } from '../components/ServiceBadges'
import {
  ServiceEvidenceValidationError,
  getSignedServiceEvidenceUrl,
  sanitizeRpcArgs,
  uploadServiceEvidencePhotos,
  useCompleteServiceVisit,
  useDiscardPendingServiceOperation,
  useLogAssistantVisitContribution,
  usePendingServiceOperations,
  useRetryPendingServiceOperation,
  useSaveServiceVisit,
  useSubmitServiceRequest,
} from './services'
import {
  PendingOperationConflictError,
  classifyServiceRpcError,
  clearPendingServiceOperation,
  readPendingServiceOperations,
  resetServiceSessionRegistryForTest,
} from '../lib/pendingOperations'
import { syncProtectedAuthSessionFromProvider } from '@/lib/idempotency/pendingOperations'
import { readPendingAttendanceOperations, resetAttendanceSessionRegistryForTest } from '@/modules/attendance/lib/pendingOperations'

const mockRpc = vi.fn<(...args: unknown[]) => Promise<{ data: unknown; error: unknown }>>()
const mockUpload = vi.fn<(...args: unknown[]) => Promise<{ error: unknown }>>()
const mockRemove = vi.fn<(...args: unknown[]) => Promise<{ error: unknown }>>()
const mockCreateSignedUrl =
  vi.fn<(...args: unknown[]) => Promise<{ data: { signedUrl: string } | null; error: unknown }>>()
const mockUseAuth = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: () => ({
    rpc: (...args: unknown[]) => mockRpc(...args),
    storage: {
      from: () => ({
        upload: (...args: unknown[]) => mockUpload(...args),
        remove: (...args: unknown[]) => mockRemove(...args),
        createSignedUrl: (...args: unknown[]) => mockCreateSignedUrl(...args),
      }),
    },
  }),
}))

vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuth: () => mockUseAuth() as unknown,
}))

function createWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ToastProvider>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </ToastProvider>
    )
  }
}

const OWNER_UUID = 'c5100000-0000-4000-8000-000000000009'
const VISIT_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function makeFakeJpeg(name = 'photo.jpg'): File {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
  const file = new File([bytes], name, { type: 'image/jpeg' })
  Object.defineProperty(file, 'arrayBuffer', {
    value: () => Promise.resolve(bytes.buffer),
  })
  return file
}

function makeFakePdf(name = 'report.pdf'): File {
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])
  const file = new File([bytes], name, { type: 'application/pdf' })
  Object.defineProperty(file, 'arrayBuffer', {
    value: () => Promise.resolve(bytes.buffer),
  })
  return file
}

describe('Field Services API Adapter, Storage Policy & Idempotent Retry Contract', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    vi.unstubAllEnvs()
    vi.stubEnv('VITE_SUPABASE_URL', 'https://qa.supabase.co')
    resetAttendanceSessionRegistryForTest()
    resetServiceSessionRegistryForTest()
    mockRpc.mockReset()
    mockUpload.mockReset()
    mockRemove.mockReset()
    mockCreateSignedUrl.mockReset()
    mockUpload.mockResolvedValue({ error: null })
    mockRemove.mockResolvedValue({ error: null })
    mockUseAuth.mockReturnValue({
      status: 'authenticated',
      session: { userId: OWNER_UUID },
      access: { profile: { id: OWNER_UUID }, roleKeys: ['employee'], permissionKeys: [] },
      authEpoch: 1,
    })
  })

  it('sanitizes blank strings & undefined params to explicit null', () => {
    expect(sanitizeRpcArgs({ p_note: '  ', p_id: undefined, p_decision: 'approve' })).toEqual({
      p_note: null,
      p_id: null,
      p_decision: 'approve',
    })
  })

  it('freezes p_request_id across 504 errors and replays cleanly via PendingServiceOperationsBanner', async () => {
    const wrapper = createWrapper()
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: '504 Gateway Timeout', status: 504 },
    })

    const { result: submitHook } = renderHook(() => useSubmitServiceRequest(), { wrapper })
    await expect(
      submitHook.current.mutateAsync({ id: 'req-1', expectedVersion: 1 }),
    ).rejects.toBeDefined()

    const firstArgs = mockRpc.mock.calls[0]?.[1] as { p_request_id: string }
    expect(firstArgs.p_request_id).toMatch(/^[0-9a-f-]{36}$/i)
    const pending = readPendingServiceOperations(OWNER_UUID)
    expect(pending).toHaveLength(1)
    expect(pending[0]?.requestId).toBe(firstArgs.p_request_id)

    mockRpc.mockResolvedValueOnce({
      data: {
        request_id: firstArgs.p_request_id,
        operation_type: 'service_submit_request',
        replayed: true,
        result: { id: 'req-1', status: 'submitted', version: 2 },
      },
      error: null,
    })

    render(<PendingServiceOperationsBanner />, { wrapper })
    const retryBtn = await screen.findByRole('button', { name: /Retry Pending Action/i })
    act(() => {
      retryBtn.click()
    })
    await vi.waitFor(() => {
      expect(mockRpc).toHaveBeenCalledTimes(2)
      expect(readPendingServiceOperations(OWNER_UUID)).toHaveLength(0)
    })

    const replayArgs = mockRpc.mock.calls[1]?.[1] as { p_request_id: string }
    expect(replayArgs.p_request_id).toBe(firstArgs.p_request_id)
    expect(readPendingServiceOperations(OWNER_UUID)).toHaveLength(0)
  })

  it('classifies PROVIDER_REF_EXISTS and CONCURRENT_MODIFICATION as definite errors', () => {
    expect(
      classifyServiceRpcError({ code: 'P0001', message: 'PROVIDER_REF_EXISTS: Ref already exists' }),
    ).toBe('definite')
    expect(
      classifyServiceRpcError({
        code: 'P0001',
        message: 'CONCURRENT_MODIFICATION: Changed elsewhere',
      }),
    ).toBe('definite')
    expect(classifyServiceRpcError({ status: 504, message: 'Gateway Timeout' })).toBe('uncertain')
  })

  it('rejects PDF evidence uploads before reaching storage and uploads valid JPEG cleanly', async () => {
    await expect(
      uploadServiceEvidencePhotos({
        ownerId: OWNER_UUID,
        visitId: VISIT_UUID,
        files: [makeFakePdf()],
      }),
    ).rejects.toBeInstanceOf(ServiceEvidenceValidationError)
    expect(mockUpload).not.toHaveBeenCalled()

    const paths = await uploadServiceEvidencePhotos({
      ownerId: OWNER_UUID,
      visitId: VISIT_UUID,
      files: [makeFakeJpeg()],
    })
    expect(paths).toHaveLength(1)
    expect(paths[0]).toMatch(
      new RegExp(`^${OWNER_UUID}/service-evidence/${VISIT_UUID}/[0-9a-f-]+\\.jpg$`),
    )
    expect(mockUpload).toHaveBeenCalledTimes(1)
  })

  it('keeps uploaded photos frozen on 504 retry, and deletes new uploads only on definite RPC failure', async () => {
    const wrapper = createWrapper()
    const { result: completeHook } = renderHook(() => useCompleteServiceVisit(), { wrapper })
    const { result: retryHook } = renderHook(() => useRetryPendingServiceOperation(), { wrapper })

    // 1) Transient 504 -> must KEEP uploaded storage file & freeze p_photo_paths
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Gateway Timeout', status: 504 },
    })

    await expect(
      completeHook.current.mutateAsync({
        visitId: VISIT_UUID,
        outcome: 'completed',
        checklist: { ont_mounted: true },
        workNotes: 'Signal -19 dBm verified',
        keptPhotoPaths: [],
        newPhotoFiles: [makeFakeJpeg()],
        expectedVisitVersion: 1,
        expectedRequestVersion: 3,
      }),
    ).rejects.toBeDefined()

    expect(mockRemove).not.toHaveBeenCalled()
    const pending = readPendingServiceOperations(OWNER_UUID)
    expect(pending).toHaveLength(1)
    const uploadedPath = (pending[0]?.payload.p_photo_paths as string[])[0]
    expect(uploadedPath).toContain(`/service-evidence/${VISIT_UUID}/`)

    // Retry reuses exact uploaded path & same requestId without re-uploading
    const firstOp = pending[0]
    if (!firstOp) throw new Error('Expected pending operation')
    mockRpc.mockResolvedValueOnce({
      data: {
        request_id: firstOp.requestId,
        operation_type: 'service_complete_visit',
        replayed: false,
        result: { visit_id: VISIT_UUID, status: 'work_completed' },
      },
      error: null,
    })
    await act(async () => {
      await retryHook.current.mutateAsync(firstOp)
    })
    expect(mockUpload).toHaveBeenCalledTimes(1)
    expect(readPendingServiceOperations(OWNER_UUID)).toHaveLength(0)

    // 2) Definite validation error -> removes newly uploaded file immediately
    mockUpload.mockClear()
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: '22023', message: 'Work notes require at least 5 chars' },
    })

    await expect(
      completeHook.current.mutateAsync({
        visitId: VISIT_UUID,
        outcome: 'completed',
        checklist: { ont_mounted: true },
        workNotes: 'ok',
        keptPhotoPaths: [],
        newPhotoFiles: [makeFakeJpeg('second.jpg')],
        expectedVisitVersion: 2,
        expectedRequestVersion: 4,
      }),
    ).rejects.toBeDefined()

    expect(mockRemove).toHaveBeenCalledTimes(1)
    expect(readPendingServiceOperations(OWNER_UUID)).toHaveLength(0)
  })

  it('rejects cross-origin signed evidence URLs cleanly', async () => {
    const validPath = `${OWNER_UUID}/service-evidence/${VISIT_UUID}/11111111-1111-4111-8111-111111111111.jpg`
    mockCreateSignedUrl.mockResolvedValueOnce({
      data: { signedUrl: 'https://evil.example.com/steal.jpg' },
      error: null,
    })
    await expect(getSignedServiceEvidenceUrl(validPath)).rejects.toThrow(
      'The private file download could not be created.',
    )

    mockCreateSignedUrl.mockResolvedValueOnce({
      data: { signedUrl: 'https://qa.supabase.co/storage/v1/object/sign/private-files/ok?token=1' },
      error: null,
    })
    await expect(getSignedServiceEvidenceUrl(validPath)).resolves.toContain('https://qa.supabase.co/')
  })

  it('prevents cross-account replay, blocks conflicting edits until resolved, and clears both Attendance & Service stores together', async () => {
    const wrapper = createWrapper()

    // Account switch while in-flight throws AbortError without touching new user's storage
    let resolveRpc!: (val: { data: unknown; error: unknown }) => void
    mockRpc.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRpc = resolve
        }),
    )

    const { result: submitHook, rerender } = renderHook(() => useSubmitServiceRequest(), { wrapper })
    const promise = submitHook.current.mutateAsync({ id: 'req-swap', expectedVersion: 1 })
    await vi.waitFor(() => {
      expect(mockRpc).toHaveBeenCalledTimes(1)
    })

    const OTHER_UUID = 'c5100000-0000-4000-8000-000000000010'
    mockUseAuth.mockReturnValue({
      status: 'authenticated',
      session: { userId: OTHER_UUID },
      access: { profile: { id: OTHER_UUID }, roleKeys: ['service_desk'], permissionKeys: [] },
      authEpoch: 2,
    })
    rerender()

    resolveRpc({
      data: {
        request_id: 'f5100000-0000-4000-8000-000000000099',
        operation_type: 'service_submit_request',
        replayed: false,
        result: { status: 'submitted' },
      },
      error: null,
    })
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })

    // Shared protected store clear wipes BOTH Attendance & Service pending ledgers
    writePendingOperationForTest(OTHER_UUID)
    clearAllProtectedPendingOperations()
    expect(readPendingServiceOperations(OTHER_UUID)).toHaveLength(0)
    expect(readPendingAttendanceOperations(OTHER_UUID)).toHaveLength(0)

    // Discard helper works for uncertain ops
    const { result: discardHook } = renderHook(() => useDiscardPendingServiceOperation(), { wrapper })
    const { result: opsHook } = renderHook(() => usePendingServiceOperations(), { wrapper })
    mockRpc.mockResolvedValueOnce({ data: null, error: { status: 502, message: 'Bad Gateway' } })
    await expect(
      submitHook.current.mutateAsync({ id: 'req-conflict', expectedVersion: 1 }),
    ).rejects.toBeDefined()
    expect(opsHook.current).toHaveLength(1)

    await expect(
      submitHook.current.mutateAsync({ id: 'req-conflict', expectedVersion: 2 }),
    ).rejects.toBeInstanceOf(PendingOperationConflictError)

    act(() => {
      discardHook.current('service:submit:req-conflict')
    })
    expect(opsHook.current).toHaveLength(0)
    expect(clearPendingServiceOperation(OTHER_UUID, 'missing')).toBe(false)
  })

  it('B5-01: binds useLogAssistantVisitContribution, useSaveServiceVisit, and useCompleteServiceVisit to starting session across photo uploads and 0-file microtasks', async () => {
    const wrapper = createWrapper()
    const OTHER_UUID = 'c5100000-0000-4000-8000-000000000010'

    const switchToBeta = (rerender: () => void) => {
      mockUseAuth.mockReturnValue({
        status: 'authenticated',
        session: { userId: OTHER_UUID },
        access: { profile: { id: OTHER_UUID }, roleKeys: ['employee'], permissionKeys: [] },
        authEpoch: 2,
      })
      rerender()
    }

    // Case 1: Assistant delayed photo upload -> account switches mid-upload -> AbortError, zero RPC, zero storage DELETE under Beta, zero pending records
    let resolveUpload1!: (res: { error: unknown }) => void
    mockUpload.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveUpload1 = resolve
        }),
    )
    const contribHook1 = renderHook(() => useLogAssistantVisitContribution(), { wrapper })
    const p1 = contribHook1.result.current.mutateAsync({
      visitId: VISIT_UUID,
      note: 'Alpha assistant splice note',
      keptPhotoPaths: [],
      newPhotoFiles: [makeFakeJpeg('asst-proof.jpg')],
      expectedVisitVersion: 1,
    })
    await vi.waitFor(() => {
      expect(mockUpload).toHaveBeenCalledTimes(1)
    })
    switchToBeta(() => contribHook1.rerender())
    resolveUpload1({ error: null })
    await expect(p1).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockRpc).not.toHaveBeenCalled()
    expect(mockRemove).not.toHaveBeenCalled()
    expect(readPendingServiceOperations(OWNER_UUID)).toHaveLength(0)
    expect(readPendingServiceOperations(OTHER_UUID)).toHaveLength(0)

    // Case 2: Assistant note-only (0-file microtask yield) -> auth switches immediately during microtask yield
    resetServiceSessionRegistryForTest()
    mockUseAuth.mockReturnValue({
      status: 'authenticated',
      session: { userId: OWNER_UUID },
      access: { profile: { id: OWNER_UUID }, roleKeys: ['employee'], permissionKeys: [] },
      authEpoch: 1,
    })
    const contribHook2 = renderHook(() => useLogAssistantVisitContribution(), { wrapper })
    const p2 = contribHook2.result.current.mutateAsync({
      visitId: VISIT_UUID,
      note: 'Alpha zero-file note',
      keptPhotoPaths: [],
      newPhotoFiles: [],
      expectedVisitVersion: 1,
    })
    syncProtectedAuthSessionFromProvider({
      identityKey: OTHER_UUID,
      authEpoch: 2,
      isReady: true,
    })
    await expect(p2).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockRpc).not.toHaveBeenCalled()
    expect(readPendingServiceOperations(OWNER_UUID)).toHaveLength(0)
    expect(readPendingServiceOperations(OTHER_UUID)).toHaveLength(0)

    // Case 3: useSaveServiceVisit delayed photo upload -> switch mid-upload
    resetServiceSessionRegistryForTest()
    mockUpload.mockClear()
    mockUseAuth.mockReturnValue({
      status: 'authenticated',
      session: { userId: OWNER_UUID },
      access: { profile: { id: OWNER_UUID }, roleKeys: ['employee'], permissionKeys: [] },
      authEpoch: 1,
    })
    let resolveUpload3!: (res: { error: unknown }) => void
    mockUpload.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveUpload3 = resolve
        }),
    )
    const saveHook = renderHook(() => useSaveServiceVisit(), { wrapper })
    const p3 = saveHook.result.current.mutateAsync({
      visitId: VISIT_UUID,
      checklist: { ont_mounted: true },
      workNotes: 'Alpha lead notes',
      keptPhotoPaths: [],
      newPhotoFiles: [makeFakeJpeg('lead-draft.jpg')],
      expectedVisitVersion: 1,
    })
    await vi.waitFor(() => {
      expect(mockUpload).toHaveBeenCalledTimes(1)
    })
    switchToBeta(() => saveHook.rerender())
    resolveUpload3({ error: null })
    await expect(p3).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockRpc).not.toHaveBeenCalled()
    expect(mockRemove).not.toHaveBeenCalled()
    expect(readPendingServiceOperations(OWNER_UUID)).toHaveLength(0)
    expect(readPendingServiceOperations(OTHER_UUID)).toHaveLength(0)

    // Case 4: useCompleteServiceVisit delayed photo upload -> switch mid-upload
    resetServiceSessionRegistryForTest()
    mockUpload.mockClear()
    mockUseAuth.mockReturnValue({
      status: 'authenticated',
      session: { userId: OWNER_UUID },
      access: { profile: { id: OWNER_UUID }, roleKeys: ['employee'], permissionKeys: [] },
      authEpoch: 1,
    })
    let resolveUpload4!: (res: { error: unknown }) => void
    mockUpload.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveUpload4 = resolve
        }),
    )
    const completeHook = renderHook(() => useCompleteServiceVisit(), { wrapper })
    const p4 = completeHook.result.current.mutateAsync({
      visitId: VISIT_UUID,
      outcome: 'completed',
      checklist: { ont_mounted: true },
      workNotes: 'Signal -19 dBm',
      keptPhotoPaths: [],
      newPhotoFiles: [makeFakeJpeg('lead-complete.jpg')],
      expectedVisitVersion: 1,
      expectedRequestVersion: 3,
    })
    await vi.waitFor(() => {
      expect(mockUpload).toHaveBeenCalledTimes(1)
    })
    switchToBeta(() => completeHook.rerender())
    resolveUpload4({ error: null })
    await expect(p4).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockRpc).not.toHaveBeenCalled()
    expect(mockRemove).not.toHaveBeenCalled()
    expect(readPendingServiceOperations(OWNER_UUID)).toHaveLength(0)
    expect(readPendingServiceOperations(OTHER_UUID)).toHaveLength(0)
  })
})
