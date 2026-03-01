const BROWSERLESS_URL = 'https://chrome.browserless.io/content'

// Strips scripts, styles and head to get at the visible text content
function visibleTextLength(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .length
}

// Fetch a page and return its HTML.
//
// Strategy:
//   1. Try a plain fetch with a 5s timeout.
//   2. If the response has very little visible text (< 500 chars) it's likely
//      a JS shell — fall through to Browserless.io.
//   3. If plain fetch times out or errors — fall through to Browserless.io.
//   4. Browserless.io spins up a real Chrome instance, renders the page fully,
//      and returns the HTML. Used for JS-rendered sites (Bookwhen, Dice, etc.)
//
export async function fetchPage(url) {
  // ── Step 1: try plain fetch ────────────────────────────────────────────────
  console.log(`[fetchPage] Trying plain fetch: ${url}`)
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    })
    clearTimeout(timeout)

    if (res.ok) {
      const html = await res.text()
      const textLen = visibleTextLength(html)
      console.log(`[fetchPage] Plain fetch OK — visible text length: ${textLen}`)
      if (textLen >= 500) {
        console.log(`[fetchPage] Using plain fetch result`)
        return html
      }
      console.log(`[fetchPage] Visible text too low (${textLen} chars) — likely a JS shell, falling back to Browserless.io`)
    } else {
      console.log(`[fetchPage] Plain fetch returned ${res.status} — falling back to Browserless.io`)
    }
  } catch (err) {
    console.log(`[fetchPage] Plain fetch failed (${err.message}) — falling back to Browserless.io`)
  }

  // ── Step 2: Browserless.io for JS-rendered pages ───────────────────────────
  if (!process.env.BROWSERLESS_TOKEN) {
    throw new Error('Page requires JavaScript rendering but BROWSERLESS_TOKEN is not set.')
  }

  return fetchWithBrowserless(url)
}

export async function fetchWithBrowserless(url) {
  if (!process.env.BROWSERLESS_TOKEN) {
    throw new Error('Page requires JavaScript rendering but BROWSERLESS_TOKEN is not set.')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 25000)

  console.log(`[fetchPage] Calling Browserless.io for: ${url}`)
  let res
  try {
    res = await fetch(`${BROWSERLESS_URL}?token=${process.env.BROWSERLESS_TOKEN}`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, gotoOptions: { waitUntil: 'networkidle2', timeout: 20000 } }),
    })
  } catch (err) {
    clearTimeout(timeout)
    throw new Error(err.name === 'AbortError' ? 'Browserless.io timed out after 25s' : err.message)
  }
  clearTimeout(timeout)

  console.log(`[fetchPage] Browserless.io responded: ${res.status}`)
  if (!res.ok) {
    const body = await res.text()
    console.log(`[fetchPage] Browserless.io error body: ${body}`)
    throw new Error(`Browserless.io failed: ${res.status} — ${body}`)
  }
  const html = await res.text()
  console.log(`[fetchPage] Browserless.io HTML length: ${html.length}`)
  return html
}
