import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppTopBar } from "@/components/AppTopBar";
import { useAuth } from "@/lib/auth-store";
import {
  Inbox, ClipboardCheck, CalendarDays, Bus, Users, Bell, FileText, AlertCircle, CheckCircle2,
} from "lucide-react";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin Console — School Field Trip Busing" }, { name: "robots", content: "noindex" }] }),
  component: AdminPage,
});

type Tab = "dashboard" | "quotes" | "schedule" | "assets" | "availability" | "documents";

function AdminPage() {
  const { role } = useAuth();
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>("dashboard");
  useEffect(() => setReady(true), []);
  if (ready && role !== "admin") return <Navigate to="/login" />;

  return (
    <div className="min-h-screen bg-surface">
      <AppTopBar />
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-primary">
              Admin · Melody & Alan
            </span>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground">Operations</h1>
          </div>
          <Notifications />
        </div>

        <Tabs tab={tab} setTab={setTab} />

        <div className="mt-6">
          {tab === "dashboard" && <Dashboard onJump={setTab} />}
          {tab === "quotes" && <QuoteQueue />}
          {tab === "schedule" && <Schedule />}
          {tab === "assets" && <Assets />}
          {tab === "availability" && <Availability />}
          {tab === "documents" && <Documents />}
        </div>
      </div>
    </div>
  );
}

function Tabs({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "dashboard", label: "Dashboard" },
    { id: "quotes", label: "Quotes" },
    { id: "schedule", label: "Schedule" },
    { id: "assets", label: "Assets" },
    { id: "availability", label: "Availability" },
    { id: "documents", label: "Documents" },
  ];
  return (
    <div className="mt-6 flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1 shadow-soft">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => setTab(t.id)}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function Notifications() {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 shadow-soft">
      <Bell className="h-4 w-4 text-primary" />
      <span className="text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">2 alerts</span> · Quote changed · Trip added
      </span>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, onClick }: { icon: any; label: string; value: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-start gap-4 rounded-2xl border border-border bg-card p-5 text-left shadow-soft transition-shadow hover:shadow-elevated">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="text-2xl font-bold text-foreground">{value}</div>
        <div className="text-sm text-muted-foreground">{label}</div>
      </div>
    </button>
  );
}

