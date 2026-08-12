// invite-admin: send someone an admin invitation.
//
// Mirrors invite-driver rather than sharing code with it. They look similar but
// diverge where it matters: a driver invite also creates a `drivers` row and
// sets trip_type, an admin invite must NOT. Folding them into one function with
// a role switch would put the most privileged operation in this system behind a
// parameter, which is exactly the kind of thing that gets passed wrong once.
//
// SECURITY: only an existing admin can call this. That check is the whole
// perimeter — an admin account can see every quote, every customer contact, and
// change what anyone is charged.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "unauthorized" }, 401);

    // Caller's own JWT, so RLS applies and we read THEIR profile, not one they
    // nominated.
    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    // Scope to the CALLER'S OWN row. `.single()` alone was a bug that only bit
    // admins: profiles_admin_read lets an admin read EVERY profile, so .single()
    // saw 13 rows, errored, and the function concluded they weren't an admin.
    // A non-admin passed the query (RLS limits them to their own row) and was
    // then correctly rejected -- so it failed for exactly the people it was for.
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) return json({ error: "unauthorized" }, 401);
    const { data: profile } = await callerClient
      .from("profiles").select("role").eq("id", caller.id).maybeSingle();
    if (profile?.role !== "admin") return json({ error: "unauthorized" }, 403);

    const { email, first_name, last_name } = await req.json();
    if (!email) return json({ error: "email is required" }, 400);

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Someone may already have an account as a CUSTOMER — Curtis did, from
    // quoting a trip with his personal address. Inviting them again fails, so
    // promote the existing account instead of dead-ending.
    const { data: existing } = await adminClient
      .from("profiles").select("id, role").eq("email", email).maybeSingle();

    if (existing) {
      if (existing.role === "admin") {
        return json({ status: "already_admin", user_id: existing.id });
      }
      const { error } = await adminClient
        .from("profiles").update({ role: "admin" }).eq("id", existing.id);
      if (error) return json({ error: error.message }, 400);
      return json({ status: "promoted_existing", user_id: existing.id });
    }

    // Send them to the set-password page, NOT the homepage.
    //
    // Without redirectTo, Supabase bounces the invite to the project's Site URL
    // — so an invited admin lands on the marketing homepage, signed in, with no
    // password set and nothing telling them what to do. They'd be locked out
    // the moment that session expired, and would have no idea why.
    //
    // Site URL is read from the same place the notification emails use, so the
    // two can't drift apart.
    let siteUrl = "https://ccsta.net";
    try {
      const { data: configured } = await adminClient.rpc("_site_url");
      if (typeof configured === "string" && configured.startsWith("http")) siteUrl = configured;
    } catch { /* fall back to the constant above */ }

    const { data: invited, error: inviteError } = await adminClient.auth.admin
      .inviteUserByEmail(email, {
        data: { first_name, last_name },
        redirectTo: `${siteUrl}/reset-password`,
      });
    if (inviteError) return json({ error: inviteError.message }, 400);

    const userId = invited.user.id;
    const { error: roleErr } = await adminClient
      .from("profiles").upsert({ id: userId, email, role: "admin" });
    if (roleErr) {
      // The auth user exists but has no admin role — say so plainly rather than
      // reporting success. They'd be able to sign in as a customer and nobody
      // would know why their dashboard was empty.
      return json({ status: "invited_but_role_failed", user_id: userId, error: roleErr.message }, 500);
    }

    return json({ status: "invited", user_id: userId });
  } catch (err) {
    console.error("invite-admin failed", String(err));
    return json({ error: String(err) }, 500);
  }
});
