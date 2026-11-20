import * as XLSX from 'xlsx'
import type {
  PerformanceEmployee,
  PerformanceImportVersion,
  PerformanceReview,
  PerformanceReviewer,
} from './api'

export const PERFORMANCE_TEMPLATE_HEADERS = [
  'Employee Number',
  'Reviewer Name',
  'Manager Comments',
  'Recommend Increment',
  'Recommend Promotion',
  'Goal 1 Description',
  'Goal 1 Rating',
  'Goal 2 Description',
  'Goal 2 Rating',
  'Goal 3 Description',
  'Goal 3 Rating',
] as const

export type PerformanceImportAction = 'new' | 'overwrite' | 'error'

export interface ParsedPerformanceImportRow {
  rowNumber: number
  action: PerformanceImportAction
  existingStatus: PerformanceReview['status'] | null
  expectedReviewId: string | null
  expectedVersion: number | null
  employeeNumber: string
  employeeName: string
  employeeId: string | null
  reviewerName: string
  reviewerProfileId: string | null
  managerComments: string
  recommendIncrement: boolean
  recommendPromotion: boolean
  goals: Array<{ description: string; managerRating: number }>
  errors: string[]
}

export interface PerformanceImportPreview {
  rows: ParsedPerformanceImportRow[]
  newCount: number
  overwriteCount: number
  errorCount: number
  canCommit: boolean
}

const OVERWRITABLE_STATUSES = new Set<PerformanceReview['status']>([
  'draft',
  'reopened',
  'manager_submitted',
])

