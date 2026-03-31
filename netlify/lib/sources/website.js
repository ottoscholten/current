import * as cheerio from 'cheerio'
import { parse, isValid } from 'date-fns'
import { broadFilter, strictFilter, assignCategories } from '../ai.js'
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
  // 1. Sibling traversal — agenda layouts where a date header row precedes event rows
  let current = $(el).prev()
  while (current.length) {
    if (current.is(dateHeaderSelector)) return current.text().trim()
    // Handle compound selectors like "div.header h2" — sibling is the parent wrapper
    const nested = current.find(dateHeaderSelector)
    if (nested.length) return nested.first().text().trim()
    current = current.prev()
  }
  // 2. Ancestor wrapper — grouped layouts where events are nested inside a date container
  // (e.g. <div data-day="2026-03-01"><article>...</article></div>)
  const ancestor = $(el).closest(dateHeaderSelector)
  if (ancestor.length) {
    // Prefer a data attribute that looks like a date (ISO or readable)
    const attrs = ancestor[0]?.attribs || {}
    for (const val of Object.values(attrs)) {
      if (/\d{4}-\d{2}-\d{2}/.test(String(val))) return String(val)
    }
    // Fall back: first child whose text doesn't come from a nested event article
    let dateText = ''
    ancestor.children().each((_, child) => {
      if (dateText) return false
      if ($(child).is('article') || $(child).find('article').length) return
      const text = $(child).text().trim()
      if (text) dateText = text
    })
    return dateText
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

// Extract date using the structured dateStrategy (new sources).
function extractDateFromStrategy($, el, dateStrategy) {
  if (!dateStrategy) return ''
  const jel = $(el)

  switch (dateStrategy.type) {
    case 'ancestor_attribute': {
      const ancestor = jel.closest(dateStrategy.selector)
      return ancestor.length ? (ancestor.attr(dateStrategy.attribute) || '') : ''
    }
    case 'ancestor_text': {
      const ancestor = jel.closest(dateStrategy.selector)
      if (!ancestor.length) return ''
      const ownText = ancestor.clone().children().remove().end().text().trim()
      return ownText || ancestor.text().trim()
    }
    case 'sibling_header': {
      let current = jel.prev()
      while (current.length) {
        if (current.is(dateStrategy.selector)) return current.text().trim()
        const nested = current.find(dateStrategy.selector)
        if (nested.length) return nested.first().text().trim()
        current = current.prev()
      }
      return ''
    }
    case 'descendant':
      return jel.find(dateStrategy.selector).first().text().trim()
    case 'descendant_attribute':
      return jel.find(dateStrategy.selector).first().attr(dateStrategy.attribute) || ''
    case 'link_href': {
      const href = jel.find(dateStrategy.selector).first().attr('href') || ''
      const m = href.match(/(20\d{2})([01]\d)([0-3]\d)/)
      return m ? `${m[1]}-${m[2]}-${m[3]}` : ''
    }
    default:
      return ''
  }
}

function scrapeEvents($, selectors, sourceUrl) {
  const events = []
  let lastDateStr = ''

  $(selectors.container).each((_, el) => {
    const title = $(el).find(selectors.title).first().text().trim()

    let dateStr
    if (selectors.dateStrategy) {
      // New path: structured date strategy derived from DOM analysis
      const raw = extractDateFromStrategy($, el, selectors.dateStrategy)
      dateStr = raw || lastDateStr
      if (raw) lastDateStr = raw
    } else {
      // Legacy path: old date/dateHeader selector approach (existing saved sources)
      const isHybridLayout = !!(selectors.dateHeader && selectors.date && selectors.date !== selectors.dateHeader)
      const headerDate = selectors.dateHeader ? extractDateFromHeader($, el, selectors.dateHeader) : ''
      const rowDate = selectors.date ? $(el).find(selectors.date).first().text().trim() : ''
      if (isHybridLayout && !rowDate) return
      const resolved = headerDate && rowDate ? combineDateParts(rowDate, headerDate) : headerDate || rowDate
      dateStr = resolved || lastDateStr
      if (resolved) lastDateStr = resolved
    }

    const timeStr = selectors.time ? $(el).find(selectors.time).first().text().trim() : ''
    const href = extractHref($, el, selectors.link, sourceUrl)
    const description = selectors.description
      ? $(el).find(selectors.description).first().text().trim() || null
      : null

    if (title) events.push({ title, dateStr, timeStr, href, description })
  })
  return events
}

function toWebsiteRow(event, userId, sourceId, category) {
  return {
    user_id: userId,
    source_id: sourceId,
    title: event.title,
    venue: event.venueName,
    neighbourhood: null,
    date: event.date,
    time: event.time || '00:00',
    category: category || 'Other',
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
  console.log(`[syncWebsite] ${sourceName}: scraped ${scraped.length} raw events`)
  if (scraped.length > 0) console.log(`[syncWebsite] sample:`, JSON.stringify(scraped.slice(0, 2)))
  if (!scraped.length) return 0

  // New sources use dateStrategy — parseEventDate tries all formats automatically.
  // Old sources (date/dateHeader selectors) may have a stored format hint.
  const isHybrid = !selectors.dateStrategy && selectors.dateHeader && selectors.date
  const dateFormat = selectors.dateStrategy
    ? null
    : (isHybrid ? null : selectors.dateHeader ? selectors.dateHeaderFormat : selectors.dateFormat)
  const today = new Date()
  today.setHours(0, 0, 0, 0)

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

  console.log(`[syncWebsite] ${sourceName}: ${futureEvents.length} future events after date filter`)
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

  // Assign per-event categories when source has multiple options; otherwise use the first
  const fallbackCategory = (sourceCategories && sourceCategories[0]) || 'Other'
  let categoryMap = {}
  if (sourceCategories && sourceCategories.length > 1) {
    const assignments = await assignCategories(toInsert, sourceCategories)
    for (const { i, category } of assignments) {
      if (sourceCategories.includes(category)) categoryMap[i] = category
    }
  }

  await supabase.from('events').delete().eq('source_id', sourceId).eq('user_id', userId).eq('is_saved', false)
  const rows = toInsert.map((e, i) => toWebsiteRow(e, userId, sourceId, categoryMap[i] || fallbackCategory))
  console.log(`[syncWebsite] ${sourceName}: inserting ${rows.length} events, sample:`, JSON.stringify(rows[0]))
  const { error: insertError } = await supabase.from('events').insert(rows)
  if (insertError) console.error(`[syncWebsite] ${sourceName} insert error:`, insertError.message)
  await updateLastSynced(supabase, userId, sourceId)

  return rows.length
}

async function clearAndUpdateSync(supabase, userId, sourceId) {
  await supabase.from('events').delete().eq('source_id', sourceId).eq('user_id', userId).eq('is_saved', false)
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
