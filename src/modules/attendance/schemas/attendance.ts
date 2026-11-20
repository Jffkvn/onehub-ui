import { z } from 'zod'

/* ─── Envelope & Shared Scalars ───────────────────────────────────────────── */

export const mutationEnvelopeSchema = z.object({
  request_id: z.string(),
  operation_type: z.string(),
  replayed: z.boolean(),
  result: z.unknown(),
})

export const workModeSchema = z.enum(['office', 'field', 'remote'])
export const workModeOrNoneSchema = z.enum(['office', 'field', 'remote', 'none'])

export const attendanceCaptureStatusSchema = z.enum([
  'captured',
  'denied',
  'unavailable',
  'timeout',
  'not_requested',
])

export const persistedLocationCheckSchema = z.enum([
  'onsite',
  'outside',
  'poor_accuracy',
  'unavailable',
  'denied',
  'not_required',
  'recorded',
])

export const explanationStatusSchema = z.enum([
  'not_required',
  'required_unsubmitted',
  'pending',
  'accepted',
  'rejected',
  'unresolved',
])

export const attendancePunchSchema = z.object({
  id: z.string(),
  punch_kind: z.enum(['clock_in', 'clock_out', 'still_working']),
  occurred_at: z.string(),
  client_captured_at: z.string().nullable().optional(),
  source: z.string(),
  location_status: attendanceCaptureStatusSchema,
  location_check: persistedLocationCheckSchema,
  accuracy_m: z.number().nullable().optional(),
  distance_m: z.number().nullable().optional(),
  work_mode: workModeSchema,
  coordinates: z
    .object({
      lat: z.number(),
      lng: z.number(),
      accuracy_m: z.number().nullable().optional(),
    })
    .nullable()
    .optional(),
})

export const attendanceDaySummarySchema = z.object({
  id: z.string(),
  local_date: z.string(),
  expected_start_at: z.string().nullable().optional(),
  expected_end_at: z.string().nullable().optional(),
  is_workday: z.boolean(),
  is_holiday: z.boolean(),
  clock_in_at: z.string().nullable().optional(),
  clock_out_at: z.string().nullable().optional(),
  has_clock_in: z.boolean(),
  has_clock_out: z.boolean(),
  clock_in_location_check: persistedLocationCheckSchema.nullable().optional(),
  clock_out_location_check: persistedLocationCheckSchema.nullable().optional(),
  clock_in_distance_m: z.number().nullable().optional(),
  clock_out_distance_m: z.number().nullable().optional(),
  clock_in_work_mode: workModeSchema.nullable().optional(),
  clock_out_work_mode: workModeSchema.nullable().optional(),
  still_working_until: z.string().nullable().optional(),
  extra_minutes: z.number(),
  record_state: z.string(),
  policy_verified: z.boolean().optional(),
  review_status: z.string(),
  explanation_status: explanationStatusSchema,
  version: z.number(),
})

/* ─── Today Context & Personal History ────────────────────────────────────── */

