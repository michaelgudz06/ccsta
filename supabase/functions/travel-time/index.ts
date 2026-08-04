// travel-time: how long it takes a driver to get from the yard to the pickup,
// and from the drop-off back to the yard, using the Google Routes API.
//
// This exists because driver time used to be a flat 1 hour for every trip, so
// a school three minutes from the yard was billed the same as one fifty
// minutes away. See migration 060 for the rules this feeds.
//
// Secrets (Supabase dashboard -> Edge Functions -> Secrets):
//   GOOGLE_ROUTES_API_KEY — REQUIRED. Must be a SEPARATE key from the one in
//     the frontend bundle. The frontend key is restricted by HTTP referrer,
//     which does nothing for a server-to-server call; this one is restricted
//     by API instead. Never put this key in .env — .env is bundled and
//     shipped to the browser.
//
// Without the secret the function returns minutes: null rather than failing.
// Callers treat null as "unknown" and fall back to the flat buffer, so a
// missing or revoked key makes quotes slightly less accurate instead of
// breaking the quote form.

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

/** Cache-key normalisation. Must stay in sync with nothing else — this is the
 *  only place addresses are normalised, deliberately. */
function normalise(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

const CACHE_MAX_AGE_DAYS = 90;

type Leg = { origin: string; destination: string; departAt: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.legs)) {
      return json({ error: "expected { legs: [{ origin, destination, departAt }] }" }, 400);
    }

    // Hard ceiling on legs per call. A quote needs two. Anything asking for
    // hundreds is a bug or an abuse attempt, and this API is metered.
    const legs: Leg[] = body.legs.slice(0, 4);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const apiKey = Deno.env.get("GOOGLE_ROUTES_API_KEY");
    const results: Array<{ minutes: number | null; distanceKm: number | null; source: string }> = [];

    for (const leg of legs) {
      if (!leg?.origin || !leg?.destination || !leg?.departAt) {
        results.push({ minutes: null, distanceKm: null, source: "incomplete" });
        continue;
      }

      const originKey = normalise(leg.origin);
      const destKey = normalise(leg.destination);

      // Same origin and destination — a yard-based school, or a pickup that
      // IS the yard. Zero, without spending a request to be told so.
      if (originKey === destKey) {
        results.push({ minutes: 0, distanceKm: 0, source: "identical" });
        continue;
      }

      const depart = new Date(leg.departAt);
      if (Number.isNaN(depart.getTime())) {
        results.push({ minutes: null, distanceKm: null, source: "bad-date" });
        continue;
      }
      const dow = depart.getUTCDay();
      const hour = depart.getUTCHours();

      // ── Cache first ────────────────────────────────────────────────────
      const { data: hit } = await admin
        .from("travel_time_cache")
        .select("minutes, distance_km, fetched_at")
        .eq("origin_key", originKey)
        .eq("dest_key", destKey)
        .eq("dow", dow)
        .eq("hour", hour)
        .maybeSingle();

      if (hit) {
        const ageDays = (Date.now() - new Date(hit.fetched_at).getTime()) / 86_400_000;
        if (ageDays < CACHE_MAX_AGE_DAYS) {
          results.push({
            minutes: Number(hit.minutes),
            distanceKm: hit.distance_km === null ? null : Number(hit.distance_km),
            source: "cache",
          });
          continue;
        }
        // Stale: fall through and refresh, but keep the old value in hand as a
        // fallback if the refresh fails.
      }

      if (!apiKey) {
        results.push({
          minutes: hit ? Number(hit.minutes) : null,
          distanceKm: hit?.distance_km == null ? null : Number(hit.distance_km),
          source: hit ? "stale-cache-no-key" : "no-key",
        });
        continue;
      }

      // ── Live lookup ────────────────────────────────────────────────────
      // Routes API accepts addresses directly, so no separate Geocoding call
      // (and no second SKU to pay for).
      //
      // TRAFFIC_AWARE, not TRAFFIC_AWARE_OPTIMAL: the optimal variant costs
      // more per request and its extra precision is meaningless here, since
      // the answer gets rounded up to a quarter hour anyway.
      //
      // departureTime must be in the future or Google rejects it. Trips are
      // booked ahead so normally it is, but re-pricing an old quote would
      // otherwise fail — hence the shift below to the same weekday and hour
      // in the next week, which preserves the traffic pattern that matters.
      let departureTime = depart;
      if (departureTime.getTime() <= Date.now() + 60_000) {
        const shifted = new Date(departureTime);
        while (shifted.getTime() <= Date.now() + 60_000) {
          shifted.setUTCDate(shifted.getUTCDate() + 7);
        }
        departureTime = shifted;
      }

      let minutes: number | null = null;
      let distanceKm: number | null = null;
      let source = "google";

      try {
        const resp = await fetch(
          "https://routes.googleapis.com/directions/v2:computeRoutes",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": apiKey,
              // Field mask is mandatory, and it's also what keeps us on the
              // cheaper SKU — asking for fewer fields bills less.
              "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
            },
            body: JSON.stringify({
              origin: { address: leg.origin },
              destination: { address: leg.destination },
              travelMode: "DRIVE",
              routingPreference: "TRAFFIC_AWARE",
              departureTime: departureTime.toISOString(),
              regionCode: "CA",
              units: "METRIC",
            }),
            signal: AbortSignal.timeout(8000),
          },
        );

        if (!resp.ok) {
          const text = await resp.text();
          console.error("routes api error", resp.status, text.slice(0, 500));
          source = `google-error-${resp.status}`;
        } else {
          const data = await resp.json();
          const route = data?.routes?.[0];
          if (route?.duration) {
            // duration comes back as a string like "1837s".
            const secs = Number(String(route.duration).replace(/s$/, ""));
            if (Number.isFinite(secs)) {
              minutes = Math.round((secs / 60) * 10) / 10;
              distanceKm = route.distanceMeters
                ? Math.round((route.distanceMeters / 1000) * 10) / 10
                : null;
            }
          } else {
            // No route found — usually an unrecognisable address.
            source = "no-route";
          }
        }
      } catch (e) {
        console.error("routes api fetch failed", String(e));
        source = "fetch-failed";
      }

      if (minutes !== null) {
        await admin.from("travel_time_cache").upsert(
          {
            origin_key: originKey,
            dest_key: destKey,
            dow,
            hour,
            minutes,
            distance_km: distanceKm,
            fetched_at: new Date().toISOString(),
          },
          { onConflict: "origin_key,dest_key,dow,hour" },
        );
        results.push({ minutes, distanceKm, source });
      } else if (hit) {
        // Refresh failed but we have a stale number. A slightly old travel
        // time beats no travel time, which would drop us to the flat buffer.
        results.push({
          minutes: Number(hit.minutes),
          distanceKm: hit.distance_km === null ? null : Number(hit.distance_km),
          source: `stale-cache-after-${source}`,
        });
      } else {
        results.push({ minutes: null, distanceKm: null, source });
      }
    }

    return json({ legs: results });
  } catch (e) {
    console.error("travel-time failed", String(e));
    return json({ error: String(e) }, 500);
  }
});
