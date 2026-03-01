import { createClient } from '@supabase/supabase-js'
import * as cheerio from 'cheerio'
import { callAI } from '../lib/ai.js'
import { fetchPage, fetchWithBrowserless } from '../lib/fetch-page.js'
import { parseEventDate, estimateSyncHours } from '../lib/parse-date.js'

// Strip everything that isn't visible event content, then truncate
function cleanHTML(html) {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s{2,}/g, ' ')
  return stripped.slice(0, 60000)
}

// Extract a compact body snippet for self-correction prompts
function bodySnippet(html, maxLen = 4000) {
  return html
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, maxLen)
}

// Resolve a link href from an element:
//   1. Element itself is an <a>
//   2. Descendant matches the AI selector
//   3. Any <a> descendant
//   4. Fall back to the source page URL
function extractHref($, el, linkSelector, fallbackUrl) {
  if ($(el).is('a')) return $(el).attr('href') || fallbackUrl
  if (linkSelector) {
    const found = $(el).find(linkSelector).first()
    if (found.length && found.attr('href')) return found.attr('href')
  }
  const anyAnchor = $(el).find('a').first().attr('href')
  return anyAnchor || fallbackUrl
}

// For agenda layouts, traverse previous siblings to find the enclosing date header row.
function extractDateFromHeader($, el, dateHeaderSelector) {
  let current = $(el).prev()
  while (current.length) {
    if (current.is(dateHeaderSelector)) return current.text().trim()
    current = current.prev()
  }
  return ''
}

// Last-resort heuristic: when the AI's title selector doesn't match, find the element
// inside the container with the longest meaningful own text (skipping numbers and times).
function inferTitleSelector($, containerSelector) {
  const container = $(containerSelector).first()
  if (!container.length) return null

  let bestText = ''
  let bestSelector = null

  container.find('a, button, h1, h2, h3, h4, h5, p, span, td, div').each((_, el) => {
    const ownText = $(el).clone().children().remove().end().text().trim()
    if (
      ownText.length > bestText.length &&
      ownText.length > 5 &&
      !/^\d{1,4}$/.test(ownText) &&            // skip pure numbers (day of month)
      !/^\d{1,2}:\d{2}/.test(ownText) &&       // skip times
      !/^\d{1,2}(am|pm)/i.test(ownText) &&     // skip times like "6:30pm"
      !/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i.test(ownText) // skip weekday abbreviations
    ) {
      bestText = ownText
      const tag = el.name
      const cls = $(el).attr('class')?.split(/\s+/).find(c => c && !/^(fa-|svg-|icon)/.test(c))
      const parent = el.parent
      const parentTag = parent?.name
      const parentCls = $(parent)?.attr('class')?.split(/\s+/).find(c => c && !/^(fa-|svg-|icon)/.test(c))
      if (parentTag && !['tr', 'tbody', 'table', 'body'].includes(parentTag) && parentCls) {
        bestSelector = `${parentTag}.${parentCls} ${cls ? `${tag}.${cls}` : tag}`
      } else {
        bestSelector = cls ? `${tag}.${cls}` : tag
      }
    }
  })

  if (bestSelector) console.log(`[extract-selectors] Heuristic title selector: "${bestSelector}" (text: "${bestText.slice(0, 60)}")`)
  return bestSelector
}

// For hybrid agenda layouts: month/year in header row, day number in event row.
// Combines "6" + "March, 2026" → "6 March 2026"
function combineDateParts(dayStr, headerStr) {
  const day = dayStr.match(/\d+/)?.[0]
  if (!day) return headerStr
  return `${day} ${headerStr.replace(',', '').trim()}`
}

// The prompt shared by both the initial AI call and the Browserless re-run
function buildSelectorPrompt(htmlContent, hint) {
  return `You are analysing the HTML of an events listing page. Extract CSS selectors that identify individual events and their fields.

HTML (truncated):
${htmlContent}

Return a JSON object with these keys:
- container: CSS selector that matches ONLY the repeating event elements — not grouping headers or wrapper rows.
- title: CSS selector for the event title, relative to container
- date: CSS selector for the event date or day-number text within each event row, relative to container. Set to null ONLY if the event row contains absolutely no date or day information. If only a day number (e.g. "6") appears in the row while month/year is in a separate header row, still provide this selector — and also set dateHeader.
- dateFormat: date format using date-fns tokens (e.g. "d MMMM yyyy", "dd/MM/yyyy", "d" for a bare day number). Null if unknown.
- dateHeader: CSS selector for header rows/elements that group events by month/year (e.g. "March 2026"). IMPORTANT: this must match SIBLING elements of the container in the DOM — elements at the same level, not inside the container. For example, if container is 'tr[data-hook="event"]', dateHeader would be 'tr.month-header' (another row at the same level, not a child td). Set whenever such grouped headers exist, even if date is also set. Null if every event row contains its full date.
- dateHeaderFormat: format of the header row date using date-fns tokens (e.g. "MMMM yyyy", "MMMM, yyyy"). Null if dateHeader is null.
- time: CSS selector for the event start time text, relative to container. Null if not present.
- timeFormat: the time format string using date-fns tokens (e.g. "h:mma", "HH:mm", "h:mm a"). Null if unknown.
- link: CSS selector for the event link anchor tag, relative to container. Null if events have no direct links.
- description: CSS selector for the event description, relative to container. Null if not present.
${hint ? `\nExtra context from the user: ${hint}` : ''}
Important: use attribute selectors like [data-hook="value"] for elements identified by data attributes — do not use .value class syntax for data attribute values.
Return ONLY the JSON object.`
}

