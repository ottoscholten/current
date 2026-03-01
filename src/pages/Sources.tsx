import { useState, useEffect } from "react";
import { Plus, Loader2, AlertCircle, ChevronLeft, Search, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
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
  skip_taste_filter: boolean;
  last_synced_at: string | null;
  selectors: unknown;
  created_by: string | null;
}

interface PreviewEvent {
  title: string;
  date: string;
  time?: string;
  link: string;
  description: string;
}

// ─── Source row ─────────────────────────────────────────────────────────────

const SourceRow = ({
  source,
  userId,
  onToggleActive,
  onToggleFilter,
  onEdit,
}: {
  source: Source;
  userId: string;
  onToggleActive: (id: string, current: boolean) => void;
  onToggleFilter: (id: string, current: boolean) => void;
  onEdit: (source: Source) => void;
}) => (
  <div className="rounded-lg border border-border bg-card px-4 py-3">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-card-foreground">{source.name}</span>
          <Badge variant="secondary" className="text-[10px]">{source.type}</Badge>
          {source.created_by === userId && (
            <button
              onClick={() => onEdit(source)}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">{source.url}</p>
        {source.last_synced_at && (
          <p className="text-[10px] text-muted-foreground">
            Synced {formatDistanceToNow(new Date(source.last_synced_at), { addSuffix: true })}
          </p>
        )}
      </div>
      <Switch
        checked={source.is_active}
        onCheckedChange={() => onToggleActive(source.id, source.is_active)}
      />
    </div>
    {!source.is_platform && source.is_active && (
      <div className="mt-2 flex items-center gap-2 border-t border-border pt-2">
        <Switch
          checked={!source.skip_taste_filter}
          onCheckedChange={() => onToggleFilter(source.id, source.skip_taste_filter)}
        />
        <span className="text-[10px] text-muted-foreground">Taste filter</span>
      </div>
    )}
  </div>
);

// ─── Sync frequency options ──────────────────────────────────────────────────

const SYNC_OPTIONS = [
  { hours: 12,  label: "Twice daily",   hint: "Good for venues that post events last-minute." },
  { hours: 24,  label: "Daily",         hint: "A good default for most event listings." },
  { hours: 72,  label: "Every 3 days",  hint: "Works well for weekly programmes." },
  { hours: 168, label: "Weekly",        hint: "Ideal for monthly or seasonal listings." },
  { hours: 720, label: "Monthly",       hint: "For venues that plan well ahead." },
] as const;

// ─── Main page ───────────────────────────────────────────────────────────────

type AddStep = "url" | "checking" | "preview" | "fix" | "setup";

const Sources = () => {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // Edit dialog state
  const [editSource, setEditSource] = useState<Source | null>(null);
  const [editName, setEditName] = useState("");

  // Add dialog state
  const [addOpen, setAddOpen] = useState(false);
  const [addStep, setAddStep] = useState<AddStep>("url");
  const [addUrl, setAddUrl] = useState("");
  const [addCategories, setAddCategories] = useState<string[]>(["Other"]);
  const [addName, setAddName] = useState("");
  const [addSelectors, setAddSelectors] = useState<Json | null>(null);
  const [addPreview, setAddPreview] = useState<PreviewEvent[]>([]);
  const [addError, setAddError] = useState<string | null>(null);
  const [addHint, setAddHint] = useState("");
  const [addSyncHours, setAddSyncHours] = useState(24);

  const { user, session } = useAuth();

  const fetchSources = async () => {
    const [{ data: sourcesData, error }, { data: prefsData, error: prefsError }] = await Promise.all([
      supabase.from("sources").select("*").order("name"),
      supabase
        .from("user_source_prefs")
        .select("source_id, is_active, skip_taste_filter, last_synced_at")
        .eq("user_id", user!.id),
    ]);

    if (error || prefsError) {
      toast.error(`Failed to load sources: ${error?.message ?? prefsError?.message}`);
      setLoading(false);
      return;
    }

    const prefsMap = Object.fromEntries((prefsData ?? []).map((p) => [p.source_id, p]));
    const merged = (sourcesData ?? []).map((s) => ({
      ...s,
      // No source is active by default — user must explicitly enable each one.
      // This ensures a pref row exists before sync runs.
      is_active: prefsMap[s.id]?.is_active ?? false,
      skip_taste_filter: prefsMap[s.id]?.skip_taste_filter ?? false,
      last_synced_at: prefsMap[s.id]?.last_synced_at ?? null,
    }));

    setSources(merged);
    setLoading(false);
  };

  useEffect(() => {
    if (user) fetchSources();
  }, [user?.id]);

  const handleToggleActive = async (id: string, current: boolean) => {
    const enabling = !current;
    const source = sources.find((s) => s.id === id);
    const { error } = await supabase.from("user_source_prefs").upsert({
      user_id: user!.id,
      source_id: id,
      is_active: enabling,
      // Custom website sources always skip taste filtering — they're specific venues you follow
      ...(!source?.is_platform ? { skip_taste_filter: true } : {}),
      ...(enabling ? { last_synced_at: null } : {}),
    });
    if (error) { toast.error("Failed to update source"); return; }
    if (!enabling) {
      await supabase.from("events").delete().eq("user_id", user!.id).eq("source_id", id);
    }
    setSources((prev) => prev.map((s) => s.id === id ? { ...s, is_active: enabling } : s));
  };

  const handleToggleFilter = async (id: string, currentSkip: boolean) => {
    const newSkip = !currentSkip;
    const { error } = await supabase.from("user_source_prefs").upsert({
      user_id: user!.id,
      source_id: id,
      skip_taste_filter: newSkip,
      last_synced_at: null,
    });
    if (error) { toast.error("Failed to update taste filter"); return; }
    setSources((prev) => prev.map((s) => s.id === id ? { ...s, skip_taste_filter: newSkip } : s));
  };

  const handleEditSave = async () => {
    if (!editSource || !editName.trim()) return;
    const { error } = await supabase
      .from("sources")
      .update({ name: editName.trim() })
      .eq("id", editSource.id);
    if (error) { toast.error("Failed to update name"); return; }
    setSources((prev) => prev.map((s) => s.id === editSource.id ? { ...s, name: editName.trim() } : s));
    setEditSource(null);
    toast.success("Name updated");
  };

  const handleCheck = async () => {
    if (!addUrl.trim()) return;
    setAddStep("checking");
    setAddError(null);

    try {
      if (!session) {
        setAddError("Not signed in — please refresh and try again.");
        setAddStep("url");
        return;
      }
      const res = await fetch("/.netlify/functions/extract-selectors", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ url: addUrl.trim(), hint: addHint.trim() || undefined }),
      });

      const data = await res.json();

      if (!res.ok) {
        setAddError(data.error || "We couldn't read this page — check the URL and try again.");
        setAddStep("url");
        return;
      }

      setAddName(data.pageName || "");
      setAddSelectors(data.selectors);
      setAddPreview(data.preview);
      setAddSyncHours(data.suggestedSyncHours ?? 24);
      setAddHint("");
      setAddStep("preview");
    } catch {
      setAddError("Something went wrong — please try again.");
      setAddStep("url");
    }
  };

  const handleSave = async () => {
    const { data: sourceData, error: sourceError } = await supabase
      .from("sources")
      .insert({
        name: addName.trim(),
        url: addUrl.trim(),
        type: 'Website',
        categories: addCategories,
        is_platform: false,
        selectors: addSelectors,
        created_by: user!.id,
      })
      .select()
      .single();

    if (sourceError) {
      toast.error(sourceError.message || "Failed to save source");
      return;
    }

    const { error: prefError } = await supabase.from("user_source_prefs").upsert({
      user_id: user!.id,
      source_id: sourceData.id,
      is_active: true,
      skip_taste_filter: true,
      sync_interval_hours: addSyncHours,
      last_synced_at: null,
    });

    if (prefError) {
      toast.error(prefError.message || "Failed to activate source");
      return;
    }

    setSources((prev) => [...prev, {
      ...sourceData,
      is_active: true,
      skip_taste_filter: true,
      last_synced_at: null,
      created_by: user!.id,
    }]);

    handleReset();
    toast.success(`${addName} added`);
  };

  const handleReset = () => {
    setAddOpen(false);
    setAddStep("url");
    setAddUrl("");
    setAddCategories(["Other"]);
    setAddName("");
    setAddSelectors(null);
    setAddPreview([]);
    setAddError(null);
    setAddHint("");
    setAddSyncHours(24);
  };

  const q = searchQuery.toLowerCase();
  const filtered = q ? sources.filter((s) => s.name.toLowerCase().includes(q)) : sources;
  const platformSources = filtered.filter((s) => s.is_platform);
  const mySources = filtered.filter((s) => !s.is_platform && s.created_by === user!.id);
  const communitySources = filtered.filter((s) => !s.is_platform && s.created_by !== user!.id);

  const syncHint = SYNC_OPTIONS.find((o) => o.hours === addSyncHours)?.hint ?? "";
  const urlDomain = (() => { try { return new URL(addUrl).hostname.replace(/^www\./, ''); } catch { return addUrl; } })();

  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Sources</h2>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> Add website
        </Button>
      </div>
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search sources…"
          className="pl-8 text-sm"
        />
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-8">

          {platformSources.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Supported integrations
              </p>
              <div className="space-y-2">
                {platformSources.map((s) => (
                  <SourceRow key={s.id} source={s} userId={user!.id} onToggleActive={handleToggleActive} onToggleFilter={handleToggleFilter} onEdit={(s) => { setEditSource(s); setEditName(s.name); }} />
                ))}
              </div>
            </div>
          )}

          {mySources.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Your websites
              </p>
              <div className="space-y-2">
                {mySources.map((s) => (
                  <SourceRow key={s.id} source={s} userId={user!.id} onToggleActive={handleToggleActive} onToggleFilter={handleToggleFilter} onEdit={(s) => { setEditSource(s); setEditName(s.name); }} />
                ))}
              </div>
            </div>
          )}

          {communitySources.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Community created
              </p>
              <div className="space-y-2">
                {communitySources.map((s) => (
                  <SourceRow key={s.id} source={s} userId={user!.id} onToggleActive={handleToggleActive} onToggleFilter={handleToggleFilter} onEdit={(s) => { setEditSource(s); setEditName(s.name); }} />
                ))}
              </div>
            </div>
          )}

          {sources.length === 0 && (
            <p className="text-sm text-muted-foreground">No sources yet.</p>
          )}
        </div>
      )}

      {/* Edit name dialog */}
      <Dialog open={!!editSource} onOpenChange={(open) => { if (!open) setEditSource(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit source</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label htmlFor="edit-name">Name</Label>
            <Input
              id="edit-name"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleEditSave()}
              className="mt-1.5"
            />
          </div>
          <DialogFooter>
            <Button onClick={handleEditSave} disabled={!editName.trim()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add website dialog */}
      <Dialog open={addOpen} onOpenChange={(open) => { if (!open) handleReset(); }}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">

          {/* ── Step: url ── */}
          {addStep === "url" && (
            <>
              <DialogHeader>
                <DialogTitle>Add an events website</DialogTitle>
                <DialogDescription>
                  Got a favourite venue, club night, or events page you don't want to miss? Paste the link and we'll watch it for you — checking regularly for new events and adding anything that looks like your kind of thing to your week.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label htmlFor="url">Link to the events page</Label>
                  <Input
                    id="url"
                    value={addUrl}
                    onChange={(e) => setAddUrl(e.target.value)}
                    placeholder="e.g. https://fabriclondon.com/events"
                    onKeyDown={(e) => e.key === "Enter" && handleCheck()}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Use the URL of their events or programme page — not the homepage.
                  </p>
                </div>
                {addError && (
                  <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {addError}
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button onClick={handleCheck} disabled={!addUrl.trim()}>
                  Check this site
                </Button>
              </DialogFooter>
            </>
          )}

          {/* ── Step: checking ── */}
          {addStep === "checking" && (
            <>
              <DialogHeader>
                <DialogTitle>Checking this page…</DialogTitle>
                <DialogDescription className="break-all text-xs">{addUrl}</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col items-center gap-3 py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {addHint ? "Trying again with your feedback…" : "Looking for events on this page…"}
                </p>
              </div>
            </>
          )}

          {/* ── Step: preview ── */}
          {addStep === "preview" && (
            <>
              <DialogHeader>
                <DialogTitle>Here's what we found</DialogTitle>
                <DialogDescription>
                  {addPreview.length > 0
                    ? `Do these look like the right events from ${urlDomain}?`
                    : `We didn't find any events on this page.`}
                </DialogDescription>
              </DialogHeader>
              <div className="py-2">
                {addPreview.length > 0 ? (
                  <div className="space-y-1.5 rounded-md border border-border p-3">
                    {addPreview.map((e, i) => (
                      <div key={i} className="border-b border-border pb-1.5 last:border-0 last:pb-0">
                        {e.link ? (
                          <a
                            href={e.link.startsWith('http') ? e.link : `${new URL(addUrl).origin}${e.link}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-medium leading-snug hover:underline"
                          >
                            {e.title}
                          </a>
                        ) : (
                          <p className="text-sm font-medium leading-snug">{e.title}</p>
                        )}
                        <p className="text-[11px] text-muted-foreground">
                          {[e.date, e.time].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Try telling us what to look for and we'll take another look.
                  </p>
                )}
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setAddStep("fix")}>
                  {addPreview.length > 0 ? "Something's off" : "Tell us what to look for"}
                </Button>
                {addPreview.length > 0 && (
                  <Button onClick={() => setAddStep("setup")}>
                    Looks right →
                  </Button>
                )}
              </DialogFooter>
            </>
          )}

          {/* ── Step: fix ── */}
          {addStep === "fix" && (
            <>
              <DialogHeader>
                <DialogTitle>
                  <button
                    onClick={() => setAddStep("preview")}
                    className="mr-2 inline-flex items-center text-muted-foreground hover:text-foreground"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  What's off?
                </DialogTitle>
                <DialogDescription>
                  Describe what doesn't look right in plain English and we'll try again. For example: "the dates are missing", "it's showing the wrong section of the page", or "only past events are coming up".
                </DialogDescription>
              </DialogHeader>
              <div className="py-2 space-y-1">
                <textarea
                  value={addHint}
                  onChange={(e) => setAddHint(e.target.value.slice(0, 500))}
                  placeholder="Dates are missing / showing the wrong events / only past events…"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  rows={3}
                  autoFocus
                />
                <p className="text-right text-[10px] text-muted-foreground">{addHint.length}/500</p>
              </div>
              <DialogFooter>
                <Button onClick={handleCheck} disabled={!addHint.trim()}>
                  Try again
                </Button>
              </DialogFooter>
            </>
          )}

          {/* ── Step: setup ── */}
          {addStep === "setup" && (
            <>
              <DialogHeader>
                <DialogTitle>Almost done</DialogTitle>
                <DialogDescription>
                  A couple of quick settings before we start tracking this site.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-5 py-2">
                <div className="space-y-1.5">
                  <Label htmlFor="name">What do you want to call it?</Label>
                  <Input
                    id="name"
                    value={addName}
                    onChange={(e) => setAddName(e.target.value)}
                    placeholder="e.g. Fabric, Corsica Studios, Boiler Room…"
                  />
                </div>
                <div className="space-y-2">
                  <Label>What kind of events does it list?</Label>
                  <div className="flex flex-wrap gap-2">
                    {(["Music", "Dance", "Comedy", "Art", "Other"] as const).map((cat) => {
                      const selected = addCategories.includes(cat);
                      return (
                        <button
                          key={cat}
                          onClick={() => setAddCategories((prev) =>
                            selected
                              ? prev.length > 1 ? prev.filter((c) => c !== cat) : prev
                              : [...prev, cat]
                          )}
                          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                            selected
                              ? "bg-primary text-primary-foreground"
                              : "bg-secondary text-muted-foreground"
                          }`}
                        >
                          {cat}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>How often should we check for new events?</Label>
                  <div className="flex flex-wrap gap-2">
                    {SYNC_OPTIONS.map(({ hours, label }) => (
                      <button
                        key={hours}
                        onClick={() => setAddSyncHours(hours)}
                        className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                          addSyncHours === hours
                            ? "bg-primary text-primary-foreground"
                            : "bg-secondary text-muted-foreground"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {syncHint && (
                    <p className="text-[11px] text-muted-foreground">{syncHint}</p>
                  )}
                </div>
              </div>
              <DialogFooter>
                <Button onClick={handleSave} disabled={!addName.trim()}>
                  Add to my week
                </Button>
              </DialogFooter>
            </>
          )}

        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Sources;
