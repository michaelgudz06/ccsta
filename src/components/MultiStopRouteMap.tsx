import { useEffect, useRef, useState } from "react";
import { type RouteResult, geocode, loadLeaflet, rushBuffer } from "@/components/RouteMap";

// Multi-destination route: pickup -> stop 1 -> stop 2 -> ... -> return leg,
// geocoded in order and routed as ONE OSRM multi-waypoint request (OSRM
// natively sums distance across every leg — no manual summing needed here).
// Geocoding stays sequential (Nominatim asks for <=1 req/sec) with a small
// same-address cache so an unedited "return to pickup" leg doesn't trigger
// a second lookup. If any address fails to geocode, the whole route can't
// be computed (OSRM needs coordinates for every waypoint) — that's
// surfaced as a warning, not a blocker: submission still proceeds, and
// Melody gets a flagged list of which addresses need a manual look.

export type GeocodePoint = { address: string; lat: number | null; lng: number | null };

type Stage =
  | { status: "idle" }
  | { status: "geocoding"; index: number; total: number }
  | { status: "routing" }
  | { status: "ready"; result: RouteResult }
  | { status: "partial"; unresolved: string[] }
  | { status: "error"; message: string };

type Props = {
  /** Ordered addresses, index 0 = pickup. */
  addresses: string[];
  /** "HH:MM" departure time — used to decide the rush-hour buffer. */
  departTime?: string;
  /** Called once the full route is computed; null if it couldn't be (any unresolved address). */
  onResult?: (r: RouteResult | null) => void;
  /** Called as each address resolves (or fails to) — one entry per address, in order, growing as geocoding proceeds. */
  onGeocodeUpdate?: (points: GeocodePoint[]) => void;
  className?: string;
};

export function MultiStopRouteMap({ addresses, departTime, onResult, onGeocodeUpdate, className }: Props) {
  const mapEl = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Stage>({ status: "idle" });
  // Same fix as RouteMap: both callbacks arrive as inline arrows from the
  // quote form, so keeping them in the dependency array restarted this effect
  // on every render and cancelled the in-flight geocoding before it could
  // report a distance. Refs keep the latest callback without re-triggering.
  const onResultRef = useRef(onResult);
  const onGeocodeUpdateRef = useRef(onGeocodeUpdate);
  useEffect(() => {
    onResultRef.current = onResult;
    onGeocodeUpdateRef.current = onGeocodeUpdate;
  });

  useEffect(() => {
    const trimmed = addresses.map((a) => a.trim());
    if (trimmed.length < 2 || trimmed.some((a) => !a)) {
      setStage({ status: "idle" });
      return;
    }
    let cancelled = false;
    let map: import("leaflet").Map | null = null;

    (async () => {
      setStage({ status: "geocoding", index: 0, total: trimmed.length });
      const cache = new Map<string, [number, number] | null>();
      const points: GeocodePoint[] = [];

      for (let i = 0; i < trimmed.length; i++) {
        if (cancelled) return;
        setStage({ status: "geocoding", index: i, total: trimmed.length });
        const key = trimmed[i].toLowerCase();
        let coords = cache.get(key);
        if (coords === undefined) {
          coords = await geocode(trimmed[i]);
          cache.set(key, coords);
        }
        points.push({ address: trimmed[i], lat: coords?.[0] ?? null, lng: coords?.[1] ?? null });
        onGeocodeUpdateRef.current?.([...points]);
      }
      if (cancelled) return;

      const unresolved = points.filter((p) => p.lat == null);
      if (unresolved.length > 0) {
        setStage({ status: "partial", unresolved: unresolved.map((p) => p.address) });
        onResultRef.current?.(null);
        return;
      }

      setStage({ status: "routing" });
      const L = await loadLeaflet();

      // Single multi-waypoint OSRM request, in the customer's given order
      // (deliberately NOT the "Trip" TSP-solving endpoint — we don't want
      // stops reordered). OSRM returns the TOTAL distance across every leg.
      const coordStr = points.map((p) => `${p.lng},${p.lat}`).join(";");
      const osrm = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson`;
      const rRes = await fetch(osrm);
      const rData = (await rRes.json()) as {
        routes?: Array<{ distance: number; duration: number; geometry: { coordinates: [number, number][] } }>;
      };
      if (cancelled) return;
      const route = rData.routes?.[0];
      if (!route) {
        setStage({ status: "error", message: "No driving route found through those stops." });
        onResultRef.current?.(null);
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
      onResultRef.current?.(res);

      if (!mapEl.current) { setStage({ status: "ready", result: res }); return; }
      const container = mapEl.current as HTMLDivElement & { _leaflet_id?: number };
      if (container._leaflet_id) { container._leaflet_id = undefined; container.innerHTML = ""; }

      map = L.map(mapEl.current, { scrollWheelZoom: false, attributionControl: true });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map);

      const line = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]) as [number, number][];
      const poly = L.polyline(line, { color: "#2563eb", weight: 5, opacity: 0.85 }).addTo(map);
      points.forEach((p, i) => {
        const label = i === 0 ? "Pickup" : i === points.length - 1 ? "Return" : `Stop ${i}`;
        L.marker([p.lat!, p.lng!]).addTo(map!).bindPopup(label);
      });
      map.fitBounds(poly.getBounds(), { padding: [30, 30] });
      setStage({ status: "ready", result: res });
    })().catch((e) => {
      if (cancelled) return;
      setStage({ status: "error", message: "Map service is temporarily unavailable." });
      onResultRef.current?.(null);
      console.error("MultiStopRouteMap error:", e);
    });

    return () => {
      cancelled = true;
      if (map) map.remove();
    };
    // addresses is compared by content (JSON.stringify) since a fresh array
    // reference is expected on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(addresses), departTime]);

  if (stage.status === "idle") {
    return (
      <div className={`rounded-2xl border border-dashed border-border bg-card p-5 text-sm text-muted-foreground ${className ?? ""}`}>
        Enter all stop addresses to see the route and total distance.
      </div>
    );
  }

  if (stage.status === "partial") {
    return (
      <div className={`rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 ${className ?? ""}`}>
        ⚠ Route preview not available — {stage.unresolved.length} address{stage.unresolved.length > 1 ? "es" : ""} couldn't
        be located: {stage.unresolved.join(", ")}. Your request will still go through — Melody will confirm the route by hand.
      </div>
    );
  }

  return (
    <div className={`overflow-hidden rounded-2xl border border-border bg-card ${className ?? ""}`}>
      <div ref={mapEl} className="h-56 w-full bg-surface" aria-label="Multi-stop route map" />
      <div className="border-t border-border px-4 py-3 text-sm">
        {stage.status === "geocoding" && (
          <span className="text-muted-foreground">Locating address {stage.index + 1} of {stage.total}…</span>
        )}
        {stage.status === "routing" && <span className="text-muted-foreground">Calculating route…</span>}
        {stage.status === "error" && <span className="text-muted-foreground text-xs">{stage.message}</span>}
        {stage.status === "ready" && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
            <span><span className="font-semibold text-foreground">{stage.result.distanceKm} km</span> <span className="text-muted-foreground">total route</span></span>
            <span><span className="font-semibold text-foreground">~{stage.result.bufferedMin} min</span> <span className="text-muted-foreground">drive</span></span>
            <span className="text-xs text-muted-foreground">
              {stage.result.freeFlowMin} min free-flow + {stage.result.bufferPct}% {stage.result.isRush ? "school-run traffic" : "typical traffic"} buffer
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
