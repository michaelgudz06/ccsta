import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

// Browser-safe client. Uses the anon key — all access is governed by RLS.
// Import this in React components and client-side hooks.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Add them to .env.local.",
  );
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);
