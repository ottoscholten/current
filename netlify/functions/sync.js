import { createClient } from '@supabase/supabase-js'
import { syncRA } from '../lib/sources/ra.js'
import { syncWebsite } from '../lib/sources/website.js'
// import { syncDice } from '../lib/sources/dice.js'  // uncomment when ready

const MIN_CHECK_INTERVAL_HOURS = 1

// Returns the next 14 date strings starting from today
function getWeekDays() {
  const days = []
  const today = new Date()
  for (let i = 0; i < 14; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    days.push(d.toISOString().split('T')[0])
  }
  return days
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' }
  }

  const token = event.headers.authorization?.replace('Bearer ', '')
  if (!token) return { statusCode: 401, body: 'Unauthorized' }

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  )

  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) return { statusCode: 401, body: 'Unauthorized' }

  // Require a taste profile before syncing
  const { data: profile } = await supabase
    .from('profiles')
    .select('taste_profile, taste_parsed')
    .eq('id', user.id)
    .single()

  if (!profile?.taste_profile) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: true, reason: 'no taste profile' }) }
  }

  // Fetch all active sources for this user
  const { data: activePrefs } = await supabase
    .from('user_source_prefs')
    .select('source_id, last_synced_at, skip_taste_filter, sync_interval_hours, synced_days, sources(id, name, url, categories, is_platform, selectors)')
    .eq('user_id', user.id)
    .eq('is_active', true)

  if (!activePrefs?.length) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: true, reason: 'no active sources' }) }
  }

  const upcomingDays = getWeekDays()
  const checkCutoff = new Date(Date.now() - MIN_CHECK_INTERVAL_HOURS * 60 * 60 * 1000)

  // Sync a source if:
  // - It hasn't been checked in the last hour (rate limit), AND
  // - At least one upcoming day isn't in synced_days yet
  const sourcesToSync = activePrefs.filter(p => {
    if (p.last_synced_at && new Date(p.last_synced_at) > checkCutoff) return false
    const synced = p.synced_days ?? []
    return upcomingDays.some(d => !synced.includes(d))
  })

  if (!sourcesToSync.length) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: true, reason: 'fresh' }) }
  }

  const results = {}

  for (const pref of sourcesToSync) {
    const source = pref.sources
    const name = source.name

    try {
      if (!source.is_platform) {
        // User-added website source — sync using saved CSS selectors
        results[name] = await syncWebsite(
          supabase,
          user.id,
          profile.taste_profile,
          profile.taste_parsed || [],
          source,
          pref.skip_taste_filter,
        )
      } else {
        // Built-in platform integration
        switch (name) {
          case 'Resident Advisor London':
            results[name] = await syncRA(supabase, user.id, profile.taste_profile, profile.taste_parsed || [])
            break
          // case 'Dice':
          //   results[name] = await syncDice(supabase, user.id, profile.taste_profile, profile.taste_parsed || [])
          //   break
          default:
            results[name] = { skipped: true, reason: 'no handler' }
        }
      }
    } catch (err) {
      console.error(`Sync error for ${name}:`, err.message)
      results[name] = { error: err.message }
    }
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, results }) }
}
