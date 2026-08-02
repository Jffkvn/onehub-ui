import { Outlet } from 'react-router-dom'
import { useAuth } from './AuthProvider'
import { ForbiddenPage } from './ForbiddenPage'
import { Skeleton } from '@/components/ui/Skeleton'

export interface RequirePermissionProps {
  permission?: string
  allOf?: string[]
  anyOf?: string[]
}

export function RequirePermission({
  permission,
  allOf,
  anyOf,
}: RequirePermissionProps) {
  const { status, access } = useAuth()

  if (status === 'initializing' || status === 'loading_access') {
    return (
      <div className="flex h-64 w-full items-center justify-center p-6">
        <Skeleton shape="kpi" className="max-w-sm" />
      </div>
    )
  }

  const required = allOf ?? (permission ? [permission] : [])
  const accepted = anyOf ?? []

  const allowed =
    status === 'authenticated' &&
    required.every((key) => access?.permissionKeys.includes(key)) &&
    (!accepted.length || accepted.some((key) => access?.permissionKeys.includes(key)))

  return allowed ? <Outlet /> : <ForbiddenPage />
}
