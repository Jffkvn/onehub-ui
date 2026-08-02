import React from 'react'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from './EmptyState'
import { cn } from '@/lib/utils'

export interface ColumnDef<T> {
  key: string
  header: React.ReactNode
  accessor?: (row: T) => React.ReactNode
  align?: 'left' | 'center' | 'right'
  width?: string
}

export interface DataTableProps<T> {
  columns: ColumnDef<T>[]
  data: T[]
  keyExtractor: (row: T) => string
  totalsRow?: Record<string, React.ReactNode>
  loading?: boolean
  emptyTitle?: string
  emptyDescription?: string
  onRowClick?: (row: T) => void
  className?: string
}

export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  totalsRow,
  loading = false,
  emptyTitle = 'No data available',
  emptyDescription = 'There are no records to display.',
  onRowClick,
  className,
}: DataTableProps<T>) {
  if (loading) {
    return (
      <div className="w-full overflow-hidden rounded-lg border border-line bg-surface shadow-xs">
        <div className="h-10 border-b border-line bg-canvas/60 px-4 flex items-center gap-4">
          {columns.map((col) => (
            <Skeleton key={col.key} className="h-4 w-20" />
          ))}
        </div>
        {Array.from({ length: 5 }).map((_, idx) => (
          <Skeleton key={idx} shape="row" />
        ))}
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-line bg-surface p-8 text-center shadow-xs">
        <EmptyState title={emptyTitle} description={emptyDescription} />
      </div>
    )
  }

  return (
    <div
      className={cn(
        'w-full overflow-x-auto rounded-lg border border-line bg-surface shadow-xs',
        className,
      )}
    >
      <table className="w-full text-left text-xs border-collapse">
        {/* Sticky Header */}
        <thead className="sticky top-0 z-10 bg-canvas/80 font-body font-semibold uppercase tracking-wider text-muted backdrop-blur-xs border-b border-line">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                style={{ width: col.width }}
                className={cn(
                  'px-4 py-3 font-semibold text-soft',
                  col.align === 'right' && 'text-right',
                  col.align === 'center' && 'text-center',
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>

        {/* Dense Rows */}
        <tbody className="divide-y divide-line font-body text-ink">
          {data.map((row) => {
            const key = keyExtractor(row)
            return (
              <tr
                key={key}
                onClick={() => onRowClick?.(row)}
                className={cn(
                  'transition-colors hover:bg-line/20',
                  onRowClick && 'cursor-pointer',
                )}
              >
                {columns.map((col) => {
                  const val = col.accessor
                    ? col.accessor(row)
                    : (row as Record<string, unknown>)[col.key]

                  return (
                    <td
                      key={col.key}
                      className={cn(
                        'px-4 py-2.5 text-xs text-soft',
                        col.align === 'right' && 'text-right tabular-nums font-mono',
                        col.align === 'center' && 'text-center',
                      )}
                    >
                      {val as React.ReactNode}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>

        {/* Optional Totals Footer */}
        {totalsRow && (
          <tfoot className="border-t-2 border-line bg-canvas/60 font-body font-bold text-ink">
            <tr>
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    'px-4 py-3 text-xs',
                    col.align === 'right' && 'text-right tabular-nums font-mono',
                    col.align === 'center' && 'text-center',
                  )}
                >
                  {totalsRow[col.key] ?? null}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
