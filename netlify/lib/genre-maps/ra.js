// RA genre name → ID mapping
// Source: https://ra.co/graphql { genres { id name } }
// Used at sync time to map taste_parsed genre labels to RA filter IDs.
// Each integration owns its own map — the taste profile itself is integration-agnostic.

export const RA_GENRE_MAP = {
  'Progressive House': 1,
  'Trance': 2,
  'Breakbeat': 3,
  'Drum & Bass': 4,
  'Techno': 5,
  'House': 6,
  'Hip-Hop': 9,
  'Hardcore': 11,
  'Bass': 12,
  'Garage': 13,
  'Tech House': 15,
  'Electro': 16,
  'Minimal': 18,
  'Ambient': 19,
  'Deep House': 20,
  'Disco': 21,
  'Downtempo': 22,
  'Dub': 23,
  'Dubstep': 24,
  'Experimental': 25,
  'Acid': 32,
  'Afrobeat': 33,
  'Balearic': 35,
  'Breakcore': 36,
  'Dub Techno': 42,
  'EBM': 43,
  'Footwork': 44,
  'IDM': 46,
  'Industrial': 47,
  'Italo Disco': 48,
  'Jungle': 49,
  'Noise': 54,
  'Drone': 41,
  'Electronica': 75,
  'Psytrance': 76,
  'Minimal Techno': 77,
  'Afro Tech': 78,
}

// Resolve a list of plain genre label strings to RA genre IDs.
// Unrecognised labels are silently ignored — the AI filter handles the rest.
export function resolveRAGenreIds(genreLabels = []) {
  return genreLabels
    .map(label => RA_GENRE_MAP[label])
    .filter(Boolean)
}
