import * as cheerio from 'cheerio'
import { parse, isValid } from 'date-fns'
import { broadFilter, strictFilter } from '../ai.js'
import { fetchPage, fetchWithBrowserless } from '../fetch-page.js'
import { parseEventDate } from '../parse-date.js'

// Normalise a raw time string to HH:MM — returns '00:00' if unparseable
function parseEventTime(timeStr, timeFormat) {
  if (!timeStr) return '00:00'

  // Strip timezone suffixes (GMT, BST, UTC, EST, etc.) before parsing
  const normalized = timeStr.replace(/\s+[A-Z]{2,5}$/, '').trim()

  if (timeFormat) {
    const parsed = parse(normalized, timeFormat, new Date())
    if (isValid(parsed)) {
      return `${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}`
    }
  }

  const timeFormats = ['h:mma', 'h:mm a', 'HH:mm', 'H:mm', 'ha', 'h a']
  for (const fmt of timeFormats) {
    const parsed = parse(normalized.toLowerCase(), fmt, new Date())
    if (isValid(parsed)) {
      return `${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}`
    }
  }

  const match = normalized.match(/\b(\d{1,2}):(\d{2})\b/)
  if (match) return `${String(parseInt(match[1])).padStart(2, '0')}:${match[2]}`

  return '00:00'
}

function extractDateFromHeader($, el, dateHeaderSelector) {
  let current = $(el).prev()
  while (current.length) {
    if (current.is(dateHeaderSelector)) return current.text().trim()
    current = current.prev()
  }
  return ''
}

function combineDateParts(dayStr, headerStr) {
  const day = dayStr.match(/\d+/)?.[0]
  if (!day) return headerStr
  return `${day} ${headerStr.replace(',', '').trim()}`
}

function extractHref($, el, linkSelector, fallbackUrl) {
  if ($(el).is('a')) return $(el).attr('href') || fallbackUrl
  if (linkSelector) {
    const found = $(el).find(linkSelector).first()
    if (found.length && found.attr('href')) return found.attr('href')
  }
  return $(el).find('a').first().attr('href') || fallbackUrl
}

function scrapeEvents($, selectors, sourceUrl) {
  const events = []
  const isHybridLayout = !!(selectors.dateHeader && selectors.date)
  let lastDateStr = ''
  $(selectors.container).each((_, el) => {
    const title = $(el).find(selectors.title).first().text().trim()
    const headerDate = selectors.dateHeader ? extractDateFromHeader($, el, selectors.dateHeader) : ''
    const rowDate = selectors.date ? $(el).find(selectors.date).first().text().trim() : ''
    // In hybrid layouts a missing day number means no specific date — skip
    if (isHybridLayout && !rowDate) return
    const resolved = headerDate && rowDate ? combineDateParts(rowDate, headerDate) : headerDate || rowDate
    // Carry forward the last seen date for non-hybrid layouts
    const dateStr = resolved || lastDateStr
    if (resolved) lastDateStr = resolved
    const timeStr = selectors.time ? $(el).find(selectors.time).first().text().trim() : ''
    const href = extractHref($, el, selectors.link, sourceUrl)
    const description = selectors.description
      ? $(el).find(selectors.description).first().text().trim() || null
      : null

    if (title) events.push({ title, dateStr, timeStr, href, description })
  })
  return events
}

function toWebsiteRow(event, userId, sourceId, sourceCategory) {
  return {
    user_id: userId,
    source_id: sourceId,
    title: event.title,
    venue: event.venueName,
    neighbourhood: null,
    date: event.date,
    time: event.time || '00:00',
    category: sourceCategory ? sourceCategory.charAt(0).toUpperCase() + sourceCategory.slice(1).toLowerCase() : 'Other',
    is_saved: false,
    url: event.url,
    description: event.description || null,
  }
}

export async function syncWebsite(supabase, userId, tasteProfile, tasteParsed = [], sourceRow, skipTasteFilter) {
  const { selectors, url, name: sourceName, id: sourceId, categories: sourceCategories } = sourceRow

  if (!selectors?.container) {
    throw new Error(`Source "${sourceName}" has no saved selectors — re-run setup.`)
  }

  const html = selectors.needsBrowserless ? await fetchWithBrowserless(url) : await fetchPage(url)
  const $ = cheerio.load(html)
  const scraped = scrapeEvents($, selectors, url)
  if (!scraped.length) return 0

  const isHybrid = selectors.dateHeader && selectors.date
  const dateFormat = isHybrid ? null : selectors.dateHeader ? selectors.dateHeaderFormat : selectors.dateFormat
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Store all future events — no upper cap (unlike RA's 7-day window)
  const futureEvents = scraped
    .map(e => {
      const parsed = parseEventDate(e.dateStr, dateFormat)
      if (!parsed || parsed < today) return null

      let resolvedUrl = e.href
      if (resolvedUrl && resolvedUrl.startsWith('/')) {
        resolvedUrl = `${new URL(url).origin}${resolvedUrl}`
      }

      return {
        title: e.title,
        genres: [],
        artists: [],
        content: e.description,
        venueName: sourceName,
        date: parsed.toISOString().split('T')[0],
        time: parseEventTime(e.timeStr, selectors.timeFormat),
        url: resolvedUrl,
        description: e.description,
      }
    })
    .filter(Boolean)

  if (!futureEvents.length) return 0

  let toInsert = futureEvents

  if (!skipTasteFilter) {
    const broadIndices = await broadFilter(futureEvents, tasteProfile, tasteParsed)
    const candidates = broadIndices.map(i => futureEvents[i]).filter(Boolean)
    if (!candidates.length) {
      await clearAndUpdateSync(supabase, userId, sourceId)
      return 0
    }

    const strictIndices = await strictFilter(candidates, tasteProfile, tasteParsed)
    toInsert = strictIndices.map(i => candidates[i]).filter(Boolean)
    if (!toInsert.length) {
      await clearAndUpdateSync(supabase, userId, sourceId)
      return 0
    }
  }

  await supabase.from('events').delete().eq('source_id', sourceId).eq('user_id', userId)
  const primaryCategory = (sourceCategories && sourceCategories[0]) || 'Other'
  await supabase.from('events').insert(toInsert.map(e => toWebsiteRow(e, userId, sourceId, primaryCategory)))
  await updateLastSynced(supabase, userId, sourceId)

  return toInsert.length
}

async function clearAndUpdateSync(supabase, userId, sourceId) {
  await supabase.from('events').delete().eq('source_id', sourceId).eq('user_id', userId)
  await updateLastSynced(supabase, userId, sourceId)
}

async function updateLastSynced(supabase, userId, sourceId) {
  const { error } = await supabase.from('user_source_prefs').upsert({
    user_id: userId,
    source_id: sourceId,
    last_synced_at: new Date().toISOString(),
  })
  if (error) console.error(`Failed to update last_synced_at for source ${sourceId}:`, error.message)
}
