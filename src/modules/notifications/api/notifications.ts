import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { getSupabaseClient } from '@/lib/supabase/client'
import { isMonitorOnlyAccount } from '@/config/navigation'
import type { UserRole } from '@/config/modules'
import { useAuth } from '@/modules/auth/AuthProvider'
import {
  assertProtectedSessionCurrent,
  captureProtectedSessionSnapshot,
  useProtectedIdentityScope,
} from '@/lib/idempotency/pendingOperations'

export const NOTIFICATION_CATEGORIES = [
  'service_urgent',
  'service',
  'attendance',
  'hr',
  'payroll',
  'warehouse',
  'project',
  'cash',
  'general',
] as const

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]

export const NOTIFICATION_CATEGORY_META: Record<
  NotificationCategory,
  { label: string; description: string; lockedOn?: boolean }
> = {
  service_urgent: {
    label: 'Urgent Field Service Alerts',
    description: 'Mandatory safety, escalation, and coordinator alerts. Cannot be muted.',
    lockedOn: true,
  },
  service: {
    label: 'Field Service Updates',
    description: 'Request intake, crew assignment, review, and provider handoff updates.',
  },
  attendance: {
    label: 'Attendance & Corrections',
    description: 'Daily clock reminders, correction decisions, and field evidence reviews.',
  },
  hr: {
    label: 'HR & Lifecycle',
    description: 'Employee records, onboarding, leave, and profile updates.',
  },
  payroll: {
    label: 'Payroll & Payslips',
    description: 'Payroll run approvals, payments, and payslip availability.',
  },
  warehouse: {
    label: 'Warehouse & Inventory',
    description: 'Stock movements, reconciliations, and low-stock notices.',
  },
  project: {
    label: 'Projects & Operations',
    description: 'Project assignments, task updates, and completion notices.',
  },
  cash: {
    label: 'Cash & Advances',
    description: 'Expense approvals, disbursements, and advance settlements.',
  },
  general: {
    label: 'General Announcements',
    description: 'Workspace announcements and administrative notices.',
  },
}

export const notificationItemSchema = z.object({
  id: z.string().uuid(),
  recipient_profile_id: z.string().uuid(),
  title: z.string(),
  message: z.string(),
  is_read: z.boolean(),
  category: z.enum(NOTIFICATION_CATEGORIES),
  created_at: z.string(),
  action_path: z.string().nullable(),
})
export type NotificationItem = z.infer<typeof notificationItemSchema>

export const notificationPreferenceSchema = z.object({
  profile_id: z.string().uuid(),
  category: z.enum(NOTIFICATION_CATEGORIES),
  email_enabled: z.boolean(),
})
export type NotificationPreference = z.infer<typeof notificationPreferenceSchema>

export const NOTIFICATION_BELL_FILTERS = [
  'all',
  'unread',
  'urgent_unread',
  'service_urgent',
] as const
export type NotificationBellFilter = (typeof NOTIFICATION_BELL_FILTERS)[number]

export const notificationBellStateSchema = z.object({
  total_count: z.number().int().nonnegative(),
  unread_count: z.number().int().nonnegative(),
  unread_urgent_count: z.number().int().nonnegative(),
  filter: z.enum(NOTIFICATION_BELL_FILTERS),
  filtered_count: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  rows: z.array(notificationItemSchema),
})
export type NotificationBellState = z.infer<typeof notificationBellStateSchema>

const SAFE_ACTION_PATH_RE =
  /^\/[A-Za-z0-9_/-]+(\?(request|advance|review|training|day|correction|service_request|urgent|claim)=[0-9a-f-]{36})?$/i

export function isSafeNotificationPath(path: string | null | undefined): path is string {
  if (!path) return false
  if (path.includes('//') || path.includes('..')) return false
  return SAFE_ACTION_PATH_RE.test(path)
}

function getEffectiveRoles(auth: ReturnType<typeof useAuth>): readonly UserRole[] {
  const previewRole = import.meta.env.DEV ? auth.devPreviewRole : null
  return previewRole ? [previewRole] : auth.access?.roleKeys ?? []
}

export const notificationsApi = {
  async getBellState({
    filter = 'all',
    limit = 20,
    offset = 0,
  }: {
    filter?: NotificationBellFilter
    limit?: number
    offset?: number
  } = {}): Promise<NotificationBellState> {
    const response = (await getSupabaseClient().rpc('rpc_get_notification_bell_state', {
      p_filter: filter,
      p_limit: limit,
      p_offset: offset,
    })) as { data: unknown; error: unknown }

    if (response.error) {
      throw response.error instanceof Error
        ? response.error
        : new Error(
            typeof response.error === 'object' &&
              response.error !== null &&
              'message' in response.error &&
              typeof response.error.message === 'string'
              ? response.error.message
              : 'Could not load notifications.',
          )
    }
    return notificationBellStateSchema.parse(response.data)
  },

  async listNotifications(): Promise<NotificationItem[]> {
    const { data, error } = await getSupabaseClient()
      .from('notifications')
      .select('id, recipient_profile_id, title, message, is_read, category, created_at, action_path')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(50)

    if (error) throw error
    return z.array(notificationItemSchema).parse(data ?? [])
  },

  async markAsRead(notificationId: string): Promise<void> {
    const { error } = await getSupabaseClient().rpc('mark_notification_as_read', {
      p_notification_id: notificationId,
    })
    if (error) throw error
  },

  async markAllAsRead(): Promise<void> {
    const { error } = await getSupabaseClient().rpc('mark_all_notifications_as_read')
    if (error) throw error
  },

  async listPreferences(): Promise<NotificationPreference[]> {
    const { data, error } = await getSupabaseClient()
      .from('notification_preferences')
      .select('profile_id, category, email_enabled')
      .order('category')

    if (error) throw error
    return z.array(notificationPreferenceSchema).parse(data ?? [])
  },

  async setEmailPreference(category: NotificationCategory, enabled: boolean): Promise<void> {
    if (category === 'service_urgent' && !enabled) {
      throw new Error('Urgent service email notifications are mandatory and cannot be muted.')
    }
    const { error } = await getSupabaseClient().rpc('set_notification_email_preference', {
      preference_category: category,
      preference_enabled: enabled,
    })
    if (error) throw error
  },
}

