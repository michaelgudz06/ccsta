import { createFileRoute, Navigate } from "@tanstack/react-router";
import { Fragment, useCallback, useEffect, useState } from "react";
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

// The grid runs 05:00–21:00. Route drivers start early and afternoon routes
// finish mid-evening; anything outside that is rare enough to phone in.
const GRID_START = 5;
const GRID_END = 21;
const HOURS = Array.from({ length: GRID_END - GRID_START }, (_, i) => GRID_START + i);

function hourLabel(h: number): string {
  const ampm = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${ampm}`;
}

/** "14:00:00" -> 14. Blocks are stored as times; the grid works in hours. */
function toHour(t: string | null, fallback: number): number {
  if (!t) return fallback;
  return Number(t.slice(0, 2));
}

function DriverPage() {
  const { role, loading, session } = useAuth();
  const [driver, setDriver] = useState<DriverRow | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [blocks, setBlocks] = useState<AvailBlock[]>([]);
  // Drag state. `anchor` is the hour the drag started on; `cursor` is the hour
  // the pointer is over now. Together they describe the highlighted range, in
  // either direction — dragging upward has to work as well as downward.
  const [dragDay, setDragDay] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  // What a drag creates. Route drivers block the hours they're on a route, so
  // "away" is the common case and the default.
  const [paintMode, setPaintMode] = useState<"unavailable" | "available">("unavailable");
  const [savingBlock, setSavingBlock] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  // Admins reach this page too (there's a banner saying so), but they have no
  // `drivers` row, so `driver` stays null and every save silently gave up.
  // Rather than just disabling the grid, let an admin choose whose availability
  // they're editing -- Melody wants to fill these in for drivers who won't.
  const [allDrivers, setAllDrivers] = useState<{ id: string; first_name: string; last_name: string }[]>([]);
  const [editingDriverId, setEditingDriverId] = useState<string | null>(null);
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

  // Admin: load the roster so they can pick whose availability to edit.
  useEffect(() => {
    if (loading || role !== "admin") return;
    (async () => {
      const { data } = await supabase
        .from("drivers").select("id, first_name, last_name")
        .eq("active", true).order("last_name");
      setAllDrivers(data ?? []);
      setDataLoading(false);
    })();
  }, [loading, role]);

  // Whose availability the grid is editing. A driver edits their own; an admin
  // edits whoever they picked. Null means the grid must not pretend to work.
  const targetDriverId = driver?.id ?? editingDriverId;

  // Reload blocks whenever the target changes (admin switching drivers).
  useEffect(() => {
    if (!targetDriverId || driver) return; // driver's own blocks come from load()
    (async () => {
      const { data } = await supabase
        .from("driver_availability")
        .select("id, date, status, start_time, end_time, note")
        .eq("driver_id", targetDriverId)
        .gte("date", toISODate(new Date()))
        .order("date");
      setBlocks((data as AvailBlock[]) ?? []);
    })();
  }, [targetDriverId, driver]);

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

  // Commit whatever the driver just dragged over.
  //
  // Rebuilt from a tap-two-dropdowns form at Mila's request: route drivers need
  // to block the hours they're driving a route, and doing that one dropdown pair
  // at a time was too slow. Dragging a column is the natural gesture for "these
  // hours are gone".
  async function commitDrag() {
    if (dragDay === null || anchor === null || cursor === null) {
      setDragDay(null); setAnchor(null); setCursor(null);
      return;
    }
    // Never fail silently. This branch used to just reset, so the highlight
    // vanished and nothing saved with no explanation -- which is exactly how
    // the admin-viewing-as-driver case presented.
    if (!targetDriverId) {
      setDragDay(null); setAnchor(null); setCursor(null);
      flash("Choose which driver you're editing first.", false);
      return;
    }
    const lo = Math.min(anchor, cursor);
    const hi = Math.max(anchor, cursor);
    const day = dragDay;
    setDragDay(null); setAnchor(null); setCursor(null);

    const start_time = `${String(GRID_START + lo).padStart(2, "0")}:00`;
    // +1 because the range is INCLUSIVE of the hour dragged to: releasing on
    // the 15:00 row means 15:00–16:00 is blocked, not a zero-length window.
    const end_time = `${String(GRID_START + hi + 1).padStart(2, "0")}:00`;

    setSavingBlock(true);
    const { data, error } = await supabase
      .from("driver_availability")
      .insert({
        driver_id: targetDriverId,
        date: day,
        status: paintMode,
        start_time,
        end_time,
        note: null,
      })
      .select("id, date, status, start_time, end_time, note")
      .single();
    setSavingBlock(false);

    if (error) {
      flash(
        error.message.toLowerCase().includes("duplicate")
          ? "That block is already saved."
          : `Couldn't save — ${error.message}`,
        false,
      );
      return;
    }
    setBlocks((prev) => [...prev, data as AvailBlock]);
    flash("Saved ✓", true);
  }

  // Label an existing block. Free text, because Mila didn't want a fixed list.
  async function labelBlock(id: string, note: string) {
    const prev = blocks;
    setBlocks((b) => b.map((x) => (x.id === id ? { ...x, note } : x)));
    const { error } = await supabase.from("driver_availability").update({ note }).eq("id", id);
    if (error) { setBlocks(prev); flash("Couldn't save that label.", false); }
  }

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

  // The 7 days currently shown. weekOffset moves the window forward a week at
  // a time; there's no backward past today, since marking availability in the
  // past does nothing.
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + weekOffset * 7 + i);
    return { date: d, iso: toISODate(d) };
  });
  const weekIsos = new Set(weekDays.map((d) => d.iso));
  const weekBlocks = blocks
    .filter((b) => weekIsos.has(b.date))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.start_time ?? "").localeCompare(b.start_time ?? ""));

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

        {/* AVAILABILITY — hourly grid, drag to mark.
            Melody's screen reads these through recommend_drivers, which hides a
            driver only when a block actually OVERLAPS the trip window. So
            blocking a morning route no longer costs the afternoon. */}
        <section className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-bold text-foreground">My Availability</h2>
            <div className="flex items-center gap-1 text-xs">
              <button
                onClick={() => setWeekOffset((w) => Math.max(0, w - 1))}
                disabled={weekOffset === 0}
                className="rounded border border-border px-2 py-1 font-medium text-muted-foreground hover:bg-surface disabled:opacity-40"
              >
                ← Earlier
              </button>
              <button
                onClick={() => setWeekOffset((w) => w + 1)}
                className="rounded border border-border px-2 py-1 font-medium text-muted-foreground hover:bg-surface"
              >
                Later →
              </button>
            </div>
          </div>

          {/* Admin picker. The page already tells admins they're viewing the
              driver dashboard; without this the grid looked interactive but
              could never save, because an admin has no drivers row. */}
          {role === "admin" && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <label className="mb-1 block text-xs font-medium text-amber-900">
                You're an admin — choose whose availability to edit
              </label>
              <select
                value={editingDriverId ?? ""}
                onChange={(e) => setEditingDriverId(e.target.value || null)}
                className="w-full rounded-lg border border-input bg-background px-2 py-2 text-sm text-foreground outline-none ring-ring focus:ring-2"
              >
                <option value="">Not chosen — the grid won't save</option>
                {allDrivers.map((d) => (
                  <option key={d.id} value={d.id}>{d.last_name}, {d.first_name}</option>
                ))}
              </select>
            </div>
          )}

          <p className="mt-1 text-sm text-muted-foreground">
            Drag down a day to mark hours. Use it for your routes as well as time
            off — anything you don't mark counts as available.
          </p>

          {/* What a drag paints. Away is the default because blocking route
              hours is the common case. */}
          <div className="mt-3 flex gap-2">
            {(["unavailable", "available"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setPaintMode(m)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                  paintMode === m
                    ? m === "unavailable"
                      ? "border-rose-400 bg-rose-100 text-rose-900"
                      : "border-emerald-400 bg-emerald-100 text-emerald-900"
                    : "border-border bg-surface text-muted-foreground"
                }`}
              >
                {m === "unavailable" ? "Away / on a route" : "Available"}
              </button>
            ))}
          </div>

          {/* The grid. onPointerEnter rather than onPointerMove so a drag tracks
              cells rather than pixels, which behaves the same with a finger as
              with a mouse. touch-none stops the browser scrolling the page
              instead of extending the selection. */}
          <div
            className={`mt-3 overflow-x-auto ${targetDriverId ? "" : "pointer-events-none opacity-50"}`}
            onPointerUp={commitDrag}
            onPointerLeave={() => { if (dragDay) commitDrag(); }}
          >
            <div className="min-w-[560px]">
              <div className="grid grid-cols-[3rem_repeat(7,1fr)] gap-px">
                <div />
                {weekDays.map((d) => (
                  <div key={d.iso} className="pb-1 text-center text-[11px] font-semibold text-foreground">
                    <div>{d.date.toLocaleDateString("en-CA", { weekday: "short" })}</div>
                    <div className="text-muted-foreground">{d.date.getDate()}</div>
                  </div>
                ))}

                {HOURS.map((h, rowIdx) => (
                  <Fragment key={h}>
                    <div className="pr-1 text-right text-[10px] leading-6 text-muted-foreground">
                      {hourLabel(h)}
                    </div>
                    {weekDays.map((d) => {
                      const covering = blocks.find(
                        (b) =>
                          b.date === d.iso &&
                          h >= toHour(b.start_time, GRID_START) &&
                          h < toHour(b.end_time, GRID_END),
                      );
                      const inDrag =
                        dragDay === d.iso &&
                        anchor !== null && cursor !== null &&
                        rowIdx >= Math.min(anchor, cursor) &&
                        rowIdx <= Math.max(anchor, cursor);
                      const cls = inDrag
                        ? paintMode === "unavailable" ? "bg-rose-300" : "bg-emerald-300"
                        : covering
                          ? covering.status === "unavailable" ? "bg-rose-200" : "bg-emerald-200"
                          : "bg-surface hover:bg-accent/20";
                      return (
                        <div
                          key={d.iso + h}
                          onPointerDown={(e) => {
                            e.preventDefault();
                            setDragDay(d.iso); setAnchor(rowIdx); setCursor(rowIdx);
                          }}
                          onPointerEnter={() => { if (dragDay === d.iso) setCursor(rowIdx); }}
                          className={`h-6 cursor-pointer touch-none border border-border/40 ${cls}`}
                          title={covering?.note ?? undefined}
                        />
                      );
                    })}
                  </Fragment>
                ))}
              </div>
            </div>
          </div>

          {savingBlock && <p className="mt-2 text-xs text-muted-foreground">Saving…</p>}

          {/* Everything marked this week, with a free-text label per block.
              Labels live here rather than in a prompt during the drag, so the
              drag stays one uninterrupted gesture. */}
          {weekBlocks.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold text-foreground">Marked this week</h3>
              <ul className="mt-2 grid gap-1.5">
                {weekBlocks.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface/60 px-3 py-2 text-sm">
                    <span
                      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
                        b.status === "unavailable" ? "bg-rose-400" : "bg-emerald-400"
                      }`}
                    />
                    <span className="font-medium text-foreground">
                      {new Date(`${b.date}T12:00`).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" })}
                      {" · "}
                      {hourLabel(toHour(b.start_time, GRID_START))}–{hourLabel(toHour(b.end_time, GRID_END))}
                    </span>
                    <input
                      defaultValue={b.note ?? ""}
                      placeholder="Label (optional)"
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== (b.note ?? "")) labelBlock(b.id, v);
                      }}
                      className="min-w-0 flex-1 rounded border border-input bg-background px-2 py-1 text-sm text-foreground outline-none ring-ring focus:ring-2"
                    />
                    <button
                      onClick={() => removeBlock(b.id)}
                      className="rounded border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-surface"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="mt-3 text-xs text-muted-foreground">
            The office sees these straight away.
          </p>
        </section>

        <p className="rounded-xl border border-dashed border-border bg-card p-3 text-center text-xs text-muted-foreground">
          Live bus location and hours-of-service will sync from Samsara once that integration is connected.
        </p>
      </main>
    </div>
  );
}
