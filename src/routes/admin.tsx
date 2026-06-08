import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppTopBar } from "@/components/AppTopBar";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import {
  Inbox, ClipboardCheck, CalendarDays, Bus, Users, Bell,
  FileText, AlertCircle, CheckCircle2, X, UserCheck,
} from "lucide-react";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin Console — School Field Trip Busing" }, { name: "robots", content: "noindex" }] }),
  component: AdminPage,
});

type Tab = "dashboard" | "quotes" | "schedule" | "assets" | "availability" | "documents";

function AdminPage() {
  const { role, loading } = useAuth();
  const [tab, setTab] = useState<Tab>("dashboard");
  if (loading) return null;
  if (role !== "admin") return <Navigate to="/login" />;

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
        <span className="font-semibold text-foreground">Notifications</span> · Email/SMS coming Phase 4
      </span>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, onClick }: { icon: React.ElementType; label: string; value: string; onClick?: () => void }) {
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
        <StatCard icon={Inbox} label="New quote requests" value="—" onClick={() => onJump("quotes")} />
        <StatCard icon={ClipboardCheck} label="Quotes in review" value="—" onClick={() => onJump("quotes")} />
        <StatCard icon={CalendarDays} label="Trips scheduled" value="—" onClick={() => onJump("schedule")} />
        <StatCard icon={AlertCircle} label="Assets needing attention" value="—" onClick={() => onJump("assets")} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          <h3 className="text-sm font-semibold text-foreground">Recent activity</h3>
          <ul className="mt-3 space-y-3 text-sm">
            <Activity icon={<Inbox className="h-4 w-4" />} text="New quote requests appear here in real time." time="" />
            <Activity icon={<CheckCircle2 className="h-4 w-4" />} text="Confirmed trips will be listed when scheduled." time="" />
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">Activity feed — Phase 4 (live notifications).</p>
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
        {time && <div className="text-xs text-muted-foreground">{time}</div>}
      </div>
    </li>
  );
}

const STATUS_LABEL: Record<string, string> = {
  requested: "Requested",
  in_review: "In review",
  approved:  "Approved",
  confirmed: "Confirmed",
  scheduled: "Scheduled",
  completed: "Completed",
  invoiced:  "Invoiced",
  cancelled: "Cancelled",
};

const statusStyle: Record<string, string> = {
  requested: "bg-amber-100 text-amber-800",
  in_review: "bg-blue-100 text-blue-800",
  approved:  "bg-emerald-100 text-emerald-800",
  confirmed: "bg-emerald-100 text-emerald-800",
  scheduled: "bg-purple-100 text-purple-800",
  completed: "bg-slate-100 text-slate-700",
  invoiced:  "bg-slate-100 text-slate-700",
  cancelled: "bg-rose-100 text-rose-800",
};

type AdminVersionDetail = {
  trip_date: string | null;
  student_count: number | null;
  destination_name: string | null;
  total: number | null;
  departure_time: string | null;
  special_requests: string | null;
};

type AdminQuoteRow = {
  id: string;
  quote_number: string;
  status: string;
  created_at: string;
  current_version_id: string | null;
  schools: { name: string } | null;
  quote_versions: AdminVersionDetail | null;
};

type AssignmentSuggestion = {
  driver_id: string;
  driver_name: string;
  air_brake_cert: boolean;
  phone: string | null;
  bus_id: string;
  bus_fleet: string;
  bus_bench_count: number;
};

type AssignmentResult = {
  trip_date: string;
  headcount: number;
  needed_bench: number;
  suggestions: AssignmentSuggestion[];
};