export function useNotificationBellState({
  filter = 'all',
  limit = 20,
  offset = 0,
}: {
  filter?: NotificationBellFilter
  limit?: number
  offset?: number
} = {}) {
  const auth = useAuth()
  const identityScope = useProtectedIdentityScope(auth)
  const roles = getEffectiveRoles(auth)
  const isMonitorOnly = isMonitorOnlyAccount(roles)

  return useQuery({
    queryKey: [
      'notifications',
      'bell',
      { filter, limit, offset },
      identityScope.identityKey,
      identityScope.authEpoch,
    ],
    queryFn: async () => {
      const res = await notificationsApi.getBellState({ filter, limit, offset })
      const latest = identityScope.latestRef.current
      if (
        !latest.isAuthReady ||
        latest.identityKey !== identityScope.identityKey ||
        latest.authEpoch !== identityScope.authEpoch
      ) {
        throw new DOMException('Account session changed while loading notifications.', 'AbortError')
      }
      return res
    },
    enabled:
      identityScope.isAuthReady &&
      Boolean(identityScope.identityKey) &&
      !isMonitorOnly &&
      !(import.meta.env.DEV && auth.devPreviewRole),
    refetchInterval: 30_000,
    staleTime: 10_000,
  })
}

export function useNotifications() {
  const auth = useAuth()
  const identityScope = useProtectedIdentityScope(auth)
  const roles = getEffectiveRoles(auth)
  const isMonitorOnly = isMonitorOnlyAccount(roles)

  return useQuery({
    queryKey: ['notifications', 'list', identityScope.identityKey, identityScope.authEpoch],
    queryFn: () => notificationsApi.listNotifications(),
    enabled:
      identityScope.isAuthReady &&
      Boolean(identityScope.identityKey) &&
      !isMonitorOnly &&
      !(import.meta.env.DEV && auth.devPreviewRole),
    refetchInterval: 30_000,
    staleTime: 10_000,
  })
}

export function useNotificationPreferences() {
  const auth = useAuth()
  const identityScope = useProtectedIdentityScope(auth)
  const roles = getEffectiveRoles(auth)
  const isMonitorOnly = isMonitorOnlyAccount(roles)

  return useQuery({
    queryKey: ['notifications', 'preferences', identityScope.identityKey, identityScope.authEpoch],
    queryFn: () => notificationsApi.listPreferences(),
    enabled:
      identityScope.isAuthReady &&
      Boolean(identityScope.identityKey) &&
      !isMonitorOnly &&
      !(import.meta.env.DEV && auth.devPreviewRole),
    staleTime: 60_000,
  })
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient()
  const auth = useAuth()
  const identityScope = useProtectedIdentityScope(auth)

  return useMutation({
    mutationFn: async (notificationId: string) => {
      const snapshot = captureProtectedSessionSnapshot({
        identityKey: identityScope.identityKey,
        authEpoch: identityScope.authEpoch,
        isReady: identityScope.isAuthReady,
      })
      assertProtectedSessionCurrent(snapshot, identityScope.latestRef.current)
      await notificationsApi.markAsRead(notificationId)
      assertProtectedSessionCurrent(snapshot, identityScope.latestRef.current)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient()
  const auth = useAuth()
  const identityScope = useProtectedIdentityScope(auth)

  return useMutation({
    mutationFn: async () => {
      const snapshot = captureProtectedSessionSnapshot({
        identityKey: identityScope.identityKey,
        authEpoch: identityScope.authEpoch,
        isReady: identityScope.isAuthReady,
      })
      assertProtectedSessionCurrent(snapshot, identityScope.latestRef.current)
      await notificationsApi.markAllAsRead()
      assertProtectedSessionCurrent(snapshot, identityScope.latestRef.current)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

export function useSetNotificationEmailPreference() {
  const queryClient = useQueryClient()
  const auth = useAuth()
  const identityScope = useProtectedIdentityScope(auth)

  return useMutation({
    mutationFn: async ({
      category,
      enabled,
    }: {
      category: NotificationCategory
      enabled: boolean
    }) => {
      const snapshot = captureProtectedSessionSnapshot({
        identityKey: identityScope.identityKey,
        authEpoch: identityScope.authEpoch,
        isReady: identityScope.isAuthReady,
      })
      assertProtectedSessionCurrent(snapshot, identityScope.latestRef.current)
      await notificationsApi.setEmailPreference(category, enabled)
      assertProtectedSessionCurrent(snapshot, identityScope.latestRef.current)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['notifications', 'preferences'] })
    },
  })
}
