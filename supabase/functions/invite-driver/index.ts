import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verify caller is an admin using their JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: profile } = await callerClient
      .from("profiles")
      .select("role")
      .single();

    if (profile?.role !== "admin") {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse request body
    const { email, first_name, last_name } = await req.json();
    if (!email || !first_name || !last_name) {
      return new Response(JSON.stringify({ error: "email, first_name, and last_name are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use service role to invite the user and create their records
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: { first_name, last_name },
    });

    if (inviteError) {
      return new Response(JSON.stringify({ error: inviteError.message }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = invited.user.id;

    // Set their profile role to driver
    await adminClient
      .from("profiles")
      .upsert({ id: userId, email, role: "driver" });

    // Create their drivers record
    await adminClient
      .from("drivers")
      .insert({ profile_id: userId, first_name, last_name, email, trip_type: "field_trip" });

    return new Response(JSON.stringify({ success: true, user_id: userId }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
