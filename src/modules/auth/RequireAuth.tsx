import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './AuthProvider'
import { Skeleton } from '@/components/ui/Skeleton'

export function RequireAuth() {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'initializing' || status === 'loading_access') {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center bg-canvas p-6 space-y-4">
        <Skeleton shape="circle" className="h-12 w-12 border-2 border-emerald" />
        <p className="font-body text-xs font-semibold text-soft animate-pulse">
          Verifying security &amp; access context…
        </p>
      </div>
    )
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (status === 'mfa_enrollment_required') {
    return <Navigate to="/mfa/enroll" replace />
  }

  if (status === 'mfa_challenge_required') {
    return <Navigate to="/mfa/challenge" replace />
  }

  if (status === 'access_denied' || status === 'error') {
    return <Navigate to="/forbidden" replace />
  }

  return <Outlet />
}
