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
function rushBuffer(departTime?: string): { pct: number; isRush: boolean } {
  if (!departTime) return { pct: 0.12, isRush: false };
  const [h] = departTime.split(":").map(Number);
  const isRush = (h >= 7 && h < 9) || (h >= 14 && h < 18);
  return { pct: isRush ? 0.2 : 0.12, isRush };
}

function loadLeaflet(): Promise<typeof import("leaflet")> {
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

async function geocode(q: string): Promise<[number, number] | null> {
  if (!q.trim()) return null;
  // Bias toward British Columbia, Canada for school-trip addresses.
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ca&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const data = (await res.json()) as Array<{ lat: string; lon: string }>;
  if (!data.length) return null;
  return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
}

export function RouteMap({ pickup, destination, departTime, onResult, className }: Props) {
  const mapEl = useRef<HTMLDivElement>(null);
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
        // Nominatim asks for <=1 req/sec — sequence the two geocodes.
        const from = await geocode(pickup);
        const to = await geocode(destination);
        if (cancelled) return;
        if (!from || !to) {
          setErrorMsg(null); // silent — map just won't show, estimate still works
          setStatus("error");
          return;
        }

        // OSRM driving route (free-flow, no live traffic).
        const osrm = `https://router.project-osrm.org/route/v1/driving/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson`;
        const rRes = await fetch(osrm);
        const rData = (await rRes.json()) as {
          routes?: Array<{ distance: number; duration: number; geometry: { coordinates: [number, number][] } }>;
        };
        if (cancelled) return;
        const route = rData.routes?.[0];
        if (!route) { setErrorMsg("No driving route found between those points."); setStatus("error"); return; }

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
        onResult?.(res);

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
        setErrorMsg("Map service is temporarily unavailable.");
        setStatus("error");
        console.error("RouteMap error:", e);
      }
    })();

    return () => {
      cancelled = true;
      if (map) map.remove();
    };
  }, [pickup, destination, departTime, onResult]);

  if (status === "idle") {
    return (
      <div className={`rounded-2xl border border-dashed border-border bg-card p-5 text-sm text-muted-foreground ${className ?? ""}`}>
        Enter a pickup and destination address to see the route, distance, and drive time.
      </div>
    );
  }

  // Silent error (e.g. address not geocodable) — show nothing rather than alarming the user.
  if (status === "error" && !errorMsg) {
    return (
      <div className={`rounded-2xl border border-dashed border-border bg-card p-5 text-sm text-muted-foreground ${className ?? ""}`}>
        Route preview not available for this address — your estimate is still accurate.
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
