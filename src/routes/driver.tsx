import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppTopBar } from "@/components/AppTopBar";
import { useAuth } from "@/lib/auth-store";
import { Bus, ClipboardList, MapPin, CalendarDays, Bell } from "lucide-react";

export const Route = createFileRoute("/driver")({
  head: () => ({
    meta: [
      { title: "Driver Dashboard — School Field Trip Busing" },
      { name: "description", content: "Driver schedule, pre-trip checklist, and trip details for the day." },
      { property: "og:title", content: "Driver Dashboard" },
      { property: "og:description", content: "Today's trips, pre-trip checklist, and your upcoming schedule." },
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

const TRIPS_TODAY = [
  {
    id: "T-3041",
    pickup: "8:30 AM",
    school: "[Placeholder School]",
    dest: "Science World",
    headcount: 48,
    contact: "Jane D. · (604) 555-0188",
    notes: "Two students require aisle seats near the front.",
  },
];

const UPCOMING = [
  { id: "T-3055", when: "Thu Mar 14 · 9:00 AM", school: "[Placeholder School]", dest: "Aquarium", isNew: true },
  { id: "T-3061", when: "Fri Mar 15 · 8:15 AM", school: "[Placeholder School]", dest: "Capilano Park", isNew: false },
];

function DriverPage() {
  const { role } = useAuth();
  const [ready, setReady] = useState(false);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  useEffect(() => setReady(true), []);
  if (ready && role !== "driver") return <Navigate to="/login" />;

  return (
    <div className="min-h-screen bg-surface">
      <AppTopBar />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Driver Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">Hi [Driver] — here's your day at a glance.</p>
        </div>

        <section className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          <div className="flex items-center gap-2">
            <Bus className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Today's Trips</h2>
          </div>
          {TRIPS_TODAY.map((t) => (
            <div key={t.id} className="mt-3 rounded-xl border border-border bg-surface p-4">
              <div className="flex items-center justify-between">
                <div className="text-lg font-bold text-foreground">{t.pickup}</div>
                <span className="rounded-full bg-accent/30 px-2 py-0.5 text-[10px] font-semibold text-primary">{t.id}</span>
              </div>
              <div className="mt-2 text-sm text-foreground">
                <span className="font-semibold">{t.school}</span> → {t.dest}
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                Headcount: <span className="font-medium text-foreground">{t.headcount}</span> · Day-of: <span className="font-medium text-foreground">{t.contact}</span>
              </div>
              <div className="mt-2 rounded-lg border border-dashed border-border bg-card p-2 text-xs text-muted-foreground">
                Special: {t.notes}
              </div>

              <div className="mt-3 flex h-32 items-center justify-center rounded-xl border border-dashed border-border bg-card text-xs text-muted-foreground">
                <div className="text-center">
                  <MapPin className="mx-auto h-5 w-5 text-primary" />
                  [Placeholder route map]
                </div>
              </div>
            </div>
          ))}
        </section>

        <section className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Pre-Trip Checklist (15 min)</h2>
          </div>
          <ul className="mt-3 space-y-2">
            {CHECKLIST.map((item) => (
              <li key={item}>
                <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!!checks[item]}
                    onChange={(e) => setChecks((c) => ({ ...c, [item]: e.target.checked }))}
                    className="h-4 w-4"
                  />
                  <span className={checks[item] ? "text-muted-foreground line-through" : "text-foreground"}>{item}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">My Schedule</h2>
          </div>
          <ul className="mt-3 space-y-2">
            {UPCOMING.map((u) => (
              <li key={u.id} className="flex items-center justify-between rounded-lg border border-border bg-surface p-3 text-sm">
                <div>
                  <div className="font-semibold text-foreground">{u.when}</div>
                  <div className="text-xs text-muted-foreground">{u.school} → {u.dest} · {u.id}</div>
                </div>
                {u.isNew && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-accent/30 px-2 py-0.5 text-[10px] font-semibold text-primary">
                    <Bell className="h-3 w-3" /> New
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          <h2 className="text-sm font-semibold text-foreground">My Availability</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Set your availability as far ahead as you know. The coordinator can also adjust it.
          </p>
          <div className="mt-3 grid grid-cols-7 gap-1.5 text-center text-xs">
            {Array.from({ length: 14 }).map((_, i) => (
              <button
                key={i}
                className="rounded-lg border border-border bg-surface px-1 py-2 hover:border-primary hover:bg-primary/5"
              >
                <div className="font-semibold text-foreground">D{i + 1}</div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">tap to set</div>
              </button>
            ))}
          </div>
        </section>

        <p className="rounded-xl border border-dashed border-border bg-card p-3 text-center text-xs text-muted-foreground">
          Driver info such as assigned buses, route times and hours of service will sync from Samsara later.
        </p>
      </main>
    </div>
  );
}
