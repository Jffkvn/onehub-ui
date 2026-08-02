import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase/client'
import type {
  PayrollDraftItem,
  PayrollEmployee,
  PayrollItem,
  PayrollLineItem,
  PayrollPayment,
  PayrollRun,
} from '@/_contract/types/payroll.types'

type Row = Record<string, unknown>
const number = (value: unknown) => Number(value ?? 0)
const text = (value: unknown) => (typeof value === 'string' ? value : null)

const itemSelection =
  'id,employee_id,employee_number,employee_name,tax_treatment,nssf_applicable,percent_of_month_worked,contractual_gross,prorated_gross,overtime_hours,overtime_rate,overtime_pay,allowances,taxable_gross,paye,nssf_employee,nssf_employer,wht,salary_advance_deduction,other_deductions,total_deductions,net_pay,tin_number,nssf_number,payment_method,bank_name,account_number,sort_code,mobile_money_number,payroll_line_items(id,kind,code,description,amount)'

const runSelection = `id,period_id,run_number,run_type,source_run_id,status,reason,total_gross,total_paye,total_nssf_employee,total_nssf_employer,total_wht,total_deductions,total_net,approved_at,payroll_periods(period_start,period_end,label),payroll_items(${itemSelection}),payroll_payments(id,paid_on,amount,payment_reference,payment_method,proof_path,notes,recorded_at)`

export const payrollRunListSelection =
  'id,period_id,run_number,run_type,source_run_id,status,reason,total_gross,total_paye,total_nssf_employee,total_nssf_employer,total_wht,total_deductions,total_net,approved_at,payroll_periods(period_start,period_end,label),payroll_payments(id,paid_on,amount,payment_reference,payment_method,proof_path,notes,recorded_at)'

function mapLine(row: Row): PayrollLineItem {
  return {
    id: String(row.id),
    kind: row.kind as PayrollLineItem['kind'],
    code: String(row.code),
    description: String(row.description),
    amount: number(row.amount),
  }
}

function mapItem(row: Row): PayrollItem {
  const lines = (row.payroll_line_items as Row[] | undefined) ?? []
  return {
    id: String(row.id),
    employeeId: String(row.employee_id),
    employeeNumber: String(row.employee_number),
    employeeName: String(row.employee_name),
    taxTreatment: row.tax_treatment as PayrollItem['taxTreatment'],
    nssfApplicable: Boolean(row.nssf_applicable),
    percentOfMonthWorked: number(row.percent_of_month_worked),
    contractualGross: number(row.contractual_gross),
    proratedGross: number(row.prorated_gross),
    overtimeHours: number(row.overtime_hours),
    overtimeRate: number(row.overtime_rate),
    overtimePay: number(row.overtime_pay),
    allowances: number(row.allowances),
    taxableGross: number(row.taxable_gross),
    paye: number(row.paye),
    nssfEmployee: number(row.nssf_employee),
    nssfEmployer: number(row.nssf_employer),
    wht: number(row.wht),
    salaryAdvanceDeduction: number(row.salary_advance_deduction),
    otherDeductions: number(row.other_deductions),
    totalDeductions: number(row.total_deductions),
    netPay: number(row.net_pay),
    tinNumber: text(row.tin_number),
    nssfNumber: text(row.nssf_number),
    paymentMethod: (text(row.payment_method) ?? 'cash') as PayrollItem['paymentMethod'],
    bankName: text(row.bank_name),
    accountNumber: text(row.account_number),
    sortCode: text(row.sort_code),
    mobileMoneyNumber: text(row.mobile_money_number),
    lineItems: lines.map(mapLine),
  }
}

function mapPayment(row: Row | undefined): PayrollPayment | null {
  return row
    ? {
        id: String(row.id),
        paidOn: String(row.paid_on),
        amount: number(row.amount),
        reference: String(row.payment_reference),
        method: row.payment_method as PayrollPayment['method'],
        proofPath: text(row.proof_path),
        notes: text(row.notes),
        recordedAt: String(row.recorded_at),
      }
    : null
}

