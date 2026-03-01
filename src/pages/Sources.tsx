import { useState, useEffect } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

interface Source {
  id: string;
  name: string;
  url: string;
  type: string;
  is_platform: boolean;
  is_active: boolean;
  last_synced_at: string;
}

const SourceRow = ({ source, onToggle }: { source: Source; onToggle: (id: string, current: boolean) => void }) => (
  <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <span className="font-medium text-card-foreground">{source.name}</span>
        <Badge variant="secondary" className="text-[10px]">{source.type}</Badge>
      </div>
      <p className="truncate text-xs text-muted-foreground">{source.url}</p>
      {source.last_synced_at && (
        <p className="text-[10px] text-muted-foreground">
          Synced {formatDistanceToNow(new Date(source.last_synced_at), { addSuffix: true })}
        </p>
      )}
    </div>
    <Switch checked={source.is_active} onCheckedChange={() => onToggle(source.id, source.is_active)} />
  </div>
);

const Sources = () => {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [type, setType] = useState<"Venue" | "Website">("Venue");

  const { user } = useAuth();

  const fetchSources = async () => {
    const [{ data: sourcesData, error }, { data: prefsData, error: prefsError }] = await Promise.all([
      supabase.from("sources").select("*").order("name"),
      supabase.from("user_source_prefs").select("source_id, is_active, last_synced_at").eq("user_id", user!.id),
    ]);

    if (error || prefsError) {
      console.error("Sources error:", error?.message, prefsError?.message);
      toast.error(`Failed to load sources: ${error?.message ?? prefsError?.message}`);
      setLoading(false);
      return;
    }

    const prefsMap = Object.fromEntries((prefsData ?? []).map((p) => [p.source_id, p]));
    const merged = (sourcesData ?? []).map((s) => ({
      ...s,
      is_active: prefsMap[s.id]?.is_active ?? s.is_active,
      last_synced_at: prefsMap[s.id]?.last_synced_at ?? null,
    }));

    setSources(merged);
    setLoading(false);
  };

  useEffect(() => {
    if (user) fetchSources();
  }, [user?.id]);

  const handleToggle = async (id: string, current: boolean) => {
    const enabling = !current;
    const { error } = await supabase
      .from("user_source_prefs")
      .upsert({
        user_id: user!.id,
        source_id: id,
        is_active: enabling,
        // Reset sync time when enabling so it fetches on the next ThisWeek visit
        ...(enabling ? { last_synced_at: null } : {}),
      });
    if (error) {
      toast.error("Failed to update source");
      return;
    }
    if (!enabling) {
      // Remove events for this source immediately
      await supabase.from("events").delete().eq("user_id", user!.id).eq("source_id", id);
    }
    setSources((prev) => prev.map((s) => (s.id === id ? { ...s, is_active: enabling } : s)));
  };

  const handleAdd = async () => {
    if (!name.trim() || !url.trim()) return;
    const { data, error } = await supabase
      .from("sources")
      .insert({ name: name.trim(), url: url.trim(), type, is_platform: false })
      .select()
      .single();
    if (error) {
      toast.error("Failed to add source");
      return;
    }
    setSources((prev) => [...prev, data]);
    setName("");
    setUrl("");
    setType("Venue");
    setOpen(false);
    toast.success("Source added");
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Sources</h2>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> Add Source
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-6">
          {/* Platform integrations — hardcoded sources like RA, Dice, Eventbrite.
              Toggle currently controls sources.is_active directly.
              TODO: when auth lands, swap to user_source_prefs per-user toggle. */}
          {sources.some((s) => s.is_platform) && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Supported integrations</p>
              <div className="space-y-2">
                {sources.filter((s) => s.is_platform).map((source) => (
                  <SourceRow key={source.id} source={source} onToggle={handleToggle} />
                ))}
              </div>
            </div>
          )}

          {/* Custom sources — user-added URLs for scraping */}
          {sources.some((s) => !s.is_platform) && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Custom sources</p>
              <p className="mb-2 text-xs text-muted-foreground">Add any website — we'll scrape it for events.</p>
              <div className="space-y-2">
                {sources.filter((s) => !s.is_platform).map((source) => (
                  <SourceRow key={source.id} source={source} onToggle={handleToggle} />
                ))}
              </div>
            </div>
          )}

          {sources.length === 0 && (
            <p className="text-sm text-muted-foreground">No sources yet.</p>
          )}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Source</DialogTitle>
            <DialogDescription>Add a venue or website to pull events from.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fabric" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="url">URL</Label>
              <Input id="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <div className="flex gap-2">
                {(["Venue", "Website"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setType(t)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      type === t
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleAdd} disabled={!name.trim() || !url.trim()}>
              Add Source
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Sources;
