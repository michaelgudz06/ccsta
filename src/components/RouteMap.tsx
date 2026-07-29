import { useEffect, useRef, useState } from "react";

// Free, no-API-key route map: OpenStreetMap tiles (Leaflet, loaded from CDN at
// runtime so nothing touches the SSR bundle), Nominatim for geocoding, and
// OSRM for the driving route + free-flow duration. Live traffic needs a paid
// Google/Mapbox key (pending) — until then we show a clearly-labeled rush-hour
// buffer on top of the free-flow time.

export type RouteResult = {
  distanceKm: number;
  freeFlowMin: number;
  bufferedMin: number;
  isRush: boolean;
  bufferPct: number;
};

type Props = {
  pickup: string;
  destination: string;
  /** "HH:MM" departure time — used to decide the rush-hour buffer. */
  departTime?: string;
  /** Called once a route is computed, so the parent can show distance/surcharge text. */
  onResult?: (r: RouteResult) => void;
  className?: string;
};

const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";

// School-run congestion windows (local time): morning + afternoon pickups.
export function rushBuffer(departTime?: string): { pct: number; isRush: boolean } {
  if (!departTime) return { pct: 0.12, isRush: false };
  const [h] = departTime.split(":").map(Number);
  const isRush = (h >= 7 && h < 9) || (h >= 14 && h < 18);
  return { pct: isRush ? 0.2 : 0.12, isRush };
}

