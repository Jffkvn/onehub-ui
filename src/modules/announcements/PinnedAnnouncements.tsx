import { useQuery } from '@tanstack/react-query'
import { Pin } from 'lucide-react'
import { Link } from 'react-router-dom'

import { type IdentityScopeRef, useProtectedIdentityScope } from '@/lib/idempotency/pendingOperations'
import { useAuth } from '@/modules/auth/AuthProvider'
import { announcementListKey, announcementsApi } from './api'

function PinnedList({ scope }: { scope: IdentityScopeRef }) {
  const notices = useQuery({
    queryKey: announcementListKey(scope, false, 0),
    queryFn: () => announcementsApi(scope).list(false, 0),
    retry: false,
    refetchInterval: 60_000,
  })
  const pinned = notices.isError ? [] : (notices.data?.items ?? []).filter((item) => item.is_pinned).slice(0, 3)
  if (pinned.length === 0) return null
  return (
    <section className="space-y-2 rounded-lg border border-line bg-surface px-4 py-3" aria-label="Pinned announcements">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Pin size={16} className="text-amber" aria-hidden="true" />
          Pinned announcements
        </h2>
        <Link to="/my/announcements" className="rounded-md text-xs font-semibold text-emerald-600 underline-offset-4 hover:underline focus-visible:outline-emerald">
          All announcements
        </Link>
      </div>
      <ul className="space-y-1">
        {pinned.map(({ id, title }) => <li key={id} className="break-words text-sm text-soft">{title}</li>)}
      </ul>
    </section>
  )
}

export function PinnedAnnouncements() {
  const auth = useAuth()
  const scope = useProtectedIdentityScope(auth)
  if (!scope.isAuthReady || !auth.access?.permissionKeys.includes('announcements.read')) return null
  return <PinnedList key={`${scope.identityKey}:${scope.authEpoch}`} scope={scope} />
}
