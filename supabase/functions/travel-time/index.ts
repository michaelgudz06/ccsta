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

/**
 * Interpret "YYYY-MM-DDTHH:MM" as BC wall-clock time and return the real instant.
 *
 * This exists because of a live pricing bug. The browser built its timestamp
 * with `new Date("...T09:00").toISOString()`, which resolves against the
 * BROWSER's timezone; this function then received a bare string and, running in
 * UTC, read the same 09:00 as 09:00Z — 02:00 in Vancouver. So the price the
 * customer saw was measured at rush hour and the price they were CHARGED was
 * measured on empty 2am roads. It also split the cache in two, paying Google
 * twice for every quote.
 *
 * The fix is that there is now exactly one conversion, here. Callers send naive
 * wall-clock strings and never do timezone maths themselves.
 *
 * Handles DST by asking the runtime what the offset actually was on that date,
 * rather than assuming -7 or -8.
 */
function bcInstant(naive: string): Date {
  const asIfUtc = new Date(`${naive}Z`);
  if (Number.isNaN(asIfUtc.getTime())) return asIfUtc;
  // What wall time does that instant read as in Vancouver? The gap is the offset.
  const shown = new Date(asIfUtc.toLocaleString("en-US", { timeZone: "America/Vancouver" }));
  return new Date(asIfUtc.getTime() + (asIfUtc.getTime() - shown.getTime()));
}

type Leg = { origin: string; destination: string; departAt: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body || (!Array.isArray(body.legs) && !body.quoteId)) {
      return json({ error: "expected { legs: [...] } or { quoteId }" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // ── Two modes, and the difference is a security boundary ───────────────
    //
    // PREVIEW  { legs: [...] }  — caller supplies addresses, we answer, nothing
    //                             is written. Used by the quote form so the
    //                             customer sees a price while typing.
    //
    // PERSIST  { quoteId }      — we read the addresses from the quote OURSELVES
    //                             and write the result to quote_versions.
    //
    // The split matters because leg minutes change what the customer is
    // charged. If the client could post its own minutes and have them saved,
    // anyone could send zeros and knock a couple of hours off their bill —
    // roughly $160 on a 47-bench trip. So the numbers that get stored are only
    // ever derived from data already in the database.
    let legs: Leg[];
    let persistQuoteId: string | null = null;

    if (body.quoteId) {
      const { data: q } = await admin
        .from("quotes")
        .select("id, status, current_version_id")
        .eq("id", body.quoteId)
        .maybeSingle();
      if (!q) return json({ error: "quote not found" }, 404);

      // Only price a quote that's still being quoted. Without this, anyone
      // could re-run the lookup against an APPROVED quote and move a number the
      // customer already agreed to.
      if (!["requested", "in_review"].includes(q.status)) {
        return json({ error: `quote status is ${q.status}; not repricing`, legs: [] }, 409);
      }

      const { data: v } = await admin
        .from("quote_versions")
        .select("id, pickup_address, destination_address, trip_date, departure_time, return_time, trip_type")
        .eq("id", q.current_version_id)
        .maybeSingle();
      if (!v?.pickup_address || !v.trip_date) {
        return json({ error: "quote has no pickup address or date", legs: [] }, 422);
      }

      const { data: yard } = await admin
        .from("yards").select("address").eq("is_default", true).maybeSingle();
      if (!yard?.address) return json({ error: "no default yard", legs: [] }, 500);

      // On a two-way trip the bus returns the group to the pickup point, so the
      // last leg is pickup→yard. Only a one-way trip ends at the destination.
      const returnOrigin = v.trip_type === "one_way"
        ? (v.destination_address || v.pickup_address)
        : v.pickup_address;

      // Naive wall-clock strings; bcInstant does the one conversion below.
      const depart = `${v.trip_date}T${(v.departure_time ?? "08:00").slice(0, 5)}`;
      const back   = `${v.trip_date}T${(v.return_time ?? v.departure_time ?? "15:00").slice(0, 5)}`;

      legs = [
        { origin: yard.address, destination: v.pickup_address, departAt: depart },
        { origin: returnOrigin, destination: yard.address, departAt: back },
      ];
      persistQuoteId = v.id;
    } else {
      // Hard ceiling on legs per call. A quote needs two. Anything asking for
      // hundreds is a bug or an abuse attempt, and this API is metered.
      legs = body.legs.slice(0, 4);
    }

    const apiKey = Deno.env.get("GOOGLE_ROUTES_API_KEY");
    const results: Array<{ minutes: number | null; distanceKm: number | null; source: string }> = [];

    // Daily ceiling on live lookups (migration 062). Google's own per-day quota
    // cap would be the better place for this, but it's disabled on free trial
    // accounts, so this stands in until the billing account is activated.
    //
    // Read once per request, not per leg: the count can't change underneath us
    // in a way that matters, and it saves a query on the common two-leg call.
    // Cache reads are unaffected by the cap -- they cost nothing.
    let budgetLeft = Number.POSITIVE_INFINITY;
    try {
      const [capRes, usedRes] = await Promise.all([
        admin.from("app_config").select("value").eq("key", "travel_time_daily_cap").maybeSingle(),
        admin.rpc("travel_time_calls_today"),
      ]);
      const cap = Number(capRes.data?.value);
      const used = Number(usedRes.data);
      if (Number.isFinite(cap)) budgetLeft = Math.max(0, cap - (Number.isFinite(used) ? used : 0));
    } catch (e) {
      // Fail OPEN, not closed. If the budget check itself breaks we still serve
      // quotes; the alternative is a config hiccup silently degrading every
      // estimate to the flat buffer, which is harder to notice than a bill.
      console.error("budget check failed, proceeding uncapped", String(e));
    }

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

      // Single conversion point. Callers pass BC wall-clock time.
      const depart = bcInstant(leg.departAt);
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

      if (!apiKey || budgetLeft <= 0) {
        const reason = !apiKey ? "no-key" : "daily-cap";
        if (budgetLeft <= 0) {
          console.warn(`travel-time daily cap reached; serving ${hit ? "stale cache" : "null"}`);
        }
        results.push({
          minutes: hit ? Number(hit.minutes) : null,
          distanceKm: hit?.distance_km == null ? null : Number(hit.distance_km),
          source: hit ? `stale-cache-${reason}` : reason,
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
        budgetLeft -= 1;
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

    // Persist mode: write what we derived. Note we write even when a leg came
    // back null — that's honest ("we don't know"), and calculate_estimate
    // treats null as "fall back to the flat buffer" rather than as zero travel.
    if (persistQuoteId) {
      const { error: upErr } = await admin
        .from("quote_versions")
        .update({
          leg_out_minutes: results[0]?.minutes ?? null,
          leg_back_minutes: results[1]?.minutes ?? null,
        })
        .eq("id", persistQuoteId);
      if (upErr) {
        console.error("failed to persist legs", upErr.message);
        return json({ legs: results, persisted: false, error: upErr.message }, 500);
      }
      return json({ legs: results, persisted: true });
    }

    return json({ legs: results });
  } catch (e) {
    console.error("travel-time failed", String(e));
    return json({ error: String(e) }, 500);
  }
});
