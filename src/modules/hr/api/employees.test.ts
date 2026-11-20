import { afterEach, describe, expect, it, vi } from 'vitest'
import * as supabaseClientModule from '@/lib/supabase/client'
import { employeeApi, toEmployeeRpcPayload } from './employees'
import type { EmployeeFormValues } from '../schemas/employee'

describe('HR Employee API Contract & RPC Payload Mapping', () => {
  it('CRITICAL: toEmployeeRpcPayload produces identical snake_case keys expected by Supabase RPC', () => {
    const formValues: EmployeeFormValues = {
      fullName: 'Kato Mukasa',
      employeeNumber: 'EMP-001',
      nationalId: 'CM90012345678',
      companyEmail: 'kato.mukasa@egypro.com',
      personalEmail: 'kato@gmail.com',
      phone: '+256770001122',
      gender: 'male',
      dateOfBirth: '1990-05-15',
      departmentId: 'dept_123',
      jobTitleId: 'title_456',
      payGradeId: 'grade_789',
      employmentType: 'full_time',
      startDate: '2026-01-01',
      contractType: 'permanent',
      contractEndDate: '',
      probationEndDate: '2026-06-30',
      probationStatus: 'passed',
      grossSalary: '5000000',
      currency: 'UGX',
      customOvertimeRate: '',
      paymentMethod: 'bank',
      bankName: 'Stanbic Bank',
      accountNumber: '9030001234567',
      sortCode: '0401',
      mobileMoneyNumber: '',
      tinNumber: '1001234567',
      nssfNumber: 'NS10002000',
      employeeTaxType: 'local',
      pctMonthWorked: '100',
      whtRate: '6',
    }

    const payload = toEmployeeRpcPayload(formValues)

    expect(payload).toEqual({
      employee_data: {
        employee_number: 'EMP-001',
        legal_name: 'Kato Mukasa',
        national_id: 'CM90012345678',
        company_email: 'kato.mukasa@egypro.com',
        personal_email: 'kato@gmail.com',
        work_phone: '+256770001122',
        gender: 'male',
        date_of_birth: '1990-05-15',
        gross_salary: '5000000',
        currency_code: 'UGX',
        custom_overtime_rate: null,
        payment_method: 'bank',
        mobile_money_number: null,
        bank_name: 'Stanbic Bank',
        account_number: '9030001234567',
        sort_code: '0401',
        tin_number: '1001234567',
        nssf_number: 'NS10002000',
        employee_tax_type: 'local',
        pct_month_worked: '100',
        wht_rate: '6',
      },
      period_data: {
        start_date: '2026-01-01',
        end_date: null,
        department_id: 'dept_123',
        job_title_id: 'title_456',
        pay_grade_id: 'grade_789',
        employment_type: 'full_time',
        contract_type: 'permanent',
        probation_end_date: '2026-06-30',
        probation_status: 'passed',
      },
    })
  })
})

