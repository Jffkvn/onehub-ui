import { z } from 'zod'

export const SERVICE_REQUEST_TYPES = ['installation', 'maintenance'] as const
export type ServiceRequestType = (typeof SERVICE_REQUEST_TYPES)[number]

export const SERVICE_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export type ServicePriority = (typeof SERVICE_PRIORITIES)[number]

export const SERVICE_RECEIVED_SOURCES = [
  'provider_email',
  'provider_portal',
  'phone',
  'walk_in',
] as const
export type ServiceReceivedSource = (typeof SERVICE_RECEIVED_SOURCES)[number]

export const SERVICE_REQUEST_STATUSES = [
  'draft',
  'submitted',
  'assigned',
  'in_progress',
  'follow_up_required',
  'work_completed',
  'coordinator_reviewed',
  'reported_to_provider',
  'provider_confirmed',
  'cancelled',
] as const
export type ServiceRequestStatus = (typeof SERVICE_REQUEST_STATUSES)[number]

export const SERVICE_URGENT_REASON_CODES = [
  'safety_hazard',
  'access_blocked',
  'fiber_backbone_fault',
  'customer_escalation',
  'material_shortage',
  'other',
] as const
export type ServiceUrgentReasonCode = (typeof SERVICE_URGENT_REASON_CODES)[number]

export const SERVICE_URGENT_STATUSES = ['open', 'acknowledged', 'resolved'] as const
export type ServiceUrgentStatus = (typeof SERVICE_URGENT_STATUSES)[number]

export const NOTIFICATION_DELIVERY_STATUSES = [
  'pending',
  'processing',
  'sent',
  'failed',
  'skipped',
] as const
export type NotificationDeliveryStatus = (typeof NOTIFICATION_DELIVERY_STATUSES)[number]

export const SERVICE_MONITOR_BUCKETS = [
  'all',
  'unassigned',
  'ongoing',
  'follow_up',
  'review',
  'urgent',
  'overdue',
  'acknowledged',
] as const
export type ServiceMonitorBucket = (typeof SERVICE_MONITOR_BUCKETS)[number]

export const SERVICE_VIEWER_SCOPES = [
  'full',
  'active_assigned',
  'historical_participant',
] as const
export type ServiceViewerScope = (typeof SERVICE_VIEWER_SCOPES)[number]

export const SERVICE_TYPE_LABELS: Record<ServiceRequestType, string> = {
  installation: 'Installation',
  maintenance: 'Maintenance',
}

export const SERVICE_PRIORITY_LABELS: Record<ServicePriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
}

export const SERVICE_SOURCE_LABELS: Record<ServiceReceivedSource, string> = {
  provider_email: 'Provider Email',
  provider_portal: 'Provider Portal',
  phone: 'Phone Call',
  walk_in: 'Walk-In / Direct',
}

export const SERVICE_STATUS_LABELS: Record<ServiceRequestStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  follow_up_required: 'Follow-Up Required',
  work_completed: 'Work Completed',
  coordinator_reviewed: 'Coordinator Reviewed',
  reported_to_provider: 'Reported to Provider',
  provider_confirmed: 'Provider Confirmed',
  cancelled: 'Cancelled',
}

export const SERVICE_URGENT_REASON_LABELS: Record<ServiceUrgentReasonCode, string> = {
  safety_hazard: 'Safety Hazard',
  access_blocked: 'Access / Entry Blocked',
  fiber_backbone_fault: 'Fibre Backbone Fault',
  customer_escalation: 'Customer Escalation',
  material_shortage: 'Material / Hardware Shortage',
  other: 'Other Operational Block',
}

export const SERVICE_URGENT_STATUS_LABELS: Record<ServiceUrgentStatus, string> = {
  open: 'Open Urgent Flag',
  acknowledged: 'Acknowledged',
  resolved: 'Resolved',
}

export const serviceChecklistItemSchema = z.object({
  key: z.string(),
  label: z.string(),
})
export type ServiceChecklistItem = z.infer<typeof serviceChecklistItemSchema>

