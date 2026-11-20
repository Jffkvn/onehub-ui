import { describe, expect, it } from 'vitest'
import { payload, mapPayrollRun } from './payroll'
import type { PayrollDraftItem } from '@/_contract/types/payroll.types'

describe('Payroll API Contract & Mapping', () => {
  it('CRITICAL: item_payload maps camelCase to exact snake_case RPC format', () => {
    const draftItems: PayrollDraftItem[] = [
      {
        employeeId: 'emp_001',
        percentOfMonthWorked: 100,
        overtimeHours: 5,
        lineItems: [
          { kind: 'allowance', code: 'HOUSING', description: 'Housing allowance', amount: 500000 },
          { kind: 'salary_advance', code: 'STAFF_ADVANCE', description: 'Auto advance deduction', amount: 100000 },
          { kind: 'deductions' as never, code: 'UNPAID_LEAVE', description: 'Unpaid Leave', amount: 100000 },
        ],
      },
    ]

    const mapped = payload(draftItems)
    expect(mapped).toEqual([
      {
        employee_id: 'emp_001',
        percent_of_month_worked: 100,
        overtime_hours: 5,
        line_items: [
          { kind: 'allowance', code: 'HOUSING', description: 'Housing allowance', amount: 500000 },
          { kind: 'deductions', code: 'UNPAID_LEAVE', description: 'Unpaid Leave', amount: 100000 },
        ],
      },
    ])
  })

  it('correctly maps raw Supabase database row to PayrollRun object', () => {
    const rawRow = {
      id: 'run_123',
      period_id: 'period_456',
      run_number: 1,
      run_type: 'regular',
      source_run_id: null,
      status: 'approved',
      reason: 'Monthly payroll',
      total_gross: 10000000,
      total_paye: 1000000,
      total_nssf_employee: 500000,
      total_nssf_employer: 1000000,
      total_wht: 0,
      total_deductions: 1500000,
      total_net: 8500000,
      approved_at: '2026-07-30T12:00:00Z',
      payroll_periods: {
        period_start: '2026-07-01',
        period_end: '2026-07-31',
        label: 'July 2026',
      },
      payroll_items: [
        {
          id: 'item_1',
          employee_id: 'emp_1',
          employee_number: 'EMP001',
          employee_name: 'Kato Mukasa',
          tax_treatment: 'local',
          nssf_applicable: true,
          percent_of_month_worked: 100,
          contractual_gross: 10000000,
          prorated_gross: 10000000,
          overtime_hours: 0,
          overtime_rate: 0,
          overtime_pay: 0,
          allowances: 0,
          taxable_gross: 10000000,
          paye: 1000000,
          nssf_employee: 500000,
          nssf_employer: 1000000,
          wht: 0,
          salary_advance_deduction: 0,
          other_deductions: 0,
          total_deductions: 1500000,
          net_pay: 8500000,
          tin_number: '1234567890',
          nssf_number: 'NS123456',
          payment_method: 'bank',
          bankName: 'Centenary Bank',
          accountNumber: '12345678',
          sortCode: '0101',
          mobileMoneyNumber: null,
          payroll_line_items: [],
        },
      ],
      payroll_payments: [
        {
          id: 'pay_1',
          paid_on: '2026-07-30',
          amount: 8500000,
          payment_reference: 'STAN-PAY-001',
          payment_method: 'bank',
          proof_path: null,
          notes: 'Bank transfer completed',
          recorded_at: '2026-07-30T14:00:00Z',
        },
      ],
    }

    const mapped = mapPayrollRun(rawRow)
    expect(mapped.id).toBe('run_123')
    expect(mapped.periodLabel).toBe('July 2026')
    expect(mapped.items.length).toBe(1)
    expect(mapped.items[0].employeeName).toBe('Kato Mukasa')
    expect(mapped.payment?.reference).toBe('STAN-PAY-001')
  })

  it('DEF-11: normalizes PostgREST 1:1 object and null payroll_payments relations', () => {
    const baseRow = {
      id: 'run_456',
      period_id: 'period_789',
      run_number: 1,
      run_type: 'regular',
      source_run_id: null,
      status: 'approved',
      reason: 'Dec payroll',
      total_gross: 1500000,
      total_paye: 352000,
      total_nssf_employee: 75000,
      total_nssf_employer: 150000,
      total_wht: 0,
      total_deductions: 527000,
      total_net: 973000,
      approved_at: '2026-12-20T10:00:00Z',
      payroll_periods: {
        period_start: '2026-12-01',
        period_end: '2026-12-31',
        label: 'December 2026',
      },
      payroll_items: [],
    }

    const withObjectPayment = mapPayrollRun({
      ...baseRow,
      payroll_payments: {
        id: 'pay_obj_1',
        paid_on: '2026-12-21',
        amount: 973000,
        payment_reference: 'QA-SIM-PAY-202612',
        payment_method: 'bank',
        proof_path: null,
        notes: null,
        recorded_at: '2026-12-21T08:00:00Z',
      },
    })
    expect(withObjectPayment.payment?.reference).toBe('QA-SIM-PAY-202612')

    const withNullPayment = mapPayrollRun({
      ...baseRow,
      payroll_payments: null,
    })
    expect(withNullPayment.payment).toBeNull()
  })
})
