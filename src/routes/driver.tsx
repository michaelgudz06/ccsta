import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AppTopBar } from "@/components/AppTopBar";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { Bus, ClipboardList, CalendarDays, Check } from "lucide-react";
import { formatTripDate, formatTime, todayISO, toISODate } from "@/lib/format";
import { COMPANY } from "@/lib/company";

export const Route = createFileRoute("/driver")({
  head: () => ({
    meta: [
      { title: `Driver Dashboard — ${COMPANY.name}` },
      { name: "description", content: "Driver schedule, pre-trip checklist, and trip details for the day." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DriverPage,
});

const CHECKLIST = [
  "Walk-around: tires, lights, mirrors",
  "Brake check (incl. air brake test)",
  "Emergency exits & first-aid kit",
  "Fuel level & fluids",
  "Interior cleanliness & seat belts",
  "Driver paperwork & route sheet",
];

type DriverRow = { id: string; first_name: string; last_name: string };
type Trip = {
  id: string;
  trip_number: string;
  trip_date: string;
  departure_time: string | null;
  return_time: string | null;
  destination_name: string | null;
  destination_address: string | null;
  student_count: number | null;
  status: string;
  pretrip_checklist: Record<string, boolean> | null;
};
type Availability = Record<string, "available" | "unavailable" | "unknown">;

function DriverPage() {
  const { role, loading } = useAuth();
  const [driver, setDriver] = useState<DriverRow | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [availability, setAvailability] = useState<Availability>({});
  const [dataLoading, setDataLoading] = useState(true);

  const load = useCallback(async () => {
    setDataLoading(true);
    const { data: d } = await supabase
      .from("drivers")
      .select("id, first_name, last_name")
      .limit(1)
      .maybeSingle();
    if (!d) { setDataLoading(false); return; }
    setDriver(d as DriverRow);

    const { data: t } = await supabase
      .from("trips")
      .select("id, trip_number, trip_date, departure_time, return_time, destination_name, destination_address, student_count, status, pretrip_checklist")
      .eq("driver_id", d.id)
      .order("trip_date", { ascending: true });
    setTrips((t as unknown as Trip[]) ?? []);

    const { data: av } = await supabase
      .from("driver_availability")
      .select("date, status")
      .eq("driver_id", d.id);
    setAvailability(Object.fromEntries((av ?? []).map((r) => [r.date, r.status])) as Availability);
    setDataLoading(false);
  }, []);

  useEffect(() => {
    if (loading || role !== "driver") return;
    load();
  }, [loading, role, load]);

  async function toggleCheck(trip: Trip, item: string) {
    const current = (trip.pretrip_checklist as Record<string, boolean>) ?? {};
    const next = { ...current, [item]: !current[item] };
    setTrips((prev) => prev.map((t) => (t.id === trip.id ? { ...t, pretrip_checklist: next } : t)));
    await supabase.from("trips").update({ pretrip_checklist: next }).eq("id", trip.id);
  }

  async function cycleAvailability(dateStr: string) {
    if (!driver) return;
    const order: Availability[string][] = ["available", "unavailable", "unknown"];
    const cur = availability[dateStr] ?? "unknown";
    const nextStatus = order[(order.indexOf(cur) + 1) % order.length];
    setAvailability((a) => ({ ...a, [dateStr]: nextStatus }));
    await supabase
      .from("driver_availability")
      .upsert({ driver_id: driver.id, date: dateStr, status: nextStatus }, { onConflict: "driver_id,date" });
  }

  if (loading) return null;
  if (role !== "driver") return <Navigate to="/login" />;

  const today = todayISO();
  const todaysTrips = trips.filter((t) => t.trip_date === today && t.status !== "cancelled");
  const upcoming = trips.filter((t) => t.trip_date > today && t.status !== "cancelled");

  return (
    <div className="min-h-screen bg-surface">
      <AppTopBar />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Driver Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {driver ? `Hi ${driver.first_name} — here's your day at a glance.` : "Here's your day at a glance."}
          </p>
        </div>

        {/* TODAY */}
        <section className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          <div className="flex items-center gap-2">
            <Bus className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Today's Trips</h2>
          </div>
          {dataLoading ? (
            <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
          ) : todaysTrips.length === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed border-border bg-surface p-4 text-sm text-muted-foreground">
              No trips scheduled for today. Enjoy the day off!
            </p>
          ) : (
            todaysTrips.map((t) => {
              const checks = (t.pretrip_checklist as Record<string, boolean>) ?? {};
              const done = CHECKLIST.filter((i) => checks[i]).length;
              return (
                <div key={t.id} className="mt-3 rounded-xl border border-border bg-surface p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-lg font-bold text-foreground">{formatTime(t.departure_time)}</div>
                    <span className="rounded-full bg-accent/30 px-2 py-0.5 text-[10px] font-semibold text-primary">{t.trip_number}</span>
                  </div>
                  <div className="mt-2 text-sm text-foreground">
                    <span className="font-semibold">{t.destination_name ?? "Field trip"}</span>
                  </div>
                  {t.destination_address && <div className="text-xs text-muted-foreground">{t.destination_address}</div>}
                  <div className="mt-2 text-xs text-muted-foreground">
                    Riders: <span className="font-medium text-foreground">{t.student_count ?? "—"}</span>
                    {" · "}Return: <span className="font-medium text-foreground">{formatTime(t.return_time)}</span>
                  </div>

                  {/* Per-trip pre-trip checklist (saved as you tap) */}
                  <div className="mt-3 rounded-lg border border-border bg-card p-3">
                    <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                      <ClipboardList className="h-3.5 w-3.5 text-primary" />
                      Pre-Trip Checklist ({done}/{CHECKLIST.length})
                    </div>
                    <ul className="mt-2 space-y-1.5">
                      {CHECKLIST.map((item) => (
                        <li key={item}>
                          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
                            <input type="checkbox" checked={!!checks[item]} onChange={() => toggleCheck(t, item)} className="h-4 w-4" />
                            <span className={checks[item] ? "text-muted-foreground line-through" : "text-foreground"}>{item}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              );
            })
          )}
        </section>

        {/* UPCOMING */}
        <section className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">My Schedule</h2>
          </div>
          {upcoming.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No upcoming trips assigned yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {upcoming.map((u) => (
                <li key={u.id} className="flex items-center justify-between rounded-lg border border-border bg-surface p-3 text-sm">
                  <div>
                    <div className="font-semibold text-foreground">{formatTripDate(u.trip_date)} · {formatTime(u.departure_time)}</div>
                    <div className="text-xs text-muted-foreground">{u.destination_name ?? "Field trip"} · {u.trip_number}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* AVAILABILITY */}
        <section className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          <h2 className="text-sm font-semibold text-foreground">My Availability</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Tap a day to cycle through Available → Away → Not set. Saved automatically.
          </p>
          <div className="mt-3 grid grid-cols-7 gap-1.5 text-center text-xs">
            {Array.from({ length: 14 }).map((_, i) => {
              const d = new Date();
              d.setDate(d.getDate() + i);
              const iso = toISODate(d);
              const status = availability[iso] ?? "unknown";
              const cls =
                status === "available" ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                : status === "unavailable" ? "border-rose-300 bg-rose-50 text-rose-800"
                : "border-border bg-surface text-muted-foreground";
              return (
                <button key={iso} onClick={() => cycleAvailability(iso)} className={`rounded-lg border px-1 py-2 hover:border-primary ${cls}`}>
                  <div className="font-semibold">{d.toLocaleDateString("en-CA", { weekday: "short" })}</div>
                  <div className="text-[11px]">{d.getDate()}</div>
                  <div className="mt-0.5 text-[9px] capitalize">
                    {status === "unknown" ? "—" : status === "available" ? "free" : "away"}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <p className="rounded-xl border border-dashed border-border bg-card p-3 text-center text-xs text-muted-foreground">
          Live bus location and hours-of-service will sync from Samsara once that integration is connected.
        </p>
      </main>
    </div>
  );
}