export const serviceChecklistsResponseSchema = z.object({
  provisional: z.boolean().optional().default(true),
  installation: z.array(serviceChecklistItemSchema).default([]),
  maintenance: z.array(serviceChecklistItemSchema).default([]),
})
export type ServiceChecklistsResponse = z.infer<typeof serviceChecklistsResponseSchema>

export const dispatchCandidateSchema = z.object({
  profile_id: z.string().uuid(),
  display_name: z.string(),
  employee_id: z.string().uuid().nullable().optional(),
  employee_number: z.string().nullable().optional(),
  role_keys: z.array(z.string()).nullable().optional().default([]),
})
export type DispatchCandidate = z.infer<typeof dispatchCandidateSchema>
export const dispatchCandidatesResponseSchema = z.array(dispatchCandidateSchema)

export const serviceRequestListRowSchema = z.object({
  id: z.string().uuid(),
  internal_code: z.string(),
  provider_name: z.string(),
  provider_reference: z.string(),
  request_type: z.enum(SERVICE_REQUEST_TYPES),
  priority: z.enum(SERVICE_PRIORITIES),
  site_name: z.string(),
  area_label: z.string(),
  status: z.enum(SERVICE_REQUEST_STATUSES),
  received_source: z.enum(SERVICE_RECEIVED_SOURCES),
  provider_received_at: z.string(),
  provider_deadline_at: z.string().nullable(),
  submitted_at: z.string().nullable(),
  accepted_at: z.string().nullable(),
  assigned_at: z.string().nullable(),
  work_completed_at: z.string().nullable(),
  coordinator_reviewed_at: z.string().nullable(),
  reported_to_provider_at: z.string().nullable(),
  provider_confirmed_at: z.string().nullable(),
  intake_owner_profile_id: z.string().uuid(),
  accepted_by_profile_id: z.string().uuid().nullable(),
  lead_profile_id: z.string().uuid().nullable(),
  lead_name: z.string().nullable(),
  assistant_count: z.number().int().nonnegative(),
  open_urgent_count: z.number().int().nonnegative(),
  highest_urgent_status: z.enum(['open', 'acknowledged', 'resolved', 'none']),
  version: z.number().int().positive(),
})
export type ServiceRequestListRow = z.infer<typeof serviceRequestListRowSchema>

export const serviceRequestsListResponseSchema = z.object({
  total_count: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  rows: z.array(serviceRequestListRowSchema),
})
export type ServiceRequestsListResponse = z.infer<typeof serviceRequestsListResponseSchema>

export const myAssignedRequestRowSchema = z.object({
  id: z.string().uuid(),
  internal_code: z.string(),
  request_type: z.enum(SERVICE_REQUEST_TYPES),
  priority: z.enum(SERVICE_PRIORITIES),
  site_name: z.string(),
  area_label: z.string(),
  status: z.enum(SERVICE_REQUEST_STATUSES),
  provider_name: z.string(),
  provider_deadline_at: z.string().nullable(),
  is_active_assignment: z.boolean(),
  my_role: z.enum(['lead', 'assistant']).nullable(),
  open_visit_id: z.string().uuid().nullable(),
  open_urgent_count: z.number().int().nonnegative(),
  version: z.number().int().positive(),
})
export type MyAssignedRequestRow = z.infer<typeof myAssignedRequestRowSchema>

export const myAssignedRequestsResponseSchema = z.object({
  total_count: z.number().int().nonnegative().optional(),
  active_count: z.number().int().nonnegative().optional(),
  historical_count: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  rows: z.array(myAssignedRequestRowSchema),
})
export type MyAssignedRequestsResponse = z.infer<typeof myAssignedRequestsResponseSchema>

export const serviceCategoryOverviewCountsSchema = z.object({
  total: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  submitted: z.number().int().nonnegative(),
  follow_up_required: z.number().int().nonnegative(),
  work_completed: z.number().int().nonnegative(),
  open_urgent_tickets: z.number().int().nonnegative(),
  open_urgent_flags: z.number().int().nonnegative(),
})
export type ServiceCategoryOverviewCounts = z.infer<typeof serviceCategoryOverviewCountsSchema>