describe('employeeApi RPC & query contract', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const sampleEmployeeRow = {
    id: 'emp-1',
    employee_number: 'EMP-001',
    legal_name: 'Kato Mukasa',
    company_email: 'kato@egypro.com',
    personal_email: 'kato@gmail.com',
    work_phone: '+256770001122',
    gender: 'male',
    date_of_birth: '1990-05-15',
    archived_at: null,
    employee_confidential_profiles: {
      national_id: 'CM90012345678',
      gross_salary: 5000000,
      payment_method: 'bank',
      bank_name: 'Stanbic Bank',
      account_number: '9030001234567',
      sort_code: '0401',
      tin_number: '1001234567',
      nssf_number: 'NS10002000',
      employee_tax_type: 'local',
      pct_month_worked: 100,
      wht_rate: 6,
    },
    employment_periods: [
      {
        start_date: '2026-01-01',
        end_date: null,
        department_id: 'dept_123',
        job_title_id: 'title_456',
        pay_grade_id: 'grade_789',
        employment_type: 'full_time',
        contract_type: 'permanent',
        probation_end_date: '2026-06-30',
        probation_status: 'passed',
        departments: { name: 'Engineering' },
        job_titles: { name: 'Field Engineer' },
        pay_grades: { name: 'Grade 1' },
      },
    ],
  }

  const formValues: EmployeeFormValues = {
    fullName: 'Kato Mukasa',
    employeeNumber: 'EMP-001',
    nationalId: 'CM90012345678',
    companyEmail: 'kato@egypro.com',
    personalEmail: 'kato@gmail.com',
    phone: '+256770001122',
    gender: 'male',
    dateOfBirth: '1990-05-15',
    departmentId: 'dept_123',
    jobTitleId: 'title_456',
    payGradeId: 'grade_789',
    employmentType: 'full_time',
    startDate: '2026-01-01',
    contractType: 'permanent',
    contractEndDate: '',
    probationEndDate: '2026-06-30',
    probationStatus: 'passed',
    grossSalary: '5000000',
    currency: 'UGX',
    customOvertimeRate: '',
    paymentMethod: 'bank',
    bankName: 'Stanbic Bank',
    accountNumber: '9030001234567',
    sortCode: '0401',
    mobileMoneyNumber: '',
    tinNumber: '1001234567',
    nssfNumber: 'NS10002000',
    employeeTaxType: 'local',
    pctMonthWorked: '100',
    whtRate: '6',
  }

  function mockSupabaseClient() {
    const rpcSpy = vi.fn().mockImplementation((name: string) => {
      if (name === 'create_employee_with_period') {
        return Promise.resolve({ data: 'emp-1', error: null })
      }
      return Promise.resolve({ data: null, error: null })
    })

    const singleSpy = vi.fn().mockResolvedValue({ data: sampleEmployeeRow, error: null })
    const orderListSpy = vi.fn().mockResolvedValue({ data: [sampleEmployeeRow], error: null })
    const orderSetupSpy = vi.fn().mockResolvedValue({ data: [], error: null })

    const fromSpy = vi.fn().mockImplementation((table: string) => {
      if (table === 'employees') {
        return {
          select: () => ({
            is: () => ({ order: orderListSpy }),
            eq: () => ({ single: singleSpy }),
          }),
        }
      }
      return {
        select: () => ({
          is: () => ({ order: orderSetupSpy }),
        }),
      }
    })

    vi.spyOn(supabaseClientModule, 'getSupabaseClient').mockReturnValue({
      from: fromSpy,
      rpc: rpcSpy,
    } as never)

    return { rpcSpy, fromSpy, singleSpy, orderListSpy }
  }

  it('calls exact Supabase RPCs and arg keys for list, get, setup, create, update, archive, and offboard', async () => {
    const { rpcSpy } = mockSupabaseClient()

    const list = await employeeApi.list()
    expect(list).toHaveLength(1)
    expect(list[0].payGradeName).toBe('Grade 1')

    const detail = await employeeApi.get('emp-1')
    expect(detail.id).toBe('emp-1')

    const setup = await employeeApi.setup()
    expect(setup).toEqual({ departments: [], jobTitles: [], payGrades: [] })

    await employeeApi.create(formValues)
    expect(rpcSpy).toHaveBeenCalledWith(
      'create_employee_with_period',
      toEmployeeRpcPayload(formValues),
    )

    await employeeApi.update('emp-1', formValues)
    expect(rpcSpy).toHaveBeenCalledWith('update_employee_profile', {
      target_employee_id: 'emp-1',
      ...toEmployeeRpcPayload(formValues),
    })

    await employeeApi.archive('emp-1', 'Duplicate record')
    expect(rpcSpy).toHaveBeenCalledWith('archive_employee', {
      target_employee_id: 'emp-1',
      reason: 'Duplicate record',
    })

    await employeeApi.offboard('emp-1', {
      endDate: '2026-12-15',
      exitReason: 'End of contract',
      exitNotes: '',
      finalPayStatus: 'pending',
    })
    expect(rpcSpy).toHaveBeenCalledWith('offboard_employee', {
      target_employee_id: 'emp-1',
      last_working_day: '2026-12-15',
      reason: 'End of contract',
      notes: null,
      pay_status: 'pending',
    })
  })
})
