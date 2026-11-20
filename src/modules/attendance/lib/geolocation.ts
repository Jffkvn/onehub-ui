import type { AttendanceSessionSnapshot } from './pendingOperations'

/** Client browser geolocation capture outcome (sent as `p_location_status`). */
export type AttendanceLocationStatus =
  | 'captured'
  | 'denied'
  | 'unavailable'
  | 'timeout'
  | 'not_requested'

/** Backend-evaluated persisted punch check (returned as `location_check`). */
export type PersistedLocationCheck =
  | 'onsite'
  | 'outside'
  | 'poor_accuracy'
  | 'unavailable'
  | 'denied'
  | 'not_required'
  | 'recorded'

export interface CapturedAttendanceLocation {
  locationStatus: AttendanceLocationStatus
  lat: number | null
  lng: number | null
  accuracyM: number | null
  clientCapturedAt: string | null
}

const NOT_REQUESTED_RESULT: CapturedAttendanceLocation = {
  locationStatus: 'not_requested',
  lat: null,
  lng: null,
  accuracyM: null,
  clientCapturedAt: null,
}

export async function captureAttendanceLocation(
  workMode: 'office' | 'field' | 'remote' | 'none',
  action: 'clock_in' | 'clock_out' | 'still_working',
): Promise<CapturedAttendanceLocation> {
  const needsGps =
    action === 'still_working'
      ? workMode === 'office'
      : workMode === 'office' || workMode === 'field'

  if (!needsGps) {
    return NOT_REQUESTED_RESULT
  }

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return {
      locationStatus: 'unavailable',
      lat: null,
      lng: null,
      accuracyM: null,
      clientCapturedAt: null,
    }
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const capturedMs =
          typeof position.timestamp === 'number' && Number.isFinite(position.timestamp)
            ? position.timestamp
            : Date.now()
        resolve({
          locationStatus: 'captured',
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracyM: Number.isFinite(position.coords.accuracy)
            ? position.coords.accuracy
            : null,
          clientCapturedAt: new Date(capturedMs).toISOString(),
        })
      },
      (geoError) => {
        const status: AttendanceLocationStatus =
          geoError.code === 1 ? 'denied' : geoError.code === 3 ? 'timeout' : 'unavailable'
        resolve({
          locationStatus: status,
          lat: null,
          lng: null,
          accuracyM: null,
          clientCapturedAt: null,
        })
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      },
    )
  })
}

export async function captureSessionScopedAttendanceLocation(
  workMode: 'office' | 'field' | 'remote' | 'none',
  action: 'clock_in' | 'clock_out' | 'still_working',
  snapshot: AttendanceSessionSnapshot,
  isCurrentFn: (snap: AttendanceSessionSnapshot) => boolean,
): Promise<CapturedAttendanceLocation> {
  if (!isCurrentFn(snapshot)) {
    throw new DOMException('Session changed before location capture started.', 'AbortError')
  }
  const captured = await captureAttendanceLocation(workMode, action)
  if (!isCurrentFn(snapshot)) {
    throw new DOMException('Account session changed while capturing location.', 'AbortError')
  }
  return captured
}

export type LocationBadgeTone = 'success' | 'warning' | 'danger' | 'neutral' | 'info'

export function describeLocationCheck(
  locationCheck?: PersistedLocationCheck | (string & {}) | null,
  distanceMeters?: number | null,
): { label: string; tone: LocationBadgeTone } {
  const distSuffix =
    typeof distanceMeters === 'number' && Number.isFinite(distanceMeters)
      ? ` (${Math.round(distanceMeters)}m)`
      : ''

  switch (locationCheck) {
    case 'onsite':
      return { label: `Onsite verified${distSuffix}`, tone: 'success' }
    case 'outside':
      return { label: `Outside zone${distSuffix}`, tone: 'danger' }
    case 'poor_accuracy':
      return { label: 'Low GPS precision', tone: 'warning' }
    case 'denied':
      return { label: 'GPS denied', tone: 'warning' }
    case 'unavailable':
      return { label: 'GPS unavailable', tone: 'warning' }
    case 'not_required':
      return { label: 'GPS not required', tone: 'neutral' }
    case 'recorded':
      return { label: 'Field GPS recorded', tone: 'info' }
    default:
      return { label: 'Not recorded', tone: 'neutral' }
  }
}