export const serviceOverviewCountsSchema = z.object({
  total_count: z.number().int().nonnegative(),
  installation: serviceCategoryOverviewCountsSchema,
  maintenance: serviceCategoryOverviewCountsSchema,
  queues: z.object({
    intake_attention_count: z.number().int().nonnegative(),
    draft_count: z.number().int().nonnegative(),
    submitted_count: z.number().int().nonnegative(),
    assigned_count: z.number().int().nonnegative(),
    in_progress_count: z.number().int().nonnegative(),
    follow_up_required_count: z.number().int().nonnegative(),
    work_completed_count: z.number().int().nonnegative(),
    coordinator_reviewed_count: z.number().int().nonnegative(),
    reported_to_provider_count: z.number().int().nonnegative(),
    provider_confirmed_count: z.number().int().nonnegative(),
    cancelled_count: z.number().int().nonnegative(),
    open_urgent_tickets: z.number().int().nonnegative(),
    open_urgent_flags: z.number().int().nonnegative(),
  }),
})
export type ServiceOverviewCounts = z.infer<typeof serviceOverviewCountsSchema>

export const activeCrewMemberSchema = z.object({
  profile_id: z.string().uuid(),
  employee_id: z.string().uuid().nullable().optional(),
  display_name: z.string(),
  assignment_role: z.enum(['lead', 'assistant']),
})
export type ActiveCrewMember = z.infer<typeof activeCrewMemberSchema>

export const visitContributorSchema = z.object({
  id: z.string().uuid(),
  profile_id: z.string().uuid(),
  display_name: z.string(),
  arrival_at: z.string(),
  note: z.string().nullable(),
  photo_paths: z.array(z.string()).default([]),
  updated_at: z.string(),
})
export type VisitContributor = z.infer<typeof visitContributorSchema>

export const serviceVisitSchema = z.object({
  id: z.string().uuid(),
  assignment_id: z.string().uuid(),
  visit_number: z.number().int().positive(),
  lead_profile_id: z.string().uuid(),
  lead_name: z.string(),
  started_by: z.string().uuid().nullable().optional(),
  completed_by: z.string().uuid().nullable().optional(),
  visit_status: z.enum(['in_progress', 'work_completed', 'follow_up_required', 'superseded']),
  checklist: z.record(z.string(), z.unknown()).default({}),
  work_notes: z.string().nullable(),
  photo_paths: z.array(z.string()).default([]),
  outcome: z.enum(['completed', 'follow_up_required']).nullable(),
  follow_up_reason: z.string().nullable(),
  arrival_at: z.string(),
  ended_at: z.string().nullable(),
  client_captured_at: z.string().nullable().optional(),
  version: z.number().int().positive(),
  contributors: z.array(visitContributorSchema).default([]),
})
export type ServiceVisit = z.infer<typeof serviceVisitSchema>

export const urgentFlagDeliverySummarySchema = z.object({
  total: z.number().int().nonnegative(),
  sent: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  processing: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  retryable_count: z.number().int().nonnegative().optional(),
  reissuable_count: z.number().int().nonnegative().optional(),
  max_attempt_count: z.number().int().nonnegative(),
  requires_reconciliation: z.boolean(),
  latest_status: z.enum(NOTIFICATION_DELIVERY_STATUSES).nullable(),
  latest_error_code: z.string().nullable(),
  last_attempt_at: z.string().nullable(),
})
export type UrgentFlagDeliverySummary = z.infer<typeof urgentFlagDeliverySummarySchema>

export const urgentFlagDeliveryAttemptSchema = z.object({
  id: z.string().uuid(),
  recipient_name: z.string(),
  status: z.enum(NOTIFICATION_DELIVERY_STATUSES),
  attempt_count: z.number().int().nonnegative(),
  last_error_code: z.string().nullable(),
  requires_reconciliation: z.boolean(),
  is_retryable: z.boolean().optional(),
  is_reissuable: z.boolean().optional(),
  first_provider_attempt_at: z.string().nullable(),
  next_attempt_at: z.string().nullable(),
  reconciled_at: z.string().nullable(),
  updated_at: z.string(),
})
export type UrgentFlagDeliveryAttempt = z.infer<typeof urgentFlagDeliveryAttemptSchema>

