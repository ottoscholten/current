export interface Source {
  id: string;
  name: string;
  url: string;
  type: "Venue" | "Website";
  is_active: boolean;
  last_synced_at: string;
}

const STORAGE_KEY = "current_sources";

const defaultSources: Source[] = [
  { id: "1", name: "Fabric", url: "https://fabriclondon.com", type: "Venue", is_active: true, last_synced_at: new Date(Date.now() - 2 * 3600000).toISOString() },
  { id: "2", name: "Barbican", url: "https://barbican.org.uk", type: "Venue", is_active: true, last_synced_at: new Date(Date.now() - 5 * 3600000).toISOString() },
  { id: "3", name: "Village Underground", url: "https://villageunderground.co.uk", type: "Venue", is_active: true, last_synced_at: new Date(Date.now() - 1 * 3600000).toISOString() },
  { id: "4", name: "Resident Advisor London", url: "https://ra.co/events/uk/london", type: "Website", is_active: true, last_synced_at: new Date(Date.now() - 3 * 3600000).toISOString() },
  { id: "5", name: "Dice London", url: "https://dice.fm/london", type: "Website", is_active: true, last_synced_at: new Date(Date.now() - 4 * 3600000).toISOString() },
  { id: "6", name: "London Dance Network", url: "https://londondance.com", type: "Website", is_active: false, last_synced_at: new Date(Date.now() - 24 * 3600000).toISOString() },
];

export function getSources(): Source[] {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultSources));
    return defaultSources;
  }
  return JSON.parse(stored);
}

export function saveSources(sources: Source[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sources));
}

export function addSource(source: Omit<Source, "id" | "last_synced_at" | "is_active">): Source {
  const sources = getSources();
  const newSource: Source = {
    ...source,
    id: crypto.randomUUID(),
    is_active: true,
    last_synced_at: new Date().toISOString(),
  };
  sources.push(newSource);
  saveSources(sources);
  return newSource;
}

export function toggleSource(id: string): Source[] {
  const sources = getSources();
  const updated = sources.map((s) => (s.id === id ? { ...s, is_active: !s.is_active } : s));
  saveSources(updated);
  return updated;
}
