import { describe, expect, it } from 'vitest'
import { employeeFormSchema, offboardingSchema } from './employee'

const validBase = {
  fullName: 'Kato Mukasa',
  nationalId: '',
  companyEmail: '',
  personalEmail: '',
  phone: '',
  gender: '' as const,
  dateOfBirth: '',
  departmentId: '',
  jobTitleId: '',
  payGradeId: '',
  employmentType: 'full_time' as const,
  startDate: '2026-11-16',
  contractType: 'permanent' as const,
  contractEndDate: '',
  probationEndDate: '',
  probationStatus: 'not_applicable' as const,
  grossSalary: '1500000',
  currency: 'UGX' as const,
  customOvertimeRate: '',
  paymentMethod: 'cash' as const,
  mobileMoneyNumber: '',
  bankName: '',
  accountNumber: '',
  sortCode: '',
  employeeNumber: 'EMP-100',
  tinNumber: '',
  nssfNumber: '',
  employeeTaxType: 'local' as const,
  pctMonthWorked: '100',
  whtRate: '6',
}

describe('HR Employee Zod 3 Schemas', () => {
  it('accepts valid ISO calendar dates and optional blank dates', () => {
    expect(employeeFormSchema.safeParse(validBase).success).toBe(true)
    expect(
      employeeFormSchema.safeParse({
        ...validBase,
        dateOfBirth: '1992-02-29',
        probationEndDate: '2027-02-15',
      }).success,
    ).toBe(true)
  })

  it('rejects impossible or malformed ISO dates on startDate, optional dates, and offboarding', () => {
    expect(
      employeeFormSchema.safeParse({ ...validBase, startDate: '2026-02-30' }).success,
    ).toBe(false)
    expect(
      employeeFormSchema.safeParse({ ...validBase, dateOfBirth: '16/11/1992' }).success,
    ).toBe(false)
    expect(
      offboardingSchema.safeParse({
        endDate: '2026-13-01',
        exitReason: 'Resigned',
        exitNotes: '',
        finalPayStatus: 'pending',
      }).success,
    ).toBe(false)
    expect(
      offboardingSchema.safeParse({
        endDate: '2026-11-30',
        exitReason: 'Resigned',
        exitNotes: '',
        finalPayStatus: 'pending',
      }).success,
    ).toBe(true)
  })

  it('enforces conditional fixed-term, bank, and mobile-money rules', () => {
    expect(
      employeeFormSchema.safeParse({ ...validBase, contractType: 'fixed_term', contractEndDate: '' })
        .success,
    ).toBe(false)
    expect(
      employeeFormSchema.safeParse({ ...validBase, paymentMethod: 'bank', bankName: '', accountNumber: '' })
        .success,
    ).toBe(false)
    expect(
      employeeFormSchema.safeParse({ ...validBase, paymentMethod: 'mobile_money', mobileMoneyNumber: '' })
        .success,
    ).toBe(false)
  })
})
