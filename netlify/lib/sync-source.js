import { broadFilter, strictFilter } from './ai.js'

// Returns the next 7 date strings starting from today
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
// Per-day append model:
//   - Tracks which days have been synced in user_source_prefs.synced_days
//   - Only fetches days not yet in synced_days
//   - Never deletes events — only appends new ones
//   - Cleans up past events where is_saved = false on each run
//   - Resetting synced_days (e.g. on taste profile change) triggers a full re-sync
//
export async function syncSource(supabase, userId, tasteProfile, tasteParsed = [], sourceName, fetchForDay, normalize, toRow) {
  const { data: source } = await supabase
    .from('sources')
    .select('id')
    .eq('name', sourceName)
    .single()

  if (!source) throw new Error(`Source "${sourceName}" not found in DB`)

  // Get current synced_days for this user+source
  const { data: pref } = await supabase
    .from('user_source_prefs')
    .select('synced_days')
    .eq('user_id', userId)
    .eq('source_id', source.id)
    .single()

  const syncedDays = pref?.synced_days ?? []

  // Cleanup: delete past events that weren't saved
  const today = new Date().toISOString().split('T')[0]
  await supabase
    .from('events')
    .delete()
    .eq('source_id', source.id)
    .eq('user_id', userId)
    .eq('is_saved', false)
    .lt('date', today)

  // Prune past dates from synced_days
  const prunedSyncedDays = syncedDays.filter(d => d >= today)

  // Determine which of the next 7 days still need fetching
  const days = getWeekDays()
  const unsyncedDays = days.filter(d => !prunedSyncedDays.includes(d))

  if (!unsyncedDays.length) {
    return 0 // all days already synced — nothing to do
  }

  const allRows = []
  const newlySyncedDays = []

  for (const day of unsyncedDays) {
    // Mark day as synced regardless of result — avoids re-fetching empty days
    newlySyncedDays.push(day)

    const raw = await fetchForDay(day)
    if (!raw.length) continue

    const normalized = normalize(raw)

    // Pass 1: broad filter
    const candidateIndices = await broadFilter(normalized, tasteProfile, tasteParsed)
    const candidates = candidateIndices.map(i => normalized[i]).filter(Boolean)
    if (!candidates.length) continue

    // Pass 2: strict filter
    const topIndices = await strictFilter(candidates, tasteProfile, tasteParsed)
    const top = topIndices.map(i => candidates[i]).filter(Boolean)
    if (!top.length) continue

    allRows.push(...top.map(e => toRow(e, userId, source.id, day)))
  }

  if (allRows.length) {
    await supabase.from('events').insert(allRows)
  }

  // Update synced_days and last_synced_at
  const updatedSyncedDays = [...new Set([...prunedSyncedDays, ...newlySyncedDays])]

  const { error: upsertError } = await supabase
    .from('user_source_prefs')
    .upsert({
      user_id: userId,
      source_id: source.id,
      is_active: true,
      last_synced_at: new Date().toISOString(),
      synced_days: updatedSyncedDays,
    })

  if (upsertError) console.error(`Failed to update sync state for ${sourceName}:`, upsertError.message)

  return allRows.length
}
