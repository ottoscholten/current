const AI_URL = 'https://openrouter.ai/api/v1/chat/completions'

export async function callAI(prompt, model = 'meta-llama/llama-3.1-8b-instruct') {
  const res = await fetch(AI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`AI request failed: ${res.status} — ${text}`)
  }
  const json = await res.json()
  return JSON.parse(json.choices[0].message.content)
}

// Builds a structured taste summary from raw text + parsed tags
function buildTasteContext(tasteProfile, tasteParsed = []) {
  const lines = [`Taste: "${tasteProfile}"`]
  const byCategory = {}
  for (const tag of tasteParsed) {
    if (!byCategory[tag.category]) byCategory[tag.category] = []
    byCategory[tag.category].push(tag.label)
  }
  if (byCategory.genre?.length)    lines.push(`Genres: ${byCategory.genre.join(', ')}`)
  if (byCategory.vibe?.length)     lines.push(`Vibes: ${byCategory.vibe.join(', ')}`)
  if (byCategory.value?.length)    lines.push(`Values: ${byCategory.value.join(', ')}`)
  if (byCategory.artist?.length)   lines.push(`Artists they like: ${byCategory.artist.join(', ')}`)
  if (byCategory.art_form?.length) lines.push(`Art forms: ${byCategory.art_form.join(', ')}`)
  if (byCategory.crowd?.length)    lines.push(`Crowd preferences: ${byCategory.crowd.join(', ')}`)
  if (byCategory.venue?.length)    lines.push(`Venue preferences: ${byCategory.venue.join(', ')}`)
  if (byCategory.exclude?.length)  lines.push(`Exclude: ${byCategory.exclude.join(', ')}`)
  return lines.join('\n')
}

// Pass 1: cheap coarse filter using title/venue/genres/artists only.
// Removes obvious non-matches before the more expensive strict pass.
export async function broadFilter(events, tasteProfile, tasteParsed = []) {
  const tasteContext = buildTasteContext(tasteProfile, tasteParsed)
  const eventList = events.map((e, i) => {
    const genres = e.genres.join(', ') || 'unknown'
    const artists = e.artists.join(', ') || 'unknown'
    return `${i}. "${e.title}" at ${e.venue} | Genres: ${genres} | Artists: ${artists}`
  }).join('\n')

  const prompt = `You are a personal event curator. Filter these events for someone with this taste:
${tasteContext}

Include an event ONLY if it clearly matches their taste. Exclude anything obviously unrelated.

Events:
${eventList}

Return ONLY a JSON object: {"matches": [0, 3, 7, ...]}`

  const result = await callAI(prompt)
  return result.matches || []
}

// Pass 2: strict quality filter using full event content.
// Returns all strong matches in ranked order — no hard cap.
export async function strictFilter(events, tasteProfile, tasteParsed = []) {
  const tasteContext = buildTasteContext(tasteProfile, tasteParsed)
  const eventList = events.map((e, i) => {
    const genres = e.genres.join(', ') || 'unknown'
    const artists = e.artists.join(', ') || 'unknown'
    const content = e.content ? `\n   Info: ${e.content.slice(0, 400)}` : ''
    return `${i}. "${e.title}" at ${e.venue} | Genres: ${genres} | Artists: ${artists}${content}`
  }).join('\n\n')

  const prompt = `You are a personal event curator. From these events, return all that are a strong match, ranked best first. Only include events you are confident match — if in doubt, exclude.

${tasteContext}

Events:
${eventList}

Return ONLY a JSON object: {"matches": [0, 3, 7, ...]}`

  const result = await callAI(prompt)
  return result.matches || []
}
