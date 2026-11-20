import { afterEach, describe, expect, it, vi } from 'vitest'
import * as supabaseClientModule from '@/lib/supabase/client'
import { hrSetupApi } from './setup'

describe('hrSetupApi RPC contract', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('invokes exact RPC names and parameter keys for list, save, and archive', async () => {
    const rpcSpy = vi.fn().mockImplementation((fn: string) => {
      if (fn === 'hr_list_setup_records') {
        return Promise.resolve({
          data: {
            departments: [
              {
                id: '11111111-1111-4111-8111-111111111111',
                code: 'OPS',
                name: 'Operations',
                description: 'Field team',
                archived_at: null,
                current_employee_count: 3,
                active_job_title_count: 1,
              },
            ],
            job_titles: [],
            pay_grades: [],
          },
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: null })
    })

    vi.spyOn(supabaseClientModule, 'getSupabaseClient').mockReturnValue({
      rpc: rpcSpy,
    } as never)

    const records = await hrSetupApi.list()
    expect(rpcSpy).toHaveBeenCalledWith('hr_list_setup_records', undefined)
    expect(records.departments[0].currentEmployeeCount).toBe(3)

    await hrSetupApi.saveDepartment({
      id: null,
      code: 'fin',
      name: 'Finance',
      description: 'Accounts',
      reason: 'Create finance department',
    })
    expect(rpcSpy).toHaveBeenCalledWith('hr_save_department', {
      target_id: null,
      setup_code: 'FIN',
      setup_name: 'Finance',
      setup_description: 'Accounts',
      change_reason: 'Create finance department',
    })

    await hrSetupApi.saveJobTitle({
      id: null,
      departmentId: '11111111-1111-4111-8111-111111111111',
      code: 'tech',
      name: 'Technician',
      description: '',
      reason: 'Add role',
    })
    expect(rpcSpy).toHaveBeenCalledWith('hr_save_job_title', {
      target_id: null,
      target_department_id: '11111111-1111-4111-8111-111111111111',
      setup_code: 'TECH',
      setup_name: 'Technician',
      setup_description: '',
      change_reason: 'Add role',
    })

    await hrSetupApi.savePayGrade({
      id: null,
      code: 'g1',
      name: 'Grade 1',
      currencyCode: 'ugx',
      minimumGross: '1000000',
      maximumGross: '2000000',
      description: '',
      reason: 'Create grade 1',
    })
    expect(rpcSpy).toHaveBeenCalledWith('hr_save_pay_grade', {
      target_id: null,
      setup_code: 'G1',
      setup_name: 'Grade 1',
      setup_currency_code: 'UGX',
      minimum_gross: 1000000,
      maximum_gross: 2000000,
      setup_description: '',
      change_reason: 'Create grade 1',
    })

    await hrSetupApi.setArchived({
      kind: 'department',
      id: '11111111-1111-4111-8111-111111111111',
      archived: true,
      reason: 'Retire temporary team',
    })
    expect(rpcSpy).toHaveBeenCalledWith('hr_set_setup_archived', {
      setup_kind: 'department',
      target_id: '11111111-1111-4111-8111-111111111111',
      archived: true,
      change_reason: 'Retire temporary team',
    })
  })

  it('masks non-allowlisted raw database errors while preserving domain messages', async () => {
    const rpcSpy = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'department code or name already exists' },
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'relation "internal_secret" violates check constraint' },
      })

    vi.spyOn(supabaseClientModule, 'getSupabaseClient').mockReturnValue({
      rpc: rpcSpy,
    } as never)

    await expect(
      hrSetupApi.saveDepartment({
        id: null,
        code: 'OPS',
        name: 'Operations',
        description: '',
        reason: 'Duplicate test',
      }),
    ).rejects.toThrow('department code or name already exists')

    await expect(
      hrSetupApi.saveDepartment({
        id: null,
        code: 'OPS',
        name: 'Operations',
        description: '',
        reason: 'Raw error test',
      }),
    ).rejects.toThrow('HR setup request could not be completed.')
  })
})
