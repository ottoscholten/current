import { createClient } from '@supabase/supabase-js'
import * as cheerio from 'cheerio'
import { callAI } from '../lib/ai.js'
import { fetchPage, fetchWithBrowserless } from '../lib/fetch-page.js'
import { parseEventDate, estimateSyncHours } from '../lib/parse-date.js'

// Strip everything that isn't visible event content, then truncate.
function cleanHTML(html) {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<picture[\s\S]*?<\/picture>/gi, '')
    .replace(/<source[^>]*>/gi, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/\ssrcset="[^"]*"/gi, '')
    .replace(/\sdata-src="[^"]*"/gi, '')
    .replace(/\sstyle="[^"]*"/gi, '')
    .replace(/\shref="[^"]{60,}"/gi, ' href="#"')
    .replace(/>([^<]{150,})</g, (_, text) => `>${text.slice(0, 150)}<`)
    .replace(/\s{2,}/g, ' ')
  return stripped.slice(0, 60000)
}

// ─── DOM utilities ────────────────────────────────────────────────────────────

// Find the deepest element whose own text (or full text) contains the search string.
// Normalises whitespace so minor formatting differences don't break the match.
function findByText($, text, scope) {
  if (!text) return null
  const norm = s => s.trim().replace(/\s+/g, ' ')
  const needle = norm(text)
  const root = scope ? scope : $('body')
  let best = null
  let bestDepth = -1

  root.find('*').each((_, el) => {
    const jel = $(el)
    const ownText = norm(jel.clone().children().remove().end().text())
    if (!ownText) return
    if (ownText === needle || ownText.includes(needle)) {
      const depth = jel.parents().length
      if (depth > bestDepth) { best = jel; bestDepth = depth }
    }
  })

  // Fallback: full text match (covers cases where needle is spread across nested nodes)
  if (!best) {
    root.find('*').each((_, el) => {
      const jel = $(el)
      const fullText = norm(jel.text())
      if (fullText === needle) {
        const depth = jel.parents().length
        if (depth > bestDepth) { best = jel; bestDepth = depth }
      }
    })
  }

  return best
}

// Generate a CSS selector string from a cheerio element.
function generateSelector($, el) {
  const jel = el.cheerio ? el : $(el)
  const node = jel[0]
  if (!node) return null
  const tag = node.name
  const noisy = /^(js-|is-|has-|active|selected|first|last|current|open|closed|visible|hidden|show|hide)/
  const classes = (jel.attr('class') || '').split(/\s+/).filter(c => c && c.length > 1 && !noisy.test(c))
  const id = jel.attr('id')
  const dataAttrs = Object.keys(node.attribs || {})
    .filter(k => k.startsWith('data-') && !/^(data-v-|data-react|data-ember|data-src)/.test(k))

  if (id && !/^\d/.test(id) && !id.includes(':')) return `#${id}`
  if (classes.length > 0) return `${tag}.${classes[0]}`
  if (dataAttrs.length > 0) return `${tag}[${dataAttrs[0]}]`
  return tag
}

// Generate a CSS selector for fieldEl relative to containerEl.
// Picks the simplest selector that uniquely identifies fieldEl within one container.
function generateRelativeSelector($, containerEl, fieldEl) {
  const node = fieldEl[0]
  if (!node) return null
  const tag = node.name
  const classes = (fieldEl.attr('class') || '').split(/\s+/).filter(c => c && c.length > 1)

  const candidates = [
    tag,
    classes.length > 0 ? `${tag}.${classes[0]}` : null,
    classes.length > 1 ? `${tag}.${classes[0]}.${classes[1]}` : null,
  ].filter(Boolean)

  for (const sel of candidates) {
    if (containerEl.find(sel).length === 1) return sel
  }
  return candidates[candidates.length - 1]
}

// Heuristic: does a text string look like a date?
function looksLikeDate(text) {
  return /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(text) ||
    /\b\d{4}\b/.test(text) ||
    /\b\d{1,2}(st|nd|rd|th)\b/i.test(text) ||
    /\b(mon|tue|wed|thu|fri|sat|sun)\b/i.test(text) ||
    /\d{4}-\d{2}-\d{2}/.test(text)
}

// ─── Container derivation ─────────────────────────────────────────────────────

