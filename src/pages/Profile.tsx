import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import TasteConstellation from "@/components/TasteConstellation";

interface TasteTag {
  id: string;
  category: string;
  label: string;
}

const Profile = () => {
  const { user, session } = useAuth();
  const [tasteProfile, setTasteProfile] = useState("");
  const [tags, setTags] = useState<TasteTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .limit(1)
      .then(({ data, error }) => {
        if (error) console.error("Profile error:", error.message);
const row = data?.[0];
        setTasteProfile(row?.taste_profile ?? "");
        setTags((row?.taste_parsed as TasteTag[]) ?? []);
        setLoading(false);
      });
  }, [user?.id]);

  const handleSave = async () => {
    if (!user || !session) return;
    setSaving(true);

    // Save raw text first
    const { error } = await supabase
      .from("profiles")
      .update({ taste_profile: tasteProfile })
      .eq("id", user.id);

    if (error) {
      setSaving(false);
      toast.error("Failed to save");
      return;
    }

    // Parse into structured tags via AI
    try {
      const res = await fetch("/api/parse-profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ taste_profile: tasteProfile }),
      });
      const data = await res.json();
      if (data.ok) setTags(data.tags);
    } catch {
      // Non-fatal — raw text is already saved
      toast.error("Saved, but taste tags couldn't be generated");
    }

    // Reset sync state so next ThisWeek visit re-syncs with new taste profile.
    // Clear synced_days so all days are re-fetched, and delete unsaved events.
    await supabase
      .from("user_source_prefs")
      .update({ last_synced_at: null, synced_days: [] })
      .eq("user_id", user.id);

    await supabase
      .from("events")
      .delete()
      .eq("user_id", user.id)
      .eq("is_saved", false);

    setSaving(false);
    toast.success("Taste profile saved");
  };

  const removeTag = async (id: string) => {
    if (!user) return;
    const updated = tags.filter((t) => t.id !== id);
    setTags(updated);
    await supabase
      .from("profiles")
      .update({ taste_parsed: updated })
      .eq("id", user.id);
  };

  return (
    <div className="mx-auto max-w-xl px-6 py-6">
      <h2 className="mb-1 text-lg font-semibold text-foreground">Profile</h2>
      <p className="mb-6 text-xs text-muted-foreground">{user?.email}</p>

      {/* Taste constellation */}
      {!loading && tags.length > 0 && (
        <div className="mb-6">
          <TasteConstellation tags={tags} onRemove={removeTag} />
        </div>
      )}

      {/* Text input */}
      <div className="space-y-3">
        <div>
          <Label htmlFor="taste">Update taste profile</Label>
          <p className="mb-2 text-xs text-muted-foreground">
            Describe the kinds of events and experiences you want. The more specific, the better.
          </p>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <Textarea
              id="taste"
              value={tasteProfile}
              onChange={(e) => setTasteProfile(e.target.value)}
              placeholder="e.g. trance, psychedelic experiences, sober crowd, real dancing, intimate venues…"
              rows={4}
            />
          )}
        </div>
        <Button onClick={handleSave} disabled={saving || loading || !tasteProfile.trim()}>
          {saving ? "Saving…" : "Save & generate tags"}
        </Button>
      </div>
    </div>
  );
};

export default Profile;