export const todayContextSchema = z.object({
  enabled: z.boolean(),
  enrolled: z.boolean(),
  employee_id: z.string(),
  local_date: z.string(),
  timezone: z.string(),
  context_revision: z.string(),
  work_mode: workModeOrNoneSchema,
  mode_reason: z.string(),
  is_workday: z.boolean(),
  is_holiday: z.boolean(),
  holiday_name: z.string().nullable().optional(),
  workplace: z
    .object({
      id: z.string(),
      name: z.string(),
      radius_meters: z.number(),
      timezone: z.string(),
      is_active: z.boolean(),
    })
    .nullable()
    .optional(),
  schedule: z
    .object({
      id: z.string(),
      name: z.string(),
      timezone: z.string(),
      half_day_boundary: z.string().nullable().optional(),
      lateness_grace_minutes: z.number(),
      explanation_threshold_minutes: z.number(),
      is_workday: z.boolean(),
      expected_start: z.string().nullable().optional(),
      expected_end: z.string().nullable().optional(),
      expected_start_at: z.string().nullable().optional(),
      expected_end_at: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  active_arrangement: z
    .object({
      id: z.string(),
      mode: z.enum(['field', 'remote']),
      coverage_type: z.enum(['dated', 'weekly']),
      duty_label: z.string().nullable().optional(),
      start_date: z.string(),
      end_date: z.string().nullable().optional(),
      version: z.number(),
    })
    .nullable()
    .optional(),
  day: attendanceDaySummarySchema.nullable().optional(),
  open_correction: z
    .object({
      id: z.string(),
      request_kind: z.string(),
      status: z.string(),
      claimed_in_at: z.string().nullable().optional(),
      claimed_out_at: z.string().nullable().optional(),
      reason: z.string(),
      created_at: z.string(),
    })
    .nullable()
    .optional(),
  server_now: z.string(),
})

export const myHistoryDaySchema = attendanceDaySummarySchema.extend({
  timezone: z.string(),
  grace_minutes: z.number(),
  punctuality: z.enum(['on_time', 'late']).nullable().optional(),
  punches: z.array(attendancePunchSchema),
})

export const myCorrectionSchema = z.object({
  id: z.string(),
  attendance_day_id: z.string(),
  local_date: z.string(),
  request_kind: z.string(),
  claimed_in_at: z.string().nullable().optional(),
  claimed_out_at: z.string().nullable().optional(),
  original_clock_in_at: z.string().nullable().optional(),
  original_clock_out_at: z.string().nullable().optional(),
  reason: z.string(),
  status: z.string(),
  review_note: z.string().nullable().optional(),
  reviewed_at: z.string().nullable().optional(),
  created_at: z.string(),
})

export const myExplanationSchema = z.object({
  id: z.string(),
  attendance_day_id: z.string(),
  local_date: z.string(),
  reason: z.string(),
  declared_finish_at: z.string().nullable().optional(),
  status: z.string(),
  review_note: z.string().nullable().optional(),
  reviewed_at: z.string().nullable().optional(),
  created_at: z.string(),
})

export const myArrangementSchema = z.object({
  id: z.string(),
  mode: z.enum(['field', 'remote']),
  coverage_type: z.enum(['dated', 'weekly']),
  start_date: z.string(),
  end_date: z.string().nullable().optional(),
  weekdays: z.array(z.number()).nullable().optional(),
  reason: z.string(),
  duty_label: z.string().nullable().optional(),
  status: z.string(),
  source: z.string().nullable().optional(),
  review_note: z.string().nullable().optional(),
  version: z.number(),
  created_at: z.string(),
})

export const myHistoryResponseSchema = z.object({
  from_date: z.string(),
  to_date: z.string(),
  days: z.array(myHistoryDaySchema),
  corrections: z.array(myCorrectionSchema),
  explanations: z.array(myExplanationSchema),
  arrangements: z.array(myArrangementSchema),
})

/* ─── Register & Review Queues & Setup ────────────────────────────────────── */

export const registerRowSchema = z.object({
  attendance_day_id: z.string().nullable().optional(),
  day_version: z.number().nullable().optional(),
  employee_id: z.string(),
  employee_number: z.string(),
  employee_name: z.string(),
  department_id: z.string().nullable().optional(),
  department_name: z.string().nullable().optional(),
  local_date: z.string(),
  timezone: z.string(),
  workplace_name: z.string().nullable().optional(),
  schedule_name: z.string().nullable().optional(),
  work_mode: workModeSchema.nullable().optional(),
  clock_out_work_mode: workModeSchema.nullable().optional(),
  is_workday: z.boolean(),
  is_holiday: z.boolean(),
  expected_start_at: z.string().nullable().optional(),
  expected_end_at: z.string().nullable().optional(),
  clock_in_at: z.string().nullable().optional(),
  clock_out_at: z.string().nullable().optional(),
  clock_in_location_check: persistedLocationCheckSchema.nullable().optional(),
  clock_out_location_check: persistedLocationCheckSchema.nullable().optional(),
  clock_in_distance_m: z.number().nullable().optional(),
  clock_out_distance_m: z.number().nullable().optional(),
  clock_in_punch_id: z.string().nullable().optional(),
  clock_out_punch_id: z.string().nullable().optional(),
  still_working_until: z.string().nullable().optional(),
  extra_minutes: z.number(),
  effective_state: z.string(),
  punctuality: z.enum(['on_time', 'late']).nullable().optional(),
  review_status: z.string(),
  explanation_status: explanationStatusSchema,
  field_follow_up: z.boolean(),
  needs_review: z.boolean(),
  policy_verified: z.boolean().optional(),
})

export const registerResponseSchema = z.object({
  from_date: z.string(),
  to_date: z.string(),
  total_count: z.number(),
  limit: z.number(),
  offset: z.number(),
  summary: z.object({
    total_rows: z.number(),
    complete_count: z.number(),
    open_count: z.number(),
    exception_count: z.number(),
  }),
  rows: z.array(registerRowSchema),
})

export const reviewCorrectionRowSchema = z.object({
  id: z.string(),
  attendance_day_id: z.string(),
  employee_id: z.string(),
  employee_number: z.string(),
  employee_name: z.string(),
  local_date: z.string(),
  timezone: z.string(),
  request_kind: z.string(),
  claimed_in_at: z.string().nullable().optional(),
  claimed_out_at: z.string().nullable().optional(),
  original_clock_in_at: z.string().nullable().optional(),
  original_clock_out_at: z.string().nullable().optional(),
  reason: z.string(),
  status: z.string(),
  review_note: z.string().nullable().optional(),
  day_version: z.number(),
  created_at: z.string(),
})

export const reviewExplanationRowSchema = z.object({
  id: z.string(),
  attendance_day_id: z.string(),
  employee_id: z.string(),
  employee_number: z.string(),
  employee_name: z.string(),
  local_date: z.string(),
  extra_minutes: z.number(),
  declared_finish_at: z.string().nullable().optional(),
  reason: z.string(),
  status: z.string(),
  review_note: z.string().nullable().optional(),
  created_at: z.string(),
})

export const reviewFieldRowSchema = z.object({
  punch_id: z.string(),
  employee_id: z.string(),
  employee_number: z.string(),
  employee_name: z.string(),
  local_date: z.string(),
  punch_kind: z.string(),
  occurred_at: z.string(),
  location_status: attendanceCaptureStatusSchema,
  location_check: persistedLocationCheckSchema,
  accuracy_m: z.number().nullable().optional(),
  status: z.string(),
  review_note: z.string().nullable().optional(),
  version: z.number(),
})

export const reviewQueuesResponseSchema = z.object({
  corrections: z.array(reviewCorrectionRowSchema),
  explanations: z.array(reviewExplanationRowSchema),
  field_reviews: z.array(reviewFieldRowSchema),
})

export const arrangementRowSchema = z.object({
  id: z.string(),
  employee_id: z.string(),
  employee_number: z.string(),
  employee_name: z.string(),
  mode: z.enum(['field', 'remote']),
  coverage_type: z.enum(['dated', 'weekly']),
  start_date: z.string(),
  effective_start: z.string(),
  end_date: z.string().nullable().optional(),
  weekdays: z.array(z.number()).nullable().optional(),
  reason: z.string(),
  duty_label: z.string().nullable().optional(),
  status: z.string(),
  source: z.string().nullable().optional(),
  replaced_by: z.string().nullable().optional(),
  review_note: z.string().nullable().optional(),
  reviewed_at: z.string().nullable().optional(),
  version: z.number(),
  created_at: z.string(),
  can_decide: z.boolean(),
})

export const arrangementsListResponseSchema = z.object({
  total_count: z.number(),
  limit: z.number(),
  offset: z.number(),
  rows: z.array(arrangementRowSchema),
})

export const fieldEvidenceResponseSchema = z.object({
  punch_id: z.string(),
  employee_id: z.string(),
  employee_name: z.string().nullable().optional(),
  punch_kind: z.string(),
  work_mode: z.string(),
  occurred_at: z.string(),
  client_captured_at: z.string().nullable().optional(),
  location_status: attendanceCaptureStatusSchema,
  location_check: persistedLocationCheckSchema,
  accuracy_m: z.number().nullable().optional(),
  distance_m: z.number().nullable().optional(),
  expired: z.boolean(),
  coordinates: z
    .object({
      lat: z.number(),
      lng: z.number(),
      accuracy_m: z.number().nullable().optional(),
      received_at: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  review: z
    .object({
      status: z.string(),
      review_note: z.string().nullable().optional(),
      history: z.unknown(),
      version: z.number(),
      updated_at: z.string(),
    })
    .nullable()
    .optional(),
})

export const workplaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  radius_meters: z.number(),
  timezone: z.string(),
  is_active: z.boolean(),
  updated_at: z.string(),
})

export const scheduleDaySchema = z.object({
  weekday: z.number(),
  is_workday: z.boolean(),
  expected_start: z.string().nullable().optional(),
  expected_end: z.string().nullable().optional(),
})

export const scheduleSchema = z.object({
  id: z.string(),
  name: z.string(),
  timezone: z.string(),
  half_day_boundary: z.string(),
  lateness_grace_minutes: z.number(),
  explanation_threshold_minutes: z.number(),
  is_active: z.boolean(),
  updated_at: z.string(),
  days: z.array(scheduleDaySchema),
})

export const holidaySchema = z.object({
  id: z.string(),
  local_date: z.string(),
  name: z.string(),
  is_active: z.boolean(),
  updated_at: z.string(),
})

export const rosterAssignmentSchema = z.object({
  id: z.string(),
  enrollment_basis: z.enum(['office', 'arrangement']),
  workplace_id: z.string().nullable().optional(),
  workplace_name: z.string().nullable().optional(),
  schedule_id: z.string(),
  schedule_name: z.string().nullable().optional(),
  effective_from: z.string(),
  effective_to: z.string().nullable().optional(),
})

export const setupRosterRowSchema = z.object({
  employee_id: z.string(),
  employee_number: z.string(),
  legal_name: z.string(),
  department_id: z.string().nullable().optional(),
  department_name: z.string().nullable().optional(),
  attendance_manager_id: z.string().nullable().optional(),
  attendance_manager_name: z.string().nullable().optional(),
  active_assignment: rosterAssignmentSchema.nullable().optional(),
})

export const setupOverviewResponseSchema = z.object({
  policy: z.object({
    enabled: z.boolean(),
    qa_defaults_pending_client_confirmation: z.boolean().optional(),
  }),
  ready_to_enable: z.boolean(),
  defaults: z
    .object({
      schedule_id: z.string().nullable().optional(),
      workplace_id: z.string().nullable().optional(),
      enrollment_basis: z.enum(['office', 'arrangement']),
      default_manager_employee_id: z.string().nullable().optional(),
      auto_enroll_new: z.boolean(),
      revision: z.number(),
      updated_at: z.string(),
    })
    .nullable()
    .optional(),
  workplaces: z.array(workplaceSchema),
  schedules: z.array(scheduleSchema),
  holidays: z.array(holidaySchema),
  departments: z.array(z.object({ id: z.string(), name: z.string() })),
  roster: z.array(setupRosterRowSchema),
})

/* ─── Form Validation Schemas ─────────────────────────────────────────────── */

export const stillWorkingFormSchema = z.object({
  reason: z.string().trim().min(3, 'Provide a reason (minimum 3 characters).').max(500),
  expectedFinishTime: z
    .string()
    .trim()
    .regex(/^\d{2}:\d{2}$/, 'Expected finish time (HH:mm) is required.'),
})

export const correctionFormSchema = z
  .object({
    localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a valid date.'),
    requestKind: z.enum([
      'missing_clock_in',
      'missing_clock_out',
      'wrong_time',
      'location_issue',
      'other',
    ]),
    claimedInTime: z.string().trim().optional(),
    claimedOutTime: z.string().trim().optional(),
    reason: z.string().trim().min(10, 'Reason must be at least 10 characters.').max(1000),
  })
  .superRefine((val, ctx) => {
    const hasIn = Boolean(val.claimedInTime && /^\d{2}:\d{2}$/.test(val.claimedInTime))
    const hasOut = Boolean(val.claimedOutTime && /^\d{2}:\d{2}$/.test(val.claimedOutTime))
    if (val.requestKind === 'missing_clock_in' && !hasIn) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['claimedInTime'],
        message: 'Clock-in time (HH:mm) is required.',
      })
    }
    if (val.requestKind === 'missing_clock_out' && !hasOut) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['claimedOutTime'],
        message: 'Clock-out time (HH:mm) is required.',
      })
    }
    if ((val.requestKind === 'wrong_time' || val.requestKind === 'other') && !hasIn && !hasOut) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['claimedInTime'],
        message: 'Provide an adjusted start and/or end time.',
      })
    }
  })