// Longest common prefix of an array of strings.
function longestCommonPrefix(strings) {
  if (!strings.length) return ''
  let prefix = strings[0]
  for (let i = 1; i < strings.length; i++) {
    while (!strings[i].startsWith(prefix)) {
      prefix = prefix.slice(0, -1)
      if (!prefix) return ''
    }
  }
  return prefix
}

// After finding a candidate container element, check if its same-tag siblings share
// a common class prefix (e.g. override-brand--art-design / override-brand--cinema).
// If so, return a generalised `tag[class*="prefix"]` selector that matches all of them.
function tryGeneralizeSelector($, el, currentSel, sampleTitles) {
  const node = el[0]
  if (!node) return null
  const tag = node.name
  const firstClass = (el.attr('class') || '').split(/\s+/).find(c => c && c.length > 2)
  if (!firstClass) return null

  // Collect first classes of same-tag siblings
  const siblingFirstClasses = []
  el.parent().children(tag).not(el).each((_, sib) => {
    const c = ($(sib).attr('class') || '').split(/\s+/).find(c => c && c.length > 2)
    if (c && c !== firstClass) siblingFirstClasses.push(c)
  })
  if (!siblingFirstClasses.length) return null

  const prefix = longestCommonPrefix([firstClass, ...siblingFirstClasses])
  if (prefix.length < 4) return null // too short to be meaningful

  const generalSel = `${tag}[class*="${prefix}"]`
  const generalCount = $(generalSel).length
  if (generalCount <= $(currentSel).length) return null // no benefit
  if (generalCount > 300) return null // too broad

  const titlesFound = sampleTitles.filter(title => {
    let found = false
    $(generalSel).each((_, el) => {
      if ($(el).text().includes(title.trim())) { found = true; return false }
    })
    return found
  })

  return titlesFound.length >= Math.min(2, sampleTitles.length) ? generalSel : null
}

// Walk up the DOM from a known title element to find the repeating container element.
// Verification: at least 2 of the sample titles must appear within instances of the candidate.
function deriveContainerSelector($, titleEl, sampleTitles) {
  let current = titleEl.parent()

  while (current.length && !['body', 'html'].includes(current[0]?.name)) {
    const sel = generateSelector($, current)
    if (!sel) { current = current.parent(); continue }

    const parent = current.parent()
    const siblingCount = parent.children(sel).length

    if (siblingCount >= 3) {
      const globalCount = $(sel).length
      if (globalCount >= 3 && globalCount <= 300) {
        // Verify this is the right section of the page — not nav items or footers
        const titlesFound = sampleTitles.filter(title => {
          let found = false
          $(sel).each((_, el) => {
            if ($(el).text().includes(title.trim())) { found = true; return false }
          })
          return found
        })
        if (titlesFound.length >= Math.min(2, sampleTitles.length)) {
          // Check if siblings with different class names share a common prefix —
          // if so, generalise to catch all variants (e.g. override-brand--cinema too)
          const generalSel = tryGeneralizeSelector($, current, sel, sampleTitles)
          return { selector: generalSel || sel, el: current }
        }
      }
    }

    current = parent
  }

  return null
}

// ─── Date strategy derivation ─────────────────────────────────────────────────

