import { Construction } from 'lucide-react'
import { EmptyState } from '@/components/patterns/EmptyState'
import { PageHeader } from '@/components/patterns/PageHeader'
import { StatusPill } from '@/components/ui/StatusPill'

export interface PagePlaceholderProps {
  title: string
  task: string
  subtitle?: string
}

export function PagePlaceholder({
  title,
  task,
  subtitle = 'This module section is scheduled for development in an upcoming task milestone.',
}: PagePlaceholderProps) {
  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <StatusPill tone="info" size="md">
            Scheduled for {task}
          </StatusPill>
        }
      />

      <div className="flex min-h-[400px] w-full flex-col items-center justify-center rounded-xl border border-line bg-surface p-8 shadow-xs">
        <EmptyState
          icon={<Construction className="h-6 w-6 text-emerald-600" />}
          tone="emerald"
          title={`${title} Module Placeholder`}
          description={`The full feature set and data bindings for ${title} will be delivered in ${task}. All navigation links and permission gates are active.`}
        />
      </div>
    </div>
  )
}