export const explanationFormSchema = z.object({
  reason: z.string().trim().min(10, 'Explanation must be at least 10 characters.').max(1000),
  declaredFinishTime: z.string().trim().optional(),
})

export const arrangementFormSchema = z
  .object({
    mode: z.enum(['field', 'remote']),
    coverageType: z.enum(['dated', 'weekly']),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a valid start date.'),
    endDate: z.string().trim().optional(),
    weekdays: z.array(z.number().int().min(0).max(6)),
    dutyLabel: z.string().trim().max(120).optional(),
    reason: z.string().trim().min(5, 'Reason must be at least 5 characters.').max(1000),
  })
  .superRefine((val, ctx) => {
    if (val.coverageType === 'dated' && (!val.endDate || !/^\d{4}-\d{2}-\d{2}$/.test(val.endDate))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'Dated arrangements require an end date.',
      })
    }
    if (val.endDate && /^\d{4}-\d{2}-\d{2}$/.test(val.endDate) && val.endDate < val.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'End date cannot precede start date.',
      })
    }
    if (val.coverageType === 'weekly' && val.weekdays.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['weekdays'],
        message: 'Select at least one recurring weekday.',
      })
    }
  })

export const workplaceFormSchema = z.object({
  name: z.string().trim().min(2, 'Workplace name must be at least 2 characters.').max(120),
  latitude: z.coerce.number().min(-90, 'Latitude must be >= -90.').max(90, 'Latitude must be <= 90.'),
  longitude: z.coerce.number().min(-180, 'Longitude must be >= -180.').max(180, 'Longitude must be <= 180.'),
  radiusMeters: z.coerce.number().int().min(25, 'Minimum 25m.').max(5000, 'Maximum 5000m.'),
  timezone: z.string().trim().min(2, 'Timezone is required.'),
  isActive: z.boolean(),
  reason: z.string().trim().min(3, 'Audit reason requires at least 3 characters.').max(500),
})

