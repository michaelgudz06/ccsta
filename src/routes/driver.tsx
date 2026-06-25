import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AppTopBar } from "@/components/AppTopBar";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { Bus, ClipboardList, CalendarDays, Check, Phone } from "lucide-react";
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
type DayOfContact = { name?: string; phone?: string };
type Trip = {
  id: string;
  trip_number: string;
  trip_date: string;
  departure_time: string | null;
  return_time: string | null;
  destination_name: string | null;
  destination_address: string | null;
  pickup_address: string | null;
  contact_day_of: DayOfContact | null;
  special_requests: string | null;
  student_count: number | null;
  status: string;
  pretrip_checklist: Record<string, boolean> | null;
  buses: { fleet_number: string } | null;
};
type Availability = Record<string, "available" | "unavailable" | "unknown">;

function DriverPage() {
  const { role, loading, session } = useAuth();
  const [driver, setDriver] = useState<DriverRow | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [availability, setAvailability] = useState<Availability>({});
  const [dataLoading, setDataLoading] = useState(true);
  const [saveNote, setSaveNote] = useState<{ text: string; ok: boolean } | null>(null);

  function flash(text: string, ok: boolean) {
    setSaveNote({ text, ok });
    window.setTimeout(() => setSaveNote((cur) => (cur && cur.text === text ? null : cur)), 2500);
  }

  const load = useCallback(async (userId: string) => {
    setDataLoading(true);
    const { data: d } = await supabase
      .from("drivers")
      .select("id, first_name, last_name")
      .eq("profile_id", userId)
      .maybeSingle();
    if (!d) { setDataLoading(false); return; }
    setDriver(d as DriverRow);

    const { data: t } = await supabase
      .from("trips")
      .select("id, trip_number, trip_date, departure_time, return_time, destination_name, destination_address, pickup_address, contact_day_of, special_requests, student_count, status, pretrip_checklist, buses(fleet_number)")
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
    if (loading || role !== "driver" || !session?.user?.id) return;
    load(session.user.id);
  }, [loading, role, session, load]);

  async function toggleCheck(trip: Trip, item: string) {
    const current = (trip.pretrip_checklist as Record<string, boolean>) ?? {};
    const next = { ...current, [item]: !current[item] };
    setTrips((prev) => prev.map((t) => (t.id === trip.id ? { ...t, pretrip_checklist: next } : t)));
    const { error } = await supabase.from("trips").update({ pretrip_checklist: next }).eq("id", trip.id);
    if (error) {
      // Revert the on-screen tick so the checklist never shows a false "done".
      setTrips((prev) => prev.map((t) => (t.id === trip.id ? { ...t, pretrip_checklist: current } : t)));
      flash("Couldn't save — check your signal and tap again.", false);
    } else {
      flash("Saved ✓", true);
    }
  }

  async function cycleAvailability(dateStr: string) {
    if (!driver) return;
    // True 2-way toggle: a tap flips Working <-> Away (first tap on an
    // untouched day sets it Working).
    const prev = availability[dateStr] ?? "unknown";
    const nextStatus: Availability[string] = prev === "available" ? "unavailable" : "available";
    setAvailability((a) => ({ ...a, [dateStr]: nextStatus }));
    const { error } = await supabase
      .from("driver_availability")
      .upsert({ driver_id: driver.id, date: dateStr, status: nextStatus }, { onConflict: "driver_id,date" });
    if (error) {
      setAvailability((a) => ({ ...a, [dateStr]: prev }));
      flash("Couldn't save — check your signal and tap again.", false);
    } else {
      flash("Saved ✓", true);
    }
  }

  if (loading) return null;
  if (role !== "driver") return <Navigate to="/login" />;

  const today = todayISO();
  const todayLabel = new Date().toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" });
  const todaysTrips = trips
    .filter((t) => t.trip_date === today && t.status !== "cancelled")
    .sort((a, b) => (a.departure_time ?? "").localeCompare(b.departure_time ?? ""));
  const upcoming = trips.filter((t) => t.trip_date > today && t.status !== "cancelled");

  return (
    <div className="min-h-screen bg-surface">
      <AppTopBar />
      {saveNote && (
        <div className={`fixed inset-x-0 bottom-4 z-50 mx-auto w-fit rounded-full px-4 py-2 text-sm font-semibold text-white shadow-lg ${saveNote.ok ? "bg-emerald-600" : "bg-rose-600"}`}>
          {saveNote.text}
        </div>
      )}
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Driver Dashboard</h1>
          <p className="mt-1 text-base text-muted-foreground">
            {driver ? `Hi ${driver.first_name} — here's your day at a glance.` : "Here's your day at a glance."}
          </p>
          <p className="mt-0.5 text-sm font-semibold text-foreground">Today is {todayLabel}.</p>
        </div>

        {!dataLoading && !driver && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Your driver profile isn't set up yet. Please contact the office and we'll get you added.
          </div>
        )}

        {/* TODAY */}
        <section className="rounded-2xl border-2 border-primary/40 bg-card p-5 shadow-soft">
          <div className="flex items-center gap-2">
            <Bus className="h-6 w-6 text-primary" />
            <h2 className="text-lg font-bold text-foreground">Today's Trips</h2>
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
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Leave at</div>
                      <div className="text-2xl font-bold text-foreground">{formatTime(t.departure_time)}</div>
                    </div>
                    <div className="text-right">
                      {t.buses?.fleet_number && (
                        <div className="rounded-lg bg-primary px-2.5 py-1 text-sm font-bold text-primary-foreground">{t.buses.fleet_number}</div>
                      )}
                      <div className="mt-1 text-[10px] font-semibold text-muted-foreground">{t.trip_number}</div>
                    </div>
                  </div>

                  <div className="mt-3 space-y-2">
                    <div>
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pick up students</div>
                      {t.pickup_address ? (
                        <a href={`https://maps.google.com/?q=${encodeURIComponent(t.pickup_address)}`} target="_blank" rel="noreferrer" className="font-semibold text-primary underline">{t.pickup_address}</a>
                      ) : (
                        <span className="text-sm text-muted-foreground">Not provided</span>
                      )}
                    </div>
                    <div>
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Destination</div>
                      <div className="font-semibold text-foreground">{t.destination_name ?? "Field trip"}</div>
                      {t.destination_address && (
                        <a href={`https://maps.google.com/?q=${encodeURIComponent(t.destination_address)}`} target="_blank" rel="noreferrer" className="text-sm text-primary underline">{t.destination_address}</a>
                      )}
                    </div>
                    <div className="flex gap-8">
                      <div>
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">Students</div>
                        <div className="text-base font-semibold text-foreground">{t.student_count ?? "—"}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">Back by</div>
                        <div className="text-base font-semibold text-foreground">{formatTime(t.return_time)}</div>
                      </div>
                    </div>
                  </div>

                  {t.contact_day_of?.phone && (
                    <a
                      href={`tel:${t.contact_day_of.phone.replace(/[^0-9+]/g, "")}`}
                      className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-base font-semibold text-white"
                    >
                      <Phone className="h-4 w-4" /> Call {t.contact_day_of.name || "coordinator"}: {t.contact_day_of.phone}
                    </a>
                  )}

                  {t.special_requests && (
                    <div className="mt-3 rounded-lg border border-dashed border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                      <span className="font-semibold">Notes from the school: </span>{t.special_requests}
                    </div>
                  )}

                  {/* Per-trip pre-trip checklist (saved as you tap) */}
                  <div className="mt-3 rounded-lg border border-border bg-card p-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <ClipboardList className="h-4 w-4 text-primary" />
                      Pre-Trip Checklist ({done}/{CHECKLIST.length})
                    </div>
                    <ul className="mt-2 space-y-2">
                      {CHECKLIST.map((item) => (
                        <li key={item}>
                          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface px-3 py-3 text-base">
                            <input type="checkbox" checked={!!checks[item]} onChange={() => toggleCheck(t, item)} className="h-6 w-6 shrink-0" />
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
            <CalendarDays className="h-5 w-5 text-primary" />
            <h2 className="text-base font-bold text-foreground">My Schedule</h2>
          </div>
          {upcoming.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No upcoming trips assigned yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {upcoming.map((u) => (
                <li key={u.id} className="flex items-center justify-between rounded-lg border border-border bg-surface p-3 text-sm">
                  <div>
                    <div className="font-semibold text-foreground">{formatTripDate(u.trip_date)} · {formatTime(u.departure_time)}</div>
                    <div className="text-xs text-muted-foreground">
                      {u.destination_name ?? "Field trip"}{u.buses?.fleet_number ? ` · ${u.buses.fleet_number}` : ""} · {u.trip_number}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* AVAILABILITY */}
        <section className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          <h2 className="text-base font-bold text-foreground">My Availability</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Let the office know which days you can drive over the next 2 weeks. Tap a day to switch between Working and Away — grey means not answered yet. Saved automatically.
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
                <button key={iso} onClick={() => cycleAvailability(iso)} className={`rounded-lg border px-1 py-2.5 hover:border-primary ${cls}`}>
                  <div className="font-semibold">{d.toLocaleDateString("en-CA", { weekday: "short" })}</div>
                  <div className="text-xs">{d.getDate()}</div>
                  <div className="mt-0.5 text-xs font-medium">
                    {status === "unknown" ? "Tap" : status === "available" ? "Working" : "Away"}
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
