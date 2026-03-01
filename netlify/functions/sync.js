import { createClient } from '@supabase/supabase-js'
import { syncRA } from '../lib/sources/ra.js'
// import { syncDice } from '../lib/sources/dice.js'  // uncomment when ready

const STALE_HOURS = 6

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

  // Fetch all active sources for this user with their last sync time
  const { data: activePrefs } = await supabase
    .from('user_source_prefs')
    .select('source_id, last_synced_at, sources(name)')
    .eq('user_id', user.id)
    .eq('is_active', true)

  if (!activePrefs?.length) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: true, reason: 'no active sources' }) }
  }

  // Sync a source if it has never been synced (new) or is stale
  const staleAt = new Date(Date.now() - STALE_HOURS * 60 * 60 * 1000)
  const sourcesToSync = activePrefs.filter(p =>
    !p.last_synced_at || new Date(p.last_synced_at) < staleAt
  )

  if (!sourcesToSync.length) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: true, reason: 'fresh' }) }
  }

  const results = {}

  for (const pref of sourcesToSync) {
    const name = pref.sources.name
    try {
      switch (name) {
        case 'Resident Advisor London':
          results[name] = await syncRA(supabase, user.id, profile.taste_profile, profile.taste_parsed || [])
          break
        // case 'Dice':
        //   results[name] = await syncDice(supabase, user.id, profile.taste_profile)
        //   break
        default:
          results[name] = { skipped: true, reason: 'no handler' }
      }
    } catch (err) {
      console.error(`Sync error for ${name}:`, err.message)
      results[name] = { error: err.message }
    }
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, results }) }
}
