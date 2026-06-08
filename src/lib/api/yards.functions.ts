import { createServerFn } from "@tanstack/react-start";
import { getSupabaseAdmin } from "../supabase.server";

// Returns all yards. Used to verify the Supabase ↔ server round-trip
// works end-to-end (Phase 0 smoke test). Will be expanded in Phase 1.
export const getYards = createServerFn({ method: "GET" }).handler(async () => {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("yards")
    .select("id, name, address, is_default")
    .order("is_default", { ascending: false });

  if (error) throw new Error(`Failed to load yards: ${error.message}`);
  return data ?? [];
});
