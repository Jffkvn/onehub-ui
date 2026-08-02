import { ShieldX } from 'lucide-react'
import { EmptyState } from '@/components/patterns/EmptyState'
import { Button } from '@/components/ui/Button'
import { useNavigate } from 'react-router-dom'

export function ForbiddenPage() {
  const navigate = useNavigate()

  return (
    <div className="flex min-h-[60vh] w-full flex-col items-center justify-center p-6 text-center">
      <EmptyState
        icon={<ShieldX className="h-6 w-6 text-rose" />}
        tone="rose"
        title="403 — Permission Denied"
        description="Your account is active, but you do not have permission to access this module or route. Contact HR or your OneHub administrator to request access."
        action={
          <div className="flex items-center justify-center gap-3">
            <Button variant="primary" size="md" onClick={() => { void navigate('/dashboard') }}>
              Return to Dashboard
            </Button>
            <Button variant="outline" size="md" onClick={() => { void navigate('/my') }}>
              My Workspace
            </Button>
          </div>
        }
      />
    </div>
  )
}
