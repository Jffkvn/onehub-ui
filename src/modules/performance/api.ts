import { z } from 'zod'
import {
  assertProtectedSessionCurrent,
  captureProtectedSessionSnapshot,
  type IdentityScopeRef,
} from '@/lib/idempotency/pendingOperations'
import { getSupabaseClient } from '@/lib/supabase/client'

const uuid = z.string().uuid()
const number = z.coerce.number().finite()
const cycleStatus = z.enum(['draft', 'active', 'closed'])
const reviewStatus = z.enum(['draft', 'manager_submitted', 'hr_approved', 'employee_acknowledged', 'reopened'])
const cycleSchema = z.object({
  id: uuid,
  name: z.string(),
  start_date: z.string(),
  end_date: z.string(),
  status: cycleStatus,
  total_reviews: number.int().nonnegative(),
  completed_reviews: number.int().nonnegative(),
})
const reviewSchema = z.object({
  id: uuid,
  cycle_id: uuid,
  cycle_name: z.string(),
  employee_id: uuid,
  employee_number: z.string(),
  employee_name: z.string(),
  reviewer_profile_id: uuid,
  reviewer_name: z.string(),
  status: reviewStatus,
  overall_score: number.nullable(),
  manager_comments: z.string().nullable(),
  recommend_increment: z.boolean(),
  recommend_promotion: z.boolean(),
  hr_reason: z.string().nullable(),
  acknowledged_at: z.string().nullable(),
  acknowledgment_comment: z.string().nullable(),
  goals: z.array(z.object({
    id: uuid,
    description: z.string(),
    manager_rating: number.min(1).max(5),
  })),
})
const eventSchema = z.object({
  id: uuid,
  event_type: z.string(),
  reason: z.string().nullable(),
  actor_name: z.string(),
  occurred_at: z.string(),
})
const reviewerSchema = z.object({ profile_id: uuid, display_name: z.string(), role_label: z.string() })
const employeeSchema = z.object({ id: uuid, legal_name: z.string(), employee_number: z.string() })
const importVersionSchema = z.object({
  employee_id: uuid,
  review_id: uuid,
  status: reviewStatus,
  version: number.int().positive(),
})

const performanceCycleInput = z.object({
  name: z.string().trim().min(2).max(160),
  startDate: z.string().date(),
  endDate: z.string().date(),
}).refine((value) => value.endDate >= value.startDate, {
  message: 'End date must be on or after the start date.',
})

export const assessmentSchema = z.object({
  managerComments: z.string().trim().min(3).max(4000),
  recommendIncrement: z.boolean(),
  recommendPromotion: z.boolean(),
  goals: z.array(z.object({
    description: z.string().trim().min(2).max(1000),
    managerRating: number.min(1).max(5),
  })).min(1).max(30),
})

export type PerformanceCycle = z.infer<typeof cycleSchema>
export type PerformanceReview = z.infer<typeof reviewSchema>
export type PerformanceReviewer = z.infer<typeof reviewerSchema>
export type PerformanceEmployee = z.infer<typeof employeeSchema>
export type PerformanceImportVersion = z.infer<typeof importVersionSchema>
export type Assessment = z.infer<typeof assessmentSchema>

export function performanceKey(scope: IdentityScopeRef) {
  return ['performance', scope.identityKey, scope.authEpoch]
}

const readableRpcErrors = new Set([
  'An active performance cycle is required.',
  'Employee not found.',
  'This employee already has a review in the cycle.',
  'Select an eligible reviewer.',
  'Only an assigned reviewer can edit this review.',
  'Only draft or reopened reviews can be edited.',
  'A released review cannot be overwritten by import.',
  'A review for this employee was created since you previewed the workbook. Re-validate before importing.',
  'This performance review changed since you previewed the workbook. Re-validate before importing.',
  'Comments and rated goals are required.',
  'Each goal needs a description and rating from 1 to 5.',
  'Complete and save the review before submitting.',
  'Only submitted reviews can be approved.',
  'Only released reviews can be acknowledged.',
])