export const holidayFormSchema = z.object({
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a valid holiday date.'),
  name: z.string().trim().min(2, 'Holiday name requires at least 2 characters.').max(120),
  isActive: z.boolean(),
  reason: z.string().trim().min(3, 'Audit reason requires at least 3 characters.').max(500),
})

export const reviewDecisionFormSchema = z
  .object({
    decision: z.enum(['approved', 'rejected']),
    note: z.string().trim().max(500),
  })
  .superRefine((val, ctx) => {
    if (val.decision === 'rejected' && val.note.trim().length < 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['note'],
        message: 'Rejection requires a review note of at least 3 characters.',
      })
    }
  })

/* ─── Exported Inferred Types ─────────────────────────────────────────────── */

export type TodayContext = z.infer<typeof todayContextSchema>
export type MyHistoryResponse = z.infer<typeof myHistoryResponseSchema>
export type MyHistoryDay = z.infer<typeof myHistoryDaySchema>
export type MyCorrection = z.infer<typeof myCorrectionSchema>
export type MyExplanation = z.infer<typeof myExplanationSchema>
export type MyArrangement = z.infer<typeof myArrangementSchema>
export type AttendancePunch = z.infer<typeof attendancePunchSchema>
export type RegisterResponse = z.infer<typeof registerResponseSchema>
export type RegisterRow = z.infer<typeof registerRowSchema>
export type ReviewQueuesResponse = z.infer<typeof reviewQueuesResponseSchema>
export type ReviewCorrectionRow = z.infer<typeof reviewCorrectionRowSchema>
export type ReviewExplanationRow = z.infer<typeof reviewExplanationRowSchema>
export type ReviewFieldRow = z.infer<typeof reviewFieldRowSchema>
export type ArrangementsListResponse = z.infer<typeof arrangementsListResponseSchema>
export type ArrangementRow = z.infer<typeof arrangementRowSchema>
export type FieldEvidenceResponse = z.infer<typeof fieldEvidenceResponseSchema>
export type SetupOverviewResponse = z.infer<typeof setupOverviewResponseSchema>
export type WorkplaceSetup = z.infer<typeof workplaceSchema>
export type ScheduleSetup = z.infer<typeof scheduleSchema>
export type HolidaySetup = z.infer<typeof holidaySchema>
export type SetupRosterRow = z.infer<typeof setupRosterRowSchema>
export type MutationEnvelope = z.infer<typeof mutationEnvelopeSchema>
