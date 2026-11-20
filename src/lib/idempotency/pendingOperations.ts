import { useRef, useSyncExternalStore } from 'react'

export interface MinimalAuthLike {
  status?: string
  authEpoch?: number
  session?: { userId?: string | null } | null
  access?: { profile?: { id?: string | null } | null } | null
}

export type PendingOperationStatus = 'in_flight' | 'uncertain'
export type RpcErrorKind = 'definite' | 'uncertain'

export interface PendingOperationRecord<TOpType extends string = string> {
  profileId: string
  intentKey: string
  operationType: TOpType
  rpcName: string
  label: string
  requestId: string
  instanceId?: string
  status?: PendingOperationStatus
  payload: Record<string, unknown>
  payloadCanonical: string
  createdAt: string
  errorMessage?: string
}

export interface ProtectedSessionSnapshot {
  identityKey: string | null
  authEpoch: number
  authGeneration: number
  isReady: boolean
}

export interface IdentityScopeRef {
  identityKey: string | null
  authEpoch: number
  isAuthReady: boolean
  latestRef: {
    current: {
      identityKey: string | null
      authEpoch: number
      isAuthReady: boolean
    }
  }
}

interface AuthSessionRegistryState extends ProtectedSessionSnapshot {
  controlledByProvider: boolean
}

const authRegistry: AuthSessionRegistryState = {
  identityKey: null,
  authEpoch: 0,
  authGeneration: 0,
  isReady: false,
  controlledByProvider: false,
}

const registeredStores = new Set<{
  clearAll: () => void
  resetForTest: () => void
}>()

export function clearAllProtectedPendingOperations(): void {
  for (const store of registeredStores) {
    store.clearAll()
  }
}

export function syncProtectedAuthSessionFromProvider(params: {
  identityKey: string | null
  authEpoch?: number
  isReady: boolean
  invalidate?: boolean
  clearStorage?: boolean
}): void {
  if (params.clearStorage) {
    clearAllProtectedPendingOperations()
  }

  const nextEpoch = params.authEpoch ?? authRegistry.authEpoch
  const identityChanged =
    authRegistry.identityKey !== null &&
    params.identityKey !== null &&
    authRegistry.identityKey !== params.identityKey
  const identityEnded = authRegistry.identityKey !== null && params.identityKey === null
  const becameUnready = authRegistry.isReady && !params.isReady
  const epochChanged = params.authEpoch !== undefined && params.authEpoch !== authRegistry.authEpoch

  if (params.invalidate || identityChanged || identityEnded || becameUnready || epochChanged) {
    authRegistry.authGeneration += 1
  }

  authRegistry.identityKey = params.identityKey
  authRegistry.authEpoch = nextEpoch
  authRegistry.isReady = params.isReady
  authRegistry.controlledByProvider = true
}

export function syncProtectedAuthSessionFromHook(params: {
  identityKey: string | null
  authEpoch: number
  isReady: boolean
}): void {
  if (authRegistry.controlledByProvider) return

  const changed =
    authRegistry.identityKey !== params.identityKey ||
    authRegistry.authEpoch !== params.authEpoch ||
    authRegistry.isReady !== params.isReady

  if (changed) {
    authRegistry.authGeneration += 1
    authRegistry.identityKey = params.identityKey
    authRegistry.authEpoch = params.authEpoch
    authRegistry.isReady = params.isReady
  }
}

export function captureProtectedSessionSnapshot(fallback?: {
  identityKey: string | null
  authEpoch: number
  isReady: boolean
}): ProtectedSessionSnapshot {
  if (!authRegistry.controlledByProvider && fallback) {
    syncProtectedAuthSessionFromHook(fallback)
  }
  return {
    identityKey: authRegistry.identityKey,
    authEpoch: authRegistry.authEpoch,
    authGeneration: authRegistry.authGeneration,
    isReady: authRegistry.isReady,
  }
}

export function isProtectedSessionCurrent(
  snapshot: ProtectedSessionSnapshot,
  latestHook?: { identityKey: string | null; authEpoch: number; isAuthReady: boolean },
): boolean {
  if (!snapshot.isReady || !snapshot.identityKey) return false
  if (authRegistry.authGeneration !== snapshot.authGeneration) return false
  if (!authRegistry.isReady || authRegistry.identityKey !== snapshot.identityKey) return false
  if (authRegistry.authEpoch !== snapshot.authEpoch) return false

  if (latestHook) {
    if (
      !latestHook.isAuthReady ||
      latestHook.identityKey !== snapshot.identityKey ||
      latestHook.authEpoch !== snapshot.authEpoch
    ) {
      return false
    }
  }
  return true
}

