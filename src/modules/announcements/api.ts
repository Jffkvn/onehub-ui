import { z } from 'zod'
import { assertProtectedSessionCurrent, captureProtectedSessionSnapshot, type IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import { getSupabaseClient } from '@/lib/supabase/client'

const datetime = z.string().datetime({ offset: true })
const announcementSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  body: z.string(),
  is_pinned: z.boolean(),
  published_at: datetime,
  expires_at: datetime.nullable(),
  version: z.number().int().positive(),
  status: z.enum(['scheduled', 'published', 'expired']),
  read_at: datetime.nullable(),
  read_count: z.number().int().nonnegative().nullable(),
})
const pageSchema = z.object({ items: z.array(announcementSchema), has_more: z.boolean() })

export type Announcement = z.infer<typeof announcementSchema>
const announcementPageSize = 30

export function announcementListKey(scope: IdentityScopeRef, manage: boolean, page: number) {
  return ['announcements', scope.identityKey, scope.authEpoch, manage, page] as const
}

export function announcementsApi(scope: IdentityScopeRef) {
  async function rpc(name: string, args: Record<string, unknown>) {
    const snapshot = captureProtectedSessionSnapshot({
      identityKey: scope.identityKey,
      authEpoch: scope.authEpoch,
      isReady: scope.isAuthReady,
    })
    assertProtectedSessionCurrent(snapshot, scope.latestRef.current)
    const result: { data: unknown; error: { code: string } | null } = await getSupabaseClient().rpc(name, args)
    const { data, error } = result
    assertProtectedSessionCurrent(snapshot, scope.latestRef.current)
    if (error) {
      if (error.code === '40001') throw new Error('This announcement changed. Close the form and refresh before trying again.')
      if (error.code === '42501') throw new Error('You do not have access to this announcement.')
      if (error.code === '22023') throw new Error('Check the announcement text and dates.')
      throw new Error('The announcement request could not be completed.')
    }
    return data
  }

  return {
    async list(manage: boolean, page: number) {
      return pageSchema.parse(await rpc('rpc_list_announcements', {
        p_manage: manage, p_offset: page * announcementPageSize,
      }))
    },
    async markRead(announcementId: string) {
      return datetime.parse(await rpc('rpc_mark_announcement_read', { p_announcement_id: announcementId }))
    },
    async save(
      announcement: Announcement | null,
      input: { title: string; body: string; pinned: boolean; published: string | null; expires: string | null },
    ) {
      await rpc('rpc_save_announcement', {
        p_announcement_id: announcement?.id ?? null,
        p_expected_version: announcement?.version ?? null,
        p_title: input.title,
        p_body: input.body,
        p_is_pinned: input.pinned,
        p_published_at: input.published,
        p_expires_at: input.expires,
      })
    },
    async archive(announcement: Announcement) {
      await rpc('rpc_archive_announcement', {
        p_announcement_id: announcement.id, p_expected_version: announcement.version,
      })
    },
  }
}
