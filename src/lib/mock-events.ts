import { startOfWeek, addDays, format } from "date-fns";

export type EventCategory = "Music" | "Dance" | "Comedy" | "Art" | "Film" | "Theatre" | "Exhibition" | "Talk" | "Other";

export interface EventItem {
  id: string;
  title: string;
  venue: string;
  date: string; // ISO date string
  time: string;
  category: EventCategory;
  isSaved: boolean;
  url: string | null;
  description: string | null;
}

export function getMockEvents(weekStart: Date): EventItem[] {
  const mon = weekStart;
  const toISO = (d: Date) => format(d, "yyyy-MM-dd");

  return [
    { id: "1", title: "Drumcode Night", venue: "Fabric", date: toISO(addDays(mon, 4)), time: "11pm", category: "Music", isSaved: false, url: null, description: null },
    { id: "2", title: "London Symphony Orchestra", venue: "Barbican", date: toISO(addDays(mon, 3)), time: "7:30pm", category: "Music", isSaved: false, url: null, description: null },
    { id: "3", title: "Swing Dance Social", venue: "Village Underground", date: toISO(addDays(mon, 4)), time: "8pm", category: "Dance", isSaved: false, url: null, description: null },
    { id: "4", title: "Stand-Up Showcase", venue: "Roundhouse", date: toISO(addDays(mon, 5)), time: "8pm", category: "Comedy", isSaved: false, url: null, description: null },
    { id: "5", title: "Late Night Jazz", venue: "The Jazz Cafe", date: toISO(addDays(mon, 4)), time: "9pm", category: "Music", isSaved: false, url: null, description: null },
    { id: "6", title: "Afrobeats Takeover", venue: "Phonox", date: toISO(addDays(mon, 5)), time: "10pm", category: "Music", isSaved: false, url: null, description: null },
    { id: "7", title: "Turbine Hall Installation", venue: "Tate Modern", date: toISO(addDays(mon, 0)), time: "10am", category: "Art", isSaved: false, url: null, description: null },
    { id: "8", title: "Rooftop Cinema", venue: "Bold Tendencies", date: toISO(addDays(mon, 5)), time: "7pm", category: "Other", isSaved: false, url: null, description: null },
    { id: "9", title: "Improv Comedy Night", venue: "Roundhouse", date: toISO(addDays(mon, 5)), time: "9:30pm", category: "Comedy", isSaved: false, url: null, description: null },
    { id: "10", title: "Contemporary Dance Workshop", venue: "Barbican", date: toISO(addDays(mon, 1)), time: "6pm", category: "Dance", isSaved: false, url: null, description: null },
  ];
}

export const categoryColors: Record<EventCategory, string> = {
  Music: "bg-primary text-primary-foreground",
  Dance: "bg-pink-100 text-pink-700",
  Comedy: "bg-amber-100 text-amber-700",
  Art: "bg-violet-100 text-violet-700",
  Film: "bg-sky-100 text-sky-700",
  Theatre: "bg-rose-100 text-rose-700",
  Exhibition: "bg-teal-100 text-teal-700",
  Talk: "bg-orange-100 text-orange-700",
  Other: "bg-secondary text-secondary-foreground",
};
