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
// One row per BLOCK, not per day (migration 070) — a driver can be away
// 09:00–11:00 for a dentist and 14:00–16:00 for something else on the same date.
type AvailBlock = {
  id: string;
  date: string;
  status: string;
  start_time: string | null;
  end_time: string | null;
  note: string | null;
};

// Half-hour steps, 05:00–22:00. Dropdowns rather than a free time input: a
// typed time is easy to fat-finger on a phone, and a wrong one quietly makes a
// driver unbookable.
const HALF_HOURS = Array.from({ length: 35 }, (_, i) => {
  const mins = 5 * 60 + i * 30;
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${mins % 60 === 0 ? "00" : "30"}`;
});
function prettyTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function DriverPage() {
  const { role, loading, session } = useAuth();
  const [driver, setDriver] = useState<DriverRow | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [blocks, setBlocks] = useState<AvailBlock[]>([]);
  // The day the driver is currently adding time off to. Null = form closed.
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [fromTime, setFromTime] = useState("09:00");
  const [toTime, setToTime] = useState("12:00");
  const [awayNote, setAwayNote] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [savingBlock, setSavingBlock] = useState(false);
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
      .select("id, date, status, start_time, end_time, note")
      .eq("driver_id", d.id)
      .gte("date", toISODate(new Date()))
      .order("date")
      .order("start_time", { nullsFirst: true });
    setBlocks((av as AvailBlock[]) ?? []);
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

  // Add a block of time off. Times are TAPPED from dropdowns rather than
  // dragged across a grid: the drivers are older and not tech-forward, and a
  // mis-drag that silently books someone out of a whole day is a worse failure
  // than a few extra taps.
  async function addBlock() {
    if (!driver || !openDay) return;
    const start = allDay ? null : fromTime;
    const end = allDay ? null : toTime;
    if (!allDay && toTime <= fromTime) {
      flash("The end time needs to be after the start time.", false);
      return;
    }
    setSavingBlock(true);
    const { data, error } = await supabase
      .from("driver_availability")
      .insert({
        driver_id: driver.id,
        date: openDay,
        status: "unavailable",
        start_time: start,
        end_time: end,
        note: awayNote.trim() || null,
      })
      .select("id, date, status, start_time, end_time, note")
      .single();
    setSavingBlock(false);
    if (error) {
      // The unique index is on the WINDOW, so this is almost always a duplicate.
      flash(
        error.message.includes("duplicate")
          ? "You've already marked that time off."
          : "Couldn't save — check your signal and try again.",
        false,
      );
      return;
    }
    setBlocks((prev) => [...prev, data as AvailBlock].sort(
      (a, b) => a.date.localeCompare(b.date) || (a.start_time ?? "").localeCompare(b.start_time ?? ""),
    ));
    setAwayNote("");
    setOpenDay(null);
    flash("Time off saved ✓", true);
  }

  // Cancelling an appointment is the most ordinary thing a driver will do, so
  // they can remove their own blocks (migration 070 added the delete policy).
  // Making them phone the office to un-block a morning would defeat the point.
  async function removeBlock(id: string) {
    const prev = blocks;
    setBlocks((b) => b.filter((x) => x.id !== id));
    const { error } = await supabase.from("driver_availability").delete().eq("id", id);
    if (error) {
      setBlocks(prev);
      flash("Couldn't remove that — try again.", false);
    } else {
      flash("Removed ✓", true);
    }
  }

  const today = todayISO();
  const todayLabel = new Date().toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" });
  const todaysTrips = trips
    .filter((t) => t.trip_date === today && t.status !== "cancelled")
    .sort((a, b) => (a.departure_time ?? "").localeCompare(b.departure_time ?? ""));
  const upcoming = trips.filter((t) => t.trip_date > today && t.status !== "cancelled");

  return (
    <div className="min-h-screen bg-surface">
      <AppTopBar />
      {role === "admin" && (
        <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900">
          Viewing the driver dashboard as an admin — you have no assigned trips, so these lists are empty.{" "}
          <a href="/admin" className="font-semibold underline">Back to admin</a>
        </div>
      )}
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
                      <span className="font-semibold">Notes: </span>{t.special_requests}
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

        {/* AVAILABILITY — a 14-day calendar of BLOCKS, not a day toggle.
            Melody's assignment screen reads these through recommend_drivers,
            which only hides a driver when a block actually OVERLAPS the trip
            window. So marking a morning off no longer costs you the afternoon. */}
        <section className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          <h2 className="text-base font-bold text-foreground">My Availability</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Tap a day to mark time off. You can mark part of a day — if you're
            away all morning you can still be offered an afternoon trip.
          </p>

          <div className="mt-3 grid grid-cols-7 gap-1.5 text-center text-xs">
            {Array.from({ length: 14 }).map((_, i) => {
              const d = new Date();
              d.setDate(d.getDate() + i);
              const iso = toISODate(d);
              const dayBlocks = blocks.filter((b) => b.date === iso && b.status === "unavailable");
              const fullDay = dayBlocks.some((b) => !b.start_time && !b.end_time);
              // Colour by how much of the day is gone, since reasons are free
              // text and can't be reliably grouped: amber = partly away,
              // rose = away all day, plain = free.
              const cls = fullDay
                ? "border-rose-300 bg-rose-50 text-rose-800"
                : dayBlocks.length > 0
                  ? "border-amber-300 bg-amber-50 text-amber-900"
                  : "border-border bg-surface text-muted-foreground";
              return (
                <button
                  key={iso}
                  onClick={() => { setOpenDay(openDay === iso ? null : iso); setAwayNote(""); setAllDay(false); }}
                  className={`rounded-lg border px-1 py-2.5 hover:border-primary ${cls} ${openDay === iso ? "ring-2 ring-ring" : ""}`}
                >
                  <div className="font-semibold">{d.toLocaleDateString("en-CA", { weekday: "short" })}</div>
                  <div className="text-xs">{d.getDate()}</div>
                  <div className="mt-0.5 text-[11px] font-medium">
                    {fullDay ? "Away" : dayBlocks.length > 0 ? `${dayBlocks.length} off` : "Free"}
                  </div>
                </button>
              );
            })}
          </div>

          {openDay && (
            <div className="mt-4 rounded-xl border border-border bg-surface/60 p-4">
              <h3 className="text-sm font-semibold text-foreground">
                Time off on{" "}
                {new Date(`${openDay}T12:00`).toLocaleDateString("en-CA", {
                  weekday: "long", month: "long", day: "numeric",
                })}
              </h3>

              {/* Existing blocks for this day, each removable. */}
              {blocks.filter((b) => b.date === openDay).length > 0 && (
                <ul className="mt-2 grid gap-1.5">
                  {blocks.filter((b) => b.date === openDay).map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
                      <span>
                        <span className="font-medium text-foreground">
                          {!b.start_time && !b.end_time
                            ? "All day"
                            : `${b.start_time?.slice(0, 5)}–${b.end_time?.slice(0, 5)}`}
                        </span>
                        {b.note && <span className="text-muted-foreground"> · {b.note}</span>}
                      </span>
                      <button
                        onClick={() => removeBlock(b.id)}
                        className="rounded border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-surface"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <label className="mt-3 flex items-center gap-2 text-sm text-foreground">
                <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="h-4 w-4" />
                Away the whole day
              </label>

              {!allDay && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">From</label>
                    <select
                      value={fromTime}
                      onChange={(e) => setFromTime(e.target.value)}
                      className="w-full rounded-lg border border-input bg-background px-2 py-2 text-base text-foreground outline-none ring-ring focus:ring-2"
                    >
                      {HALF_HOURS.map((t) => <option key={t} value={t}>{prettyTime(t)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Until</label>
                    <select
                      value={toTime}
                      onChange={(e) => setToTime(e.target.value)}
                      className="w-full rounded-lg border border-input bg-background px-2 py-2 text-base text-foreground outline-none ring-ring focus:ring-2"
                    >
                      {HALF_HOURS.map((t) => <option key={t} value={t}>{prettyTime(t)}</option>)}
                    </select>
                  </div>
                </div>
              )}

              <label className="mb-1 mt-3 block text-xs font-medium text-muted-foreground">Reason (optional)</label>
              <input
                value={awayNote}
                onChange={(e) => setAwayNote(e.target.value)}
                placeholder="Appointment, personal, etc."
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-base text-foreground outline-none ring-ring focus:ring-2"
              />

              <div className="mt-3 flex gap-2">
                <button
                  onClick={addBlock}
                  disabled={savingBlock}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                >
                  {savingBlock ? "Saving…" : "Mark time off"}
                </button>
                <button
                  onClick={() => setOpenDay(null)}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-surface"
                >
                  Done
                </button>
              </div>
            </div>
          )}

          <p className="mt-3 text-xs text-muted-foreground">
            The office sees these straight away. Anything you don't mark off counts as available.
          </p>
        </section>

        <p className="rounded-xl border border-dashed border-border bg-card p-3 text-center text-xs text-muted-foreground">
          Live bus location and hours-of-service will sync from Samsara once that integration is connected.
        </p>
      </main>
    </div>
  );
}