// Given the container element and the date string the AI found, determine HOW
// to extract the date at sync time. Returns a dateStrategy object or null.
//
// Priority:
//   1. Ancestor has an ISO date attribute (e.g. data-day="2026-03-01")
//   2. Ancestor has date-like own text (e.g. "Sun 1 Mar")
//   3. A preceding sibling has date-like text (agenda/header-row layout)
//   4. Date text is inside the container (descendant selector)
function deriveDateStrategy($, containerEl, dateStr, containerSelector) {
  // 1. ISO date attribute — check the container itself AND ancestors.
  //    Starting at containerEl (not parent) handles the case where the container
  //    IS the date-holding element (e.g. <div data-day="2026-03-01">).
  //    At sync time, extractDateFromStrategy uses .closest() which checks the
  //    element itself first, so this works correctly.
  let el = containerEl
  for (let depth = 0; depth < 7; depth++) {
    if (!el.length || ['body', 'html'].includes(el[0]?.name)) break
    const attrs = el[0]?.attribs || {}
    for (const [attr, val] of Object.entries(attrs)) {
      const strVal = String(val)
      // Skip JSON blobs, URLs, or anything too long to be a plain date string
      if (strVal.length > 60 || strVal.startsWith('{') || strVal.startsWith('[') || strVal.startsWith('http')) continue
      // Require a specific day number — rejects month-only strings like "March 2026"
      const hasDay = /\b\d{1,2}\b/.test(strVal.replace(/\d{4}/, ''))
      if (/\d{4}-\d{2}-\d{2}/.test(strVal) || (looksLikeDate(strVal) && hasDay)) {
        // When the attribute is on the container element itself (depth 0), use the
        // already-generalised containerSelector (e.g. div[class*="override-brand--"])
        // so that all variants (Cinema, Music, etc.) are matched at sync time,
        // not just the specific class the first container happened to have.
        const sel = (depth === 0 && containerSelector) ? containerSelector : generateSelector($, el)
        if (sel) return { type: 'ancestor_attribute', selector: sel, attribute: attr }
      }
    }
    el = el.parent()
  }

  // 2. ISO date attribute inside a descendant (e.g. <time datetime="2026-03-01">)
  let descWithAttr = null
  containerEl.find('*').each((_, child) => {
    if (descWithAttr) return false
    const childAttrs = child.attribs || {}
    for (const [attr, val] of Object.entries(childAttrs)) {
      const strVal = String(val)
      if (strVal.length > 60 || strVal.startsWith('{') || strVal.startsWith('[') || strVal.startsWith('http')) continue
      const hasDay2 = /\b\d{1,2}\b/.test(strVal.replace(/\d{4}/, ''))
      if (/\d{4}-\d{2}-\d{2}/.test(strVal) || (looksLikeDate(strVal) && hasDay2)) {
        descWithAttr = { el: $(child), attr }
        return false
      }
    }
  })
  if (descWithAttr) {
    const sel = generateRelativeSelector($, containerEl, descWithAttr.el)
    if (sel) return { type: 'descendant_attribute', selector: sel, attribute: descWithAttr.attr }
  }

  // 3b. Compact date encoded in a link href (e.g. /events/ev-xxx-20260302183000/)
  //     Checked before text-based strategies since URL dates are always day-specific.
  let descFromHref = null
  containerEl.find('a').each((_, a) => {
    if (descFromHref) return false
    const href = $(a).attr('href') || ''
    if (/20\d{2}[01]\d[0-3]\d/.test(href)) { descFromHref = $(a); return false }
  })
  if (descFromHref) {
    const sel = generateRelativeSelector($, containerEl, descFromHref)
    if (sel) return { type: 'link_href', selector: sel }
  }

  // 4. Ancestor text — e.g. a day header wrapping a group of events
  let ancestor = containerEl.parent()
  for (let depth = 0; depth < 5; depth++) {
    if (!ancestor.length || ['body', 'html'].includes(ancestor[0]?.name)) break
    const ownText = ancestor.clone().children().remove().end().text().trim()
    if (ownText && looksLikeDate(ownText)) {
      const sel = generateSelector($, ancestor)
      if (sel) return { type: 'ancestor_text', selector: sel }
    }
    ancestor = ancestor.parent()
  }

  // 5. Preceding sibling — header row before a group of events
  let sibling = containerEl.prev()
  for (let i = 0; i < 10; i++) {
    if (!sibling.length) break
    const sibText = sibling.text().trim()
    if (sibText && looksLikeDate(sibText)) {
      const sel = generateSelector($, sibling)
      if (sel) return { type: 'sibling_header', selector: sel }
    }
    sibling = sibling.prev()
  }

  // 6. Descendant text — date text inside the event row
  if (dateStr) {
    const desc = findByText($, dateStr, containerEl)
    if (desc) {
      const sel = generateRelativeSelector($, containerEl, desc)
      if (sel) return { type: 'descendant', selector: sel }
    }
  }
  // Any date-looking text element inside the container
  let dateLooking = null
  containerEl.find('*').each((_, child) => {
    if (dateLooking) return false
    const ownText = $(child).clone().children().remove().end().text().trim()
    if (ownText && looksLikeDate(ownText)) dateLooking = $(child)
  })
  if (dateLooking) {
    const sel = generateRelativeSelector($, containerEl, dateLooking)
    if (sel) return { type: 'descendant', selector: sel }
  }

  return null
}

// ─── Runtime date extraction (used for preview here; mirrored in website.js) ─

