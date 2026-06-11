// notify-send: drains pending email rows from notification_log and delivers
// them via the Resend API (https://resend.com).
//
// Invoked fire-and-forget from the app right after any action that queues a
// notification (quote submitted, approved, accepted, cancellation request…).
// Requires a signed-in user's JWT (verify_jwt = true); the function itself
// only ever sends rows that the SQL workflow functions already queued.
//
// Secrets (Supabase dashboard → Edge Functions → notify-send → Secrets):
//   RESEND_API_KEY     — required to actually send; without it rows stay 'pending'
//   NOTIFY_FROM_EMAIL  — optional, e.g. "CCSTA Bookings <bookings@ccsta.ca>"
//                        (defaults to Resend's onboarding sender for testing)

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
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: rows, error } = await admin
      .from("notification_log")
      .select("id, recipient, subject, body")
      .eq("type", "email")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(20);

    if (error) return json({ error: error.message }, 500);
    if (!rows || rows.length === 0) return json({ sent: 0, queued: 0 });

    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) {
      // Not configured yet — leave everything queued for later.
      return json({ sent: 0, queued: rows.length, note: "RESEND_API_KEY not set" });
    }

    const from = Deno.env.get("NOTIFY_FROM_EMAIL") ?? "CCSTA Bookings <onboarding@resend.dev>";
    let sent = 0;
    let failed = 0;

    for (const row of rows) {
      // Claim the row first so concurrent invocations can't double-send.
      const { data: claimed } = await admin
        .from("notification_log")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("status", "pending")
        .select("id");
      if (!claimed || claimed.length === 0) continue; // someone else got it

      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [row.recipient],
          subject: row.subject ?? "CCSTA notification",
          text: row.body,
        }),
      });

      if (resp.ok) {
        sent++;
      } else {
        failed++;
        const errText = (await resp.text()).slice(0, 500);
        await admin
          .from("notification_log")
          .update({ status: "failed", error: errText, sent_at: null })
          .eq("id", row.id);
      }
    }

    return json({ sent, failed });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