function relation(value: unknown): Row {
  return (Array.isArray(value) ? value[0] : value) as Row
}

export function mapPayrollRun(row: Row): PayrollRun {
  const period = relation(row.payroll_periods)
  const payments = (row.payroll_payments as Row[] | undefined) ?? []
  return {
    id: String(row.id),
    periodId: String(row.period_id),
    periodStart: String(period.period_start),
    periodEnd: String(period.period_end),
    periodLabel: String(period.label),
    runNumber: number(row.run_number),
    runType: row.run_type as PayrollRun['runType'],
    sourceRunId: text(row.source_run_id),
    status: row.status as PayrollRun['status'],
    reason: text(row.reason),
    totalGross: number(row.total_gross),
    totalPaye: number(row.total_paye),
    totalNssfEmployee: number(row.total_nssf_employee),
    totalNssfEmployer: number(row.total_nssf_employer),
    totalWht: number(row.total_wht),
    totalDeductions: number(row.total_deductions),
    totalNet: number(row.total_net),
    approvedAt: text(row.approved_at),
    items: ((row.payroll_items as Row[] | undefined) ?? []).map(mapItem),
    payment: mapPayment(payments[0]),
  }
}

export const payload = (items: PayrollDraftItem[]) =>
  items.map((item) => ({
    employee_id: item.employeeId,
    percent_of_month_worked: item.percentOfMonthWorked,
    overtime_hours: item.overtimeHours,
    line_items: item.lineItems.map(({ kind, code, description, amount }) => ({
      kind,
      code,
      description,
      amount,
    })),
  }))

export interface PayrollApi {
  list(): Promise<PayrollRun[]>
  get(id: string): Promise<PayrollRun>
  eligibleEmployees(): Promise<PayrollEmployee[]>
  create(periodStart: string, items: PayrollDraftItem[]): Promise<string>
  replace(id: string, items: PayrollDraftItem[], reason: string): Promise<void>
  approve(id: string, reason: string): Promise<void>
  amend(
    id: string,
    type: 'supplemental' | 'correction',
    reason: string,
    items: PayrollDraftItem[],
  ): Promise<string>
  recordPayment(input: {
    runId: string
    paidOn: string
    reference: string
    method: PayrollPayment['method']
    notes?: string
  }): Promise<string>
  recordExport(
    runId: string,
    itemId: string | null,
    kind: 'master' | 'bank' | 'mtn' | 'nssf' | 'paye' | 'wht' | 'payslip',
  ): Promise<void>
}

async function list(): Promise<PayrollRun[]> {
  const { data, error } = await getSupabaseClient()
    .from('payroll_runs')
    .select(payrollRunListSelection)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data as unknown as Row[]).map(mapPayrollRun)
}

async function get(id: string): Promise<PayrollRun> {
  const { data, error } = await getSupabaseClient()
    .from('payroll_runs')
    .select(runSelection)
    .eq('id', id)
    .single()
  if (error) throw error
  return mapPayrollRun(data)
}

async function eligibleEmployees(): Promise<PayrollEmployee[]> {
  const { data, error } = await getSupabaseClient()
    .from('employees')
    .select(
      'id,employee_number,legal_name,employee_confidential_profiles(pct_month_worked),employment_periods(start_date,end_date,departments(name))',
    )
    .is('archived_at', null)
    .order('legal_name')
  if (error) throw error

  const today = new Date().toISOString().slice(0, 10)
  return (data as unknown as Row[]).map((row) => {
    const c = relation(row.employee_confidential_profiles)
    const periods = (row.employment_periods as Row[] | undefined) ?? []
    const currentPeriod =
      periods.find((p) => {
        const endDate = text(p.end_date)
        return !endDate || endDate >= today
      }) ?? periods[0]
    const dept = currentPeriod ? relation(currentPeriod.departments) : null
    return {
      id: String(row.id),
      employeeNumber: String(row.employee_number),
      employeeName: String(row.legal_name),
      defaultPercentWorked: number(c?.pct_month_worked) || 100,
      departmentName: text(dept?.name),
    }
  })
}

