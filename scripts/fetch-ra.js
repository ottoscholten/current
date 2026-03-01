import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY
)

const AI_URL = 'https://openrouter.ai/api/v1/chat/completions'
const RA_URL = 'https://ra.co/graphql'
const LONDON_AREA_ID = 13


function getDateRange() {
  const today = new Date()
  const twoWeeks = new Date()
  twoWeeks.setDate(today.getDate() + 14)
  return {
    gte: today.toISOString().split('T')[0],
    lte: twoWeeks.toISOString().split('T')[0],
  }
}

// ─── Generic AI helpers ───────────────────────────────────────────────────────

async function callAI(prompt) {
  const res = await fetch(AI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'meta-llama/llama-3.1-8b-instruct',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`AI request failed: ${res.status} — ${text}`)
  }

  const json = await res.json()
  return JSON.parse(json.choices[0].message.content)
}

// Pass 1: broad filter using lightweight fields (title, venue, genres, artists)
// Returns indices of potential matches — liberal, to avoid missing anything good
async function broadFilter(events, tasteProfile) {
  const eventList = events.map((e, i) => {
    const genres = e.genres.join(', ') || 'unknown'
    const artists = e.artists.join(', ') || 'unknown'
    return `${i}. "${e.title}" at ${e.venue} | Genres: ${genres} | Artists: ${artists}`
  }).join('\n')

  const prompt = `You are a personal event curator filtering events for one person.

Their taste: "${tasteProfile}"

Rule: include an event ONLY if it clearly involves at least one of:
- Trance, psychedelic, dark/hypnotic techno, or deep/heavy house music
- A DJ or artist known for those genres
- Ballet, contemporary, or modern dance performance

Exclude everything else (pop, R&B, hip-hop, disco, soul, funk, jazz, drum & bass, comedy, etc.).

Events:
${eventList}

Return ONLY a JSON object: {"matches": [0, 3, 7, ...]}`

  const result = await callAI(prompt)
  return result.matches || []
}

// Pass 2: strict filter using full event content — picks top 5, ranked best first
async function strictFilter(events, tasteProfile) {
  const eventList = events.map((e, i) => {
    const genres = e.genres.join(', ') || 'unknown'
    const artists = e.artists.join(', ') || 'unknown'
    const content = e.content ? `\n   Info: ${e.content.slice(0, 400)}` : ''
    return `${i}. "${e.title}" at ${e.venue} | Genres: ${genres} | Artists: ${artists}${content}`
  }).join('\n\n')

  const prompt = `You are a personal event curator. Rank these events by how well they match this taste profile and return the best 5, ranked best first. Only include events that are a strong match — if fewer than 5 are genuinely good, return fewer.

Taste: "${tasteProfile}"

Events:
${eventList}

Return ONLY a JSON object: {"matches": [0, 3, 7, ...]}`

  const result = await callAI(prompt)
  // Hard cap at 5 regardless of what the model returns
  return (result.matches || []).slice(0, 5)
}

// ─── RA-specific fetching + normalisation ─────────────────────────────────────

async function fetchRAEvents() {
  const { gte, lte } = getDateRange()

  const body = {
    query: `{
      eventListings(
        filters: {
          areas: { eq: ${LONDON_AREA_ID} }
          listingDate: { gte: "${gte}", lte: "${lte}" }
        }
        page: 1
        pageSize: 100
      ) {
        data {
          listingDate
          event {
            title
            startTime
            contentUrl
            content
            venue { name }
            artists { name }
            genres { name }
            pick { blurb }
          }
        }
        totalResults
      }
    }`,
  }

  const res = await fetch(RA_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Referer: 'https://ra.co/events/uk/london',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) throw new Error(`RA request failed: ${res.status}`)

  const json = await res.json()

  if (json.errors) {
    console.error('RA GraphQL errors:', JSON.stringify(json.errors, null, 2))
    throw new Error('RA GraphQL query failed')
  }

  return json.data.eventListings.data
}

