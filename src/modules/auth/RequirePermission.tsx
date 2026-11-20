import { Outlet } from 'react-router-dom'
import type { UserRole } from '@/config/modules'
import { isMonitorOnlyAccount } from '@/config/navigation'
import { useAuth } from './AuthProvider'
import { ForbiddenPage } from './ForbiddenPage'
import { MOCK_ROLE_PERMISSIONS } from '@/components/patterns/DevRoleSwitcher'
import { Skeleton } from '@/components/ui/Skeleton'

export interface RequirePermissionProps {
  permission?: string
  allOf?: string[]
  anyOf?: string[]
  allowedRoles?: readonly UserRole[]
  disallowMonitorOnly?: boolean
}

export function RequirePermission({
  permission,
  allOf,
  anyOf,
  allowedRoles,
  disallowMonitorOnly = false,
}: RequirePermissionProps) {
  const { status, access, devPreviewRole } = useAuth()

  if (status === 'initializing' || status === 'loading_access') {
    return (
      <div className="flex h-64 w-full items-center justify-center p-6">
        <Skeleton shape="kpi" className="max-w-sm" />
      </div>
    )
  }

  const previewRole = import.meta.env.DEV ? devPreviewRole : null
  const activeRoles: readonly UserRole[] = previewRole ? [previewRole] : access?.roleKeys ?? []
  const activePermissions: readonly string[] = previewRole
    ? MOCK_ROLE_PERMISSIONS[previewRole]
    : access?.permissionKeys ?? []

  const required = allOf ?? (permission ? [permission] : [])
  const accepted = anyOf ?? []

  const allowed =
    status === 'authenticated' &&
    (!disallowMonitorOnly || !isMonitorOnlyAccount(activeRoles)) &&
    (!allowedRoles?.length || allowedRoles.some((role) => activeRoles.includes(role))) &&
    required.every((key) => activePermissions.includes(key)) &&
    (!accepted.length || accepted.some((key) => activePermissions.includes(key)))

  return allowed ? <Outlet /> : <ForbiddenPage />
}
