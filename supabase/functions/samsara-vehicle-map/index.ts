// samsara-vehicle-map: read-only. Lists Samsara vehicles as id / name / gateway
// serial so buses.samsara_vehicle_id can be checked against reality.
//
// Written because a probe revealed our stored values were GATEWAY SERIALS
// (GV6C-E9T-U3W) while Samsara's vehicleId is numeric (281474988980545).
// Assigning a route by gateway serial fails. See migration 078.
//
// Re-run this if the fleet changes and buses need re-mapping.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const token = Deno.env.get("SAMSARA_API_TOKEN");
  if (!token) {
    return new Response(JSON.stringify({ error: "SAMSARA_API_TOKEN not set" }), {
      status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const out: Array<{ id: string; name: string; serial: string | null }> = [];
  let after: string | null = null;
  try {
    for (let page = 0; page < 5; page++) {
      const url = new URL("https://api.samsara.com/fleet/vehicles");
      url.searchParams.set("limit", "100");
      if (after) url.searchParams.set("after", after);
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) {
        return new Response(JSON.stringify({ error: `samsara ${r.status}`, detail: (await r.text()).slice(0, 300) }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const j = await r.json();
      for (const v of j.data ?? []) {
        out.push({ id: v.id, name: v.name, serial: v.gateway?.serial ?? null });
      }
      if (!j.pagination?.hasNextPage) break;
      after = j.pagination.endCursor;
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ count: out.length, vehicles: out }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
