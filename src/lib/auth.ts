import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Database } from "./database.types";
import type { Session, User } from "@supabase/supabase-js";

export type Role = "customer" | "driver" | "admin" | null;

interface AuthState {
  session: Session | null;
  user: User | null;
  role: Role;
  loading: boolean;
}

// Uses the session's own access_token rather than relying on the shared client's
// internal session, which may not be updated yet when onAuthStateChange fires.
async function fetchRole(userId: string, accessToken: string): Promise<Role> {
  const url = import.meta.env.VITE_SUPABASE_URL as string;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  const client = createClient<Database>(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data } = await client
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();
  return (data?.role as Role) ?? "customer";
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    session: null,
    user: null,
    role: null,
    loading: true,
  });

  useEffect(() => {
    // Hydrate from existing session on mount
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        const role = await fetchRole(session.user.id, session.access_token);
        setState({ session, user: session.user, role, loading: false });
      } else {
        setState({ session: null, user: null, role: null, loading: false });
      }
    });

    // Keep state in sync with Supabase auth events (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (session?.user) {
          const role = await fetchRole(session.user.id, session.access_token);
          setState({ session, user: session.user, role, loading: false });
        } else {
          setState({ session: null, user: null, role: null, loading: false });
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  return {
    session: state.session,
    user: state.user,
    role: state.role,
    loading: state.loading,
    email: state.user?.email ?? null,
    login: async (email: string, password: string) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    // Self-serve customer signup. The handle_new_user trigger creates a
    // 'customer' profile. Returns needsConfirmation=true when the project
    // requires email confirmation (no session yet); false when the user is
    // logged in immediately.
    signup: async (email: string, password: string) => {
      // emailRedirectTo is NOT optional, and omitting it was a live bug that
      // silently blocked real customers for weeks.
      //
      // Without it, Supabase points the "Confirm email address" link at the
      // PROJECT'S Site URL from the Auth dashboard — which was still
      // http://localhost:8080 from development. Every customer who signed up
      // got a confirmation email whose link opened "Safari can't open the page
      // because it couldn't connect to the server". Nothing errored on our
      // side: signup succeeded, the email sent, and the account simply sat
      // unconfirmed forever. resetPasswordForEmail in login.tsx already passed
      // a redirectTo, which is why password reset worked and signup didn't.
      //
      // Deriving it from window.location.origin rather than hard-coding
      // ccsta.net means local dev keeps working and a future domain change
      // can't reintroduce this.
      //
      // /login is the landing spot on purpose: the Supabase client consumes the
      // token from the URL hash on load, and login.tsx already redirects a
      // signed-in user on to the right place for their role.
      const emailRedirectTo =
        typeof window !== "undefined" ? `${window.location.origin}/login` : undefined;
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo },
      });
      if (error) throw error;
      return { needsConfirmation: !data.session };
    },
    logout: async () => {
      await supabase.auth.signOut();
    },
  };
}
