/** Formats ISO YYYY-MM-DD or timestamp cleanly for Kampala / UG readers. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return 'Not recorded'
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('en-UG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: /^\d{4}-\d{2}-\d{2}$/.test(value) ? 'UTC' : 'Africa/Kampala',
  }).format(parsed)
}

/** Converts snake_case enum tokens into readable Title Case labels. */
export function formatLabel(value: string | null | undefined, fallback = 'Not recorded'): string {
  if (!value) return fallback
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => (part[0] ? part[0].toUpperCase() + part.slice(1) : ''))
    .join(' ')
}

/** Formats currency values without decimals as e.g. "UGX 1,500,000". */
export function formatMoney(
  value: number | null | undefined,
  currencyCode = 'UGX',
  fallback = 'Not provided',
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return fallback
  return `${currencyCode} ${Math.round(value).toLocaleString('en-UG')}`
}

/** Masks sensitive account identifiers when shown in summary displays. */
export function maskAccount(value: string | null | undefined): string {
  if (!value) return '—'
  const s = value.trim()
  if (s.length <= 4) return s
  return `${s.slice(0, 4)} ···· ${s.slice(-4)}`
}

/** Masks phone numbers in compact summary contexts. */
export function maskPhone(value: string | null | undefined): string {
  if (!value) return '—'
  const s = value.replace(/\s+/g, '')
  if (s.length < 8) return s
  return `${s.slice(0, 6)} ···· ${s.slice(-2)}`
}
