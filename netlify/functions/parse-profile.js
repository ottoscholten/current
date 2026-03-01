import { createClient } from '@supabase/supabase-js'
import { callAI } from '../lib/ai.js'
import { COMMON_GENRES } from '../lib/genre-maps/common.js'

// Tags are integration-agnostic — plain labels only, no platform-specific IDs.
// Each integration (RA, Dice, etc.) owns its own genre map and resolves IDs at sync time.

const PARSE_PROMPT = (text) => `You are extracting a person's event taste profile into structured categories.

Input: "${text}"

Extract into these categories:
- genre: MUSIC genres only — map to the closest match from this list: ${COMMON_GENRES.join(', ')}. Never put dance styles or art forms here. You may add a music genre not on the list only if it is clearly distinct and well-known.
- vibe: energy and atmosphere descriptors (e.g. "dark", "hypnotic", "psychedelic", "high-energy", "emotional intensity")
- value: personal values and principles (e.g. "sober", "conscious", "connection", "movement-focused", "let go")
- artist: specific artists or DJs mentioned by name
- art_form: performing arts and physical disciplines ONLY (e.g. "ballet", "contemporary dance", "modern dance", "immersive theatre", "physical theatre"). Dance styles always go here, never in genre.
- crowd: crowd preferences (e.g. "queer-friendly", "dancers", "dressed up", "conscious crowd")
- venue: venue preferences (e.g. "intimate", "underground", "small", "places where people really dance")
- exclude: things explicitly not wanted (e.g. "no commercial", "no pop")

Rules:
- genre = music only. Ballet, contemporary dance, modern dance → art_form, never genre.
- "emotional" or "intense" music does not mean Downtempo — infer the actual genre from context (e.g. emotional trance → Trance, not Downtempo)
- other labels should be short (1–4 words), natural, lowercase
- infer what is clearly implied ("not afraid to move" → value: "movement-focused")
- if a category has nothing, return an empty array

Return ONLY valid JSON: { "genre": [...], "vibe": [...], "value": [...], "artist": [...], "art_form": [...], "crowd": [...], "venue": [...], "exclude": [...] }`

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' }

  const token = event.headers.authorization?.replace('Bearer ', '')
  if (!token) return { statusCode: 401, body: 'Unauthorized' }

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  )

  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) return { statusCode: 401, body: 'Unauthorized' }

  const { taste_profile } = JSON.parse(event.body || '{}')
  if (!taste_profile?.trim()) return { statusCode: 400, body: 'No profile text' }

  try {
    // Use Claude Haiku for better reasoning on nuanced human values
    const parsed = await callAI(PARSE_PROMPT(taste_profile), 'anthropic/claude-3-haiku')

    // Build flat tag array with stable IDs — no platform-specific fields
    const tags = []
    for (const [category, labels] of Object.entries(parsed)) {
      if (!Array.isArray(labels)) continue
      for (const label of labels) {
        if (typeof label !== 'string' || !label.trim()) continue
        tags.push({
          id: crypto.randomUUID(),
          category,
          label: label.trim(),
        })
      }
    }

    const { error } = await supabase
      .from('profiles')
      .update({ taste_parsed: tags })
      .eq('id', user.id)

    if (error) throw error

    return { statusCode: 200, body: JSON.stringify({ ok: true, tags }) }
  } catch (err) {
    console.error('Parse profile error:', err.message)
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) }
  }
}