export function assertProtectedSessionCurrent(
  snapshot: ProtectedSessionSnapshot,
  latestHook?: { identityKey: string | null; authEpoch: number; isAuthReady: boolean },
  message = 'Account session changed before operation completed.',
): void {
  if (!isProtectedSessionCurrent(snapshot, latestHook)) {
    throw new DOMException(message, 'AbortError')
  }
}

export function resetProtectedSessionRegistryForTest(): void {
  authRegistry.identityKey = null
  authRegistry.authEpoch = 0
  authRegistry.authGeneration = 0
  authRegistry.isReady = false
  authRegistry.controlledByProvider = false
  for (const store of registeredStores) {
    store.resetForTest()
  }
}

export function useProtectedIdentityScope(auth: MinimalAuthLike): IdentityScopeRef {
  const identityKey = auth.session?.userId ?? auth.access?.profile?.id ?? null
  const authEpoch = auth.authEpoch ?? 0
  const isAuthReady = auth.status ? auth.status === 'authenticated' : Boolean(identityKey)

  syncProtectedAuthSessionFromHook({
    identityKey,
    authEpoch,
    isReady: isAuthReady,
  })

  const latestRef = useRef({ identityKey, authEpoch, isAuthReady })
  latestRef.current = { identityKey, authEpoch, isAuthReady }
  return { identityKey, authEpoch, isAuthReady, latestRef }
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  return (error as { name?: unknown }).name === 'AbortError'
}

export function createUuidV4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16)
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function sanitizeRpcArgs(args: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined) {
      sanitized[key] = null
    } else if (typeof value === 'string') {
      sanitized[key] = value.trim() === '' ? null : value
    } else {
      sanitized[key] = value
    }
  }
  return sanitized
}

function sortValueForCanonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValueForCanonical)
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortValueForCanonical(obj[key])
    }
    return sorted
  }
  return value
}

export function canonicalizePayload(payload: Record<string, unknown>): string {
  return JSON.stringify(sortValueForCanonical(payload))
}

export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === 'object') {
    const maybe = error as { message?: unknown; details?: unknown }
    if (typeof maybe.message === 'string' && maybe.message) return maybe.message
    if (typeof maybe.details === 'string' && maybe.details) return maybe.details
  }
  return 'Request failed.'
}

export function formatPendingOperationConflictMessage<TOpType extends string>(
  pendingOperation: PendingOperationRecord<TOpType>,
  isActivelyInFlight: boolean,
): string {
  const shortId = pendingOperation.requestId.slice(0, 8)
  if (isActivelyInFlight) {
    return `A "${pendingOperation.label}" request (${shortId}) is currently in progress. Wait for server confirmation before submitting changes.`
  }
  return `An unconfirmed "${pendingOperation.label}" request (${shortId}) is awaiting confirmation. Retry that request or discard it before submitting modified changes.`
}

export class PendingOperationConflictError<TOpType extends string = string> extends Error {
  readonly pendingOperation: PendingOperationRecord<TOpType>

  constructor(pendingOperation: PendingOperationRecord<TOpType>, message?: string) {
    super(
      message ??
        formatPendingOperationConflictMessage(
          pendingOperation,
          pendingOperation.status === 'in_flight',
        ),
    )
    this.name = 'PendingOperationConflictError'
    this.pendingOperation = pendingOperation
  }
}

export class UncertainTransportError extends Error {
  readonly uncertainTransport = true
  readonly attendanceUncertainTransport = true

  constructor(message: string) {
    super(message)
    this.name = 'UncertainTransportError'
  }
}

const DEFINITE_SQL_STATES = new Set([
  '42501', // insufficient_privilege
  '22023', // invalid_parameter_value
  '22P02', // invalid_text_representation
  '23503', // foreign_key_violation
  '23505', // unique_violation
  '23514', // check_violation
  '23P01', // exclusion_violation
  'P0001', // raise_exception
  'P0002', // no_data_found
])

const DEFINITE_HTTP_STATUSES = new Set([400, 401, 403, 404, 409, 422])

const BASE_DEFINITE_MESSAGE_MARKERS = [
  'IDEMPOTENCY_CONFLICT',
  'STALE_CONTEXT',
  'CONCURRENT_MODIFICATION',
  'permission is required',
  'Insufficient privileges',
  'MFA verification required',
  'No active employee record is linked',
]

