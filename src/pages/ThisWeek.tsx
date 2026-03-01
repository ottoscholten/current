import { useState, useEffect, useRef } from "react";
import { startOfWeek, addWeeks, addDays, format, isSameDay } from "date-fns";
import { ChevronLeft, ChevronRight, Heart, ExternalLink } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { categoryColors, type EventCategory, type EventItem } from "@/lib/mock-events";
import { cn } from "@/lib/utils";

const categories: ("All" | EventCategory)[] = ["All", "Music", "Dance", "Comedy", "Art", "Other"];

async function fetchEvents(weekStart: Date, weekEnd: Date, userId: string): Promise<EventItem[]> {
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("user_id", userId)
    .gte("date", format(weekStart, "yyyy-MM-dd"))
    .lte("date", format(weekEnd, "yyyy-MM-dd"))
    .order("date")
    .order("time");

  if (error) throw error;

  return (data ?? []).map((e) => ({
    id: e.id,
    title: e.title,
    venue: e.venue,
    date: e.date,
    time: e.time,
    category: e.category as EventCategory,
    isSaved: e.is_saved,
    url: e.url ?? null,
    description: e.description ?? null,
  }));
}

const ThisWeek = () => {
  const [weekOffset, setWeekOffset] = useState(0);
  const [filter, setFilter] = useState<"All" | EventCategory>("All");
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [selectedEvent, setSelectedEvent] = useState<EventItem | null>(null);

  const { user, session } = useAuth();
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const syncFiredRef = useRef(false);

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("taste_profile")
        .eq("id", user!.id)
        .single();
      return data;
    },
    enabled: !!user,
  });

  const hasTasteProfile = !!profile?.taste_profile?.trim();

  useEffect(() => {
    if (!user || !session || syncFiredRef.current) return;
    syncFiredRef.current = true;

    const sync = async () => {
      setSyncing(true);
      try {
        const res = await fetch("/api/sync", {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const data = await res.json().catch(() => ({}));
        // Only refresh events if the sync actually ran — not when skipped (fresh/no taste profile)
        if (data.ok && !data.skipped) {
          queryClient.invalidateQueries({ queryKey: ["events"] });
        }
      } finally {
        setSyncing(false);
      }
    };

    sync();
  }, [user?.id]);

  const weekStart = startOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 1 });
  const weekEnd = addDays(weekStart, 6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const { data: events = [], isLoading } = useQuery({
    queryKey: ["events", weekStart.toISOString(), user?.id],
    queryFn: () => fetchEvents(weekStart, weekEnd, user!.id),
    enabled: !!user,
  });

  const filtered = filter === "All" ? events : events.filter((e) => e.category === filter);

  const toggleSave = (id: string) => {
    setSavedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const weekLabel = `${format(weekStart, "d")}–${format(weekEnd, "d MMM")}`;

  return (
    <div className="mx-auto max-w-7xl px-6 py-6">
      {/* Taste profile nudge */}
      {profile !== undefined && !hasTasteProfile && (
        <div className="mb-6 rounded-lg border border-border bg-secondary px-4 py-3 text-sm text-foreground">
          Set your{" "}
          <Link to="/profile" className="font-medium underline underline-offset-2 hover:text-primary">
            taste profile
          </Link>{" "}
          to start discovering events.
        </div>
      )}

      {/* Week nav */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          {syncing && <span className="text-xs text-muted-foreground">Syncing events…</span>}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setWeekOffset((o) => o - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[120px] text-center text-sm font-medium text-foreground">{weekLabel}</span>
          <Button variant="ghost" size="icon" onClick={() => setWeekOffset((o) => o + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Filter pills */}
      <div className="mb-6 flex gap-2">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors",
              filter === cat
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground hover:text-foreground"
            )}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Week grid */}
      <div className="grid min-w-[700px] grid-cols-7 gap-3 overflow-x-auto">
        {days.map((day) => {
          const dayEvents = filtered.filter((e) => isSameDay(new Date(e.date), day));
          return (
            <div key={day.toISOString()} className="min-h-[200px]">
              <div className="mb-3 text-center">
                <div className="text-xs font-medium text-muted-foreground">{format(day, "EEE")}</div>
                <div className="text-sm font-semibold text-foreground">{format(day, "d")}</div>
              </div>
              <div className="space-y-2">
                {isLoading && (
                  <div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-border">
                    <span className="text-[10px] text-muted-foreground">Loading…</span>
                  </div>
                )}
                {!isLoading && dayEvents.length === 0 && (
                  <div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-border">
                    <span className="text-[10px] text-muted-foreground">No events</span>
                  </div>
                )}
                {dayEvents.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    isSaved={savedIds.has(event.id)}
                    onToggleSave={() => toggleSave(event.id)}
                    onClick={() => setSelectedEvent(event)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Event detail modal */}
      <Dialog open={!!selectedEvent} onOpenChange={(open) => !open && setSelectedEvent(null)}>
        <DialogContent className="max-w-md max-h-[85vh] flex flex-col">
          {selectedEvent && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">{selectedEvent.title}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 overflow-y-auto">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-foreground">{selectedEvent.venue}</span>
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", categoryColors[selectedEvent.category])}>
                    {selectedEvent.category}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {format(new Date(selectedEvent.date), "EEEE d MMMM")} · {selectedEvent.time}
                </p>
                {selectedEvent.description && (
                  <p className="text-sm text-foreground leading-relaxed">{selectedEvent.description}</p>
                )}
                {selectedEvent.url && (
                  <a
                    href={selectedEvent.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                  >
                    View event <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

function EventCard({
  event,
  isSaved,
  onToggleSave,
  onClick,
}: {
  event: EventItem;
  isSaved: boolean;
  onToggleSave: () => void;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="cursor-pointer rounded-lg border border-border bg-card p-3 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="mb-1 flex items-start justify-between gap-1">
        <h3 className="truncate text-xs font-semibold text-card-foreground">{event.title}</h3>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleSave(); }}
          className="shrink-0 text-muted-foreground transition-colors hover:text-primary"
        >
          <Heart className={cn("h-3 w-3", isSaved && "fill-primary text-primary")} />
        </button>
      </div>
      <p className="truncate text-[10px] text-muted-foreground">{event.venue}</p>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">{event.time}</span>
        <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-medium", categoryColors[event.category])}>
          {event.category}
        </span>
      </div>
    </div>
  );
}

export default ThisWeek;
