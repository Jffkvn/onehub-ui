import { describe, expect, it } from 'vitest'
import type { PerformanceEmployee, PerformanceReview, PerformanceReviewer } from './api'
import { PERFORMANCE_TEMPLATE_HEADERS, parsePerformanceWorkbookRows } from './performanceWorkbook'

const employees: PerformanceEmployee[] = [
  { id: '10000000-0000-4000-8000-000000000001', employee_number: 'EMP-01', legal_name: 'Alice One' },
  { id: '10000000-0000-4000-8000-000000000002', employee_number: 'EMP-02', legal_name: 'Bob Two' },
  { id: '10000000-0000-4000-8000-000000000003', employee_number: 'EMP-03', legal_name: 'Cara Three' },
]

const reviewers: PerformanceReviewer[] = [
  { profile_id: '20000000-0000-4000-8000-000000000001', display_name: 'Manager Jane', role_label: 'Coordinator' },
  { profile_id: '20000000-0000-4000-8000-000000000002', display_name: 'Duplicate Name', role_label: 'PM' },
  { profile_id: '20000000-0000-4000-8000-000000000003', display_name: 'Duplicate Name', role_label: 'CFO' },
]

function existingReview(
  employeeId: string,
  status: PerformanceReview['status'],
): PerformanceReview {
  return {
    id: `30000000-0000-4000-8000-00000000000${employeeId.slice(-1)}`,
    cycle_id: '40000000-0000-4000-8000-000000000001',
    cycle_name: 'FY 2026',
    employee_id: employeeId,
    employee_number: 'EMP-0X',
    employee_name: 'Worker',
    reviewer_profile_id: reviewers[0].profile_id,
    reviewer_name: reviewers[0].display_name,
    status,
    overall_score: null,
    manager_comments: null,
    recommend_increment: false,
    recommend_promotion: false,
    hr_reason: null,
    acknowledged_at: null,
    acknowledgment_comment: null,
    goals: [],
  }
}

describe('parsePerformanceWorkbookRows (Option A preflight)', () => {
  it('classifies new rows vs draft/reopened/submitted overwrites and validates up to 3 goals', () => {
    const preview = parsePerformanceWorkbookRows(
      [
        [...PERFORMANCE_TEMPLATE_HEADERS],
        [
          'EMP-01',
          'Manager Jane',
          'Strong delivery throughout Q3.',
          'Yes',
          'No',
          'Complete safety audit',
          '5',
          'Mentor junior engineers',
          '4',
          '',
          '',
        ],
        [
          'EMP-02',
          'manager jane',
          'Solid field execution.',
          'no',
          'yes',
          'On-time preventive visits',
          '4',
          '',
          '',
          '',
          '',
        ],
      ],
      {
        employees,
        reviewers,
        existingVersions: [
          {
            employee_id: employees[1].id,
            review_id: '30000000-0000-4000-8000-000000000002',
            status: 'draft',
            version: 3,
          },
        ],
      },
    )

    expect(preview.canCommit).toBe(true)
    expect(preview.newCount).toBe(1)
    expect(preview.overwriteCount).toBe(1)
    expect(preview.errorCount).toBe(0)
    expect(preview.rows[0]?.action).toBe('new')
    expect(preview.rows[0]?.expectedReviewId).toBeNull()
    expect(preview.rows[0]?.expectedVersion).toBeNull()
    expect(preview.rows[0]?.goals).toHaveLength(2)
    expect(preview.rows[1]?.action).toBe('overwrite')
    expect(preview.rows[1]?.existingStatus).toBe('draft')
    expect(preview.rows[1]?.expectedReviewId).toBe('30000000-0000-4000-8000-000000000002')
    expect(preview.rows[1]?.expectedVersion).toBe(3)
    expect(preview.rows[1]?.recommendPromotion).toBe(true)
  })

  it('blocks hr_approved/employee_acknowledged overwrites, ambiguous reviewers, duplicates, and bad ratings', () => {
    const preview = parsePerformanceWorkbookRows(
      [
        [...PERFORMANCE_TEMPLATE_HEADERS],
        ['EMP-01', 'Duplicate Name', 'Hi', 'Maybe', 'No', 'Goal', '7', '', '', '', ''],
        ['EMP-02', 'Unknown Person', 'Valid comments here.', 'No', 'No', 'Goal', '4', '', '', '', ''],
        ['EMP-02', 'Manager Jane', 'Duplicate employee row.', 'No', 'No', 'Goal', '3', '', '', '', ''],
      ],
      {
        employees,
        reviewers,
        existingReviews: [existingReview(employees[1].id, 'hr_approved')],
      },
    )

    expect(preview.canCommit).toBe(false)
    expect(preview.errorCount).toBe(3)
    expect(preview.rows[0]?.errors.join(' ')).toMatch(/ambiguous/i)
    expect(preview.rows[0]?.errors.join(' ')).toMatch(/3 and 4000/i)
    expect(preview.rows[0]?.errors.join(' ')).toMatch(/whole number from 1 to 5/i)
    expect(preview.rows[1]?.errors.join(' ')).toMatch(/released or acknowledged/i)
    expect(preview.rows[2]?.errors.join(' ')).toMatch(/duplicate employee number/i)
  })
})