export function classifyRpcError(
  error: unknown,
  extraDefiniteMarkers: readonly string[] = [],
): RpcErrorKind {
  if (!error || typeof error !== 'object') return 'uncertain'

  const candidate = error as {
    code?: unknown
    status?: unknown
    statusCode?: unknown
    message?: unknown
    uncertainTransport?: unknown
    attendanceUncertainTransport?: unknown
  }

  if (candidate.uncertainTransport === true || candidate.attendanceUncertainTransport === true) {
    return 'uncertain'
  }

  if (typeof candidate.code === 'string' && DEFINITE_SQL_STATES.has(candidate.code.toUpperCase())) {
    return 'definite'
  }

  const httpStatus =
    typeof candidate.status === 'number'
      ? candidate.status
      : typeof candidate.statusCode === 'number'
        ? candidate.statusCode
        : null
  if (httpStatus !== null) {
    if (httpStatus >= 500 || httpStatus === 0) return 'uncertain'
    if (DEFINITE_HTTP_STATUSES.has(httpStatus)) return 'definite'
  }

  const msg = typeof candidate.message === 'string' ? candidate.message : ''
  if (
    BASE_DEFINITE_MESSAGE_MARKERS.some((marker) => msg.includes(marker)) ||
    extraDefiniteMarkers.some((marker) => msg.includes(marker))
  ) {
    return 'definite'
  }

  return 'uncertain'
}

function getSessionStorageSafe(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.sessionStorage
  } catch {
    return null
  }
}

export interface PendingOperationStore<TOpType extends string> {
  storagePrefix: string
  getStorageKey: (profileId: string) => string
  subscribe: (listener: () => void) => () => void
  readAll: (profileId?: string | null) => PendingOperationRecord<TOpType>[]
  readByIntent: (
    profileId: string | null | undefined,
    intentKey: string,
  ) => PendingOperationRecord<TOpType> | null
  readDefault: (profileId?: string | null) => PendingOperationRecord<TOpType> | null
  write: (op: PendingOperationRecord<TOpType>) => void
  updateIfOwned: (op: PendingOperationRecord<TOpType>) => boolean
  clear: (
    profileId?: string | null,
    intentKey?: string,
    expectedOwnership?: { requestId: string; instanceId?: string },
  ) => boolean
  clearAll: () => void
  registerInFlight: (
    instanceId: string,
    profileId: string,
    intentKey: string,
    requestId: string,
  ) => void
  unregisterInFlight: (instanceId: string) => void
  isActivelyInFlight: (op: PendingOperationRecord<TOpType>) => boolean
  isStillOwned: (
    profileId: string,
    intentKey: string,
    requestId: string,
    instanceId: string,
  ) => boolean
  formatLabel: (opType: TOpType) => string
  useOperations: (auth: MinimalAuthLike) => PendingOperationRecord<TOpType>[]
  resetForTest: () => void
}

