// push-trip-to-samsara: put the trip sheet where drivers already look.
//
// Mila: "a lot of them are old and I fear they won't use the scheduling / trip
// info". Drivers already sign into Samsara daily. So the trip sheet goes into
// the Samsara Driver App as an assigned route, rather than into a CCSTA app
// they'd have to remember exists.
//
// Assigned to the VEHICLE, not the driver: all 28 buses have a Samsara vehicle
// id, zero drivers have a Samsara driver id. Samsara shows a vehicle's route to
// whoever signs into it, which drivers already do every morning.
//
// Secret: SAMSARA_API_TOKEN (Supabase -> Edge Functions -> Secrets). Needs
// "Write Routes", which lives under **Driver Workflow** in Samsara's scope
// picker — there is no top-level Routes or Dispatch category, which is why it's
// hard to find.
//
// Modes:
//   { probe: true }      read-only token check, writes nothing
//   { tripId }           create or update that trip's route
//   { tripId, remove }   delete it

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

const SAMSARA = "https://api.samsara.com";

/**
 * BC wall-clock -> real instant. Same reasoning as travel-time's bcInstant: a
 * bare "2026-09-15T09:00" read as UTC is 2am in Vancouver. A route scheduled
 * seven hours early is worse than no route at all.
 */
function bcInstant(naive: string): Date {
  const asIfUtc = new Date(`${naive}Z`);
  if (Number.isNaN(asIfUtc.getTime())) return asIfUtc;
  const shown = new Date(asIfUtc.toLocaleString("en-US", { timeZone: "America/Vancouver" }));
  return new Date(asIfUtc.getTime() + (asIfUtc.getTime() - shown.getTime()));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const token = Deno.env.get("SAMSARA_API_TOKEN");
    if (!token) return json({ error: "SAMSARA_API_TOKEN not set" }, 503);

    const body = await req.json().catch(() => ({}));

    // Probe: prove the token works before writing anything to a live fleet.
    if (body.probe) {
      const r = await fetch(`${SAMSARA}/fleet/vehicles?limit=1`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      });
      const text = await r.text();
      return json({
        ok: r.ok,
        status: r.status,
        note: r.ok ? "token valid for reads" : "token rejected",
        sample: text.slice(0, 300),
      }, r.ok ? 200 : 502);
    }

    if (!body.tripId) return json({ error: "expected { tripId } or { probe: true }" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: trip } = await admin
      .from("trips")
      .select("id, trip_number, trip_date, departure_time, return_time, pickup_address, destination_name, destination_address, student_count, contact_day_of, special_requests, status, bus_id, samsara_route_id")
      .eq("id", body.tripId)
      .maybeSingle();
    if (!trip) return json({ error: "trip not found" }, 404);

    // Remove. A cancelled trip MUST lose its route, or a driver turns up for a
    // trip that isn't happening — worse than never having pushed at all.
    if (body.remove || trip.status === "cancelled") {
      if (!trip.samsara_route_id) return json({ status: "nothing_to_remove" });
      const del = await fetch(`${SAMSARA}/fleet/routes/${trip.samsara_route_id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      });
      // 404 counts as success: it's already gone, which is the desired state.
      if (!del.ok && del.status !== 404) {
        const t = await del.text();
        await admin.from("trips")
          .update({ samsara_error: `delete ${del.status}: ${t.slice(0, 300)}` })
          .eq("id", trip.id);
        return json({ status: "delete_failed", httpStatus: del.status, detail: t.slice(0, 500) }, 502);
      }
      await admin.from("trips")
        .update({ samsara_route_id: null, samsara_error: null })
        .eq("id", trip.id);
      return json({ status: "removed" });
    }

    const { data: bus } = await admin
      .from("buses").select("fleet_number, samsara_vehicle_id").eq("id", trip.bus_id).maybeSingle();
    if (!bus?.samsara_vehicle_id) {
      return json({ error: "bus has no samsara_vehicle_id; cannot assign" }, 422);
    }

    const depart = bcInstant(`${trip.trip_date}T${(trip.departure_time ?? "08:00").slice(0, 5)}`).toISOString();
    const back = bcInstant(`${trip.trip_date}T${(trip.return_time ?? "15:00").slice(0, 5)}`).toISOString();

    // The trip sheet. Newlines render in the driver app, so this is the whole
    // sheet in one readable block rather than fields scattered across stops.
    const contact = (trip.contact_day_of ?? {}) as { name?: string; phone?: string };
    const sheet = [
      `Trip ${trip.trip_number ?? ""}`.trim(),
      trip.student_count ? `${trip.student_count} students` : null,
      contact.name || contact.phone
        ? `Day-of contact: ${[contact.name, contact.phone].filter(Boolean).join(" · ")}`
        : null,
      trip.special_requests ? `Notes: ${trip.special_requests}` : null,
    ].filter(Boolean).join("\n");

    // Two stops minimum, per Samsara. With the default start/completion
    // conditions the FIRST stop needs a departure time and the LAST needs an
    // arrival time.
    const payload = {
      name: `${trip.trip_number ?? "Trip"} — ${trip.destination_name ?? "Field trip"}`,
      vehicleId: String(bus.samsara_vehicle_id),
      notes: sheet,
      // Lets a re-push find the same route instead of creating a second one.
      externalIds: { ccsta_trip: String(trip.id) },
      stops: [
        {
          name: "Pickup",
          singleUseLocation: { address: trip.pickup_address ?? "", name: "Pickup" },
          scheduledDepartureTime: depart,
          notes: sheet,
        },
        {
          name: trip.destination_name ?? "Destination",
          singleUseLocation: {
            address: trip.destination_address ?? trip.pickup_address ?? "",
            name: trip.destination_name ?? "Destination",
          },
          scheduledArrivalTime: back,
        },
      ],
    };

    const isUpdate = !!trip.samsara_route_id;
    const res = await fetch(
      isUpdate ? `${SAMSARA}/fleet/routes/${trip.samsara_route_id}` : `${SAMSARA}/fleet/routes`,
      {
        method: isUpdate ? "PATCH" : "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      },
    );

    const text = await res.text();
    if (!res.ok) {
      // Record it. A trip the driver never received must not look identical to
      // one that arrived fine.
      await admin.from("trips")
        .update({ samsara_error: `${res.status}: ${text.slice(0, 400)}` })
        .eq("id", trip.id);
      return json({ status: "push_failed", httpStatus: res.status, detail: text.slice(0, 800) }, 502);
    }

    let routeId: string | null = trip.samsara_route_id ?? null;
    try { routeId = JSON.parse(text)?.data?.id ?? routeId; } catch { /* keep existing */ }

    await admin.from("trips").update({
      samsara_route_id: routeId,
      samsara_pushed_at: new Date().toISOString(),
      samsara_error: null,
    }).eq("id", trip.id);

    return json({ status: isUpdate ? "updated" : "created", routeId });
  } catch (err) {
    console.error("push-trip-to-samsara failed", String(err));
    return json({ error: String(err) }, 500);
  }
});
