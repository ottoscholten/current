import { createClient } from '@supabase/supabase-js'
import { syncRA } from '../lib/sources/ra.js'
import { syncWebsite } from '../lib/sources/website.js'
// import { syncDice } from '../lib/sources/dice.js'  // uncomment when ready

const MIN_CHECK_INTERVAL_HOURS = 1

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
  const { data: activePrefs, error: prefsError } = await supabase
    .from('user_source_prefs')
    .select('source_id, last_synced_at, skip_taste_filter, sync_interval_hours, sources(id, name, url, categories, is_platform, selectors)')
    .eq('user_id', user.id)
    .eq('is_active', true)

  if (prefsError) {
    console.error('Failed to fetch active prefs:', prefsError.message)
    return { statusCode: 500, body: JSON.stringify({ error: prefsError.message }) }
  }

  if (!activePrefs?.length) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: true, reason: 'no active sources' }) }
  }

  const minCutoff = new Date(Date.now() - MIN_CHECK_INTERVAL_HOURS * 60 * 60 * 1000)

  // Sync a source if it hasn't been checked in the last hour AND is stale per its own interval
  const sourcesToSync = activePrefs.filter(p => {
    if (p.last_synced_at && new Date(p.last_synced_at) > minCutoff) return false
    if (!p.last_synced_at) return true
    const intervalHours = p.sync_interval_hours ?? 24
    const staleAfter = new Date(Date.now() - intervalHours * 60 * 60 * 1000)
    return new Date(p.last_synced_at) < staleAfter
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