export function createPendingOperationStore<TOpType extends string>(config: {
  storagePrefix: string
  legacyPrefixes?: readonly string[]
  defaultIntentKey?: string
  formatLabel: (opType: TOpType) => string
}): PendingOperationStore<TOpType> {
  const { storagePrefix, legacyPrefixes = [], defaultIntentKey, formatLabel } = config
  const EMPTY_OPS: PendingOperationRecord<TOpType>[] = []

  const listeners = new Set<() => void>()
  const snapshotCache = new Map<
    string,
    { raw: string | null; ops: PendingOperationRecord<TOpType>[] }
  >()
  const activeInFlightInstances = new Map<
    string,
    { profileId: string; intentKey: string; requestId: string }
  >()
  const supersededInstanceIds = new Set<string>()

  const getStorageKey = (profileId: string) => `${storagePrefix}${profileId}`

  const notifyListeners = () => {
    for (const listener of listeners) {
      try {
        listener()
      } catch {
        // Ignore subscriber errors
      }
    }
  }

  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  const isValidOp = (
    parsed: unknown,
    profileId: string,
  ): parsed is PendingOperationRecord<TOpType> => {
    if (!parsed || typeof parsed !== 'object') return false
    const op = parsed as Partial<PendingOperationRecord<TOpType>>
    return (
      op.profileId === profileId &&
      typeof op.intentKey === 'string' &&
      typeof op.operationType === 'string' &&
      typeof op.rpcName === 'string' &&
      typeof op.requestId === 'string' &&
      Boolean(op.payload) &&
      typeof op.payload === 'object'
    )
  }

  const readAll = (profileId?: string | null): PendingOperationRecord<TOpType>[] => {
    if (!profileId) return EMPTY_OPS
    const storage = getSessionStorageSafe()
    if (!storage) return EMPTY_OPS
    const key = getStorageKey(profileId)
    try {
      const raw = storage.getItem(key)
      const cached = snapshotCache.get(profileId)
      if (cached && cached.raw === raw) {
        return cached.ops
      }
      if (!raw) {
        snapshotCache.set(profileId, { raw: null, ops: EMPTY_OPS })
        return EMPTY_OPS
      }
      const parsed = JSON.parse(raw) as unknown
      const ops = Array.isArray(parsed)
        ? parsed.filter((item): item is PendingOperationRecord<TOpType> =>
            isValidOp(item, profileId),
          )
        : []
      const normalized = ops.map((item) => ({
        ...item,
        status: item.status === 'in_flight' ? ('in_flight' as const) : ('uncertain' as const),
        label: item.label || formatLabel(item.operationType),
        payloadCanonical:
          typeof item.payloadCanonical === 'string'
            ? item.payloadCanonical
            : canonicalizePayload(item.payload),
      }))
      snapshotCache.set(profileId, { raw, ops: normalized })
      return normalized
    } catch {
      snapshotCache.set(profileId, { raw: null, ops: EMPTY_OPS })
      return EMPTY_OPS
    }
  }

  const readByIntent = (
    profileId: string | null | undefined,
    intentKey: string,
  ): PendingOperationRecord<TOpType> | null => {
    const ops = readAll(profileId)
    return ops.find((op) => op.intentKey === intentKey) ?? null
  }

  const readDefault = (profileId?: string | null): PendingOperationRecord<TOpType> | null => {
    const ops = readAll(profileId)
    if (defaultIntentKey) {
      return ops.find((op) => op.intentKey === defaultIntentKey) ?? ops[0] ?? null
    }
    return ops[0] ?? null
  }

  const writeList = (profileId: string, ops: PendingOperationRecord<TOpType>[]): void => {
    const storage = getSessionStorageSafe()
    if (!storage || !profileId) return
    const key = getStorageKey(profileId)
    try {
      if (ops.length === 0) {
        storage.removeItem(key)
        snapshotCache.set(profileId, { raw: null, ops: EMPTY_OPS })
      } else {
        const serialized = JSON.stringify(ops)
        storage.setItem(key, serialized)
        snapshotCache.set(profileId, { raw: serialized, ops })
      }
      notifyListeners()
    } catch {
      // Ignore storage quota or restricted context errors
    }
  }

  const write = (op: PendingOperationRecord<TOpType>): void => {
    if (!op.profileId) return
    const existing = readAll(op.profileId)
    const normalized: PendingOperationRecord<TOpType> = {
      ...op,
      status: op.status ?? 'uncertain',
      label: op.label || formatLabel(op.operationType),
      payloadCanonical: op.payloadCanonical || canonicalizePayload(op.payload),
    }
    if (normalized.instanceId) {
      for (const [activeId, meta] of activeInFlightInstances.entries()) {
        if (
          meta.profileId === normalized.profileId &&
          meta.intentKey === normalized.intentKey &&
          activeId !== normalized.instanceId
        ) {
          supersededInstanceIds.add(activeId)
        }
      }
    }
    const idx = existing.findIndex((item) => item.intentKey === normalized.intentKey)
    const next =
      idx >= 0
        ? existing.map((item, i) => (i === idx ? normalized : item))
        : [...existing, normalized]
    writeList(op.profileId, next)
  }

  const registerInFlight = (
    instanceId: string,
    profileId: string,
    intentKey: string,
    requestId: string,
  ): void => {
    for (const [existingId, meta] of activeInFlightInstances.entries()) {
      if (meta.profileId === profileId && meta.intentKey === intentKey && existingId !== instanceId) {
        supersededInstanceIds.add(existingId)
      }
    }
    activeInFlightInstances.set(instanceId, { profileId, intentKey, requestId })
  }

  const unregisterInFlight = (instanceId: string): void => {
    activeInFlightInstances.delete(instanceId)
  }

  const isActivelyInFlight = (op: PendingOperationRecord<TOpType>): boolean =>
    op.status === 'in_flight' &&
    typeof op.instanceId === 'string' &&
    activeInFlightInstances.has(op.instanceId)

  const isStillOwned = (
    profileId: string,
    intentKey: string,
    requestId: string,
    instanceId: string,
  ): boolean => {
    if (supersededInstanceIds.has(instanceId)) return false
    const current = readByIntent(profileId, intentKey)
    if (!current) return false
    return current.requestId === requestId && current.instanceId === instanceId
  }

  const updateIfOwned = (op: PendingOperationRecord<TOpType>): boolean => {
    if (!op.profileId || !op.instanceId) return false
    if (!isStillOwned(op.profileId, op.intentKey, op.requestId, op.instanceId)) {
      return false
    }
    write(op)
    return true
  }

  const clear = (
    profileId?: string | null,
    intentKey?: string,
    expectedOwnership?: { requestId: string; instanceId?: string },
  ): boolean => {
    if (!profileId) return false
    if (!intentKey) {
      for (const [activeId, meta] of activeInFlightInstances.entries()) {
        if (meta.profileId === profileId) {
          supersededInstanceIds.add(activeId)
        }
      }
      writeList(profileId, [])
      return true
    }
    const existing = readAll(profileId)
    if (!expectedOwnership) {
      for (const item of existing) {
        if (item.intentKey === intentKey && item.instanceId) {
          supersededInstanceIds.add(item.instanceId)
        }
      }
      for (const [activeId, meta] of activeInFlightInstances.entries()) {
        if (meta.profileId === profileId && meta.intentKey === intentKey) {
          supersededInstanceIds.add(activeId)
        }
      }
    }
    if (existing.length === 0) return false
    const next = existing.filter((item) => {
      if (item.intentKey !== intentKey) return true
      if (!expectedOwnership) return false
      const matchesOwner =
        item.requestId === expectedOwnership.requestId &&
        (!expectedOwnership.instanceId || item.instanceId === expectedOwnership.instanceId)
      return !matchesOwner
    })
    if (next.length !== existing.length) {
      writeList(profileId, next)
      return true
    }
    return false
  }

  const clearAll = (): void => {
    snapshotCache.clear()
    for (const activeId of activeInFlightInstances.keys()) {
      supersededInstanceIds.add(activeId)
    }
    const storage = getSessionStorageSafe()
    if (!storage) {
      notifyListeners()
      return
    }
    try {
      const keysToRemove: string[] = []
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i)
        if (
          key &&
          (key.startsWith(storagePrefix) || legacyPrefixes.some((p) => key.startsWith(p)))
        ) {
          keysToRemove.push(key)
        }
      }
      for (const key of keysToRemove) {
        storage.removeItem(key)
      }
    } catch {
      // Ignore storage errors
    }
    notifyListeners()
  }

  const resetForTest = (): void => {
    snapshotCache.clear()
    activeInFlightInstances.clear()
    supersededInstanceIds.clear()
  }

  const useOperations = (auth: MinimalAuthLike): PendingOperationRecord<TOpType>[] => {
    const { identityKey, isAuthReady } = useProtectedIdentityScope(auth)
    return useSyncExternalStore(
      subscribe,
      () => (isAuthReady && identityKey ? readAll(identityKey) : EMPTY_OPS),
      () => EMPTY_OPS,
    )
  }

  const store: PendingOperationStore<TOpType> = {
    storagePrefix,
    getStorageKey,
    subscribe,
    readAll,
    readByIntent,
    readDefault,
    write,
    updateIfOwned,
    clear,
    clearAll,
    registerInFlight,
    unregisterInFlight,
    isActivelyInFlight,
    isStillOwned,
    formatLabel,
    useOperations,
    resetForTest,
  }

  registeredStores.add({ clearAll, resetForTest })
  return store
}

