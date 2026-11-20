import { servicePendingStore } from '../lib/pendingOperations'
import { attendancePendingStore } from '@/modules/attendance/lib/pendingOperations'
import { clearAllProtectedPendingOperations } from '@/lib/idempotency/pendingOperations'

export { clearAllProtectedPendingOperations }

export function writePendingOperationForTest(profileId: string) {
  servicePendingStore.write({
    profileId,
    intentKey: 'service:submit:test',
    operationType: 'service_submit_request',
    rpcName: 'rpc_service_submit_request',
    label: 'Submit Service Request',
    requestId: 'a1000000-0000-4000-8000-000000000001',
    payload: { p_id: 'req-1' },
    payloadCanonical: '{"p_id":"req-1"}',
    createdAt: new Date().toISOString(),
    status: 'uncertain',
  })
  attendancePendingStore.write({
    profileId,
    intentKey: 'execution:punch',
    operationType: 'clock_in',
    rpcName: 'rpc_attendance_clock_in',
    label: 'Start Day',
    requestId: 'a2000000-0000-4000-8000-000000000001',
    payload: { p_location_status: 'in_geofence' },
    payloadCanonical: '{"p_location_status":"in_geofence"}',
    createdAt: new Date().toISOString(),
    status: 'uncertain',
  })
}
