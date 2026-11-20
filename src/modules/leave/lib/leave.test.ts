import { describe, expect, it } from 'vitest'
import { allocateByYear, formatLeaveDuration, leaveDraftSchema, leaveEligibility } from './leave'

const base = {
  employeeId: '86000000-0000-4000-8000-000000000001',
  leaveTypeId: '86000000-0000-4000-8000-000000000002',
  startDate: '2026-12-31',
  endDate: '2027-01-04',
  portion: 'full',
  reason: 'Family break',
  leavingTime: '',
}
describe('leave rules adapted from the HR donor', () => {
  it('permits a cross-year full request but never a multi-day half or exact request', () => {
    expect(leaveDraftSchema.safeParse(base).success).toBe(true)
    for (const portion of ['morning', 'afternoon', 'exact']) {
      expect(leaveDraftSchema.safeParse({ ...base, portion }).success).toBe(false)
    }
  })
  it('rejects impossible dates, reversed ranges and exact leave without a time', () => {
    for (
      const values of [{ startDate: '2026-02-30' }, { endDate: '2026-01-01' }, {
        portion: 'exact',
        endDate: base.startDate,
      }]
    ) expect(leaveDraftSchema.safeParse({ ...base, ...values }).success).toBe(false)
  })
  it('keeps unknown gender eligible with guidance and only restricts the mismatched statutory type', () => {
    expect(leaveEligibility('maternity', 'male').allowed).toBe(false)
    expect(leaveEligibility('paternity', 'female').allowed).toBe(false)
    expect(leaveEligibility('annual', 'male').allowed).toBe(true)
    expect(leaveEligibility('maternity', null).allowed).toBe(true)
    expect(typeof leaveEligibility('maternity', null).guidance).toBe('string')
  })
  it('shows partial and exact durations without rounding them to whole days', () => {
    expect(formatLeaveDuration(0.5, 'morning', null)).toContain('Morning')
    expect(formatLeaveDuration(0.25, 'exact', 120)).toContain('120 min')
  })
  it('partitions supplied server allocations rather than attributing all days to the start year', () => {
    expect(
      allocateByYear([{ leave_date: '2026-12-31', days: 1 }, {
        leave_date: '2027-01-04',
        days: 0.5,
      }]),
    ).toEqual([{ year: 2026, days: 1 }, { year: 2027, days: 0.5 }])
  })
})
