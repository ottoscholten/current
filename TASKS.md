# Pending tasks

## Fix: Sites where date is split across table columns

Some sites (e.g. bookwhen.com) show dates as separate cells in a table row:
`| 4 | Wed | 6:30pm | Event Title |`

The day number and day name are in individual `<td>` cells with no full date string
anywhere visible. Month context is only in a global `data-options` JSON blob (which
we now correctly ignore).

**Current workaround**: `link_href` strategy extracts `YYYYMMDD` from the event URL
(e.g. `/events/ev-xxx-20260302183000`). Works for bookwhen but not all sites.

**Real fix needed**: Detect when a table row container has date-fragment cells
(a 1–2 digit number + a 3-letter weekday abbreviation) and combine them with the
month derived from the URL or page context to synthesise a full date string.

Files: `netlify/functions/extract-selectors.js` → `deriveDateStrategy`
       `netlify/lib/sources/website.js` → `extractDateFromStrategy`