export function loadLeaflet(): Promise<typeof import("leaflet")> {
  return new Promise((resolve, reject) => {
    const w = window as unknown as { L?: typeof import("leaflet") };
    if (w.L) { resolve(w.L); return; }
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = LEAFLET_CSS;
      document.head.appendChild(link);
    }
    const existing = document.querySelector(`script[src="${LEAFLET_JS}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(w.L!));
      existing.addEventListener("error", reject);
      return;
    }
    const script = document.createElement("script");
    script.src = LEAFLET_JS;
    script.async = true;
    script.onload = () => resolve(w.L!);
    script.onerror = reject;
    document.body.appendChild(script);
  });
}

/**
 * Progressively simpler forms of an address to try against Nominatim.
 *
 * Nominatim returns an empty array — not an error — for addresses it can't
 * parse, and unit designators are a reliable way to trip it up. A real
 * example from production: "2755 Lougheed Hwy #9, Port Coquitlam, BC V3B 5Y9"
 * returns zero results, while the identical address without "#9" resolves
 * first try. Customers type unit numbers all the time, so retry rather than
 * silently losing the distance (and with it the long-distance surcharge).
 */
export function addressVariants(q: string): string[] {
  const raw = q.trim();
  const out = [raw];
  // Drop "#9", "Unit 5", "Suite 200", "Apt 3B" and friends.
  const noUnit = raw
    .replace(/\s*#\s*[\w-]+/gi, "")
    .replace(/\s*\b(unit|suite|ste|apt|apartment)\b\.?\s*[\w-]+/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+,/g, ",")
    .trim();
  if (noUnit && noUnit !== raw) out.push(noUnit);
  // Drop a trailing Canadian postal code — occasionally the only bad token.
  const noPostal = noUnit.replace(/,?\s*[A-Za-z]\d[A-Za-z]\s*\d[A-Za-z]\d\s*$/, "").trim();
  if (noPostal && !out.includes(noPostal)) out.push(noPostal);
  return out;
}

/**
 * fetch with a hard timeout (BUG_BACKLOG #14).
 *
 * Nominatim and the public OSRM demo server are free services with no SLA. A
 * request that hangs rather than fails leaves the route chain waiting forever,
 * so distance_km stays null and the long-distance charge silently disappears —
 * the same end result as a failed geocode, but with no error to react to.
 */
export async function fetchWithTimeout(url: string, ms = 8000, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function geocode(q: string): Promise<[number, number] | null> {
  if (!q.trim()) return null;
  // Bias toward British Columbia, Canada for school-trip addresses.
  for (const variant of addressVariants(q)) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ca&q=${encodeURIComponent(variant)}`;
    const res = await fetchWithTimeout(url, 8000, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ lat: string; lon: string }>;
    if (data.length) return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
    // Only reached when a variant found nothing; Nominatim asks for <=1
    // request per second, so pause before trying a simpler form.
    await new Promise((r) => setTimeout(r, 1100));
  }
  return null;
}

export function RouteMap({ pickup, destination, departTime, onResult, className }: Props) {
  const mapEl = useRef<HTMLDivElement>(null);
  // onResult is passed as an inline arrow from the quote form, so its identity
  // changes on EVERY render. Having it in the effect's dependency array meant
  // the effect restarted on every keystroke anywhere in the form, cancelling
  // the in-flight geocode before it could report back — which is why quotes
  // were being submitted with distance_km null regardless of address quality.
  // Holding it in a ref keeps the latest callback without re-triggering.
  const onResultRef = useRef(onResult);
  useEffect(() => { onResultRef.current = onResult; });
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<RouteResult | null>(null);

  useEffect(() => {
    if (!pickup.trim() || !destination.trim()) { setStatus("idle"); return; }
    let cancelled = false;
    let map: import("leaflet").Map | null = null;

    (async () => {
      setStatus("loading");
      setErrorMsg(null);
      try {
        const L = await loadLeaflet();
        // Nominatim asks for <=1 req/sec — space the two geocodes rather than
        // just sequencing them, which is what the old comment claimed but
        // didn't actually do.
        const from = await geocode(pickup);
        await new Promise((r) => setTimeout(r, 1100));
        const to = await geocode(destination);
        if (cancelled) return;
        if (!from || !to) {
          // Was silent, with the customer told their estimate was still
          // accurate. It isn't necessarily: with no coordinates there's no
          // distance, so any long-distance surcharge is quietly omitted.
          // Say so plainly instead (BUG_BACKLOG #6).
          setErrorMsg(
            "We couldn't locate one of these addresses on the map, so this estimate may not include a long-distance charge. Your request will still go through and we'll confirm the final price.",
          );
          setStatus("error");
          return;
        }

        // OSRM driving route (free-flow, no live traffic).
        const osrm = `https://router.project-osrm.org/route/v1/driving/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson`;
        const rRes = await fetchWithTimeout(osrm);
        const rData = (await rRes.json()) as {
          routes?: Array<{ distance: number; duration: number; geometry: { coordinates: [number, number][] } }>;
        };
        if (cancelled) return;
        const route = rData.routes?.[0];
        if (!route) {
          setErrorMsg("No driving route found between those points. Your request will still go through — we'll confirm the final price after reviewing it.");
          setStatus("error");
          return;
        }

        const distanceKm = route.distance / 1000;
        const freeFlowMin = route.duration / 60;
        const { pct, isRush } = rushBuffer(departTime);
        const bufferedMin = freeFlowMin * (1 + pct);
        const res: RouteResult = {
          distanceKm: Math.round(distanceKm * 10) / 10,
          freeFlowMin: Math.round(freeFlowMin),
          bufferedMin: Math.round(bufferedMin),
          isRush,
          bufferPct: Math.round(pct * 100),
        };
        setResult(res);
        onResultRef.current?.(res);

        if (!mapEl.current) return;
        // Tear down any previous instance (re-render with new addresses).
        const container = mapEl.current as HTMLDivElement & { _leaflet_id?: number };
        if (container._leaflet_id) { container._leaflet_id = undefined; container.innerHTML = ""; }

        map = L.map(mapEl.current, { scrollWheelZoom: false, attributionControl: true });
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 18,
          attribution: "&copy; OpenStreetMap contributors",
        }).addTo(map);

        const line = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]) as [number, number][];
        const poly = L.polyline(line, { color: "#2563eb", weight: 5, opacity: 0.85 }).addTo(map);
        L.marker(from).addTo(map).bindPopup("Pickup");
        L.marker(to).addTo(map).bindPopup("Destination");
        map.fitBounds(poly.getBounds(), { padding: [30, 30] });
        setStatus("ready");
      } catch (e) {
        if (cancelled) return;
        setErrorMsg("Map service is temporarily unavailable. Your request will still go through — we'll confirm the final price after reviewing it.");
        setStatus("error");
        console.error("RouteMap error:", e);
      }
    })();

    return () => {
      cancelled = true;
      if (map) map.remove();
    };
  }, [pickup, destination, departTime]);

  if (status === "idle") {
    return (
      <div className={`rounded-2xl border border-dashed border-border bg-card p-5 text-sm text-muted-foreground ${className ?? ""}`}>
        Enter a pickup and destination address to see the route, distance, and drive time.
      </div>
    );
  }

  // Address not geocodable — no map to show, but be honest that this means
  // we don't yet know the exact distance rather than falsely reassuring
  // the customer their estimate already accounts for it.
  if (status === "error" && !errorMsg) {
    return (
      <div className={`rounded-2xl border border-dashed border-border bg-card p-5 text-sm text-muted-foreground ${className ?? ""}`}>
        Route preview not available for this address. Your request will still go through — we'll confirm the final price after reviewing it.
      </div>
    );
  }

  return (
    <div className={`overflow-hidden rounded-2xl border border-border bg-card ${className ?? ""}`}>
      <div ref={mapEl} className="h-56 w-full bg-surface" aria-label="Route map" />
      <div className="border-t border-border px-4 py-3 text-sm">
        {status === "loading" && <span className="text-muted-foreground">Calculating route…</span>}
        {status === "error" && errorMsg && <span className="text-muted-foreground text-xs">{errorMsg}</span>}
        {status === "ready" && result && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
            <span><span className="font-semibold text-foreground">{result.distanceKm} km</span> <span className="text-muted-foreground">one way</span></span>
            <span><span className="font-semibold text-foreground">~{result.bufferedMin} min</span> <span className="text-muted-foreground">drive</span></span>
            <span className="text-xs text-muted-foreground">
              {result.freeFlowMin} min free-flow + {result.bufferPct}% {result.isRush ? "school-run traffic" : "typical traffic"} buffer
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
