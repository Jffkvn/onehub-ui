import { describe, expect, it } from 'vitest'
import { closureStats, pendingEquipmentRequests, fallsOnDay, lateReturn, runningLow } from './workDashboardData'

describe('work dashboard counts', () => {
  it('uses provider receipt to confirmation and keeps missing deadlines out of on-time totals', () => {
    const record = {
      provider_received_at: '2026-11-24T09:00:00+03:00',
      provider_confirmed_at: '2026-11-24T13:00:00+03:00',
      provider_deadline_at: '2026-11-24T14:00:00+03:00',
    }
    expect(closureStats([
      record,
      { ...record, provider_confirmed_at: '2026-11-24T15:00:00+03:00' },
      { ...record, provider_deadline_at: null },
      { ...record, provider_confirmed_at: null },
      { ...record, provider_confirmed_at: '2026-11-24T07:00:00+03:00' },
    ])).toEqual({ hours: 14 / 3, timed: 3, onTime: 1, withDeadline: 2 })
  })

  it('does not double-count equipment requests already handed to a stock queue', () => {
    expect(pendingEquipmentRequests([
      { id: 'one', stock_request_id: 'stock', status: 'awaiting_approval' },
      { id: 'two', stock_request_id: null, status: 'pending' },
      { id: 'three', stock_request_id: null, status: 'fulfilled' },
      { id: 'four', stock_request_id: null, status: 'needs_information' },
    ]).map(({ id }) => id)).toEqual(['two', 'four'])
  })

  it('compares against Kampala dates, return due dates, and item reorder levels', () => {
    expect(fallsOnDay('2026-11-24T22:00:00Z', '2026-11-25')).toBe(true)
    expect(fallsOnDay(null, '2026-11-25')).toBe(false)
    expect(lateReturn('2026-11-25', '2026-11-25')).toBe(false)
    expect(lateReturn('2026-11-24', '2026-11-25')).toBe(true)
    expect(runningLow({ balance: 3, reorder_level: 2 })).toBe(false)
    expect(runningLow({ balance: 2, reorder_level: 2 })).toBe(true)
  })
})
