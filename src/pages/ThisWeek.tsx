import { useState, useEffect, useRef } from "react";
import { startOfDay, addDays, format, isSameDay, isToday } from "date-fns";
import { ChevronLeft, ChevronRight, ExternalLink, X, Heart } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { categoryColors, type EventCategory, type EventItem } from "@/lib/mock-events";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

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
  const [selectedDay, setSelectedDay] = useState<Date>(new Date());
  const [selectedEvent, setSelectedEvent] = useState<EventItem | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);
  const syncFiredRef = useRef(false);
  const isMobile = useIsMobile();

  const { user, session } = useAuth();
  const queryClient = useQueryClient();

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
        if (data.ok && !data.skipped) {
          queryClient.invalidateQueries({ queryKey: ["events"] });
        }
      } finally {
        setSyncing(false);
      }
    };

    sync();
  }, [user?.id]);

  // When window shifts, snap selected day to the first day of the new window
  useEffect(() => {
    setSelectedDay(addDays(startOfDay(new Date()), weekOffset * 7));
    setSelectedEvent(null);
  }, [weekOffset]);

  const weekStart = addDays(startOfDay(new Date()), weekOffset * 7);
  const weekEnd = addDays(weekStart, 6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const { data: events = [], isLoading } = useQuery({
    queryKey: ["events", weekStart.toISOString(), user?.id],
    queryFn: () => fetchEvents(weekStart, weekEnd, user!.id),
    enabled: !!user,
  });

  const dayEvents = events.filter((e) => isSameDay(new Date(e.date), selectedDay));

  const toggleSave = (id: string) => {
    setSavedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSelectDay = (day: Date) => {
    setSelectedDay(day);
    setSelectedEvent(null);
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-8">
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

      {/* Week strip */}
      <div className="mb-8 flex items-center gap-1">
        <button
          onClick={() => setWeekOffset((o) => o - 1)}
          className="shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <div className="flex flex-1 gap-1 overflow-x-auto">
          {days.map((day) => {
            const count = events.filter((e) => isSameDay(new Date(e.date), day)).length;
            const isSelected = isSameDay(day, selectedDay);
            const today = isToday(day);

            return (
              <button
                key={day.toISOString()}
                onClick={() => handleSelectDay(day)}
                className={cn(
                  "flex min-w-[44px] flex-1 flex-col items-center rounded-lg px-1 py-2.5 transition-colors",
                  isSelected
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <span className="text-[10px] font-medium uppercase tracking-widest">
                  {format(day, "EEE")}
                </span>
                <span className={cn(
                  "mt-0.5 text-sm font-semibold",
                  today && !isSelected && "text-primary"
                )}>
                  {format(day, "d")}
                </span>
                <div className="mt-1.5 flex gap-0.5 h-1.5 items-center">
                  {Array.from({ length: Math.min(count, 4) }).map((_, i) => (
                    <span
                      key={i}
                      className={cn(
                        "h-1 w-1 rounded-full",
                        isSelected ? "bg-background/50" : "bg-muted-foreground/40"
                      )}
                    />
                  ))}
                </div>
              </button>
            );
          })}
        </div>

        <button
          onClick={() => setWeekOffset((o) => o + 1)}
          className="shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Day heading */}
      <div className="mb-6 flex items-baseline justify-between">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          {format(selectedDay, "EEEE d MMMM")}
        </h2>
        <div className="flex items-center gap-3">
          {syncing && (
            <span className="text-xs text-muted-foreground">Syncing…</span>
          )}
          {weekOffset !== 0 && (
            <button
              onClick={() => setWeekOffset(0)}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              This week
            </button>
          )}
        </div>
      </div>

      {/* Content: card list + desktop detail panel */}
      <div className="flex items-start gap-6">
        {/* Card list */}
        <div className="w-full md:w-[380px] md:shrink-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={selectedDay.toISOString()}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.16 }}
            >
              {isLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-[76px] animate-pulse rounded-xl bg-secondary" />
                  ))}
                </div>
              ) : dayEvents.length === 0 ? (
                <p className="py-16 text-center text-sm text-muted-foreground">
                  Nothing on this day.
                </p>
              ) : (
                <div className="space-y-2">
                  {dayEvents.map((event, i) => (
                    <motion.div
                      key={event.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.18, delay: i * 0.05 }}
                    >
                      <EventCard
                        event={event}
                        isSaved={savedIds.has(event.id)}
                        isSelected={selectedEvent?.id === event.id}
                        onToggleSave={() => toggleSave(event.id)}
                        onClick={() =>
                          setSelectedEvent(selectedEvent?.id === event.id ? null : event)
                        }
                      />
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Desktop detail panel */}
        {!isMobile && (
          <AnimatePresence>
            {selectedEvent && (
              <motion.div
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12 }}
                transition={{ duration: 0.18 }}
                className="sticky top-20 w-80 shrink-0 rounded-xl border border-border bg-card p-5"
              >
                <AnimatePresence mode="wait">
                  <motion.div
                    key={selectedEvent.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.1 }}
                    className="space-y-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-base font-semibold leading-snug text-foreground">
                        {selectedEvent.title}
                      </h3>
                      <button
                        onClick={() => setSelectedEvent(null)}
                        className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">{selectedEvent.venue}</span>
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", categoryColors[selectedEvent.category])}>
                        {selectedEvent.category}
                      </span>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      {format(new Date(selectedEvent.date), "EEEE d MMMM")} · {selectedEvent.time}
                    </p>

                    {selectedEvent.description && (
                      <p className="text-sm leading-relaxed text-foreground/80">
                        {selectedEvent.description}
                      </p>
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
                  </motion.div>
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>

      {/* Mobile bottom sheet */}
      {isMobile && (
        <AnimatePresence>
          {selectedEvent && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-40 bg-black/60"
                onClick={() => setSelectedEvent(null)}
              />
              <motion.div
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ type: "spring", damping: 28, stiffness: 280 }}
                className="fixed bottom-0 left-0 right-0 z-50 max-h-[80vh] overflow-y-auto rounded-t-2xl border-t border-border bg-card p-6 pb-10"
              >
                <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-border" />

                <div className="mb-4 flex items-start justify-between gap-3">
                  <h3 className="text-base font-semibold leading-snug text-foreground">
                    {selectedEvent.title}
                  </h3>
                  <button
                    onClick={() => setSelectedEvent(null)}
                    className="mt-0.5 shrink-0 text-muted-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">{selectedEvent.venue}</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", categoryColors[selectedEvent.category])}>
                      {selectedEvent.category}
                    </span>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    {format(new Date(selectedEvent.date), "EEEE d MMMM")} · {selectedEvent.time}
                  </p>

                  {selectedEvent.description && (
                    <p className="text-sm leading-relaxed text-foreground/80">
                      {selectedEvent.description}
                    </p>
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
              </motion.div>
            </>
          )}
        </AnimatePresence>
      )}
    </div>
  );
};

function EventCard({
  event,
  isSaved,
  isSelected,
  onToggleSave,
  onClick,
}: {
  event: EventItem;
  isSaved: boolean;
  isSelected: boolean;
  onToggleSave: () => void;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "cursor-pointer rounded-xl border p-4 transition-all duration-150",
        isSelected
          ? "border-foreground/20 bg-card shadow-sm"
          : "border-border bg-card/40 hover:border-foreground/10 hover:bg-card"
      )}
    >
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold leading-snug text-foreground">{event.title}</h3>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleSave(); }}
          className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-primary"
        >
          <Heart className={cn("h-3.5 w-3.5", isSaved && "fill-primary text-primary")} />
        </button>
      </div>
      <p className="text-xs text-muted-foreground">{event.venue}</p>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs tabular-nums text-muted-foreground">{event.time}</span>
        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", categoryColors[event.category])}>
          {event.category}
        </span>
      </div>
    </div>
  );
}

export default ThisWeek;
