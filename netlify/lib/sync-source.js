import { broadFilter, strictFilter } from './ai.js'

// Returns an array of date strings for the next 7 days starting today
function getWeekDays() {
  const days = []
  const today = new Date()
  for (let i = 0; i < 7; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    days.push(d.toISOString().split('T')[0])
  }
  return days
}

// ─── Generic sync engine ───────────────────────────────────────────────────────
//
// Reusable core for any supported integration. Each integration provides:
//
//   fetchForDay(dateStr) → raw[]
//     Fetch events from the source API for a specific date.
//     Should return up to ~50 events. Return [] if none found.
//
//   normalize(raw[]) → event[]
//     Convert the raw API shape into the common event shape:
//     { title, venue, genres: string[], artists: string[], content: string|null, _raw }
//
//   toRow(event, userId, sourceId, dateStr) → DB row object
//     Map the common event shape to a Supabase `events` table row.
//
// The engine handles:
//   - Looping over 7 days
//   - Running the 2-pass AI filter per day
//   - Inserting all strong matches
//   - Updating user_source_prefs.last_synced_at
//
export async function syncSource(supabase, userId, tasteProfile, tasteParsed = [], sourceName, fetchForDay, normalize, toRow) {
  const { data: source } = await supabase
    .from('sources')
    .select('id')
    .eq('name', sourceName)
    .single()

  if (!source) throw new Error(`Source "${sourceName}" not found in DB`)

  // Clear existing events for this user + source before re-syncing
  await supabase.from('events').delete().eq('source_id', source.id).eq('user_id', userId)

  const days = getWeekDays()
  const allRows = []

  for (const day of days) {
    const raw = await fetchForDay(day)
    if (!raw.length) continue

    const normalized = normalize(raw)

    // Pass 1: broad filter — removes obvious non-matches cheaply
    const candidateIndices = await broadFilter(normalized, tasteProfile, tasteParsed)
    const candidates = candidateIndices.map(i => normalized[i]).filter(Boolean)
    if (!candidates.length) continue

    // Pass 2: strict filter — picks all strong matches from candidates
    const topIndices = await strictFilter(candidates, tasteProfile, tasteParsed)
    const top = topIndices.map(i => candidates[i]).filter(Boolean)
    if (!top.length) continue

    allRows.push(...top.map(e => toRow(e, userId, source.id, day)))
  }

  if (allRows.length) {
    await supabase.from('events').insert(allRows)
  }

  // Mark this source as synced for this user.
  // If this fails, last_synced_at stays null and the next page load will re-sync immediately.
  const { error: upsertError } = await supabase.from('user_source_prefs').upsert({
    user_id: userId,
    source_id: source.id,
    is_active: true,
    last_synced_at: new Date().toISOString(),
  })
  if (upsertError) console.error(`Failed to update last_synced_at for ${sourceName}:`, upsertError.message)

  return allRows.length
}
