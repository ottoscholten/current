// Common electronic music and performing arts genre taxonomy.
// Used in the AI profile parsing prompt so Claude maps natural language
// to recognised, consistent names rather than inventing its own.
//
// Each integration maps from these names to its own platform IDs:
//   netlify/lib/genre-maps/ra.js     → RA genre IDs
//   netlify/lib/genre-maps/dice.js   → Dice genre IDs (future)

export const COMMON_GENRES = [
  // Electronic — club / dancefloor
  'Techno', 'Minimal Techno', 'Dub Techno', 'Industrial Techno',
  'Trance', 'Psytrance', 'Progressive Trance',
  'House', 'Deep House', 'Tech House', 'Progressive House', 'Acid House',
  'Electro', 'EBM', 'Industrial', 'Dark Electro',
  'Acid', 'Hardcore', 'Gabber',
  'Drum & Bass', 'Jungle', 'Breakbeat', 'Breakcore',
  'Dubstep', 'Bass', 'UK Garage',

  // Electronic — more textural / atmospheric
  'Ambient', 'Drone', 'IDM', 'Experimental', 'Electronica',
  'Downtempo', 'Dub', 'Noise',

  // Electronic — hybrid / crossover
  'Minimal', 'Balearic', 'Italo Disco', 'Disco', 'Nu-Disco',
  'Afro House', 'Afro Tech', 'Afrobeat',

  // Live / organic
  'Jazz', 'Soul', 'Funk', 'R&B', 'Hip-Hop', 'Grime',
  'Reggae', 'Dancehall', 'Latin', 'Classical',

  // Performing arts
  'Ballet', 'Contemporary Dance', 'Modern Dance',
  'Physical Theatre', 'Immersive Theatre', 'Performance Art',
  'Circus', 'Live Art',
]