function QuoteQueue() {
  const [quotes, setQuotes] = useState<AdminQuoteRow[]>([]);
  const [qLoading, setQLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [invoiceNos, setInvoiceNos] = useState<Record<string, string>>({});

  // Action state
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmedTrip, setConfirmedTrip] = useState<string | null>(null);

  // Reject modal
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  // Assignment panel
  const [assignment, setAssignment] = useState<AssignmentResult | null>(null);
  const [assignBusy, setAssignBusy] = useState(false);

  useEffect(() => {
    // Two-step fetch: quotes first, then versions — avoids PostgREST FK ambiguity
    supabase
      .from("quotes")
      .select("id, quote_number, status, created_at, current_version_id, schools(name)")
      .order("created_at", { ascending: false })
      .limit(50)
      .then(async ({ data: rows }) => {
        if (!rows) { setQLoading(false); return; }
        const versionIds = rows
          .map((r: { current_version_id: string | null }) => r.current_version_id)
          .filter(Boolean) as string[];
        let versionMap: Record<string, AdminVersionDetail> = {};
        if (versionIds.length > 0) {
          const { data: versions } = await supabase
            .from("quote_versions")
            .select("id, trip_date, student_count, destination_name, total, departure_time, special_requests")
            .in("id", versionIds);
          versionMap = Object.fromEntries(
            (versions ?? []).map((v: AdminVersionDetail & { id: string }) => [v.id, v])
          );
        }
        const merged: AdminQuoteRow[] = rows.map((r: AdminQuoteRow) => ({
          ...r,
          quote_versions: r.current_version_id ? (versionMap[r.current_version_id] ?? null) : null,
        }));
        setQuotes(merged);
        if (merged.length > 0) setSelected(merged[0].id);
        setInvoiceNos(Object.fromEntries(merged.map((q) => [q.id, q.quote_number.replace(/^Q-/, "INV-")])));
        setQLoading(false);
      });
  }, []);

  // Clear assignment panel when switching quotes
  useEffect(() => { setAssignment(null); setConfirmedTrip(null); setActionError(null); }, [selected]);

  async function handleApprove(quoteId: string) {
    setActionBusy("approve"); setActionError(null);
    const { data, error } = await supabase.rpc("approve_quote" as never, {
      p_quote_id: quoteId,
      p_invoice_number: invoiceNos[quoteId] ?? null,
    } as never);
    setActionBusy(null);
    if (error) { setActionError(error.message); return; }
    const result = data as { invoice_number: string };
    setQuotes((prev) => prev.map((q) => q.id === quoteId ? { ...q, status: "approved" } : q));
    setInvoiceNos((m) => ({ ...m, [quoteId]: result.invoice_number }));
  }

  async function handleReject(quoteId: string) {
    setActionBusy("reject"); setActionError(null);
    const { error } = await supabase.rpc("reject_quote" as never, {
      p_quote_id: quoteId,
      p_reason: rejectReason || null,
    } as never);
    setActionBusy(null);
    if (error) { setActionError(error.message); return; }
    setQuotes((prev) => prev.filter((q) => q.id !== quoteId));
    setShowReject(false); setRejectReason("");
    setSelected((prev) => quotes.find((q) => q.id !== quoteId && q.id !== prev)?.id ?? quotes[0]?.id ?? null);
  }

  async function handleSuggest(quoteId: string) {
    setAssignBusy(true); setActionError(null); setAssignment(null);
    const { data, error } = await supabase.rpc("suggest_assignment" as never, { p_quote_id: quoteId } as never);
    setAssignBusy(false);
    if (error) { setActionError(error.message); return; }
    setAssignment(data as AssignmentResult);
  }

  async function handleConfirmTrip(quoteId: string, driverId: string, busId: string) {
    setActionBusy("confirm"); setActionError(null);
    const { data, error } = await supabase.rpc("confirm_trip" as never, {
      p_quote_id: quoteId,
      p_driver_id: driverId,
      p_bus_id: busId,
    } as never);
    setActionBusy(null);
    if (error) { setActionError(error.message); return; }
    const result = data as { trip_number: string };
    setConfirmedTrip(result.trip_number);
    setAssignment(null);
    setQuotes((prev) => prev.map((q) => q.id === quoteId ? { ...q, status: "scheduled" } : q));
  }

  if (qLoading) {
    return <div className="py-12 text-center text-sm text-muted-foreground">Loading quotes…</div>;
  }

  if (quotes.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
        No quote requests yet. They'll appear here once customers submit the quote form.
      </div>
    );
  }

  const quote = quotes.find((q) => q.id === selected) ?? quotes[0];
  const ver = quote.quote_versions;
  const invoiceNo = invoiceNos[quote.id] ?? quote.quote_number.replace(/^Q-/, "INV-");
  const tripDate = ver?.trip_date
    ? new Date(ver.trip_date).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })
    : "—";

  const canApprove = ["requested", "in_review"].includes(quote.status);
  const canSchedule = quote.status === "approved";
  const isScheduled = quote.status === "scheduled";
  const isCancelled = quote.status === "cancelled";

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      {/* ── Quote list sidebar ── */}
      <div className="lg:col-span-2 rounded-2xl border border-border bg-card shadow-soft">
        <div className="border-b border-border p-4">
          <h3 className="text-sm font-semibold text-foreground">Quote queue ({quotes.length})</h3>
        </div>
        <ul className="divide-y divide-border">
          {quotes.map((q) => (
            <li key={q.id}>
              <button
                onClick={() => setSelected(q.id)}
                className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm transition-colors ${
                  selected === q.id ? "bg-primary/5" : "hover:bg-surface"
                }`}
              >
                <div>
                  <div className="font-semibold text-foreground">{q.quote_number}</div>
                  <div className="text-xs text-muted-foreground">
                    {q.schools?.name ?? "Unknown school"} ·{" "}
                    {q.quote_versions?.trip_date
                      ? new Date(q.quote_versions.trip_date).toLocaleDateString("en-CA", { month: "short", day: "numeric" })
                      : "no date"}
                  </div>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusStyle[q.status] ?? "bg-slate-100 text-slate-700"}`}>
                  {STATUS_LABEL[q.status] ?? q.status}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* ── Detail panel ── */}
      <div className="lg:col-span-3 space-y-4">

        {/* Quote header */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Quote #</div>
              <div className="text-xl font-bold text-foreground">{quote.quote_number}</div>
              <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusStyle[quote.status] ?? ""}`}>
                {STATUS_LABEL[quote.status] ?? quote.status}
              </span>
            </div>
            <label className="flex flex-col items-end gap-1">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Invoice # (editable)</span>
              <input
                value={invoiceNo}
                onChange={(e) => setInvoiceNos((m) => ({ ...m, [quote.id]: e.target.value }))}
                className="w-44 rounded-lg border border-input bg-background px-2.5 py-1 text-right text-sm font-semibold text-foreground shadow-sm outline-none ring-ring focus:ring-2"
              />
            </label>
          </div>

          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <Kv label="School" value={quote.schools?.name ?? "—"} />
            <Kv label="Trip date" value={tripDate} />
            <Kv label="Students" value={ver?.student_count != null ? String(ver.student_count) : "—"} />
            <Kv label="Destination" value={ver?.destination_name ?? "—"} />
          </div>

          {ver?.special_requests && (
            <div className="mt-3 rounded-xl border border-dashed border-border bg-surface p-3 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Special requests: </span>{ver.special_requests}
            </div>
          )}
        </div>

        {/* Estimate card */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          <h4 className="text-sm font-semibold text-foreground">Estimate</h4>
          <div className="mt-3 grid gap-2 text-sm">
            <Kv label="Estimated total" value={ver?.total != null ? `$${Number(ver.total).toFixed(2)}` : "Pending calculation"} />
          </div>

          {/* Confirmed trip banner */}
          {confirmedTrip && (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <CheckCircle2 className="inline h-4 w-4 mr-1.5" />
              Trip <span className="font-semibold">{confirmedTrip}</span> scheduled successfully.
            </div>
          )}

          {/* Error banner */}
          {actionError && (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              {actionError}
            </div>
          )}

          {/* Action buttons — context-aware by status */}
          {!isCancelled && !isScheduled && (
            <div className="mt-5 flex flex-wrap gap-2">
              {canApprove && (
                <button
                  disabled={actionBusy === "approve"}
                  onClick={() => handleApprove(quote.id)}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                >
                  {actionBusy === "approve" ? "Approving…" : "Approve · Melody sign-off"}
                </button>
              )}
              {canSchedule && (
                <button
                  disabled={assignBusy}
                  onClick={() => handleSuggest(quote.id)}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {assignBusy ? "Loading…" : "Assign driver & bus →"}
                </button>
              )}
              {!isCancelled && (
                <button
                  onClick={() => { setShowReject(true); setActionError(null); }}
                  className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100"
                >
                  Reject / Cancel
                </button>
              )}
            </div>
          )}

          {isScheduled && (
            <p className="mt-4 text-sm text-emerald-700 font-medium">
              <CheckCircle2 className="inline h-4 w-4 mr-1" />
              Trip scheduled — driver and bus assigned.
            </p>
          )}
        </div>

        {/* Assignment suggestions panel */}
        {assignment && (
          <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-foreground">
                Available for {assignment.trip_date} · {assignment.headcount} people · {assignment.needed_bench}-bench bus
              </h4>
              <button onClick={() => setAssignment(null)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            {assignment.suggestions.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                No available driver + bus pairs for this date. Check driver availability or add fleet/driver data.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-border">
                {assignment.suggestions.map((s, i) => (
                  <li key={i} className="flex items-center justify-between py-3">
                    <div className="text-sm">
                      <div className="font-semibold text-foreground">
                        <UserCheck className="inline h-3.5 w-3.5 mr-1 text-primary" />
                        {s.driver_name}
                        {s.air_brake_cert && (
                          <span className="ml-2 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">Air brake</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Bus {s.bus_fleet} · {s.bus_bench_count}-bench{s.phone ? ` · ${s.phone}` : ""}
                      </div>
                    </div>
                    <button
                      disabled={actionBusy === "confirm"}
                      onClick={() => handleConfirmTrip(quote.id, s.driver_id, s.bus_id)}
                      className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                    >
                      {actionBusy === "confirm" ? "…" : "Confirm trip"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Reject modal (inline) */}
        {showReject && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5">
            <h4 className="text-sm font-semibold text-rose-800">Reject / cancel quote {quote.quote_number}</h4>
            <textarea
              rows={3}
              placeholder="Reason (optional — visible in internal notes)"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="mt-3 w-full rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm outline-none"
            />
            <div className="mt-3 flex gap-2">
              <button
                disabled={actionBusy === "reject"}
                onClick={() => handleReject(quote.id)}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
              >
                {actionBusy === "reject" ? "Cancelling…" : "Confirm cancel"}
              </button>
              <button
                onClick={() => { setShowReject(false); setRejectReason(""); }}
                className="rounded-lg border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-700"
              >
                Go back
              </button>
            </div>
          </div>
        )}
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
    { day: 0, status: "green", label: "T-3001 · Science World" },
    { day: 2, status: "yellow", label: "T-3002 · Grouse Mtn" },
    { day: 4, status: "green", label: "T-3003 · Aquarium" },
  ];
  const colors: Record<string, string> = {
    green:  "bg-emerald-100 text-emerald-800 border-emerald-200",
    yellow: "bg-amber-100 text-amber-800 border-amber-200",
    red:    "bg-rose-100 text-rose-800 border-rose-200",
    gray:   "bg-slate-100 text-slate-700 border-slate-200",
    muted:  "bg-card text-muted-foreground line-through border-border",
  };
  return (
    <div className="space-y-5">
      <Legend />
      <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">This week</h3>
          <span className="text-xs text-muted-foreground">Calendar — week/month view · Phase 3</span>
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
          Trips created via the Quotes tab appear here once scheduled.
        </p>
      </div>
    </div>
  );
}

function Legend() {
  const items = [
    ["bg-emerald-500", "Available / confirmed"],
    ["bg-amber-500", "In process of confirming"],
    ["bg-rose-500", "Booked / unavailable"],
    ["bg-slate-400", "Maintenance / inspection"],
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
    green:  "bg-emerald-100 text-emerald-800",
    yellow: "bg-amber-100 text-amber-800",
    red:    "bg-rose-100 text-rose-800",
    gray:   "bg-slate-100 text-slate-700",
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
                <div className="text-xs text-muted-foreground">{b.seats} seats{b.air && " · air-brake"}</div>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${chip[b.status]}`}>{b.status}</span>
            </li>
          ))}
        </ul>
        <p className="border-t border-border bg-surface p-3 text-xs text-muted-foreground">
          Seeded with placeholder fleet — replace with real data from Curtis.
        </p>
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
          <span className="font-semibold text-foreground">Note:</span> Seeded with placeholder drivers — replace with real data from Curtis.
        </div>
      </div>
    </div>
  );
}

function Availability() {
  const drivers = ["Barry", "Judy", "Sam", "Priya"];
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const styles: Record<string, string> = {
    A: "bg-emerald-100 text-emerald-800",
    U: "bg-rose-100 text-rose-800",
    "?": "bg-slate-100 text-slate-700",
  };
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
        A = Available · U = Unavailable · ? = Unknown. Drivers update their own availability via the driver portal.
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
      <p className="mt-3 text-xs text-muted-foreground">Live availability feeds from the driver portal — real data after fleet is seeded.</p>
    </div>
  );
}

function Documents() {
  const docs = [
    { title: "Bus rules & confirmation sheet", desc: "Sent to the school once the trip goes green." },
    { title: "Driver sheet", desc: "Trip details for the assigned driver." },
    { title: "Invoice file (Sage 50 import)", desc: "CSV/XML export format for Sage 50 accounting import." },
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
            Generate (Phase 4)
          </button>
        </div>
      ))}
    </div>
  );
}