export const serviceUrgentFlagSchema = z.object({
  id: z.string().uuid(),
  visit_id: z.string().uuid().nullable(),
  reason_code: z.enum(SERVICE_URGENT_REASON_CODES),
  summary: z.string(),
  status: z.enum(SERVICE_URGENT_STATUSES),
  reported_by: z.string().uuid(),
  reported_by_name: z.string(),
  reported_at: z.string(),
  acknowledged_by: z.string().uuid().nullable().optional(),
  acknowledged_by_name: z.string().nullable().optional(),
  acknowledged_at: z.string().nullable().optional(),
  acknowledgement_note: z.string().nullable().optional(),
  resolved_by: z.string().uuid().nullable().optional(),
  resolved_by_name: z.string().nullable().optional(),
  resolved_at: z.string().nullable().optional(),
  resolution_note: z.string().nullable().optional(),
  version: z.number().int().positive(),
  delivery_summary: urgentFlagDeliverySummarySchema.nullable().optional(),
  deliveries: z.array(urgentFlagDeliveryAttemptSchema).nullable().optional(),
})
export type ServiceUrgentFlag = z.infer<typeof serviceUrgentFlagSchema>

export const serviceRequestEventSchema = z.object({
  id: z.string().uuid(),
  event_type: z.string(),
  actor_profile_id: z.string().uuid().nullable(),
  actor_name: z.string().nullable(),
  from_status: z.string().nullable(),
  to_status: z.string().nullable(),
  details: z.unknown().nullable().optional(),
  occurred_at: z.string(),
})
export type ServiceRequestEvent = z.infer<typeof serviceRequestEventSchema>

export const serviceRequestDetailSchema = z.object({
  viewer_scope: z.enum(SERVICE_VIEWER_SCOPES),
  id: z.string().uuid(),
  internal_code: z.string(),
  provider_name: z.string(),
  provider_reference: z.string().nullable(),
  request_type: z.enum(SERVICE_REQUEST_TYPES),
  priority: z.enum(SERVICE_PRIORITIES),
  site_name: z.string(),
  area_label: z.string(),
  physical_address: z.string().nullable(),
  access_instructions: z.string().nullable(),
  customer_contact_name: z.string().nullable(),
  customer_contact_phone: z.string().nullable(),
  summary: z.string(),
  intake_internal_notes: z.string().nullable().optional(),
  received_source: z.enum(SERVICE_RECEIVED_SOURCES).nullable().optional(),
  provider_received_at: z.string(),
  provider_deadline_at: z.string().nullable(),
  status: z.enum(SERVICE_REQUEST_STATUSES),
  created_at: z.string().nullable().optional(),
  submitted_at: z.string().nullable().optional(),
  accepted_at: z.string().nullable().optional(),
  assigned_at: z.string().nullable().optional(),
  work_completed_at: z.string().nullable().optional(),
  coordinator_reviewed_at: z.string().nullable().optional(),
  reported_to_provider_at: z.string().nullable().optional(),
  provider_confirmed_at: z.string().nullable().optional(),
  cancelled_at: z.string().nullable().optional(),
  provider_report_note: z.string().nullable().optional(),
  provider_confirmation_note: z.string().nullable().optional(),
  cancellation_reason: z.string().nullable().optional(),
  rework_reason: z.string().nullable().optional(),
  version: z.number().int().positive(),
  active_assignment_id: z.string().uuid().nullable(),
  active_episode_number: z.number().int().positive().nullable(),
  my_assignment_role: z.enum(['lead', 'assistant']).nullable(),
  active_crew: z.array(activeCrewMemberSchema).default([]),
  visits: z.array(serviceVisitSchema).default([]),
  urgent_flags: z.array(serviceUrgentFlagSchema).default([]),
  events: z.array(serviceRequestEventSchema).default([]),
})
export type ServiceRequestDetail = z.infer<typeof serviceRequestDetailSchema>