// Apply the AI-extracted selectors to get a sample of events for preview
function extractPreview($, selectors, sourceUrl) {
  const events = []
  $(selectors.container).each((i, el) => {
    if (i >= 5) return false // preview: first 5 only
    const title = $(el).find(selectors.title).first().text().trim()
    const headerDate = selectors.dateHeader ? extractDateFromHeader($, el, selectors.dateHeader) : ''
    const rowDate = selectors.date ? $(el).find(selectors.date).first().text().trim() : ''
    const date = headerDate && rowDate ? combineDateParts(rowDate, headerDate) : headerDate || rowDate
    const time = selectors.time ? $(el).find(selectors.time).first().text().trim() : ''
    const link = extractHref($, el, selectors.link, sourceUrl)
    const description = selectors.description
      ? $(el).find(selectors.description).first().text().trim()
      : ''
    if (title) {
      console.log(`[extractPreview] "${title}" — headerDate: "${headerDate}", rowDate: "${rowDate}", date: "${date}", time: "${time}"`)
      events.push({ title, date, time, link, description })
    }
  })

  // If nothing matched, log the first container element's HTML so we can diagnose wrong sub-selectors
  if (events.length === 0 && $(selectors.container).length > 0) {
    const firstEl = $(selectors.container).first()
    console.log(`[extractPreview] 0 events — first container element HTML:\n${$.html(firstEl).slice(0, 800)}`)
    console.log(`[extractPreview] title selector "${selectors.title}" matched: ${firstEl.find(selectors.title).length} elements`)
  }

  return events
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

  let body
  try {
    body = JSON.parse(event.body)
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' }
  }

  const { url, hint } = body
  if (!url) return { statusCode: 400, body: 'Missing url' }

  // Fetch the page — tries plain fetch first, falls back to Browserless.io
  console.log(`[extract-selectors] Fetching: ${url}`)
  let html
  let usedBrowserless = false
  try {
    html = await fetchPage(url)
  } catch (err) {
    console.log(`[extract-selectors] Fetch failed: ${err.message}`)
    return { statusCode: 422, body: JSON.stringify({ error: err.message }) }
  }
  console.log(`[extract-selectors] HTML fetched (${html.length} chars)`)

  let $ = cheerio.load(html)
  const pageName = $('title').first().text().trim() || url

  const cleaned = cleanHTML(html)
  console.log(`[extract-selectors] Cleaned HTML length: ${cleaned.length} — calling AI...`)

  let selectors
  try {
    selectors = await callAI(buildSelectorPrompt(cleaned, hint), 'openai/gpt-4o-mini')
  } catch (err) {
    console.log(`[extract-selectors] AI failed: ${err.message}`)
    return { statusCode: 500, body: JSON.stringify({ error: `AI selector extraction failed: ${err.message}` }) }
  }

  console.log(`[extract-selectors] AI returned selectors:`, JSON.stringify(selectors))

  if (!selectors?.container || !selectors?.title) {
    return { statusCode: 422, body: JSON.stringify({ error: 'Could not identify event structure on this page.' }) }
  }

  let containerCount = $(selectors.container).length
  console.log(`[extract-selectors] Container selector "${selectors.container}" matched ${containerCount} elements`)

  // Extract preview from the plain-fetch HTML
  let preview = containerCount > 0 ? extractPreview($, selectors, url) : []
  console.log(`[extract-selectors] Preview events found (plain HTML): ${preview.length}`)

  // Fall back to Browserless if:
  //   (a) container matched nothing — page is JS-rendered
  //   (b) container matched but preview is empty — SSR HTML has partial structure,
  //       AI generated sub-selectors that reference JS-only attributes
  if ((containerCount === 0 || preview.length === 0) && process.env.BROWSERLESS_TOKEN) {
    console.log(`[extract-selectors] ${containerCount === 0 ? '0 container matches' : 'empty preview'} — fetching with Browserless.io and re-running AI...`)
    try {
      html = await fetchWithBrowserless(url)
      usedBrowserless = true
      $ = cheerio.load(html)

      const browserlessCleaned = cleanHTML(html)
      console.log(`[extract-selectors] Browserless cleaned length: ${browserlessCleaned.length} — re-running AI...`)
      selectors = await callAI(buildSelectorPrompt(browserlessCleaned, hint), 'openai/gpt-4o-mini')

      containerCount = $(selectors.container).length
      preview = containerCount > 0 ? extractPreview($, selectors, url) : []
      console.log(`[extract-selectors] After Browserless re-analysis: ${containerCount} elements, ${preview.length} preview events, selectors: ${JSON.stringify(selectors)}`)

      // Self-correction: if container is empty OR sub-selectors are wrong (empty preview),
      // show the AI concrete HTML evidence and ask it to fix the specific problem.
      if (containerCount === 0 || preview.length === 0) {
        console.log(`[extract-selectors] Self-correcting: containerCount=${containerCount}, preview=${preview.length}...`)
        try {
          let correctionPrompt
          if (containerCount === 0) {
            // No container matches at all — show body snippet
            correctionPrompt = `These CSS selectors matched 0 elements on the rendered page:
${JSON.stringify(selectors)}

Here is the actual rendered HTML (body content, first 4000 chars):
${bodySnippet(html)}

Look carefully at the real HTML structure. Return corrected selectors as a JSON object with the same keys.
Important:
- Only use [data-hook="value"] when the element literally has that data-hook attribute in the HTML.
- For elements with class attributes, use .classname selectors.
- The dateHeader selector must match SIBLING elements of the container (same DOM level), not descendants.
Return ONLY the JSON object.`
          } else {
            // Container matches but sub-selectors are wrong — show first container element
            const firstElHtml = $.html($(selectors.container).first()).slice(0, 1000)
            correctionPrompt = `The container selector "${selectors.container}" matched ${containerCount} elements, but the title selector "${selectors.title}" matched 0 elements inside the container.

Here is the actual HTML of a matched container element:
${firstElHtml}

Fix the selectors so the title (and other fields) correctly match this element structure. Return a corrected JSON object with the same keys.
Important: only use [data-hook="value"] when the element literally has that attribute. For class-based elements, use .classname selectors.
Return ONLY the JSON object.`
          }

          const corrected = await callAI(correctionPrompt, 'openai/gpt-4o-mini')
          console.log(`[extract-selectors] Self-correction returned: ${JSON.stringify(corrected)}`)
          if (corrected?.container) {
            selectors = corrected
            containerCount = $(selectors.container).length
            preview = containerCount > 0 ? extractPreview($, selectors, url) : []
            console.log(`[extract-selectors] After self-correction: ${containerCount} elements, ${preview.length} preview events`)
          }
        } catch (err) {
          console.log(`[extract-selectors] Self-correction failed: ${err.message}`)
        }

        // Final fallback: if AI correction still didn't produce a working title selector,
        // infer it heuristically from the actual container element HTML.
        if (preview.length === 0 && containerCount > 0) {
          const inferredTitle = inferTitleSelector($, selectors.container)
          if (inferredTitle) {
            selectors = { ...selectors, title: inferredTitle }
            preview = extractPreview($, selectors, url)
            console.log(`[extract-selectors] After heuristic fix: ${preview.length} preview events, selectors: ${JSON.stringify(selectors)}`)
          }
        }
      }
    } catch (err) {
      console.log(`[extract-selectors] Browserless retry failed: ${err.message}`)
    }
  }

  console.log(`[extract-selectors] Final preview events: ${preview.length}`)

  if (!preview.length) {
    return {
      statusCode: 422,
      body: JSON.stringify({ error: 'Selectors were extracted but no events were found. The page may require JavaScript to render.' }),
    }
  }

  // Estimate sync interval by parsing all event dates on the page
  const isHybrid = selectors.dateHeader && selectors.date
  const dateFormat = isHybrid ? null : selectors.dateHeader ? selectors.dateHeaderFormat : selectors.dateFormat
  const allDates = []
  $(selectors.container).each((_, el) => {
    const headerDate = selectors.dateHeader
      ? (() => { let cur = $(el).prev(); while (cur.length) { if (cur.is(selectors.dateHeader)) return cur.text().trim(); cur = cur.prev() } return '' })()
      : ''
    const rowDate = selectors.date ? $(el).find(selectors.date).first().text().trim() : ''
    const dateStr = headerDate && rowDate ? combineDateParts(rowDate, headerDate) : headerDate || rowDate
    const parsed = parseEventDate(dateStr, dateFormat)
    if (parsed) allDates.push(parsed)
  })
  const suggestedSyncHours = estimateSyncHours(allDates)
  console.log(`[extract-selectors] ${allDates.length} dates parsed — suggested sync: every ${suggestedSyncHours}h`)

  // Embed needsBrowserless into selectors so it's saved to DB alongside them
  if (usedBrowserless) selectors = { ...selectors, needsBrowserless: true }

  return {
    statusCode: 200,
    body: JSON.stringify({ pageName, selectors, preview, suggestedSyncHours }),
  }
}
