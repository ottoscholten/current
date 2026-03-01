// ─── Dice integration (not yet implemented) ───────────────────────────────────
//
// To add Dice as a supported integration, follow this pattern:
//
// import { syncSource } from '../sync-source.js'
//
// 1. fetchDiceEventsForDay(dateStr)
//    Fetch up to 50 events from the Dice API for a specific date.
//    Return the raw API response array ([] if none found).
//
// 2. normalizeDice(raw)
//    Convert the Dice API shape to the common event shape:
//    { title, venue, genres: string[], artists: string[], content: string|null, _raw }
//
// 3. toDiceRow(event, userId, sourceId, day)
//    Map the common shape to a Supabase `events` table row.
//    Reference toRARow in ra.js for the expected fields.
//
// 4. Export syncDice:
//    export async function syncDice(supabase, userId, tasteProfile) {
//      return syncSource(supabase, userId, tasteProfile, 'Dice', fetchDiceEventsForDay, normalizeDice, toDiceRow)
//    }
//    The source name ('Dice') must match the `name` column in the `sources` table.
//
// 5. Wire it up in netlify/functions/sync.js:
//    import { syncDice } from '../lib/sources/dice.js'
//    ...
//    case 'Dice':
//      results[name] = await syncDice(supabase, user.id, profile.taste_profile)
//      break