export function extractDateFromStrategy($, el, dateStrategy) {
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

// ─── AI event extraction ──────────────────────────────────────────────────────

async function extractSampleEvents(cleanedHtml, hint) {
  const prompt = `You are looking at the HTML of an events listing page. Find the first 5 events and extract their details.

HTML:
${cleanedHtml}

Return a JSON object: { "events": [ { "title": "...", "date": "...", "link": "...", "description": "..." } ] }

Rules:
- title: the event name exactly as it appears on the page
- date: the date text nearest to this event, as it appears. Could be "Sun 1 Mar", "1 March 2026", "March 2026", "2026-03-01", etc. Look for dates adjacent to or grouping the event — ignore dates in calendars, navigation, or filter widgets that are visually far from the event list.
- link: the URL path or href value if present on or near the event. null if not found.
- description: a brief description if present. null if not found.
${hint ? `\nExtra context from the user: ${hint}` : ''}

Return ONLY valid JSON.`

  return await callAI(prompt, 'openai/gpt-4o-mini')
}

// ─── Preview extraction ───────────────────────────────────────────────────────

function extractPreview($, selectors, dateStrategy, sourceUrl) {
  const all = []
  let lastDate = ''

  $(selectors.container).each((_, el) => {
    const jel = $(el)
    const title = jel.find(selectors.title).first().text().trim()
    const dateStr = extractDateFromStrategy($, el, dateStrategy)
    const date = dateStr || lastDate
    if (dateStr) lastDate = dateStr

    const link = selectors.link
      ? (jel.find(selectors.link).first().attr('href') || jel.find('a').first().attr('href') || sourceUrl)
      : (jel.find('a').first().attr('href') || sourceUrl)
    const description = selectors.description
      ? jel.find(selectors.description).first().text().trim() || null
      : null

    if (title && date) all.push({ title, date, link, description })
  })

  // Pick up to 5 events preferring date variety — one per unique date, then fill remaining
  const seen = new Set()
  const events = []
  for (const e of all) {
    if (events.length >= 5) break
    if (!seen.has(e.date)) { seen.add(e.date); events.push(e) }
  }
  for (const e of all) {
    if (events.length >= 5) break
    if (!events.includes(e)) events.push(e)
  }

  if (events.length === 0 && $(selectors.container).length > 0) {
    const firstEl = $(selectors.container).first()
    const titleText = firstEl.find(selectors.title).first().text().trim()
    const dateVal = extractDateFromStrategy($, firstEl[0], dateStrategy)
    console.log(`[extractPreview] 0 events. Containers: ${$(selectors.container).length}`)
    console.log(`[extractPreview] title "${selectors.title}" → "${titleText.slice(0, 60)}"`)
    console.log(`[extractPreview] dateStrategy: ${JSON.stringify(dateStrategy)} → "${dateVal}"`)
  }

  return events
}

// ─── Main handler ─────────────────────────────────────────────────────────────

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

  console.log(`[extract-selectors] Fetching: ${url}`)
  let html
  let usedBrowserless = false
  try {
    html = await fetchPage(url)
  } catch (err) {
    return { statusCode: 422, body: JSON.stringify({ error: err.message }) }
  }
  console.log(`[extract-selectors] HTML fetched (${html.length} chars)`)

  let $ = cheerio.load(html)
  const pageName = $('title').first().text().trim() || url

  const cleaned = cleanHTML(html)
  console.log(`[extract-selectors] Cleaned HTML (${cleaned.length} chars) — asking AI for sample events...`)

  // Step 1: AI reads content and extracts sample event data
  let sampleResult
  try {
    sampleResult = await extractSampleEvents(cleaned, hint)
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: `AI extraction failed: ${err.message}` }) }
  }

  const sampleEvents = sampleResult?.events
  if (!sampleEvents?.length) {
    return { statusCode: 422, body: JSON.stringify({ error: 'No events found on this page.' }) }
  }

  console.log(`[extract-selectors] AI found ${sampleEvents.length} sample events`)
  console.log(`[extract-selectors] First event: ${JSON.stringify(sampleEvents[0])}`)

  // Step 2: Find the first event title in the DOM
  const firstTitle = sampleEvents[0]?.title
  let titleEl = findByText($, firstTitle)

  // If not found, the page likely needs JavaScript — try Browserless
  if (!titleEl && process.env.BROWSERLESS_TOKEN) {
    console.log(`[extract-selectors] Title not found in plain HTML — trying Browserless...`)
    try {
      html = await fetchWithBrowserless(url)
      $ = cheerio.load(html)
      usedBrowserless = true
      titleEl = findByText($, firstTitle)
    } catch (err) {
      console.log(`[extract-selectors] Browserless failed: ${err.message}`)
    }
  }

  if (!titleEl) {
    return {
      statusCode: 422,
      body: JSON.stringify({ error: `Could not locate "${firstTitle?.slice(0, 60)}" in the page HTML. The page may require JavaScript to render.` }),
    }
  }

  // Step 3: Derive the repeating container selector by walking up from the title element
  const sampleTitles = sampleEvents.map(e => e.title).filter(Boolean)
  const containerResult = deriveContainerSelector($, titleEl, sampleTitles)
  if (!containerResult) {
    return { statusCode: 422, body: JSON.stringify({ error: 'Could not identify the repeating event structure on this page.' }) }
  }

  const containerSelector = containerResult.selector
  const containerCount = $(containerSelector).length
  console.log(`[extract-selectors] Container: "${containerSelector}" (${containerCount} elements)`)
  const totalFound = containerCount

  // Step 4: Derive the title selector — find the title within the first container
  const firstContainer = $(containerSelector).first()
  const titleInContainer = findByText($, firstTitle, firstContainer)
  if (!titleInContainer) {
    return { statusCode: 422, body: JSON.stringify({ error: 'Could not derive title selector within container.' }) }
  }
  const titleSelector = generateRelativeSelector($, firstContainer, titleInContainer)
  console.log(`[extract-selectors] Title selector: "${titleSelector}"`)

  // Step 5: Derive date strategy by analysing the DOM around the container
  const dateStrategy = deriveDateStrategy($, firstContainer, sampleEvents[0]?.date, containerSelector)
  console.log(`[extract-selectors] Date strategy: ${JSON.stringify(dateStrategy)}`)

  // Step 6: Derive link selector by matching the sample href in the container
  const firstLink = sampleEvents.find(e => e.link)?.link
  let linkSelector = null
  if (firstLink) {
    firstContainer.find('a').each((_, el) => {
      const href = $(el).attr('href') || ''
      if (href && (href === firstLink || href.includes(firstLink) || firstLink.includes(href))) {
        linkSelector = generateRelativeSelector($, firstContainer, $(el))
        return false
      }
    })
    if (!linkSelector) linkSelector = 'a'
  }
  console.log(`[extract-selectors] Link selector: "${linkSelector}"`)

  // Step 7: Derive description selector
  const firstDesc = sampleEvents.find(e => e.description)?.description
  let descriptionSelector = null
  if (firstDesc) {
    const descEl = findByText($, firstDesc.slice(0, 60), firstContainer)
    if (descEl) descriptionSelector = generateRelativeSelector($, firstContainer, descEl)
  }

  const selectors = {
    container: containerSelector,
    title: titleSelector,
    link: linkSelector,
    description: descriptionSelector,
    dateStrategy: dateStrategy || null,
  }

  if (usedBrowserless) selectors.needsBrowserless = true

  // Step 8: Extract preview to verify everything works
  const preview = extractPreview($, selectors, dateStrategy, url)
  console.log(`[extract-selectors] Preview: ${preview.length} events`)

  if (!preview.length) {
    return {
      statusCode: 422,
      body: JSON.stringify({ error: 'Could not extract events with the derived structure. The page may require JavaScript to render or have an unusual layout.' }),
    }
  }

  // Step 9: Estimate sync interval from all event dates on the page
  const allDates = []
  $(containerSelector).each((_, el) => {
    const dateStr = extractDateFromStrategy($, el, dateStrategy)
    if (dateStr) {
      const parsed = parseEventDate(dateStr, null)
      if (parsed) allDates.push(parsed)
    }
  })
  const suggestedSyncHours = estimateSyncHours(allDates)
  console.log(`[extract-selectors] ${allDates.length} dates parsed — suggested sync: every ${suggestedSyncHours}h`)

  return {
    statusCode: 200,
    body: JSON.stringify({ pageName, selectors, preview, suggestedSyncHours, totalFound }),
  }
}