function Dashboard({ onJump }: { onJump: (t: Tab) => void }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Inbox} label="New quote requests" value="[6]" onClick={() => onJump("quotes")} />
        <StatCard icon={ClipboardCheck} label="Quotes in review" value="[3]" onClick={() => onJump("quotes")} />
        <StatCard icon={CalendarDays} label="Trips today" value="[8]" onClick={() => onJump("schedule")} />
        <StatCard icon={AlertCircle} label="Assets needing attention" value="[2]" onClick={() => onJump("assets")} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          <h3 className="text-sm font-semibold text-foreground">Recent activity</h3>
          <ul className="mt-3 space-y-3 text-sm">
            <Activity icon={<Bell className="h-4 w-4" />} text="Quote Q-2026-0142 changed — needs Melody confirmation" time="2m ago" />
            <Activity icon={<CheckCircle2 className="h-4 w-4" />} text="Trip T-3041 added — drivers notified" time="14m ago" />
            <Activity icon={<Inbox className="h-4 w-4" />} text="New quote request from [Placeholder School]" time="1h ago" />
          </ul>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          <h3 className="text-sm font-semibold text-foreground">Status flow</h3>
          <ol className="mt-3 flex flex-wrap gap-2 text-xs">
            {["Requested", "In review", "Approved", "Confirmed", "Scheduled", "Completed", "Invoiced"].map((s, i) => (
              <li key={s} className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-2.5 py-1">
                <span className="font-bold text-primary">{i + 1}</span>
                <span className="text-foreground">{s}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

function Activity({ icon, text, time }: { icon: React.ReactNode; text: string; time: string }) {
  return (
    <li className="flex items-start gap-3 rounded-xl border border-border bg-surface p-3">
      <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-lg bg-accent/30 text-primary">{icon}</div>
      <div className="flex-1">
        <div className="text-foreground">{text}</div>
        <div className="text-xs text-muted-foreground">{time}</div>
      </div>
    </li>
  );
}

const QUEUE = [
  { id: "Q-2026-0156", school: "[Placeholder School A]", date: "Apr 02", students: 48, status: "Requested" },
  { id: "Q-2026-0155", school: "[Placeholder School B]", date: "Apr 04", students: 22, status: "In review" },
  { id: "Q-2026-0154", school: "[Placeholder School C]", date: "Apr 09", students: 56, status: "Approved" },
];

function autoInvoiceNo(quoteId: string) {
  // Auto-generated default: derive from the quote number (e.g. Q-2026-0156 → INV-2026-0156)
  return quoteId.replace(/^Q-/, "INV-");
}

function QuoteQueue() {
  const [selected, setSelected] = useState<string | null>(QUEUE[0].id);
  const quote = QUEUE.find((q) => q.id === selected)!;
  const [invoiceNos, setInvoiceNos] = useState<Record<string, string>>(() =>
    Object.fromEntries(QUEUE.map((q) => [q.id, autoInvoiceNo(q.id)])),
  );
  const invoiceNo = invoiceNos[quote.id] ?? autoInvoiceNo(quote.id);

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="lg:col-span-2 rounded-2xl border border-border bg-card shadow-soft">
        <div className="border-b border-border p-4">
          <h3 className="text-sm font-semibold text-foreground">Quote queue</h3>
        </div>
        <ul className="divide-y divide-border">
          {QUEUE.map((q) => (
            <li key={q.id}>
              <button
                onClick={() => setSelected(q.id)}
                className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm transition-colors ${
                  selected === q.id ? "bg-primary/5" : "hover:bg-surface"
                }`}
              >
                <div>
                  <div className="font-semibold text-foreground">{q.id}</div>
                  <div className="text-xs text-muted-foreground">{q.school} · {q.date}</div>
                </div>
                <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-medium text-primary">{q.status}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="lg:col-span-3 space-y-4">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Quote #</div>
              <div className="text-xl font-bold text-foreground">{quote.id}</div>
            </div>
            <label className="flex flex-col items-end gap-1">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Invoice # (editable)</span>
              <input
                value={invoiceNo}
                onChange={(e) =>
                  setInvoiceNos((m) => ({ ...m, [quote.id]: e.target.value }))
                }
                className="w-44 rounded-lg border border-input bg-background px-2.5 py-1 text-right text-sm font-semibold text-foreground shadow-sm outline-none ring-ring focus:ring-2"
              />
            </label>
          </div>
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <Kv label="School" value={quote.school} />
            <Kv label="Date" value={quote.date} />
            <Kv label="Students" value={String(quote.students)} />
            <Kv label="Destination" value="[Placeholder destination]" />
          </div>
        </div>


        <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          <h4 className="text-sm font-semibold text-foreground">Editable estimate (mock)</h4>
          <div className="mt-3 grid gap-2 text-sm">
            <Kv label="Suggested bus" value="[47-seat]" />
            <Kv label="Hourly rate" value="$[xxx]" />
            <Kv label="Hours" value="[x.x]" />
            <Kv label="Estimated total" value="$[xxx.xx]" />
          </div>
          <div className="mt-4 rounded-xl border border-dashed border-border bg-surface p-3 text-xs text-muted-foreground">
            Suggested driver: <span className="font-semibold text-foreground">[Driver Name]</span> · matching engine placeholder
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <button className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
              Approve · Melody sign-off
            </button>
            <button className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface">
              Send to customer
            </button>
            <button className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface">
              Admin override
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

function Schedule() {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const slots = [
    { day: 0, status: "green", label: "T-3041 · Science World" },
    { day: 1, status: "yellow", label: "Q-156 · pending" },
    { day: 2, status: "red", label: "T-3042 · Grouse" },
    { day: 3, status: "gray", label: "Bus 47 · maintenance" },
    { day: 4, status: "green", label: "T-3045 · Aquarium" },
    { day: 4, status: "muted", label: "T-3043 · cancelled" },
  ];
  const colors: Record<string, string> = {
    green: "bg-emerald-100 text-emerald-800 border-emerald-200",
    yellow: "bg-amber-100 text-amber-800 border-amber-200",
    red: "bg-rose-100 text-rose-800 border-rose-200",
    gray: "bg-slate-100 text-slate-700 border-slate-200",
    muted: "bg-card text-muted-foreground line-through border-border",
  };
  return (
    <div className="space-y-5">
      <Legend />
      <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">This week</h3>
          <span className="text-xs text-muted-foreground">[Calendar — week / month toggle placeholder]</span>
        </div>
        <div className="grid grid-cols-7 gap-2">
          {days.map((d, i) => (
            <div key={d} className="min-h-[160px] rounded-xl border border-border bg-surface p-2">
              <div className="mb-2 text-xs font-semibold text-muted-foreground">{d}</div>
              <div className="space-y-1.5">
                {slots.filter((s) => s.day === i).map((s, idx) => (
                  <div key={idx} className={`rounded-lg border px-2 py-1.5 text-[11px] ${colors[s.status]}`}>
                    {s.label}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Newly added trips appear here — drivers notified <span className="font-semibold text-foreground">(mock)</span>.
        </p>
      </div>
    </div>
  );
}

function Legend() {
  const items = [
    ["bg-emerald-500", "Available / confirmed"],
    ["bg-amber-500", "In process of confirming"],
    ["bg-rose-500", "Booked"],
    ["bg-slate-400", "Maintenance / inspection"],
    ["bg-card border border-border", "Cancelled (muted)"],
  ];
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3 text-xs">
      <span className="font-semibold text-foreground">Legend</span>
      {items.map(([cls, label]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span className={`inline-block h-3 w-3 rounded-full ${cls}`} />
          <span className="text-muted-foreground">{label}</span>
        </span>
      ))}
      <span className="ml-auto rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-medium text-primary">to confirm</span>
    </div>
  );
}

function Assets() {
  const buses = [
    { id: "Bus 14", seats: 18, status: "green", air: false },
    { id: "Bus 22", seats: 47, status: "red", air: true },
    { id: "Bus 31", seats: 56, status: "yellow", air: true },
    { id: "Bus 47", seats: 47, status: "gray", air: true },
  ];
  const drivers = [
    { name: "Barry", cert: "Air brake", sizes: "47, 56", type: "Route + field trips", avail: "Available" },
    { name: "Judy", cert: "Air brake", sizes: "47", type: "Route", avail: "Unknown" },
    { name: "Sam", cert: "Standard", sizes: "18", type: "Field trips only", avail: "Available" },
    { name: "Priya", cert: "Air brake + First aid", sizes: "47, 56", type: "Both", avail: "Unavailable" },
  ];
  const chip: Record<string, string> = {
    green: "bg-emerald-100 text-emerald-800",
    yellow: "bg-amber-100 text-amber-800",
    red: "bg-rose-100 text-rose-800",
    gray: "bg-slate-100 text-slate-700",
  };
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-2xl border border-border bg-card shadow-soft">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h3 className="text-sm font-semibold text-foreground">Buses</h3>
          <Bus className="h-4 w-4 text-muted-foreground" />
        </div>
        <ul className="divide-y divide-border">
          {buses.map((b) => (
            <li key={b.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-foreground">{b.id}</div>
                <div className="text-xs text-muted-foreground">{b.seats} seats {b.air && "· air-brake"}</div>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${chip[b.status]}`}>{b.status}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-soft">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h3 className="text-sm font-semibold text-foreground">Drivers</h3>
          <Users className="h-4 w-4 text-muted-foreground" />
        </div>
        <ul className="divide-y divide-border">
          {drivers.map((d) => (
            <li key={d.name} className="px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-foreground">{d.name}</div>
                <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-medium text-primary">{d.avail}</span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{d.cert} · Cleared for {d.sizes} · {d.type}</div>
            </li>
          ))}
        </ul>
        <div className="border-t border-border bg-surface p-3 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">Pairing rule:</span> Barry and Judy cannot be scheduled together <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-medium text-primary">mock constraint</span>
        </div>
      </div>
    </div>
  );
}

function Availability() {
  const drivers = ["Barry", "Judy", "Sam", "Priya"];
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const states = ["A", "U", "?"];
  const styles: Record<string, string> = {
    A: "bg-emerald-100 text-emerald-800",
    U: "bg-rose-100 text-rose-800",
    "?": "bg-slate-100 text-slate-700",
  };
  // deterministic mock
  const mock = [
    ["A","A","A","U","A"],
    ["?","A","?","?","U"],
    ["A","A","A","A","A"],
    ["U","U","A","A","?"],
  ];
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
      <h3 className="text-sm font-semibold text-foreground">Driver availability</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        A = Available · U = Unavailable · ? = Unknown. Some drivers work for other companies; their availability may be partial.
      </p>
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="p-2">Driver</th>
              {days.map((d) => <th key={d} className="p-2 text-center">{d}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {drivers.map((name, i) => (
              <tr key={name}>
                <td className="p-2 font-medium text-foreground">{name}</td>
                {mock[i].map((v, j) => (
                  <td key={j} className="p-2 text-center">
                    <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold ${styles[v]}`}>{v}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Drivers can also update their own availability in the driver portal.</p>
    </div>
  );
}

function Documents() {
  const docs = [
    { title: "Bus rules & confirmation sheet", desc: "Sent to the school once the trip goes green." },
    { title: "Driver sheet", desc: "Trip details for the assigned driver." },
    { title: "Invoice file (Sage 50 import)", desc: "Placeholder generator for the accounting import." },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {docs.map((d) => (
        <div key={d.title} className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <FileText className="h-5 w-5" />
          </div>
          <h4 className="mt-4 text-base font-semibold text-foreground">{d.title}</h4>
          <p className="mt-1 text-sm text-muted-foreground">{d.desc}</p>
          <button className="mt-4 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground hover:brightness-105">
            Generate (mock)
          </button>
        </div>
      ))}
    </div>
  );
}