// Normalize RA listings to a common shape for the filter pipeline.
// _raw keeps the original listing for DB insertion.
function normalizeRA(listings) {
  return listings.map(l => ({
    title: l.event.title,
    venue: l.event.venue?.name || 'Unknown venue',
    genres: (l.event.genres || []).map(g => g.name),
    artists: (l.event.artists || []).map(a => a.name),
    content: l.event.content || null,
    _raw: l,
  }))
}

// ─── Per-user filtering + storage ─────────────────────────────────────────────

async function fetchAndStoreForUser(userId, tasteProfile, sourceId, normalized) {
  console.log(`\nProcessing user ${userId}...`)

  if (!tasteProfile) {
    console.log('  No taste profile set — skipping')
    return
  }

  // Clear existing RA events for this user
  const { error: deleteError } = await supabase
    .from('events')
    .delete()
    .eq('source_id', sourceId)
    .eq('user_id', userId)

  if (deleteError) {
    console.error('  Failed to clear old events:', deleteError.message)
    return
  }

  console.log('  Pass 1: broad filter...')
  const candidateIndices = await broadFilter(normalized, tasteProfile)
  const candidates = candidateIndices.map(i => normalized[i]).filter(Boolean)
  console.log(`  ${candidates.length} candidates after pass 1`)

  if (candidates.length === 0) {
    console.log('  No candidates found.')
    return
  }

  console.log('  Pass 2: strict filter...')
  const topIndices = await strictFilter(candidates, tasteProfile)
  const top = topIndices.map(i => candidates[i]).filter(Boolean)
  console.log(`  ${top.length} events selected`)

  if (top.length === 0) return

  const rows = top.map(e => {
    const l = e._raw
    return {
      user_id: userId,
      source_id: sourceId,
      title: e.title,
      venue: e.venue,
      neighbourhood: null,
      date: l.listingDate.split('T')[0],
      time: l.event.startTime ? l.event.startTime.slice(11, 16) : '00:00',
      category: 'Music',
      is_saved: false,
      url: l.event.contentUrl ? `https://ra.co${l.event.contentUrl}` : null,
      description: l.event.pick?.blurb ?? e.content ?? null,
    }
  })

  const { error } = await supabase.from('events').insert(rows)
  if (error) {
    console.error('  Supabase insert error:', error.message)
  } else {
    console.log(`  Stored ${rows.length} events`)
    rows.forEach(r => console.log(`   - ${r.date} | ${r.title} @ ${r.venue}`))
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Find the RA source
  const { data: source, error: sourceError } = await supabase
    .from('sources')
    .select('id')
    .eq('name', 'Resident Advisor London')
    .single()

  if (sourceError || !source) {
    console.error('Could not find "Resident Advisor London" source in DB:', sourceError?.message)
    process.exit(1)
  }

  // Find all users who have RA enabled (via user_source_prefs or no pref row = default active)
  const { data: prefs, error: prefsError } = await supabase
    .from('user_source_prefs')
    .select('user_id')
    .eq('source_id', source.id)
    .eq('is_active', true)

  if (prefsError) {
    console.error('Failed to load user prefs:', prefsError.message)
    process.exit(1)
  }

  // Also include users with a profile but no pref row (haven't toggled yet = treat as enabled)
  const { data: allProfiles } = await supabase.from('profiles').select('id, taste_profile')
  const prefUserIds = new Set((prefs || []).map(p => p.user_id))
  const { data: disabledPrefs } = await supabase
    .from('user_source_prefs')
    .select('user_id')
    .eq('source_id', source.id)
    .eq('is_active', false)
  const disabledUserIds = new Set((disabledPrefs || []).map(p => p.user_id))

  const users = (allProfiles || []).filter(p => !disabledUserIds.has(p.id))
  console.log(`Found ${users.length} user(s) to process`)

  // Fetch RA events once — shared across all users
  console.log('\nFetching RA London events...')
  const listings = await fetchRAEvents()
  console.log(`RA returned ${listings.length} events`)
  const normalized = normalizeRA(listings)

  // Filter and store per user
  for (const user of users) {
    await fetchAndStoreForUser(user.id, user.taste_profile, source.id, normalized)
  }

  console.log('\nDone.')
}

main().catch(err => {
  console.error('Fatal error:', err.message)
  process.exit(1)
})