export async function executeIdempotentOperation<TOpType extends string, TResult>({
  store,
  identityScope,
  intentKey,
  operationType,
  rpcName,
  payloadWithoutRequestId,
  retryingOperation,
  pinnedSessionSnapshot,
  extraDefiniteMarkers = [],
  invokeRpc,
}: {
  store: PendingOperationStore<TOpType>
  identityScope: IdentityScopeRef
  intentKey: string
  operationType: TOpType
  rpcName: string
  payloadWithoutRequestId: Record<string, unknown>
  retryingOperation?: PendingOperationRecord<TOpType>
  pinnedSessionSnapshot?: ProtectedSessionSnapshot
  extraDefiniteMarkers?: readonly string[]
  invokeRpc: (rpcName: string, fullArgs: Record<string, unknown>) => Promise<TResult>
}): Promise<TResult> {
  const sessionSnap =
    pinnedSessionSnapshot ??
    captureProtectedSessionSnapshot({
      identityKey: identityScope.identityKey,
      authEpoch: identityScope.authEpoch,
      isReady: identityScope.isAuthReady,
    })

  if (!isProtectedSessionCurrent(sessionSnap, identityScope.latestRef.current)) {
    throw new DOMException('Authenticated session is unavailable.', 'AbortError')
  }

  const profileId = sessionSnap.identityKey!
  const sanitizedPayload = sanitizeRpcArgs(payloadWithoutRequestId)
  const payloadCanonical = canonicalizePayload(sanitizedPayload)
  const label = store.formatLabel(operationType)

  let frozenRequestId: string
  let frozenPayload: Record<string, unknown>
  let frozenCanonical: string
  let frozenCreatedAt: string

  if (retryingOperation) {
    if (retryingOperation.profileId !== profileId) {
      throw new DOMException('Cannot replay an operation from a different account.', 'AbortError')
    }
    const existing = store.readByIntent(profileId, intentKey)
    if (
      existing &&
      (store.isActivelyInFlight(existing) || existing.requestId !== retryingOperation.requestId)
    ) {
      throw new PendingOperationConflictError(
        existing,
        formatPendingOperationConflictMessage(existing, store.isActivelyInFlight(existing)),
      )
    }
    frozenRequestId = retryingOperation.requestId
    frozenPayload = retryingOperation.payload
    frozenCanonical =
      retryingOperation.payloadCanonical || canonicalizePayload(retryingOperation.payload)
    frozenCreatedAt = retryingOperation.createdAt
  } else {
    const existing = store.readByIntent(profileId, intentKey)
    if (existing) {
      if (store.isActivelyInFlight(existing)) {
        throw new PendingOperationConflictError(
          existing,
          formatPendingOperationConflictMessage(existing, true),
        )
      }
      if (existing.rpcName === rpcName && existing.payloadCanonical === payloadCanonical) {
        frozenRequestId = existing.requestId
        frozenPayload = existing.payload
        frozenCanonical = existing.payloadCanonical
        frozenCreatedAt = existing.createdAt
      } else {
        throw new PendingOperationConflictError(
          existing,
          formatPendingOperationConflictMessage(existing, false),
        )
      }
    } else {
      frozenRequestId = createUuidV4()
      frozenPayload = sanitizedPayload
      frozenCanonical = payloadCanonical
      frozenCreatedAt = new Date().toISOString()
    }
  }

  const instanceId = createUuidV4()

  try {
    store.registerInFlight(instanceId, profileId, intentKey, frozenRequestId)
    store.write({
      profileId,
      intentKey,
      operationType,
      rpcName,
      label,
      requestId: frozenRequestId,
      payload: frozenPayload,
      payloadCanonical: frozenCanonical,
      createdAt: frozenCreatedAt,
      status: 'in_flight',
      instanceId,
    })

    const result = await invokeRpc(rpcName, {
      p_request_id: frozenRequestId,
      ...frozenPayload,
    })

    if (!isProtectedSessionCurrent(sessionSnap, identityScope.latestRef.current)) {
      throw new DOMException('Account session changed before request confirmed.', 'AbortError')
    }

    if (!store.isStillOwned(profileId, intentKey, frozenRequestId, instanceId)) {
      throw new DOMException(
        'Pending request was discarded or superseded before completion.',
        'AbortError',
      )
    }

    store.clear(profileId, intentKey, {
      requestId: frozenRequestId,
      instanceId,
    })
    return result
  } catch (error) {
    if (!isProtectedSessionCurrent(sessionSnap, identityScope.latestRef.current)) {
      throw new DOMException('Account session changed while request was in flight.', 'AbortError')
    }

    if (!store.isStillOwned(profileId, intentKey, frozenRequestId, instanceId)) {
      if (isAbortError(error)) {
        throw error
      }
      throw new DOMException(
        'Pending request was discarded or superseded before completion.',
        'AbortError',
      )
    }

    const kind = classifyRpcError(error, extraDefiniteMarkers)
    if (kind === 'definite') {
      store.clear(profileId, intentKey, {
        requestId: frozenRequestId,
        instanceId,
      })
    } else {
      store.updateIfOwned({
        profileId,
        intentKey,
        operationType,
        rpcName,
        label,
        requestId: frozenRequestId,
        payload: frozenPayload,
        payloadCanonical: frozenCanonical,
        createdAt: frozenCreatedAt,
        status: 'uncertain',
        instanceId,
        errorMessage: extractErrorMessage(error),
      })
    }
    throw error
  } finally {
    store.unregisterInFlight(instanceId)
  }
}
