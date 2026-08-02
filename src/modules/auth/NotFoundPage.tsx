import { HelpCircle } from 'lucide-react'
import { EmptyState } from '@/components/patterns/EmptyState'
import { Button } from '@/components/ui/Button'
import { useNavigate } from 'react-router-dom'

export function NotFoundPage() {
  const navigate = useNavigate()

  return (
    <div className="flex min-h-[60vh] w-full flex-col items-center justify-center p-6 text-center">
      <EmptyState
        icon={<HelpCircle className="h-6 w-6 text-amber" />}
        tone="amber"
        title="404 — Page Not Found"
        description="The path you requested does not exist or has been moved. Check the URL or navigate to a registered workspace section."
        action={
          <Button variant="primary" size="md" onClick={() => { void navigate('/dashboard') }}>
            Return to Dashboard
          </Button>
        }
      />
    </div>
  )
}
