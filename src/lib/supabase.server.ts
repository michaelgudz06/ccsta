import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

// Server-only admin client. Uses the service role key — bypasses RLS.
// The .server.ts suffix causes Vite to tree-shake this file from the client bundle.
// Only import this inside createServerFn handlers or other .server.ts files.
export function getSupabaseAdmin() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in server environment.",
    );
  }

  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