async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await getSupabaseClient().rpc(name, args)
  if (res.error) throw res.error
  return res.data
}

export const payrollApi: PayrollApi = {
  list,
  get,
  eligibleEmployees,
  create: async (periodStart, items) =>
    String(
      await rpc('create_payroll_draft', {
        target_period_start: periodStart,
        target_run_type: 'regular',
        target_source_run_id: null,
        run_reason: 'Regular monthly payroll',
        item_payload: payload(items),
      }),
    ),
  replace: async (id, items, reason) => {
    await rpc('replace_payroll_draft_items', {
      target_run_id: id,
      item_payload: payload(items),
      change_reason: reason,
    })
  },
  approve: async (id, reason) => {
    await rpc('approve_payroll_run', {
      target_run_id: id,
      approval_reason: reason,
    })
  },
  amend: async (id, type, reason, items) =>
    String(
      await rpc('create_payroll_amendment', {
        source_run_id: id,
        amendment_type: type,
        amendment_reason: reason,
        item_payload: payload(items),
      }),
    ),
  recordPayment: async (input) =>
    String(
      await rpc('record_payroll_payment', {
        target_run_id: input.runId,
        payment_date: input.paidOn,
        reference: input.reference,
        method: input.method,
        payment_proof_path: null,
        payment_notes: input.notes ?? null,
      }),
    ),
  recordExport: async (runId, itemId, kind) => {
    await rpc('record_payroll_export', {
      target_run_id: runId,
      target_item_id: itemId,
      export_kind: kind,
    })
  },
}

// ─── TanStack Query Hooks ───────────────────────────────────────────────────

export function usePayrollRuns() {
  return useQuery({
    queryKey: ['payroll', 'runs'],
    queryFn: () => payrollApi.list(),
  })
}

export function usePayrollRun(id: string) {
  return useQuery({
    queryKey: ['payroll', 'run', id],
    queryFn: () => payrollApi.get(id),
    enabled: Boolean(id),
  })
}

export function useEligibleEmployees() {
  return useQuery({
    queryKey: ['payroll', 'eligible-employees'],
    queryFn: () => payrollApi.eligibleEmployees(),
  })
}

export function useCreatePayrollDraft() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ periodStart, items }: { periodStart: string; items: PayrollDraftItem[] }) =>
      payrollApi.create(periodStart, items),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['payroll', 'runs'] })
    },
  })
}

export function useReplacePayrollDraft() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      items,
      reason,
    }: {
      id: string
      items: PayrollDraftItem[]
      reason: string
    }) => payrollApi.replace(id, items, reason),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['payroll', 'runs'] })
      void queryClient.invalidateQueries({ queryKey: ['payroll', 'run', variables.id] })
    },
  })
}

export function useApprovePayrollRun() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      payrollApi.approve(id, reason),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['payroll', 'runs'] })
      void queryClient.invalidateQueries({ queryKey: ['payroll', 'run', variables.id] })
    },
  })
}

export function useCreatePayrollAmendment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      type,
      reason,
      items,
    }: {
      id: string
      type: 'supplemental' | 'correction'
      reason: string
      items: PayrollDraftItem[]
    }) => payrollApi.amend(id, type, reason, items),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['payroll', 'runs'] })
    },
  })
}

export function useRecordPayrollPayment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      runId: string
      paidOn: string
      reference: string
      method: PayrollPayment['method']
      notes?: string
    }) => payrollApi.recordPayment(input),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['payroll', 'runs'] })
      void queryClient.invalidateQueries({ queryKey: ['payroll', 'run', variables.runId] })
    },
  })
}