function normHeader(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function normValue(raw: string): string {
  return raw.trim().toLowerCase()
}

function parseBooleanToken(raw: string, label: string, errors: string[]): boolean {
  const token = normValue(raw)
  if (!token || token === 'no' || token === 'false' || token === '0' || token === 'n') return false
  if (token === 'yes' || token === 'true' || token === '1' || token === 'y') return true
  errors.push(`${label} must be Yes or No.`)
  return false
}

/** Generate and download the blank Performance Review Import `.xlsx` template. */
export function downloadPerformanceTemplate(cycleName?: string): void {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([[...PERFORMANCE_TEMPLATE_HEADERS]])
  ws['!cols'] = PERFORMANCE_TEMPLATE_HEADERS.map((h) => ({ wch: Math.max(h.length + 4, 22) }))

  const guide = XLSX.utils.aoa_to_sheet([
    ['OneHub Performance Assessment Workbook Import Guide'],
    [''],
    ['Target Cycle', cycleName ? `${cycleName} (Active cycle only)` : 'Select an active cycle before importing.'],
    ['Required columns', 'Employee Number, Reviewer Name, Manager Comments (>= 3 chars), and 1–3 rated goals (Rating 1–5).'],
    ['Matching rules', 'Employee Number and Reviewer Name match active staff and eligible reviewers strictly (exact case-insensitive match).'],
    ['Overwrite & concurrency rules', 'Draft, Reopened, and Manager Submitted reviews in the active cycle are overwritten using previewed record versions; concurrent edits block save until re-validated. Released and Employee Acknowledged reviews cannot be overwritten.'],
    ['Limits', 'Maximum 1,000 review rows and 5 MB per .xlsx upload.'],
  ])

  XLSX.utils.book_append_sheet(wb, ws, 'Performance Reviews')
  XLSX.utils.book_append_sheet(wb, guide, 'Instructions')
  XLSX.writeFile(wb, 'OneHub_Performance_Review_Import_Template.xlsx')
}

/** Validate raw workbook rows against employees, eligible reviewers, and current cycle review versions. */
export function parsePerformanceWorkbookRows(
  rawRows: string[][],
  context: {
    employees: PerformanceEmployee[]
    reviewers: PerformanceReviewer[]
    existingVersions?: PerformanceImportVersion[]
    existingReviews?: PerformanceReview[]
  },
): PerformanceImportPreview {
  if (rawRows.length < 2) {
    throw new Error('The uploaded workbook has no review rows beneath the header row.')
  }

  const headerMap = new Map<string, number>()
  ;(rawRows[0] ?? []).forEach((col, idx) => {
    const k = normHeader(col)
    if (k && !headerMap.has(k)) headerMap.set(k, idx)
  })

  const col = {
    employeeNumber: headerMap.get('employee number') ?? -1,
    reviewerName: headerMap.get('reviewer name') ?? -1,
    managerComments: headerMap.get('manager comments') ?? -1,
    recommendIncrement: headerMap.get('recommend increment') ?? -1,
    recommendPromotion: headerMap.get('recommend promotion') ?? -1,
    g1Desc: headerMap.get('goal 1 description') ?? -1,
    g1Rate: headerMap.get('goal 1 rating') ?? -1,
    g2Desc: headerMap.get('goal 2 description') ?? -1,
    g2Rate: headerMap.get('goal 2 rating') ?? -1,
    g3Desc: headerMap.get('goal 3 description') ?? -1,
    g3Rate: headerMap.get('goal 3 rating') ?? -1,
  }

  if (col.employeeNumber < 0 || col.reviewerName < 0 || col.managerComments < 0) {
    throw new Error(
      'Workbook headers must include "Employee Number", "Reviewer Name", and "Manager Comments".',
    )
  }

  const employeesByNo = new Map<string, PerformanceEmployee>()
  for (const emp of context.employees) {
    employeesByNo.set(normValue(emp.employee_number), emp)
  }

  const reviewersByName = new Map<string, PerformanceReviewer[]>()
  for (const rev of context.reviewers) {
    const k = normValue(rev.display_name)
    const list = reviewersByName.get(k) ?? []
    list.push(rev)
    reviewersByName.set(k, list)
  }

  const existingByEmpId = new Map<
    string,
    { reviewId: string; status: PerformanceReview['status']; version: number | null }
  >()
  if (context.existingVersions) {
    for (const v of context.existingVersions) {
      existingByEmpId.set(v.employee_id, {
        reviewId: v.review_id,
        status: v.status,
        version: v.version,
      })
    }
  } else if (context.existingReviews) {
    for (const r of context.existingReviews) {
      existingByEmpId.set(r.employee_id, {
        reviewId: r.id,
        status: r.status,
        version: null,
      })
    }
  }

  const seenEmpNos = new Map<string, number>()
  const parsedRows: ParsedPerformanceImportRow[] = []

  for (let i = 1; i < rawRows.length; i += 1) {
    const raw = rawRows[i] ?? []
    if (raw.every((c) => !c.trim())) continue

    const rowNumber = i + 1
    const get = (idx: number) => (idx >= 0 ? (raw[idx] ?? '').trim() : '')
    const errors: string[] = []

    const empNoRaw = get(col.employeeNumber)
    const reviewerRaw = get(col.reviewerName)
    const commentsRaw = get(col.managerComments)

    if (!empNoRaw) {
      errors.push('Employee Number is required.')
    }
    const matchedEmployee = empNoRaw ? employeesByNo.get(normValue(empNoRaw)) ?? null : null
    if (empNoRaw && !matchedEmployee) {
      errors.push(`Unknown or archived Employee Number "${empNoRaw}".`)
    }
    if (empNoRaw) {
      const k = normValue(empNoRaw)
      const prev = seenEmpNos.get(k)
      if (prev) errors.push(`Duplicate Employee Number "${empNoRaw}" also appears on row ${prev}.`)
      else seenEmpNos.set(k, rowNumber)
    }

    let matchedReviewer: PerformanceReviewer | null = null
    if (!reviewerRaw) {
      errors.push('Reviewer Name is required.')
    } else {
      const candidates = reviewersByName.get(normValue(reviewerRaw)) ?? []
      if (candidates.length === 0) {
        errors.push(`No eligible reviewer named "${reviewerRaw}".`)
      } else if (candidates.length > 1) {
        errors.push(`Ambiguous Reviewer Name "${reviewerRaw}" matches multiple eligible profiles.`)
      } else {
        matchedReviewer = candidates[0]!
      }
    }

    if (commentsRaw.length < 3 || commentsRaw.length > 4000) {
      errors.push('Manager Comments must contain between 3 and 4000 characters.')
    }

    const recommendIncrement = parseBooleanToken(
      get(col.recommendIncrement),
      'Recommend Increment',
      errors,
    )
    const recommendPromotion = parseBooleanToken(
      get(col.recommendPromotion),
      'Recommend Promotion',
      errors,
    )

    const goals: Array<{ description: string; managerRating: number }> = []
    const goalSlots: Array<[number, number, number]> = [
      [1, col.g1Desc, col.g1Rate],
      [2, col.g2Desc, col.g2Rate],
      [3, col.g3Desc, col.g3Rate],
    ]
    for (const [slot, dIdx, rIdx] of goalSlots) {
      const desc = get(dIdx)
      const rateRaw = get(rIdx)
      if (!desc && !rateRaw) continue
      if (desc.length < 2 || desc.length > 1000) {
        errors.push(`Goal ${slot} Description must be between 2 and 1000 characters.`)
      }
      const parsedRating = Number(rateRaw)
      if (!rateRaw || !Number.isInteger(parsedRating) || parsedRating < 1 || parsedRating > 5) {
        errors.push(`Goal ${slot} Rating must be a whole number from 1 to 5.`)
      } else if (desc.length >= 2 && desc.length <= 1000) {
        goals.push({ description: desc, managerRating: parsedRating })
      }
    }

    if (goals.length === 0) {
      errors.push('At least 1 rated goal (Goal 1 Description and Rating 1–5) is required.')
    }

    const existing = matchedEmployee ? existingByEmpId.get(matchedEmployee.id) ?? null : null
    if (existing && !OVERWRITABLE_STATUSES.has(existing.status)) {
      errors.push('Released or acknowledged reviews cannot be overwritten by import.')
    }

    const action: PerformanceImportAction =
      errors.length > 0 ? 'error' : existing ? 'overwrite' : 'new'

    parsedRows.push({
      rowNumber,
      action,
      existingStatus: existing?.status ?? null,
      expectedReviewId: existing ? existing.reviewId : null,
      expectedVersion: existing ? existing.version : null,
      employeeNumber: empNoRaw,
      employeeName: matchedEmployee?.legal_name ?? '',
      employeeId: matchedEmployee?.id ?? null,
      reviewerName: matchedReviewer?.display_name ?? reviewerRaw,
      reviewerProfileId: matchedReviewer?.profile_id ?? null,
      managerComments: commentsRaw,
      recommendIncrement,
      recommendPromotion,
      goals,
      errors,
    })
  }

  if (parsedRows.length === 0) {
    throw new Error('The uploaded workbook contains no review data rows.')
  }

  const newCount = parsedRows.filter((r) => r.action === 'new').length
  const overwriteCount = parsedRows.filter((r) => r.action === 'overwrite').length
  const errorCount = parsedRows.filter((r) => r.action === 'error').length

  return {
    rows: parsedRows,
    newCount,
    overwriteCount,
    errorCount,
    canCommit: errorCount === 0 && newCount + overwriteCount > 0,
  }
}
