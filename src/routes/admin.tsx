import { createFileRoute, Navigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppTopBar } from "@/components/AppTopBar";
import { RouteMap } from "@/components/RouteMap";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { dispatchNotifications } from "@/lib/notify";
import { formatTripDate, formatTime, formatMoney, todayISO, addDaysISO } from "@/lib/format";
import { COMPANY } from "@/lib/company";
import {
  Inbox, ClipboardCheck, CalendarDays, Bus, Bell,
  FileText, AlertCircle, CheckCircle2, X, UserCheck, UserPlus,
} from "lucide-react";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: `Admin Console — ${COMPANY.name}` }, { name: "robots", content: "noindex" }] }),
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
              ADMIN · MELODY, ALAN, AND CURTIS
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
    { id: "assets", label: "Buses & Drivers" },
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
        <span className="font-semibold text-foreground">Notifications</span> · No new alerts
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

type RecentQuote = { quote_number: string; status: string; created_at: string; school: string };

function Dashboard({ onJump }: { onJump: (t: Tab) => void }) {
  const [counts, setCounts] = useState({ requested: 0, in_review: 0, scheduled: 0, inactiveAssets: 0 });
  const [recent, setRecent] = useState<RecentQuote[]>([]);

  useEffect(() => {
    (async () => {
      const [reqRes, revRes, schedRes, busRes, drvRes, recentRes] = await Promise.all([
        supabase.from("quotes").select("id", { count: "exact", head: true }).eq("status", "requested"),
        supabase.from("quotes").select("id", { count: "exact", head: true }).eq("status", "in_review"),
        supabase.from("trips").select("id", { count: "exact", head: true }).eq("status", "scheduled"),
        supabase.from("buses").select("id", { count: "exact", head: true }).eq("active", false),
        supabase.from("drivers").select("id", { count: "exact", head: true }).eq("active", false),
        supabase.from("quotes").select("quote_number, status, created_at, schools(name)").order("created_at", { ascending: false }).limit(6),
      ]);
      setCounts({
        requested: reqRes.count ?? 0,
        in_review: revRes.count ?? 0,
        scheduled: schedRes.count ?? 0,
        inactiveAssets: (busRes.count ?? 0) + (drvRes.count ?? 0),
      });
      setRecent(
        ((recentRes.data ?? []) as Array<{ quote_number: string; status: string; created_at: string; schools: { name: string } | null }>)
          .map((r) => ({ quote_number: r.quote_number, status: r.status, created_at: r.created_at, school: r.schools?.name ?? "Unknown school" })),
      );
    })();
  }, []);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Inbox} label="New quote requests" value={String(counts.requested)} onClick={() => onJump("quotes")} />
        <StatCard icon={ClipboardCheck} label="Quotes in review" value={String(counts.in_review)} onClick={() => onJump("quotes")} />
        <StatCard icon={CalendarDays} label="Trips scheduled" value={String(counts.scheduled)} onClick={() => onJump("schedule")} />
        <StatCard icon={AlertCircle} label="Buses/drivers out of service" value={String(counts.inactiveAssets)} onClick={() => onJump("assets")} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          <h3 className="text-sm font-semibold text-foreground">Recent quote activity</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {recent.length === 0 ? (
              <li className="rounded-xl border border-dashed border-border bg-surface p-3 text-muted-foreground">
                New quote requests will appear here.
              </li>
            ) : (
              recent.map((r) => (
                <li key={r.quote_number} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">{r.school}</div>
                    <div className="text-xs text-muted-foreground">{r.quote_number} · {formatTripDate(r.created_at.slice(0, 10))}</div>
                  </div>
                  <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${statusStyle[r.status] ?? "bg-slate-100 text-slate-700"}`}>
                    {STATUS_LABEL[r.status] ?? r.status}
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          <h3 className="text-sm font-semibold text-foreground">Status flow</h3>
          <ol className="mt-3 flex flex-wrap gap-2 text-xs">
            {["Requested", "In review", "Approved", "Accepted", "Scheduled", "Completed", "Invoiced"].map((s, i) => (
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

// Turn raw Postgres/RPC errors into plain language for non-technical office staff.
function friendlyError(msg: string): string {
  const m = (msg || "").toLowerCase();
  if (m.includes("already booked")) return msg; // confirm_trip already returns friendly text
  if (m.includes("no rate") || m.includes("rate found") || m.includes("rate_config"))
    return "There's no price set up for this bus size yet — check the rate settings or call the office admin.";
  if (m.includes("unauthorized") || m.includes("permission") || m.includes("not allowed"))
    return "You don't have permission for that. Make sure you're logged in as an admin.";
  if (m.includes("cannot be approved") || m.includes("must be approved"))
    return "This quote isn't in the right status for that step — refresh the page and try again.";
  if (m.includes("not found"))
    return "We couldn't find that record — try refreshing the page.";
  if (m.includes("pending cancellation"))
    return "There's no pending cancellation request on this quote anymore — refresh the page.";
  return "Something went wrong: " + msg + ". Please try again, or refresh the page.";
}

const STATUS_LABEL: Record<string, string> = {
  requested: "Requested",
  in_review: "In review",
  approved:  "Approved",
  confirmed: "Accepted by customer",
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  invoiced:  "Invoiced",
  cancelled: "Cancelled",
};

const statusStyle: Record<string, string> = {
  requested: "bg-amber-100 text-amber-800",
  in_review: "bg-blue-100 text-blue-800",
  approved:  "bg-orange-100 text-orange-800",
  confirmed: "bg-emerald-100 text-emerald-800",
  scheduled: "bg-purple-100 text-purple-800",
  in_progress: "bg-indigo-100 text-indigo-800",
  completed: "bg-slate-100 text-slate-700",
  invoiced:  "bg-slate-100 text-slate-700",
  cancelled: "bg-rose-100 text-rose-800",
};

type AdminVersionDetail = {
  trip_date: string | null;
  student_count: number | null;
  destination_name: string | null;
  destination_address: string | null;
  pickup_address: string | null;
  total: number | null;
  departure_time: string | null;
  return_time: string | null;
  adults_count: number | null;
  special_requests: string | null;
  driver_preference: string | null;
  distance_km: number | null;
  approved_driver_hours: number | null;
  system_driver_hours: number | null;
  fuel_waived: boolean;
  contact_primary: { name?: string; email?: string; phone?: string } | null;
  contact_secondary: { name?: string; email?: string; phone?: string } | null;
  contact_day_of: { name?: string; phone?: string } | null;
  grade_breakdown: { grade?: string; count?: string }[] | null;
};

type AdminQuoteRow = {
  id: string;
  quote_number: string;
  status: string;
  created_at: string;
  current_version_id: string | null;
  cancellation_requested_at: string | null;
  cancellation_reason: string | null;
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

type EstimateBreakdown = {
  bench_count: number;
  bus_count: number;
  customer_type: string;
  hourly_rate: number;
  trip_hours: number;
  driver_pre_hours: number;
  driver_post_hours: number;
  reference_driver_hours: number;
  system_driver_hours: number;
  approved_driver_hours: number | null;
  driver_hours_used: number;
  billable_hours: number;
  min_hours: number;
  base_cost: number;
  fuel_surcharge: number;
  fuel_waived: boolean;
  overtime_charge: number;
  distance_km: number;
  long_distance_charge: number;
  subtotal: number;
  gst_pct: number;
  gst: number;
  total: number;
  destination_matched: string | null;
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
  // Confirm step for approving a cancellation request
  const [confirmCancelTrip, setConfirmCancelTrip] = useState(false);
  // "Adjust" section (driver-time override + fuel waiver) — expanded by default
  const [adjustExpanded, setAdjustExpanded] = useState(true);

  // Assignment panel
  const [assignment, setAssignment] = useState<AssignmentResult | null>(null);
  const [assignBusy, setAssignBusy] = useState(false);

  // Estimate breakdown
  const [estimate, setEstimate] = useState<EstimateBreakdown | null>(null);
  const [estimateBusy, setEstimateBusy] = useState(false);

  useEffect(() => {
    // Two-step fetch: quotes first, then versions — avoids PostgREST FK ambiguity
    supabase
      .from("quotes")
      .select("id, quote_number, status, created_at, current_version_id, cancellation_requested_at, cancellation_reason, schools(name)")
      .order("created_at", { ascending: false })
      .limit(50)
      .then(async ({ data: rows }) => {
        if (!rows) { setQLoading(false); return; }
        const versionIds = rows
          .map((r: any) => r.current_version_id)
          .filter(Boolean) as string[];
        let versionMap: Record<string, AdminVersionDetail> = {};
        if (versionIds.length > 0) {
          const { data: versions } = await supabase
            .from("quote_versions")
            .select("id, trip_date, student_count, adults_count, destination_name, destination_address, pickup_address, total, departure_time, return_time, special_requests, driver_preference, distance_km, approved_driver_hours, system_driver_hours, fuel_waived, contact_primary, contact_secondary, contact_day_of, grade_breakdown")
            .in("id", versionIds);
          versionMap = Object.fromEntries(
            (versions ?? []).map((v: any) => [v.id, v])
          );
        }
        const merged: AdminQuoteRow[] = rows.map((r: any) => ({
          ...r,
          quote_versions: r.current_version_id ? (versionMap[r.current_version_id] ?? null) : null,
        }));
        setQuotes(merged);
        if (merged.length > 0) setSelected(merged[0].id);
        setInvoiceNos(Object.fromEntries(merged.map((q) => [q.id, q.quote_number.replace(/^Q-/, "INV-")])));
        setQLoading(false);
      });
  }, []);

  // Clear panels when switching quotes, and auto-calculate the price so Melody
  // sees it the moment she opens a quote (no separate "Calculate" click).
  useEffect(() => {
    setAssignment(null);
    setConfirmedTrip(null);
    setActionError(null);
    setEstimate(null);
    setConfirmCancelTrip(false);
    setAdjustExpanded(true);
    const q = quotes.find((x) => x.id === selected);
    if (q && ["requested", "in_review"].includes(q.status) && q.quote_versions?.total == null) {
      handleEstimate(q.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  async function handleApprove(quoteId: string) {
    setActionBusy("approve"); setActionError(null);
    // One step: make sure a fresh price is calculated/persisted, then approve.
    const { error: calcErr } = await supabase.rpc("calculate_estimate" as never, { p_quote_id: quoteId } as never);
    if (calcErr) { setActionBusy(null); setActionError(friendlyError(calcErr.message)); return; }
    const { data, error } = await supabase.rpc("approve_quote" as never, {
      p_quote_id: quoteId,
      p_invoice_number: invoiceNos[quoteId] ?? null,
    } as never);
    setActionBusy(null);
    if (error) { setActionError(friendlyError(error.message)); return; }
    const result = data as { invoice_number: string };
    setQuotes((prev) => prev.map((q) => q.id === quoteId ? { ...q, status: "approved" } : q));
    setInvoiceNos((m) => ({ ...m, [quoteId]: result.invoice_number }));
    dispatchNotifications();
  }

  async function handleReject(quoteId: string) {
    setActionBusy("reject"); setActionError(null);
    const { error } = await supabase.rpc("reject_quote" as never, {
      p_quote_id: quoteId,
      p_reason: rejectReason || null,
    } as never);
    setActionBusy(null);
    if (error) { setActionError(friendlyError(error.message)); return; }
    setQuotes((prev) => prev.filter((q) => q.id !== quoteId));
    setShowReject(false); setRejectReason("");
    setSelected((prev) => quotes.find((q) => q.id !== quoteId && q.id !== prev)?.id ?? quotes[0]?.id ?? null);
    dispatchNotifications();
  }

  async function handleResolveCancellation(quoteId: string, approve: boolean) {
    setActionBusy(approve ? "cancel-approve" : "cancel-decline"); setActionError(null);
    const { error } = await supabase.rpc("resolve_cancellation_request" as never, {
      p_quote_id: quoteId,
      p_approve: approve,
    } as never);
    setActionBusy(null);
    if (error) { setActionError(friendlyError(error.message)); return; }
    setQuotes((prev) => prev.map((q) =>
      q.id === quoteId
        ? { ...q, status: approve ? "cancelled" : q.status, cancellation_requested_at: null }
        : q
    ));
    dispatchNotifications();
  }

  async function handleSuggest(quoteId: string) {
    setAssignBusy(true); setActionError(null); setAssignment(null);
    const { data, error } = await supabase.rpc("suggest_assignment" as never, { p_quote_id: quoteId } as never);
    setAssignBusy(false);
    if (error) { setActionError(friendlyError(error.message)); return; }
    setAssignment(data as AssignmentResult);
  }

  async function handleEstimate(quoteId: string) {
    setEstimateBusy(true); setActionError(null); setEstimate(null);
    const { data, error } = await supabase.rpc("calculate_estimate" as never, { p_quote_id: quoteId } as never);
    setEstimateBusy(false);
    if (error) { setActionError(friendlyError(error.message)); return; }
    const result = data as EstimateBreakdown;
    setEstimate(result);
    setQuotes((prev) => prev.map((q) =>
      q.id === quoteId && q.quote_versions
        ? {
            ...q,
            quote_versions: {
              ...q.quote_versions,
              total: result.total,
              approved_driver_hours: result.approved_driver_hours,
              system_driver_hours: result.system_driver_hours,
              fuel_waived: result.fuel_waived,
            },
          }
        : q
    ));
  }

  // Melody's overrides — persisted immediately (independent of quote status),
  // then recalculated so she sees the updated total right away.
  async function handleSetApprovedHours(quoteId: string, raw: string) {
    const trimmed = raw.trim();
    const hours = trimmed === "" ? null : Number(trimmed);
    if (hours !== null && (Number.isNaN(hours) || hours < 0)) return;
    setActionError(null);
    const { error } = await supabase.rpc("set_quote_approved_driver_hours" as never, { p_quote_id: quoteId, p_hours: hours } as never);
    if (error) { setActionError(friendlyError(error.message)); return; }
    await handleEstimate(quoteId);
  }

  async function handleToggleFuelWaived(quoteId: string, waived: boolean) {
    setActionError(null);
    const { error } = await supabase.rpc("set_quote_fuel_waived" as never, { p_quote_id: quoteId, p_waived: waived } as never);
    if (error) { setActionError(friendlyError(error.message)); return; }
    await handleEstimate(quoteId);
  }

  async function handleConfirmTrip(quoteId: string, driverId: string, busId: string) {
    setActionBusy("confirm"); setActionError(null);
    const { data, error } = await supabase.rpc("confirm_trip" as never, {
      p_quote_id: quoteId,
      p_driver_id: driverId,
      p_bus_id: busId,
    } as never);
    setActionBusy(null);
    if (error) { setActionError(friendlyError(error.message)); return; }
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
  const tripDate = formatTripDate(ver?.trip_date);

  const canApprove = ["requested", "in_review"].includes(quote.status);
  // Assign a bus/driver once a quote is approved, and crucially after the
  // customer accepts (status becomes 'confirmed') — otherwise the trip gets stuck.
  const canSchedule = quote.status === "approved" || quote.status === "confirmed";
  const isScheduled = quote.status === "scheduled";
  const isCancelled = quote.status === "cancelled";

  // Melody's overrides — sourced from the latest recalculation if there's
  // been one this session, otherwise from the persisted column. Editable
  // regardless of quote status ("anytime, even after approval").
  const currentApprovedHours = estimate?.approved_driver_hours ?? ver?.approved_driver_hours ?? null;
  const currentFuelWaived = estimate?.fuel_waived ?? ver?.fuel_waived ?? false;

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
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${q.cancellation_requested_at && q.status !== "cancelled" ? "bg-amber-100 text-amber-800" : statusStyle[q.status] ?? "bg-slate-100 text-slate-700"}`}>
                  {q.cancellation_requested_at && q.status !== "cancelled" ? "Cancel requested" : STATUS_LABEL[q.status] ?? q.status}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* ── Detail panel ── */}
      <div className="lg:col-span-3 space-y-4">

        {/* Pending cancellation request */}
        {quote.cancellation_requested_at && quote.status !== "cancelled" && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 shadow-soft">
            <div className="text-sm font-semibold text-amber-900">
              ⚠️ Customer asked to cancel this trip
            </div>
            <p className="mt-1 text-sm text-amber-800">
              Requested {new Date(quote.cancellation_requested_at).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}
              {quote.cancellation_reason ? <> — “{quote.cancellation_reason}”</> : null}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {confirmCancelTrip ? (
                <>
                  <Button
                    variant="destructive" size="sm" disabled={actionBusy === "cancel-approve"}
                    onClick={() => handleResolveCancellation(quote.id, true)}
                  >
                    {actionBusy === "cancel-approve" ? "Cancelling…" : "Yes — cancel the trip & email the customer"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setConfirmCancelTrip(false)}>Back</Button>
                </>
              ) : (
                <>
                  <Button variant="destructive" size="sm" onClick={() => setConfirmCancelTrip(true)}>
                    Approve — cancel the trip
                  </Button>
                  <Button
                    variant="outline" size="sm" disabled={actionBusy === "cancel-decline"}
                    onClick={() => handleResolveCancellation(quote.id, false)}
                  >
                    {actionBusy === "cancel-decline" ? "Declining…" : "Decline — keep the booking"}
                  </Button>
                </>
              )}
            </div>
            <p className="mt-2 text-xs text-amber-700">
              Either way the customer gets an email. Declining keeps the trip as-is.
            </p>
          </div>
        )}

        {/* Quote identity strip */}
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
        </div>

        {/* Section 1: Trip details */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          <h4 className="mb-3 text-sm font-semibold text-foreground">Trip details</h4>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <Kv label="School" value={quote.schools?.name ?? "—"} />
            <Kv label="Trip date" value={tripDate} />
            <Kv label="Departure" value={formatTime(ver?.departure_time ?? null)} />
            <Kv label="Return" value={formatTime(ver?.return_time ?? null)} />
            <Kv label="Pickup address" value={ver?.pickup_address || "—"} />
            <Kv label="Destination" value={ver?.destination_name || "—"} />
            <Kv label="Destination address" value={ver?.destination_address || "—"} />
            {ver?.distance_km != null ? (
              <Kv label="Distance (one-way)" value={`${ver.distance_km} km`} />
            ) : (
              <div className="flex items-center rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                ⚠ Distance unavailable — estimate may be inaccurate
              </div>
            )}
            <Kv label="Students" value={ver?.student_count != null ? String(ver.student_count) : "—"} />
            <Kv label="Group size" value={`${ver?.student_count ?? 0} students + ${ver?.adults_count ?? 0} adults`} />
            <Kv label="Bus needed" value={estimate ? `${estimate.bus_count}× ${estimate.bench_count}-passenger bus` : "Calculating…"} />
            <Kv label="Primary contact" value={fmtContact(ver?.contact_primary)} />
          </div>

          {/* Route map — tucked under the distance figure above; onResult also
              backfills distance_km for quotes that don't have it yet. */}
          <RouteMap
            className="mt-3"
            pickup={ver?.pickup_address || quote.schools?.name || ""}
            destination={ver?.destination_address || ver?.destination_name || ""}
            departTime={ver?.departure_time ?? undefined}
            onResult={(r) => {
              if (ver && ver.distance_km == null) {
                supabase.rpc("set_quote_distance_km" as never, { p_quote_id: quote.id, p_distance_km: r.distanceKm } as never);
              }
            }}
          />

          {/* Shown only when they have real content */}
          {ver?.grade_breakdown && ver.grade_breakdown.filter((g) => g.grade || g.count).length > 0 && (
            <div className="mt-3">
              <Kv
                label="Grade breakdown"
                value={ver.grade_breakdown.filter((g) => g.grade || g.count).map((g) => `${g.grade || "?"}: ${g.count || "?"}`).join(", ")}
              />
            </div>
          )}
          {!!ver?.adults_count && (
            <div className="mt-3">
              <Kv label="Adults / chaperones" value={String(ver.adults_count)} />
            </div>
          )}
          {fmtContact(ver?.contact_secondary) !== "—" && (
            <div className="mt-3">
              <Kv label="Secondary contact" value={fmtContact(ver?.contact_secondary)} />
            </div>
          )}
          {fmtContact(ver?.contact_day_of) !== "—" && (
            <div className="mt-3">
              <Kv label="Day-of contact" value={fmtContact(ver?.contact_day_of)} />
            </div>
          )}
          {ver?.special_requests && (
            <div className="mt-3 rounded-xl border border-dashed border-border bg-surface p-3 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Special requests: </span>{ver.special_requests}
            </div>
          )}
          {ver?.driver_preference && (
            <div className="mt-3 rounded-xl border border-primary/30 bg-primary/5 p-3 text-xs text-foreground">
              <span className="font-semibold">Requested driver: </span>{ver.driver_preference}
              <span className="text-muted-foreground"> — honour if available on the trip date; otherwise contact the customer.</span>
            </div>
          )}
        </div>

        {/* Section 2: Price — clean, only what the customer sees */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          <h4 className="mb-3 text-sm font-semibold text-foreground">Price</h4>
          {estimate ? (
            <div className="grid gap-1.5 text-sm">
              <Kv
                label="Base cost"
                value={`${estimate.bus_count} × $${estimate.hourly_rate}/hr × ${estimate.billable_hours}h = ${formatMoney(estimate.base_cost)}`}
              />
              <Kv label="Driver time" value={`${estimate.driver_hours_used}h`} />
              <Kv label="Fuel fee" value={estimate.fuel_waived ? "Waived" : formatMoney(estimate.fuel_surcharge)} />
              {estimate.overtime_charge > 0 && (
                <Kv label="Overtime" value={formatMoney(estimate.overtime_charge)} />
              )}
              {estimate.long_distance_charge > 0 && (
                <Kv label={`Long-distance (${estimate.distance_km}km)`} value={formatMoney(estimate.long_distance_charge)} />
              )}
              <Kv label={`GST (${estimate.gst_pct}%)`} value={formatMoney(estimate.gst)} />
              <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 font-semibold">
                <span className="text-xs uppercase tracking-wide text-primary">Total</span>
                <span className="text-sm text-primary">{formatMoney(estimate.total)}</span>
              </div>
            </div>
          ) : (
            <div className="grid gap-2 text-sm">
              <Kv label="Estimated total" value={ver?.total != null ? formatMoney(Number(ver.total)) : "Calculating…"} />
            </div>
          )}
        </div>

        {/* Section 3: Adjust — collapsible, expanded by default. Melody's
            overrides + the pricing-internal working numbers live here. */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          <button onClick={() => setAdjustExpanded((v) => !v)} className="flex w-full items-center justify-between text-left">
            <h4 className="text-sm font-semibold text-foreground">
              Adjust <span className="font-normal text-muted-foreground">(overrides &amp; working numbers)</span>
            </h4>
            <span className="text-xs text-muted-foreground">{adjustExpanded ? "Hide ▲" : "Show ▼"}</span>
          </button>

          {adjustExpanded && (
            <div className="mt-3 space-y-3">
              <div className="grid gap-3 rounded-xl border border-dashed border-border p-3 sm:grid-cols-2">
                <label className="text-sm">
                  <span className="font-medium text-foreground">Accurate driver time (hrs)</span>
                  <span className="ml-1 text-xs text-muted-foreground">— overrides the system estimate</span>
                  <input
                    key={quote.id}
                    type="number" min={0} step={0.5}
                    disabled={isCancelled}
                    defaultValue={currentApprovedHours ?? ""}
                    placeholder="system estimate"
                    onBlur={(e) => handleSetApprovedHours(quote.id, e.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none ring-ring focus:ring-2 disabled:opacity-50"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    disabled={isCancelled}
                    checked={currentFuelWaived}
                    onChange={(e) => handleToggleFuelWaived(quote.id, e.target.checked)}
                    className="h-4 w-4 rounded border-input"
                  />
                  <span className="font-medium text-foreground">Waive $50 fuel fee</span>
                </label>
              </div>

              {estimate && (
                <div className="grid gap-1.5 text-sm">
                  <Kv label="Per-location reference (informational)" value={`${estimate.reference_driver_hours}h`} />
                  <Kv label="System estimate (flat 1hr buffer)" value={`${estimate.system_driver_hours}h`} />
                  <Kv
                    label="Driver time used for billing"
                    value={`${estimate.driver_hours_used}h ${estimate.approved_driver_hours != null ? "(Melody-approved)" : "(system estimate)"}`}
                  />
                </div>
              )}

              <button
                disabled={estimateBusy || isCancelled}
                onClick={() => handleEstimate(quote.id)}
                className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent/20 disabled:opacity-50"
              >
                {estimateBusy ? "Calculating…" : "Recalculate"}
              </button>
            </div>
          )}
        </div>

        {/* Confirmed trip banner */}
        {confirmedTrip && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <CheckCircle2 className="inline h-4 w-4 mr-1.5" />
            Trip <span className="font-semibold">{confirmedTrip}</span> scheduled successfully.
          </div>
        )}

        {/* Error banner */}
        {actionError && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {actionError}
          </div>
        )}

        {isScheduled && (
          <p className="text-sm text-emerald-700 font-medium">
            <CheckCircle2 className="inline h-4 w-4 mr-1" />
            Trip scheduled — driver and bus assigned.
          </p>
        )}

        {/* Action buttons — context-aware by status */}
        {!isCancelled && (
          <div className="flex flex-wrap gap-2">
            {!isScheduled && canApprove && (
              <button
                disabled={actionBusy === "approve"}
                onClick={() => handleApprove(quote.id)}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {actionBusy === "approve" ? "Pricing & approving…" : "Approve & send price"}
              </button>
            )}
            {!isScheduled && canSchedule && (
              <div className="flex flex-col gap-1">
                <button
                  disabled={assignBusy}
                  onClick={() => handleSuggest(quote.id)}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {assignBusy ? "Loading…" : quote.status === "confirmed" ? "Assign driver & bus →" : "Assign early →"}
                </button>
                {quote.status === "approved" && (
                  <span className="text-[11px] text-amber-700">Waiting for the school to accept the price — they haven't confirmed yet.</span>
                )}
              </div>
            )}
            <button
              onClick={() => { setShowReject(true); setActionError(null); }}
              className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100"
            >
              {quote.status === "confirmed" || quote.status === "scheduled" ? "Cancel booking" : "Reject quote"}
            </button>
          </div>
        )}

        {/* Assignment suggestions panel */}
        {assignment && (
          <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-foreground">
                Available for {assignment.trip_date} · {assignment.headcount} people · {assignment.needed_bench}-passenger bus
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
                        Bus {s.bus_fleet} · {s.bus_bench_count}-passenger{s.phone ? ` · ${s.phone}` : ""}
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
            <h4 className="text-sm font-semibold text-rose-800">
              {quote.status === "confirmed" || quote.status === "scheduled"
                ? `Cancel booking ${quote.quote_number}?`
                : `Reject quote ${quote.quote_number}?`}
            </h4>
            <p className="mt-1 text-xs text-rose-700">
              {quote.status === "scheduled"
                ? "This frees up the booked bus and driver and emails the school that their booking is cancelled."
                : quote.status === "confirmed"
                ? "This cancels the accepted booking and emails the school."
                : "This declines the request and emails the school."}
            </p>
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

function fmtContact(c?: { name?: string; email?: string; phone?: string } | null): string {
  if (!c) return "—";
  const parts = [c.name, c.email, c.phone].filter(Boolean);
  return parts.length ? parts.join(" · ") : "—";
}

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

type ScheduleTrip = {
  id: string;
  trip_number: string;
  trip_date: string;
  departure_time: string | null;
  return_time: string | null;
  destination_name: string | null;
  status: string;
  school: string;
  driver: string | null;
  bus: string | null;
};

function Schedule() {
  const [trips, setTrips] = useState<ScheduleTrip[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("trips")
        .select("id, trip_number, trip_date, departure_time, return_time, destination_name, status, schools(name), drivers(first_name, last_name), buses(fleet_number)")
        .gte("trip_date", addDaysISO(todayISO(), -1))
        .order("trip_date", { ascending: true })
        .order("departure_time", { ascending: true });
      setTrips(
        ((data ?? []) as Array<{
          id: string; trip_number: string; trip_date: string; departure_time: string | null; return_time: string | null;
          destination_name: string | null; status: string;
          schools: { name: string } | null; drivers: { first_name: string; last_name: string } | null; buses: { fleet_number: string } | null;
        }>).map((t) => ({
          id: t.id, trip_number: t.trip_number, trip_date: t.trip_date, departure_time: t.departure_time, return_time: t.return_time,
          destination_name: t.destination_name, status: t.status,
          school: t.schools?.name ?? "Unknown school",
          driver: t.drivers ? `${t.drivers.first_name} ${t.drivers.last_name}` : null,
          bus: t.buses?.fleet_number ?? null,
        })),
      );
      setLoading(false);
    })();
  }, []);

  // Group trips by date.
  const byDate = trips.reduce<Record<string, ScheduleTrip[]>>((acc, t) => {
    (acc[t.trip_date] ??= []).push(t);
    return acc;
  }, {});
  const dates = Object.keys(byDate).sort();

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
        <h3 className="text-sm font-semibold text-foreground">Upcoming trips</h3>
        {loading ? (
          <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
        ) : dates.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-border bg-surface p-4 text-sm text-muted-foreground">
            No trips scheduled yet. Approve a quote and assign a driver &amp; bus in the Quotes tab — it'll appear here.
          </p>
        ) : (
          <div className="mt-4 space-y-5">
            {dates.map((date) => (
              <div key={date}>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary">{formatTripDate(date)}</div>
                <div className="space-y-2">
                  {byDate[date].map((t) => (
                    <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface p-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-foreground">
                          {t.destination_name ?? "Field trip"}
                          <span className="ml-2 text-xs font-normal text-muted-foreground">{t.trip_number}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {t.school} · {formatTime(t.departure_time)}–{formatTime(t.return_time)}
                          {t.driver ? ` · ${t.driver}` : ""}{t.bus ? ` · Bus ${t.bus}` : ""}
                        </div>
                      </div>
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${statusStyle[t.status] ?? "bg-slate-100 text-slate-700"}`}>
                        {STATUS_LABEL[t.status] ?? t.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

type DriverRow = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  trip_type: string;
  air_brake_cert: boolean;
  active: boolean;
};

type BusRow = { id: string; fleet_number: string; bench_count: number; air_brake_req: boolean; active: boolean; notes: string | null };

function Assets() {
  const { session } = useAuth();
  const [drivers, setDrivers]     = useState<DriverRow[]>([]);
  const [driversLoading, setDriversLoading] = useState(true);
  const [buses, setBuses] = useState<BusRow[]>([]);
  const [busesLoading, setBusesLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("buses")
      .select("id, fleet_number, bench_count, air_brake_req, active, notes")
      .order("fleet_number")
      .then(({ data }) => { setBuses((data as BusRow[]) ?? []); setBusesLoading(false); });
  }, []);

  // Invite form state
  const [showInvite, setShowInvite] = useState(false);
  const [inviteFirst, setInviteFirst] = useState("");
  const [inviteLast,  setInviteLast]  = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteBusy,  setInviteBusy]  = useState(false);
  const [inviteMsg,   setInviteMsg]   = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    supabase
      .from("drivers")
      .select("id, first_name, last_name, email, phone, trip_type, air_brake_cert, active")
      .order("last_name")
      .then(({ data }) => { setDrivers(data ?? []); setDriversLoading(false); });
  }, []);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteFirst || !inviteLast || !inviteEmail) return;
    setInviteBusy(true); setInviteMsg(null);

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const res = await fetch(`${supabaseUrl}/functions/v1/invite-driver`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({ email: inviteEmail, first_name: inviteFirst, last_name: inviteLast }),
    });
    const json = await res.json();
    setInviteBusy(false);

    if (!res.ok) {
      setInviteMsg({ ok: false, text: json.error ?? "Invite failed" });
    } else {
      setInviteMsg({ ok: true, text: `Invite sent to ${inviteEmail}. They'll get an email to set their password.` });
      setInviteFirst(""); setInviteLast(""); setInviteEmail("");
      setShowInvite(false);
      // Refresh driver list
      supabase.from("drivers").select("id, first_name, last_name, email, phone, trip_type, air_brake_cert, active")
        .order("last_name").then(({ data }) => setDrivers(data ?? []));
    }
  }

  return (
    <div className="space-y-6">
      {/* Buses — live from DB */}
      <div className="rounded-2xl border border-border bg-card shadow-soft">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h3 className="text-sm font-semibold text-foreground">
            Buses {!busesLoading && `(${buses.length})`}
          </h3>
          <Bus className="h-4 w-4 text-muted-foreground" />
        </div>
        {busesLoading ? (
          <div className="p-4 text-sm text-muted-foreground">Loading fleet…</div>
        ) : buses.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            No buses yet. (Demo fleet is seeded — real fleet replaces it once Curtis provides the bus list.)
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {buses.map((b) => (
              <li key={b.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="text-sm font-semibold text-foreground">{b.fleet_number}</div>
                  <div className="text-xs text-muted-foreground">{b.bench_count}-passenger{b.notes ? ` · ${b.notes}` : ""}</div>
                </div>
                <div className="flex gap-1.5">
                  {b.air_brake_req && (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">Air brake</span>
                  )}
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${b.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>
                    {b.active ? "Active" : "Inactive"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Drivers — live from DB */}
      <div className="rounded-2xl border border-border bg-card shadow-soft">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h3 className="text-sm font-semibold text-foreground">
            Drivers {!driversLoading && `(${drivers.length})`}
          </h3>
          <button
            onClick={() => { setShowInvite((v) => !v); setInviteMsg(null); }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <UserPlus className="h-3.5 w-3.5" />
            Invite driver
          </button>
        </div>

        {/* Invite form */}
        {showInvite && (
          <form onSubmit={handleInvite} className="border-b border-border bg-surface p-4 space-y-3">
            <p className="text-xs text-muted-foreground">
              Enter the driver's details — they'll receive an email to set their own password.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block text-xs">
                <span className="font-medium text-foreground">First name</span>
                <input required value={inviteFirst} onChange={(e) => setInviteFirst(e.target.value)}
                  placeholder="Jane" className="mt-1 w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm outline-none ring-ring focus:ring-2" />
              </label>
              <label className="block text-xs">
                <span className="font-medium text-foreground">Last name</span>
                <input required value={inviteLast} onChange={(e) => setInviteLast(e.target.value)}
                  placeholder="Smith" className="mt-1 w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm outline-none ring-ring focus:ring-2" />
              </label>
              <label className="block text-xs">
                <span className="font-medium text-foreground">Email</span>
                <input required type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="jane@driver.ca" className="mt-1 w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm outline-none ring-ring focus:ring-2" />
              </label>
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={inviteBusy}
                className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
                {inviteBusy ? "Sending…" : "Send invite"}
              </button>
              <button type="button" onClick={() => setShowInvite(false)}
                className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground">
                Cancel
              </button>
            </div>
            {inviteMsg && (
              <p className={`text-xs rounded-lg px-3 py-2 ${inviteMsg.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>
                {inviteMsg.text}
              </p>
            )}
          </form>
        )}

        {inviteMsg?.ok && !showInvite && (
          <div className="border-b border-border bg-emerald-50 px-4 py-2 text-xs text-emerald-800">
            <CheckCircle2 className="inline h-3.5 w-3.5 mr-1" />{inviteMsg.text}
          </div>
        )}

        {driversLoading ? (
          <div className="p-4 text-sm text-muted-foreground">Loading drivers…</div>
        ) : drivers.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">No drivers yet — use the invite button to add them.</div>
        ) : (
          <ul className="divide-y divide-border">
            {drivers.map((d) => (
              <li key={d.id} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-foreground">{d.first_name} {d.last_name}</div>
                  <div className="flex gap-1.5">
                    {d.air_brake_cert && (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">Air brake</span>
                    )}
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${d.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>
                      {d.active ? "Active" : "Inactive"}
                    </span>
                  </div>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {d.email ?? "No email"}{d.phone ? ` · ${d.phone}` : ""} · {d.trip_type.replace("_", " ")}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Availability() {
  const [drivers, setDrivers] = useState<{ id: string; name: string }[]>([]);
  const [avail, setAvail] = useState<Record<string, string>>({}); // `${driverId}|${date}` → status
  const [loading, setLoading] = useState(true);

  // Next 7 days starting today.
  const dates = Array.from({ length: 7 }).map((_, i) => addDaysISO(todayISO(), i));

  useEffect(() => {
    (async () => {
      const { data: ds } = await supabase.from("drivers").select("id, first_name, last_name").eq("active", true).order("last_name");
      const driverList = ((ds ?? []) as Array<{ id: string; first_name: string; last_name: string }>).map((d) => ({ id: d.id, name: `${d.first_name} ${d.last_name}` }));
      setDrivers(driverList);
      const { data: av } = await supabase
        .from("driver_availability")
        .select("driver_id, date, status")
        .gte("date", dates[0])
        .lte("date", dates[dates.length - 1]);
      setAvail(Object.fromEntries(((av ?? []) as Array<{ driver_id: string; date: string; status: string }>).map((r) => [`${r.driver_id}|${r.date}`, r.status])));
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cell: Record<string, { ch: string; cls: string }> = {
    available: { ch: "A", cls: "bg-emerald-100 text-emerald-800" },
    unavailable: { ch: "U", cls: "bg-rose-100 text-rose-800" },
    unknown: { ch: "?", cls: "bg-slate-100 text-slate-700" },
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
      <h3 className="text-sm font-semibold text-foreground">Driver availability</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        A = Available · U = Away · ? = Not set. Drivers set their own availability in the driver portal.
      </p>
      {loading ? (
        <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
      ) : drivers.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No active drivers yet.</p>
      ) : (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="p-2">Driver</th>
                {dates.map((d) => (
                  <th key={d} className="p-2 text-center">{formatTripDate(d, { weekday: "short", day: "numeric" })}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {drivers.map((dr) => (
                <tr key={dr.id}>
                  <td className="p-2 font-medium text-foreground">{dr.name}</td>
                  {dates.map((d) => {
                    const status = avail[`${dr.id}|${d}`] ?? "unknown";
                    const c = cell[status] ?? cell.unknown;
                    return (
                      <td key={d} className="p-2 text-center">
                        <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold ${c.cls}`}>{c.ch}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
          <button disabled className="mt-4 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted-foreground cursor-not-allowed" title="Document generation coming in a future update">
            Coming soon
          </button>
        </div>
      ))}
    </div>
  );
}
