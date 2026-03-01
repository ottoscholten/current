import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Track whether we've resolved the initial auth state.
    // Whichever fires first (onAuthStateChange INITIAL_SESSION or getSession)
    // sets isLoading=false. The other one just updates session silently.
    let initialized = false;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!initialized) {
        setSession(session);
        setIsLoading(false);
        initialized = true;
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      setSession(session);
      if (!initialized) {
        setIsLoading(false);
        initialized = true;
      }

      // Create profile row on first login if one doesn't exist yet
      if (event === "SIGNED_IN" && session?.user) {
        const { data: rows } = await supabase
          .from("profiles")
          .select("id")
          .eq("id", session.user.id)
          .limit(1);

        if (!rows || rows.length === 0) {
          await supabase
            .from("profiles")
            .insert({ id: session.user.id, taste_profile: "" });
        }
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, isLoading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
