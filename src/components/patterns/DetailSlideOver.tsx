import React from 'react'
import { SlideOver, type SlideOverProps } from '@/components/ui/SlideOver'

export interface DetailStat {
  label: string
  value: React.ReactNode
}

export interface DetailSection {
  title: string
  content: React.ReactNode
}

export interface TimelineEvent {
  id: string
  title: string
  timestamp: string
  actor: string
  tone?: 'emerald' | 'violet' | 'blue' | 'amber' | 'rose' | 'neutral'
}

export interface DetailSlideOverProps extends Omit<SlideOverProps, 'children'> {
  idText?: string
  stats?: DetailStat[]
  sections?: DetailSection[]
  timeline?: TimelineEvent[]
  children?: React.ReactNode
}

export function DetailSlideOver({
  idText,
  title,
  statusPill,
  stats,
  sections,
  timeline,
  children,
  footer,
  ...props
}: DetailSlideOverProps) {
  return (
    <SlideOver
      subtitle={idText}
      title={title}
      statusPill={statusPill}
      footer={footer}
      {...props}
    >
      {/* Summary Stat Grid */}
      {stats && stats.length > 0 && (
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-line bg-canvas/60 p-4 dark:bg-canvas/60">
          {stats.map((stat, idx) => (
            <div key={idx}>
              <p className="font-body text-[11px] font-medium text-muted">{stat.label}</p>
              <div className="font-body text-sm font-bold text-ink tabular-nums mt-0.5">
                {stat.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Sections */}
      {sections?.map((sec, idx) => (
        <div key={idx} className="space-y-2">
          <h4 className="font-display text-xs font-bold text-muted uppercase tracking-wider">
            {sec.title}
          </h4>
          <div className="rounded-lg border border-line bg-surface p-4 text-xs text-soft dark:bg-surface">
            {sec.content}
          </div>
        </div>
      ))}

      {/* Optional Timeline */}
      {timeline && timeline.length > 0 && (
        <div className="space-y-3">
          <h4 className="font-display text-xs font-bold text-muted uppercase tracking-wider">
            Activity Timeline
          </h4>
          <div className="relative border-l-2 border-line pl-4 space-y-4">
            {timeline.map((evt) => (
              <div key={evt.id} className="relative text-xs">
                <span className="absolute -left-[21px] top-0.5 h-2.5 w-2.5 rounded-full bg-emerald ring-4 ring-surface" />
                <p className="font-semibold text-ink">{evt.title}</p>
                <p className="text-[11px] text-muted">
                  {evt.actor} · <span className="font-mono">{evt.timestamp}</span>
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {children}
    </SlideOver>
  )
}