export function performanceApi(scope: IdentityScopeRef) {
  async function withCurrentSession<T>(read: () => PromiseLike<T>): Promise<T> {
    const snapshot = captureProtectedSessionSnapshot({
      identityKey: scope.identityKey,
      authEpoch: scope.authEpoch,
      isReady: scope.isAuthReady,
    })
    assertProtectedSessionCurrent(snapshot, scope.latestRef.current)
    const result = await read()
    assertProtectedSessionCurrent(snapshot, scope.latestRef.current)
    return result
  }

  async function rpc(name: string, args?: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await withCurrentSession<{ data: unknown; error: { message: string } | null }>(
      () => getSupabaseClient().rpc(name, args),
    )
    if (error) {
      throw new Error(readableRpcErrors.has(error.message) ? error.message : 'The performance request could not be completed.')
    }
    return data
  }

  return {
    async listCycles() {
      return cycleSchema.array().parse(await rpc('rpc_list_performance_cycles'))
    },
    async listReviews() {
      return reviewSchema.array().parse(await rpc('rpc_list_performance_reviews', { p_cycle_id: null }))
    },
    async listMine() {
      const reviews = reviewSchema.array().parse(await rpc('rpc_list_my_performance_reviews'))
      return reviews.filter(({ status }) => status === 'hr_approved' || status === 'employee_acknowledged')
    },
    async listAssigned() {
      const reviews = reviewSchema.array().parse(await rpc('rpc_list_my_assigned_performance_reviews'))
      return reviews.filter(({ reviewer_profile_id }) => reviewer_profile_id === scope.identityKey)
    },
    async listEvents(reviewId: string) {
      return eventSchema.array().parse(await rpc('rpc_list_performance_review_events', {
        p_review_id: uuid.parse(reviewId),
      }))
    },
    async listReviewers() {
      return reviewerSchema.array().parse(await rpc('rpc_list_performance_reviewers'))
    },
    async listEmployees() {
      const { data, error } = await withCurrentSession(() => getSupabaseClient()
        .from('employees')
        .select('id,legal_name,employee_number')
        .is('archived_at', null)
        .order('legal_name'))
      if (error) throw new Error('The employee options could not be loaded.')
      return employeeSchema.array().parse(data)
    },
    async createCycle(input: z.input<typeof performanceCycleInput>) {
      const { name, startDate, endDate } = performanceCycleInput.parse(input)
      return uuid.parse(await rpc('rpc_create_performance_cycle', {
        p_name: name, p_start_date: startDate, p_end_date: endDate,
      }))
    },
    async setCycleStatus(cycleId: string, status: PerformanceCycle['status']) {
      await rpc('rpc_set_performance_cycle_status', {
        p_cycle_id: uuid.parse(cycleId), p_status: cycleStatus.parse(status),
      })
    },
    async startReview(cycleId: string, employeeId: string, reviewerId: string) {
      return uuid.parse(await rpc('rpc_start_performance_review', {
        p_cycle_id: uuid.parse(cycleId),
        p_employee_id: uuid.parse(employeeId),
        p_reviewer_profile_id: uuid.parse(reviewerId),
      }))
    },
    async saveReview(reviewId: string, assessment: Assessment) {
      const draft = assessmentSchema.parse(assessment)
      await rpc('rpc_save_performance_review', {
        p_review_id: uuid.parse(reviewId),
        p_manager_comments: draft.managerComments,
        p_recommend_increment: draft.recommendIncrement,
        p_recommend_promotion: draft.recommendPromotion,
        p_goals: draft.goals,
      })
    },
    async submitReview(reviewId: string) {
      await rpc('rpc_submit_performance_review', { p_review_id: uuid.parse(reviewId) })
    },
    async decideReview(reviewId: string, decision: 'approved' | 'reopened', reason: string) {
      await rpc('rpc_decide_performance_review', {
        p_review_id: uuid.parse(reviewId),
        p_decision: decision,
        p_reason: z.string().trim().min(3).max(2000).parse(reason),
      })
    },
    async acknowledge(reviewId: string, comment: string) {
      await rpc('rpc_acknowledge_performance_review', {
        p_review_id: uuid.parse(reviewId),
        p_comment: z.string().trim().max(2000).parse(comment),
      })
    },
    async listImportVersions(cycleId: string) {
      return importVersionSchema.array().parse(await rpc('rpc_list_performance_import_versions', {
        p_cycle_id: uuid.parse(cycleId),
      }))
    },
    async importReview(input: {
      cycleId: string
      employeeId: string
      reviewerProfileId: string
      managerComments: string
      recommendIncrement: boolean
      recommendPromotion: boolean
      goals: Array<{ description: string; managerRating: number }>
      expectedReviewId: string | null
      expectedVersion: number | null
    }) {
      const draft = assessmentSchema.parse({
        managerComments: input.managerComments,
        recommendIncrement: input.recommendIncrement,
        recommendPromotion: input.recommendPromotion,
        goals: input.goals,
      })
      return uuid.parse(await rpc('rpc_import_performance_review_checked', {
        p_employee_id: uuid.parse(input.employeeId),
        p_cycle_id: uuid.parse(input.cycleId),
        p_reviewer_profile_id: uuid.parse(input.reviewerProfileId),
        p_manager_comments: draft.managerComments,
        p_recommend_increment: draft.recommendIncrement,
        p_recommend_promotion: draft.recommendPromotion,
        p_goals: draft.goals,
        p_expected_review_id: input.expectedReviewId ? uuid.parse(input.expectedReviewId) : null,
        p_expected_version: input.expectedReviewId ? input.expectedVersion : null,
      }))
    },
  }
}
