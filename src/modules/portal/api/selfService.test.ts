import { afterEach, describe, expect, it, vi } from 'vitest'
import * as supabaseClientModule from '@/lib/supabase/client'
import { selfServiceApi } from './selfService'

describe('selfServiceApi', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('queries linked employee via profile_id without touching confidential tables and reads own pay grade via RPC', async () => {
    const eqSpy = vi.fn().mockReturnValue({
      is: () => ({
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: 'emp-1',
            employee_number: 'EMP-QA-01',
            legal_name: 'Employee One',
            company_email: 'emp1@egypro.test',
            personal_email: null,
            work_phone: '+256700000001',
            archived_at: null,
            employment_periods: [
              {
                start_date: '2026-01-01',
                end_date: null,
                employment_type: 'full_time',
                contract_type: 'permanent',
                probation_end_date: null,
                probation_status: 'passed',
                departments: { name: 'Operations' },
                job_titles: { name: 'Field Engineer' },
              },
            ],
          },
          error: null,
        }),
      }),
    })
    const selectSpy = vi.fn().mockReturnValue({ eq: eqSpy })
    const fromSpy = vi.fn().mockReturnValue({ select: selectSpy })
    const rpcSpy = vi.fn().mockResolvedValue({ data: 'Grade 1', error: null })

    vi.spyOn(supabaseClientModule, 'getSupabaseClient').mockReturnValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { user: { id: 'auth-user-1' } } },
          error: null,
        }),
      },
      from: fromSpy,
      rpc: rpcSpy,
    } as never)

    const profile = await selfServiceApi.getProfile()

    expect(fromSpy).toHaveBeenCalledWith('employees')
    expect(selectSpy.mock.calls[0]?.[0]).not.toContain('employee_confidential_profiles')
    expect(eqSpy).toHaveBeenCalledWith('profile_id', 'auth-user-1')
    expect(rpcSpy).toHaveBeenCalledWith('get_my_pay_grade_name')
    expect(profile).toMatchObject({
      id: 'emp-1',
      employeeNumber: 'EMP-QA-01',
      payGradeName: 'Grade 1',
      departmentName: 'Operations',
      jobTitleName: 'Field Engineer',
    })
  })
})
