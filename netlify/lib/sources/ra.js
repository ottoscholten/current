import { syncSource } from '../sync-source.js'

const RA_URL = 'https://ra.co/graphql'
const LONDON_AREA_ID = 13

async function fetchRAEventsForDay(dateStr) {
  const body = {
    query: `{
      eventListings(
        filters: {
          areas: { eq: ${LONDON_AREA_ID} }
          listingDate: { gte: "${dateStr}", lte: "${dateStr}" }
        }
        page: 1
        pageSize: 50
      ) {
        data {
          listingDate
          event {
            title
            startTime
            contentUrl
            content
            venue { name area { name } }
            artists { name }
            genres { name }
            pick { blurb }
          }
        }
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
  if (json.errors) throw new Error('RA GraphQL query failed')
  return json.data.eventListings.data
}

function normalizeRA(listings) {
  return listings
    .filter(l => l.event.venue?.area?.name === 'London')
    .map(l => ({
      title: l.event.title,
      venue: l.event.venue?.name || 'Unknown venue',
      genres: (l.event.genres || []).map(g => g.name),
      artists: (l.event.artists || []).map(a => a.name),
      content: l.event.content || null,
      _raw: l,
    }))
}

function toRARow(event, userId, sourceId, day) {
  const l = event._raw
  return {
    user_id: userId,
    source_id: sourceId,
    title: event.title,
    venue: event.venue,
    neighbourhood: null,
    date: day,
    time: l.event.startTime ? l.event.startTime.slice(11, 16) : '00:00',
    category: 'Music',
    is_saved: false,
    url: l.event.contentUrl ? `https://ra.co${l.event.contentUrl}` : null,
    description: l.event.pick?.blurb ?? event.content ?? null,
  }
}

export async function syncRA(supabase, userId, tasteProfile, tasteParsed = []) {
  return syncSource(
    supabase,
    userId,
    tasteProfile,
    tasteParsed,
    'Resident Advisor London',
    fetchRAEventsForDay,
    normalizeRA,
    toRARow,
  )
}
