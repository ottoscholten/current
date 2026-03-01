
Personal events discovery dashboard for London. Aggregates events from venues and websites Otto follows into a weekly view.

**Tagline:** Discover life weekly

## Stack

- **Frontend:** React + TypeScript + Tailwind CSS + shadcn-ui
- **Build tool:** Vite
- **Database:** Supabase (Otto's own project, not Lovable's)
- **Hosting:** Netlify (not yet connected — local dev first)
- **Serverless functions:** Netlify Functions (for event fetching + scheduled refresh — not yet built)
- **GitHub:** https://github.com/ottoscholten/current-london-events

## App Structure

Two screens:

**This Week** — a 7-column week grid (Mon–Sun). Each column shows events for that day as cards. Navigate between weeks with ← → arrows. Filter by category (All / Music / Dance / Comedy / Art / Other). Click a card to open a detail modal (title, venue, date/time, description, link).

**Sources** — list of venues and websites Otto follows. Fully wired to Supabase. Add sources via modal (name, URL, type). Toggle active/inactive.

## Database (Supabase)

- `sources` — id, name, url, type, is_active, last_synced_at
- `events` — id, source_id, title, venue, neighbourhood, date, time, category, is_saved, url, description

## Event Fetching

Scripts live in `scripts/`. Run locally with `npm run fetch:ra`.

- `scripts/fetch-ra.js` — fetches London events from RA GraphQL API, filters via AI, stores in Supabase
  - RA GraphQL endpoint: `https://ra.co/graphql`
  - London area ID: `13`
  - Clears existing RA events before each run to avoid duplicates
  - AI filtering: one batched API call with all events + taste profile → returns matching indices only
  - Current AI provider: OpenRouter (keyword fallback in place — see AI Filtering section)

## AI Filtering

One call per sync run — all events sent in one batch, AI returns indices of matches.

**Taste profile:** "Trance, psychedelic, intense and deep electronic music — think dark/hypnotic dancefloor energy. Some house and techno but only when it's heavy or trippy. Also passionate ballet, modern, and contemporary dance performances."

**Provider status (as of Feb 2026):**
- Groq — API key returns 401 (account issue, not a code issue)
- Gemini — free tier not available in UK
- OpenRouter — free models rate-limited; needs small credit top-up to work reliably
- **Current state:** keyword filter used as placeholder in `fetch-ra.js`. Swap `filterWithGroq` logic for real AI call once a provider is unblocked.

## Build Order

**Completed:**
- Migrated away from Lovable (removed lovable-tagger)
- Migrated to Otto's own Supabase project
- This Week screen reads from Supabase (not mock data)
- Event detail modal (click card → title, venue, date, description, link)
- RA fetch script working (`npm run fetch:ra`)

**Next up:**
- Resolve AI filtering provider (top up OpenRouter or revisit Groq)
- Add Dice fetch script (`scripts/fetch-dice.js`)
- Add Eventbrite fetch script
- UI improvements (design is currently uninspiring)
- Netlify connection + cron scheduling (final launch step)

**v2 — Custom URL scraping:**
- When adding a source URL, fetch the page HTML
- Send HTML to Claude API once → extract CSS selectors for title, date, link
- Save selectors to DB — no AI cost on future fetches
- Future fetches: fetch HTML → apply saved selectors with cheerio → store events
- Fall back to Browserless.io for JS-rendered pages

**v3 — Source health:**
- Detect when a source stops returning events
- Alert Otto in the UI

## Data Flow

Manual sync button (cron later) → fetch script runs → filters via AI → stores only matching events in Supabase → frontend reads from Supabase directly.

## Key Decisions

- Events are cached in Supabase — never fetched live on page view
- Only filtered events are stored — nothing that fails the taste filter goes in the DB
- `Community` source type planned (pull all events, no filtering) — not yet in DB or UI
- Netlify is a final launch step, not needed for local development

## Working With Otto

- When implementing multi-step changes, do them one step at a time and confirm before moving to the next
- Ask follow-up questions when requirements are unclear before writing code
