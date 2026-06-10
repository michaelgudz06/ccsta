import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

// Browser-safe client. Uses the anon key — all access is governed by RLS.
// Import this in React components and client-side hooks.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  // Don't throw at module load — that crashes the whole route into the error
  // boundary ("This page didn't load") the instant any component imports this.
  // Log loudly instead; calls will fail with a clear network error.
  console.error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Set them in .env (committed, public values) or .env.local.",
  );
}

export const supabase = createClient<Database>(
  supabaseUrl ?? "",
  supabaseAnonKey ?? "",
);