export const serviceMutationEnvelopeSchema = z.object({
  request_id: z.string().uuid(),
  operation_type: z.string(),
  replayed: z.boolean(),
  result: z.record(z.string(), z.unknown()),
})
export type ServiceMutationEnvelope = z.infer<typeof serviceMutationEnvelopeSchema>

/* ─── Batch 6 Display-Safe Operations Monitor & Urgent Delivery Schemas ───── */

export const serviceMonitorSnapshotSchema = z.object({
  generated_at: z.string(),
  unassigned_count: z.number().int().nonnegative(),
  assigned_count: z.number().int().nonnegative(),
  in_progress_count: z.number().int().nonnegative(),
  follow_up_count: z.number().int().nonnegative(),
  review_pending_count: z.number().int().nonnegative(),
  reported_pending_confirm_count: z.number().int().nonnegative(),
  overdue_count: z.number().int().nonnegative(),
  open_urgent_flags_count: z.number().int().nonnegative(),
  acknowledged_urgent_flags_count: z.number().int().nonnegative(),
})
export type ServiceMonitorSnapshot = z.infer<typeof serviceMonitorSnapshotSchema>

// Strict whitelist ONLY: zero customer names/phones, addresses, access info, or freeform notes.
export const serviceMonitorQueueRowSchema = z.object({
  id: z.string().uuid(),
  internal_code: z.string(),
  request_type: z.enum(SERVICE_REQUEST_TYPES),
  priority: z.enum(SERVICE_PRIORITIES),
  area_label: z.string(),
  status: z.enum(SERVICE_REQUEST_STATUSES),
  has_blocker: z.boolean(),
  open_urgent_count: z.number().int().nonnegative(),
  highest_urgent_status: z.enum(['open', 'acknowledged', 'resolved', 'none']),
  urgent_reason_code: z.enum(SERVICE_URGENT_REASON_CODES).nullable(),
  submitted_at: z.string().nullable(),
  assigned_at: z.string().nullable(),
  provider_deadline_at: z.string().nullable(),
  assigned_lead_name: z.string().nullable(),
})
export type ServiceMonitorQueueRow = z.infer<typeof serviceMonitorQueueRowSchema>

export const serviceMonitorQueueResponseSchema = z.object({
  generated_at: z.string(),
  bucket: z.enum(SERVICE_MONITOR_BUCKETS),
  total_count: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  rows: z.array(serviceMonitorQueueRowSchema),
})
export type ServiceMonitorQueueResponse = z.infer<typeof serviceMonitorQueueResponseSchema>

export const coordinatorUrgentFlagRowSchema = serviceUrgentFlagSchema.extend({
  service_request_id: z.string().uuid(),
  internal_code: z.string(),
  site_name: z.string(),
  area_label: z.string(),
  request_type: z.enum(SERVICE_REQUEST_TYPES),
  request_status: z.enum(SERVICE_REQUEST_STATUSES),
})
export type CoordinatorUrgentFlagRow = z.infer<typeof coordinatorUrgentFlagRowSchema>

export const coordinatorUrgentFlagsListResponseSchema = z.object({
  total_count: z.number().int().nonnegative(),
  open_count: z.number().int().nonnegative(),
  acknowledged_count: z.number().int().nonnegative(),
  failed_delivery_flags_count: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  rows: z.array(coordinatorUrgentFlagRowSchema),
})
export type CoordinatorUrgentFlagsListResponse = z.infer<typeof coordinatorUrgentFlagsListResponseSchema>

export const retryUrgentDeliveryResultSchema = z.object({
  flag_id: z.string().uuid(),
  retried_count: z.number().int().nonnegative(),
  skipped_unauthorised_count: z.number().int().nonnegative(),
  exhausted_count: z.number().int().nonnegative(),
  reconciliation_required_count: z.number().int().nonnegative(),
})
export type RetryUrgentDeliveryResult = z.infer<typeof retryUrgentDeliveryResultSchema>

export const reissueUrgentDeliveryResultSchema = z.object({
  flag_id: z.string().uuid(),
  reconciled_count: z.number().int().nonnegative(),
  reissued_count: z.number().int().nonnegative(),
})
export type ReissueUrgentDeliveryResult = z.infer<typeof reissueUrgentDeliveryResultSchema>
