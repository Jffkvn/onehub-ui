const DEFAULT_ATTENDANCE_TZ = 'Africa/Kampala'

export function normalizeTimezone(timeZone?: string | null): string {
  const trimmed = timeZone?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_ATTENDANCE_TZ
}

interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function extractZonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: normalizeTimezone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const parts = formatter.formatToParts(date)
  const map: Record<string, string> = {}
  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value
    }
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour === '24' ? '0' : map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  }
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatTimeInZone(isoString?: string | null, timeZone?: string | null): string {
  if (!isoString) return '—'
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return '—'
  const parts = extractZonedParts(date, normalizeTimezone(timeZone))
  return `${pad2(parts.hour)}:${pad2(parts.minute)}`
}

export function formatDateTimeInZone(isoString?: string | null, timeZone?: string | null): string {
  if (!isoString) return '—'
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-UG', {
    timeZone: normalizeTimezone(timeZone),
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}

export function formatLocalDateLabel(localDate?: string | null): string {
  if (!localDate) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate.trim())
  if (!match) return localDate
  const utcDate = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0))
  return new Intl.DateTimeFormat('en-UG', {
    timeZone: 'UTC',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(utcDate)
}

export function formatWallClockDateInput(isoString?: string | null, timeZone?: string | null): string {
  if (!isoString) return ''
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return ''
  const p = extractZonedParts(date, normalizeTimezone(timeZone))
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`
}

export function formatWallClockTimeInput(isoString?: string | null, timeZone?: string | null): string {
  if (!isoString) return ''
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return ''
  const p = extractZonedParts(date, normalizeTimezone(timeZone))
  return `${pad2(p.hour)}:${pad2(p.minute)}`
}

/**
 * Converts a calendar date ("YYYY-MM-DD") and wall-clock time ("HH:mm") interpreted inside
 * `timeZone` into a UTC ISO-8601 timestamp string using iterative Intl adjustment.
 */
export function zonedWallClockToIso(
  localDate: string,
  timeHHmm: string,
  timeZone?: string | null,
): string | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate.trim())
  const timeMatch = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(timeHHmm.trim())
  if (!dateMatch || !timeMatch) return null

  const tz = normalizeTimezone(timeZone)
  const targetYear = Number(dateMatch[1])
  const targetMonth = Number(dateMatch[2])
  const targetDay = Number(dateMatch[3])
  const targetHour = Number(timeMatch[1])
  const targetMinute = Number(timeMatch[2])
  const targetSecond = Number(timeMatch[3] ?? '0')

  const desiredUtcMs = Date.UTC(
    targetYear,
    targetMonth - 1,
    targetDay,
    targetHour,
    targetMinute,
    targetSecond,
  )

  let candidateMs = desiredUtcMs
  for (let i = 0; i < 3; i += 1) {
    const actual = extractZonedParts(new Date(candidateMs), tz)
    const actualAsUtcMs = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    )
    const diffMs = desiredUtcMs - actualAsUtcMs
    if (diffMs === 0) break
    candidateMs += diffMs
  }

  return new Date(candidateMs).toISOString()
}

export function zonedDateTimeInputToIso(value: string, timeZone?: string | null): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?$/.exec(value.trim())
  if (!match) return null
  return zonedWallClockToIso(match[1], match[3] ? `${match[2]}:${match[3]}` : match[2], timeZone)
}

export function formatMinutesDuration(totalMinutes?: number | null): string {
  if (totalMinutes == null || totalMinutes <= 0) return '0m'
  const hours = Math.floor(totalMinutes / 60)
  const mins = totalMinutes % 60
  if (hours === 0) return `${mins}m`
  if (mins === 0) return `${hours}h`
  return `${hours}h ${mins}m`
}

export function getTodayIsoInZone(timeZone?: string | null, now = new Date()): string {
  const p = extractZonedParts(now, normalizeTimezone(timeZone))
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`
}

export function addDaysToIsoDate(isoDate: string, deltaDays: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim())
  if (!match) return isoDate
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + deltaDays))
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`
}

export function formatSqlTimeShort(sqlTime?: string | null): string {
  if (!sqlTime) return '—'
  const match = /^(\d{2}:\d{2})/.exec(sqlTime.trim())
  return match ? match[1] : sqlTime
}
