import { parse, isValid } from 'date-fns'

const FALLBACK_FORMATS = [
  // Full date with year
  'd MMMM yyyy',
  'dd MMMM yyyy',
  'EEEE d MMMM yyyy',
  'EEEE, d MMMM yyyy',
  'EEE d MMM yyyy',
  'EEE, d MMM yyyy',
  'dd MMM yyyy',
  'd MMM yyyy',
  'dd/MM/yyyy',
  'd/MM/yyyy',
  'yyyy-MM-dd',
  'MMMM d, yyyy',
  'MMM d, yyyy',
  // Date without year — uses current year from reference date
  'EEEE d MMMM',
  'EEE d MMM',
  'EEE, d MMM',
  'd MMMM',
  'd MMM',
]

export function parseEventDate(dateStr, dateFormat) {
  if (!dateStr) return null

  const ref = new Date()

  // Try native Date only when the string contains a 4-digit year (ISO 8601, RFC 2822, etc.)
  // Strings without a year (e.g. "Sun 1 Mar") would be misinterpreted as a past year.
  if (/\d{4}/.test(dateStr)) {
    const native = new Date(dateStr)
    if (isValid(native) && native.getFullYear() > 2000) return native
  }

  // Try the stored format first
  if (dateFormat) {
    const parsed = parse(dateStr, dateFormat, ref)
    if (isValid(parsed)) return parsed
  }

  // Try common formats
  for (const fmt of FALLBACK_FORMATS) {
    const parsed = parse(dateStr, fmt, ref)
    if (isValid(parsed)) return parsed
  }

  return null
}

// Given a list of Date objects, estimate how often this source should be synced.
// Primarily uses the average gap between events (event frequency).
// Falls back to how far ahead events are scheduled if there's only one event.
export function estimateSyncHours(dates) {
  const futureDates = dates.filter(d => d > new Date()).sort((a, b) => a - b)
  if (!futureDates.length) return 24

  // With multiple events, use the average gap between them to infer update frequency
  if (futureDates.length >= 2) {
    let totalGap = 0
    for (let i = 1; i < futureDates.length; i++) {
      totalGap += (futureDates[i] - futureDates[i - 1])
    }
    const avgGapDays = totalGap / (futureDates.length - 1) / (1000 * 60 * 60 * 24)

    if (avgGapDays >= 25) return 720  // monthly events  → sync monthly
    if (avgGapDays >= 6)  return 168  // weekly events   → sync weekly
    if (avgGapDays >= 2)  return 72   // every few days  → sync every 3 days
    return 24                          // daily or denser → sync daily
  }

  // Single event — fall back to how far ahead it is
  const daysAhead = (futureDates[0] - Date.now()) / (1000 * 60 * 60 * 24)
  if (daysAhead > 60) return 720
  if (daysAhead > 30) return 168
  if (daysAhead > 14) return 72
  return 24
}
