import { useCallback, useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

const AUTH_ERROR_MESSAGE = "Account sign-in is temporarily unavailable. You can continue as a guest or try again.";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let unsubscribe = () => undefined;

    try {
      const { data } = supabase.auth.onAuthStateChange((_event, next) => {
        if (!active) return;
        setSession(next);
        setError(null);
        setLoading(false);
      });
      unsubscribe = () => data.subscription.unsubscribe();

      void supabase.auth
        .getSession()
        .then(({ data: sessionData, error: sessionError }) => {
          if (!active) return;
          if (sessionError) throw sessionError;
          setSession(sessionData.session);
          setError(null);
          setLoading(false);
        })
        .catch((sessionError: unknown) => {
          if (!active) return;
          console.error("[Auth] Could not resolve the current session", sessionError);
          setSession(null);
          setError(AUTH_ERROR_MESSAGE);
          setLoading(false);
        });
    } catch (authError) {
      console.error("[Auth] Could not initialize auth", authError);
      setSession(null);
      setError(AUTH_ERROR_MESSAGE);
      setLoading(false);
    }

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    // Clear local state first so the header updates even if the network is unavailable.
    setSession(null);
    setError(null);
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      setError(AUTH_ERROR_MESSAGE);
      throw signOutError;
    }
  }, []);

  return { session, user: (session?.user ?? null) as User | null, loading, error, signOut };
}

export function useIsStaff(user: User | null) {
  const [isStaff, setIsStaff] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    if (!user) {
      setIsStaff(null);
      return;
    }
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .then(({ data }) => {
        if (!active) return;
        setIsStaff((data ?? []).some((r) => r.role === "admin" || r.role === "staff"));
      });
    return () => {
      active = false;
    };
  }, [user]);

  return isStaff;
}
