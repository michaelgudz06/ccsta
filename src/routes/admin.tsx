import { createFileRoute, Navigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AppTopBar } from "@/components/AppTopBar";
import { RouteMap } from "@/components/RouteMap";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { dispatchNotifications } from "@/lib/notify";
import { formatTripDate, formatTime, formatMoney, formatTripType, todayISO, addDaysISO } from "@/lib/format";
import { COMPANY } from "@/lib/company";
import {
  Inbox, ClipboardCheck, CalendarDays, Bus, Bell,
  FileText, AlertCircle, CheckCircle2, X, UserCheck, UserPlus,
} from "lucide-react";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: `Admin Console — ${COMPANY.name}` }, { name: "robots", content: "noindex" }] }),
  component: AdminPage,
});

type Tab = "dashboard" | "schedule" | "assets" | "availability" | "documents";

function AdminPage() {
  const { role, loading } = useAuth();
  const [tab, setTab] = useState<Tab>("dashboard");
  // Set when a "Recent quote activity" row is clicked, so QuoteQueue opens
  // straight to that quote instead of defaulting to the newest one. Cleared
  // (set to null) on every other jump (e.g. the stat cards), so a later plain
  // click on the Quotes tab doesn't re-select a stale quote.
  const [pendingQuoteId, setPendingQuoteId] = useState<string | null>(null);
  const jump = (t: Tab, quoteId?: string) => { setTab(t); setPendingQuoteId(quoteId ?? null); };
  if (loading) return null;
  if (role !== "admin") return <Navigate to="/login" />;

  return (
    <div className="min-h-screen bg-surface">
      <AppTopBar />
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-primary">
              ADMIN
            </span>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground">Operations</h1>
          </div>
          <Notifications />
        </div>

        <Tabs tab={tab} setTab={setTab} />

        <div className="mt-6">
          {/* The dashboard IS the quote queue now. The old four stat cards
              (new / in review / trips scheduled / assets out of service) and
              the static "status flow" legend were replaced by the five
              pipeline stages, which carry the same counts but are clickable
              into the actual work. The separate Quotes tab is gone with them. */}
          {tab === "dashboard" && <QuoteQueue initialQuoteId={pendingQuoteId} />}
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
    { id: "dashboard", label: "Quotes" },
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
  trip_type: "two_way" | "one_way" | "shuttle" | "multi_destination" | "multi_trip";
  shuttle_runs: { run_number: number; pickup_time: string; dropoff_time: string }[];
  multi_stops: { stop_number: number; destination_name: string | null; destination_address: string; arrival_time: string; departure_time: string | null }[];
  adults_count: number | null;
  cargo_needed: boolean | null;
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
  billable_trip_hours: number;
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
  // Migration 054: what the system would charge, alongside whichever fields
  // Melody has typed over. `overrides` is null-per-field when not overridden.
  system_base_cost: number;
  system_fuel_surcharge: number;
  system_overtime_charge: number;
  system_long_distance_charge: number;
  overrides: {
    base_cost: number | null;
    fuel: number | null;
    overtime: number | null;
    long_distance: number | null;
  };
  destination_matched: string | null;
};

function QuoteQueue({ initialQuoteId }: { initialQuoteId?: string | null }) {
  const [quotes, setQuotes] = useState<AdminQuoteRow[]>([]);
  const [qLoading, setQLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  // In-progress quote-number edits, keyed by quote id. Absent means "not being
  // edited" and the stored quote.quote_number is shown.
  const [quoteNoEdits, setQuoteNoEdits] = useState<Record<string, string>>({});
  // Per-field save feedback for inline admin edits: "saving" | "saved" | error text.
  const [fieldStatus, setFieldStatus] = useState<Record<string, string>>({});
  // Two-step confirm for permanent deletion, plus a short-lived confirmation note.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletedNote, setDeletedNote] = useState<string | null>(null);
  // Queue organisation: one search box across all sections, plus which
  // sections and which school folders are expanded.
  const [search, setSearch] = useState("");
  // Which pipeline stage is being viewed. Each stage is its own page now, so
  // a growing queue doesn't become an endless scroll.
  const [activeTab, setActiveTab] = useState<string>("new");
  // Exact per-stage totals from the server, independent of what's loaded.
  const [stageCounts, setStageCounts] = useState<Record<string, number>>({});
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchTruncated, setSearchTruncated] = useState(false);
  // Bumped after any action that can change a quote's status, to refresh
  // counts and the current page without a full remount.
  const [countsNonce, setCountsNonce] = useState(0);
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});

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

  // Assignment panel
  const [assignment, setAssignment] = useState<AssignmentResult | null>(null);
  const [assignBusy, setAssignBusy] = useState(false);

  // Estimate breakdown
  const [estimate, setEstimate] = useState<EstimateBreakdown | null>(null);
  const [estimateBusy, setEstimateBusy] = useState(false);

  // ── Loading, per stage ───────────────────────────────────────────────
  //
  // Was a single fetch of the 50 most recent quotes, filtered client-side into
  // stages. Two problems as volume grows: quote 51 onward silently disappeared
  // from the UI entirely, and the stage counts were computed from those 50, so
  // they would under-report without saying so. A wrong count is worse than a
  // short list.
  //
  // Now: counts come from the server (exact, whatever the total), and only the
  // open stage's rows are fetched, a page at a time.
  const PAGE_SIZE = 25;
  const SEARCH_CAP = 200;

  /** Attach version, shuttle-run and stop detail to a page of quote rows. */
  const hydrate = useCallback(async (rows: any[]): Promise<AdminQuoteRow[]> => {
    const versionIds = rows.map((r) => r.current_version_id).filter(Boolean) as string[];
    let versionMap: Record<string, AdminVersionDetail> = {};
    if (versionIds.length > 0) {
      const { data: versions } = await supabase
        .from("quote_versions")
        .select("id, trip_date, student_count, adults_count, destination_name, destination_address, pickup_address, total, departure_time, return_time, trip_type, cargo_needed, special_requests, driver_preference, distance_km, approved_driver_hours, system_driver_hours, fuel_waived, contact_primary, contact_secondary, contact_day_of, grade_breakdown")
        .in("id", versionIds);
      const { data: runs } = await supabase
        .from("quote_shuttle_runs")
        .select("quote_version_id, run_number, pickup_time, dropoff_time")
        .in("quote_version_id", versionIds)
        .order("run_number", { ascending: true });
      const runsByVersion: Record<string, { run_number: number; pickup_time: string; dropoff_time: string }[]> = {};
      for (const r of runs ?? []) (runsByVersion[r.quote_version_id] ??= []).push(r);
      const { data: stops } = await supabase
        .from("quote_multi_stops")
        .select("quote_version_id, stop_number, destination_name, destination_address, arrival_time, departure_time")
        .in("quote_version_id", versionIds)
        .order("stop_number", { ascending: true });
      const stopsByVersion: Record<string, { stop_number: number; destination_name: string | null; destination_address: string; arrival_time: string; departure_time: string | null }[]> = {};
      for (const st of stops ?? []) (stopsByVersion[st.quote_version_id] ??= []).push(st);
      versionMap = Object.fromEntries(
        (versions ?? []).map((v: any) => [v.id, { ...v, shuttle_runs: runsByVersion[v.id] ?? [], multi_stops: stopsByVersion[v.id] ?? [] }]),
      );
    }
    return rows.map((r) => ({
      ...r,
      quote_versions: r.current_version_id ? (versionMap[r.current_version_id] ?? null) : null,
    })) as AdminQuoteRow[];
  }, []);

  const QUOTE_COLUMNS =
    "id, quote_number, status, created_at, current_version_id, cancellation_requested_at, cancellation_reason, schools(name)";

  /** Exact per-stage counts, straight from the server. */
  const loadCounts = useCallback(async () => {
    const entries = await Promise.all(
      QUOTE_SECTIONS.map(async (section) => {
        const { count } = await supabase
          .from("quotes")
          .select("id", { count: "exact", head: true })
          .in("status", section.statuses);
        return [section.key, count ?? 0] as const;
      }),
    );
    setStageCounts(Object.fromEntries(entries));
  }, []);

  /** One page of a stage, newest first. `append` keeps what's already shown. */
  const loadStage = useCallback(async (statuses: QuoteStatus[], offset: number, append: boolean) => {
    setQLoading(!append);
    setLoadingMore(append);
    const { data: rows } = await supabase
      .from("quotes")
      .select(QUOTE_COLUMNS)
      .in("status", statuses)
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    const page = await hydrate(rows ?? []);
    setQuotes((prev) => (append ? [...prev, ...page] : page));
    setHasMore((rows ?? []).length === PAGE_SIZE);
    setQLoading(false);
    setLoadingMore(false);
  }, [hydrate]);

  /**
   * Server-side search, so it reaches every quote rather than only the page on
   * screen. School name lives on a joined table and destination on the version
   * row, so those are resolved to ids first and folded into one `.or()`.
   */
  const runSearch = useCallback(async (term: string) => {
    setQLoading(true);
    const like = `%${term}%`;
    const [{ data: schoolRows }, { data: verRows }] = await Promise.all([
      supabase.from("schools").select("id").ilike("name", like),
      supabase.from("quote_versions").select("quote_id").or(`destination_name.ilike.${like},destination_address.ilike.${like}`),
    ]);
    const ors = [`quote_number.ilike.${like}`];
    const schoolIds = (schoolRows ?? []).map((r: any) => r.id);
    if (schoolIds.length) ors.push(`school_id.in.(${schoolIds.join(",")})`);
    const quoteIds = [...new Set((verRows ?? []).map((r: any) => r.quote_id).filter(Boolean))];
    if (quoteIds.length) ors.push(`id.in.(${quoteIds.join(",")})`);

    const { data: rows } = await supabase
      .from("quotes")
      .select(QUOTE_COLUMNS)
      .or(ors.join(","))
      .order("created_at", { ascending: false })
      .limit(SEARCH_CAP);
    const results = await hydrate(rows ?? []);
    setQuotes(results);
    setSearchTruncated((rows ?? []).length === SEARCH_CAP);
    setHasMore(false);
    setQLoading(false);
  }, [hydrate]);

  // Counts once on mount, then whenever a status might have changed.
  useEffect(() => { loadCounts(); }, [loadCounts, countsNonce]);

  // Debounced: search when there's a term, otherwise page the active stage.
  useEffect(() => {
    const term = search.trim();
    const section = QUOTE_SECTIONS.find((x) => x.key === activeTab) ?? QUOTE_SECTIONS[0];
    const t = setTimeout(() => {
      setSearchTruncated(false);
      if (term) runSearch(term);
      else loadStage(section.statuses, 0, false);
    }, term ? 300 : 0);
    return () => clearTimeout(t);
  }, [search, activeTab, runSearch, loadStage, countsNonce]);

  // Deep-link from a notification: land on that quote, in its own stage.
  useEffect(() => {
    if (!initialQuoteId) return;
    (async () => {
      const { data } = await supabase.from("quotes").select("id, status").eq("id", initialQuoteId).maybeSingle();
      if (!data) return;
      const section = QUOTE_SECTIONS.find((sec) => (sec.statuses as string[]).includes((data as any).status));
      if (section) setActiveTab(section.key);
      setSelected(initialQuoteId);
    })();
  }, [initialQuoteId]);

  // Clear panels when switching quotes, and auto-calculate the price so Melody
  // sees it the moment she opens a quote (no separate "Calculate" click).
  useEffect(() => {
    setAssignment(null);
    setConfirmedTrip(null);
    setActionError(null);
    setEstimate(null);
    setConfirmCancelTrip(false);
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
    // p_invoice_number is vestigial: as of migration 057a, approve_quote no
    // longer creates an invoice at all. Invoices are the post-trip bill and
    // will be generated when that flow is built. The parameter is kept in the
    // signature so older callers don't break.
    const { data, error } = await supabase.rpc("approve_quote" as never, {
      p_quote_id: quoteId,
      p_invoice_number: null,
    } as never);
    setActionBusy(null);
    if (error) { setActionError(friendlyError(error.message)); return; }
    void data;
    setQuotes((prev) => prev.map((q) => q.id === quoteId ? { ...q, status: "approved" } : q));
    // The quote just left this stage — refresh the counts and the open page.
    setCountsNonce((n) => n + 1);
    dispatchNotifications();
  }

  // Persist an edited quote number. quotes.quote_number is UNIQUE, so a
  // collision is a real possibility and is reported plainly rather than as a
  // raw Postgres error.
  async function handleSaveQuoteNumber(quoteId: string) {
    const stored = quotes.find((q) => q.id === quoteId)?.quote_number ?? "";
    const next = (quoteNoEdits[quoteId] ?? stored).trim();
    const revert = () => setQuoteNoEdits((m) => {
      const { [quoteId]: _drop, ...rest } = m;
      return rest;
    });
    if (next === stored) { revert(); return; }
    if (!next) {
      setFieldStatus((s) => ({ ...s, [`qno-${quoteId}`]: "Quote number can't be blank." }));
      revert();
      return;
    }
    setFieldStatus((s) => ({ ...s, [`qno-${quoteId}`]: "saving" }));
    const { error } = await supabase
      .from("quotes")
      .update({ quote_number: next })
      .eq("id", quoteId);
    if (error) {
      const msg = error.code === "23505"
        ? "Another quote already uses that number."
        : friendlyError(error.message);
      setFieldStatus((s) => ({ ...s, [`qno-${quoteId}`]: msg }));
      revert();
      return;
    }
    setQuotes((prev) => prev.map((q) => q.id === quoteId ? { ...q, quote_number: next } : q));
    revert();
    setFieldStatus((s) => ({ ...s, [`qno-${quoteId}`]: "saved" }));
  }

  // Shared key handling for inline admin edits: Enter commits (via blur),
  // Escape abandons the edit and restores the last saved value.
  function inlineEditKeys(onCancel?: () => void) {
    return (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
      else if (e.key === "Escape") { e.preventDefault(); onCancel?.(); e.currentTarget.blur(); }
    };
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
  // The version id the admin is currently looking at. Passed to pricing
  // writes so the server can refuse if the customer edited the quote in the
  // meantime, instead of silently applying the change to their new version.
  function expectedVersionId(quoteId: string): string | null {
    return quotes.find((q) => q.id === quoteId)?.current_version_id ?? null;
  }

  async function handleSetApprovedHours(quoteId: string, raw: string) {
    const trimmed = raw.trim();
    const hours = trimmed === "" ? null : Number(trimmed);
    if (hours !== null && (Number.isNaN(hours) || hours < 0)) return;
    setActionError(null);
    const { error } = await supabase.rpc("set_quote_approved_driver_hours" as never, {
      p_quote_id: quoteId,
      p_hours: hours,
      p_expected_version_id: expectedVersionId(quoteId),
    } as never);
    if (error) { setActionError(friendlyError(error.message)); return; }
    await handleEstimate(quoteId);
  }

  // Permanently remove a quote. The server refuses if it has a non-draft
  // invoice or a completed trip, and snapshots everything to
  // deleted_quote_log first — so this can clear test data but can't erase a
  // real booking or a sent invoice.
  async function handleDeleteQuote(quoteId: string) {
    setActionBusy("delete"); setActionError(null);
    const { data, error } = await supabase.rpc("delete_quote" as never, { p_quote_id: quoteId } as never);
    setActionBusy(null);
    if (error) { setActionError(friendlyError(error.message)); setConfirmDelete(false); return; }
    const result = data as { quote_number: string };
    setConfirmDelete(false);
    setQuotes((prev) => {
      const next = prev.filter((q) => q.id !== quoteId);
      // Return to the stage list rather than jumping into whichever quote
      // happens to be next — the one you were looking at no longer exists.
      setSelected(null);
      return next;
    });
    setCountsNonce((n) => n + 1);
    setDeletedNote(`${result.quote_number} deleted.`);
  }

  // Type over one price component, or pass null to clear the override and
  // fall back to the system value. Recalculating afterwards re-derives
  // subtotal/GST/total — those are never overridable, so the invoice can't
  // disagree with its own line items.
  async function handleSetPriceOverride(quoteId: string, field: string, value: number | null) {
    setActionError(null);
    const { error } = await supabase.rpc("set_quote_price_override" as never, {
      p_quote_id: quoteId,
      p_field: field,
      p_value: value,
      p_expected_version_id: expectedVersionId(quoteId),
    } as never);
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
  // `quotes` already holds exactly the right rows -- either one page of the
  // open stage, or the server-side search results. Filtering again here would
  // just re-apply a narrower version of what the server already did.
  const searchTerm = search.trim().toLowerCase();
  const matchedQuotes = quotes;

  const quoteNoValue = quoteNoEdits[quote.id] ?? quote.quote_number;
  const quoteNoStatus = fieldStatus[`qno-${quote.id}`] ?? "";
  const tripDate = formatTripDate(ver?.trip_date);

  const canApprove = ["requested", "in_review"].includes(quote.status);
  // Assign a bus/driver once a quote is approved, and crucially after the
  // customer accepts (status becomes 'confirmed') — otherwise the trip gets stuck.
  const canSchedule = quote.status === "approved" || quote.status === "confirmed";
  const isScheduled = quote.status === "scheduled";
  const isCancelled = quote.status === "cancelled";

  // Passenger breakdown — aggregated the same way calculate_estimate classifies
  // young (K-4) vs older riders, so it works for both the new calculator's two
  // fixed buckets and any older quote's per-grade-row data.
  const K4_GRADES = ["k", "1", "2", "3", "4"];
  const gradeRows = ver?.grade_breakdown ?? [];
  const k4Total = gradeRows
    .filter((g) => K4_GRADES.includes((g.grade ?? "").toLowerCase().trim()))
    .reduce((sum, g) => sum + (parseInt(g.count ?? "0", 10) || 0), 0);
  const grade5PlusTotal = gradeRows
    .filter((g) => g.grade && !K4_GRADES.includes(g.grade.toLowerCase().trim()))
    .reduce((sum, g) => sum + (parseInt(g.count ?? "0", 10) || 0), 0);

  const activeSection = QUOTE_SECTIONS.find((x) => x.key === activeTab) ?? QUOTE_SECTIONS[0];
  const tabRows = matchedQuotes.filter((q) => (activeSection.statuses as string[]).includes(q.status));

  return (
    <div className="space-y-4">
      {/* ── Pipeline tabs ──
          Was a sidebar list of every quote. As volume grows that becomes an
          endless scroll, so each stage is now its own page: pick a tab, see
          only those quotes. Counts follow the search, so you can tell which
          stage a match is hiding in. */}
      {/* Search sits top-right, sized to itself — a full-width bar implied the
          page was mostly about searching, when it's mostly about the stages. */}
      <div className="flex justify-end">
        <div className="w-full sm:w-80">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search quote #, school, or destination…"
            className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm shadow-soft outline-none ring-ring focus:ring-2"
          />
          {search.trim() && (
            <div className="mt-1 text-right text-xs text-muted-foreground">
              {qLoading ? "searching…" : `${quotes.length} match${quotes.length === 1 ? "" : "es"}`}
              {searchTruncated && ` (first ${quotes.length}, refine to narrow)`}
              <button onClick={() => setSearch("")} className="ml-2 font-semibold underline">clear</button>
            </div>
          )}
        </div>
      </div>

      {/* The five stages, as big targets. Count first and large — it's the
          number Melody scans for; the label explains it. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {QUOTE_SECTIONS.map((section) => {
          // Not searching: the exact server-side total for the stage, so the
          // number is right however many quotes exist. Searching: how many of
          // the matches fall in this stage.
          const count = searchTerm
            ? quotes.filter((q) => (section.statuses as string[]).includes(q.status)).length
            : stageCounts[section.key] ?? 0;
          const active = section.key === activeSection.key;
          return (
            <button
              key={section.key}
              onClick={() => { setActiveTab(section.key); setSelected(null); }}
              className={`rounded-2xl border p-4 text-left shadow-soft transition-all ${
                active
                  ? "border-primary bg-primary text-primary-foreground shadow-elevated"
                  : "border-border bg-card text-foreground hover:border-primary/40 hover:shadow-elevated"
              }`}
            >
              <span className="block text-3xl font-bold leading-none">{count}</span>
              <span className="mt-2 block text-sm font-semibold leading-tight">{section.tabLabel}</span>
              <span className={`mt-0.5 block text-[11px] leading-tight ${
                active ? "text-primary-foreground/75" : "text-muted-foreground"
              }`}>
                {section.cardHint}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Either the list for this stage, or the quote you picked ── */}
      {!selected ? (
        <div className="rounded-2xl border border-border bg-card shadow-soft">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold text-foreground">{activeSection.label}</h3>
          </div>
          {tabRows.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              {search.trim() ? "No matches in this stage." : activeSection.emptyHint}
            </div>
          ) : activeSection.groupBySchool ? (
            <div className="divide-y divide-border">
              {groupBySchool(tabRows).map(([schoolName, schoolRows]) => {
                const folderKey = `${activeSection.key}:${schoolName}`;
                const folderOpen = searchTerm ? true : openFolders[folderKey] ?? false;
                return (
                  <div key={folderKey}>
                    <button
                      onClick={() => setOpenFolders((f) => ({ ...f, [folderKey]: !folderOpen }))}
                      className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-surface"
                    >
                      <span className="font-semibold text-foreground">
                        {folderOpen ? "\u{1F4C2}" : "\u{1F4C1}"} {schoolName}
                      </span>
                      <span className="text-xs text-muted-foreground">{schoolRows.length}</span>
                    </button>
                    {folderOpen && schoolRows.map((q) => (
                      <QuoteRow key={q.id} q={q} selected={false} onSelect={() => setSelected(q.id)} indent />
                    ))}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {tabRows.map((q) => (
                <QuoteRow key={q.id} q={q} selected={false} onSelect={() => setSelected(q.id)} />
              ))}
            </div>
          )}

          {/* Only when there's genuinely another page. The old code silently
              stopped at 50 with no indication anything was missing. */}
          {!searchTerm && hasMore && (
            <div className="border-t border-border p-3 text-center">
              <button
                disabled={loadingMore}
                onClick={() => loadStage(activeSection.statuses, quotes.length, true)}
                className="rounded-lg border border-border bg-surface px-4 py-2 text-xs font-semibold text-foreground hover:bg-accent/20 disabled:opacity-50"
              >
                {loadingMore ? "Loading…" : `Load older (${Math.max(0, (stageCounts[activeSection.key] ?? 0) - quotes.length)} more)`}
              </button>
            </div>
          )}
        </div>
      ) : (
      <div className="space-y-4">
        <button
          onClick={() => setSelected(null)}
          className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-surface"
        >
          &larr; Back to {activeSection.tabLabel}
        </button>

        {/* ── Detail panel ── */}

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
              <label className="block">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">Quote # (editable)</span>
                <input
                  value={quoteNoValue}
                  onChange={(e) => {
                    setQuoteNoEdits((m) => ({ ...m, [quote.id]: e.target.value }));
                    setFieldStatus((s) => ({ ...s, [`qno-${quote.id}`]: "" }));
                  }}
                  onBlur={() => handleSaveQuoteNumber(quote.id)}
                  onKeyDown={inlineEditKeys(() =>
                    setQuoteNoEdits((m) => {
                      const { [quote.id]: _drop, ...rest } = m;
                      return rest;
                    }),
                  )}
                  className="mt-0.5 block w-48 rounded-lg border border-input bg-background px-2.5 py-1 text-xl font-bold text-foreground shadow-sm outline-none ring-ring focus:ring-2"
                />
              </label>
              <span className="block h-4 text-[11px]">
                {quoteNoStatus === "saving" ? (
                  <span className="text-muted-foreground">Saving…</span>
                ) : quoteNoStatus === "saved" ? (
                  <span className="text-emerald-600">Saved</span>
                ) : quoteNoStatus ? (
                  <span className="text-destructive">{quoteNoStatus}</span>
                ) : (
                  // The customer already has the original number in their
                  // confirmation email; changing it here doesn't rewrite that.
                  <span className="text-muted-foreground">Won't update emails already sent</span>
                )}
              </span>
              <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusStyle[quote.status] ?? ""}`}>
                {STATUS_LABEL[quote.status] ?? quote.status}
              </span>
              <div className="mt-1.5 text-xs text-muted-foreground">
                Submitted{" "}
                {new Date(quote.created_at).toLocaleDateString("en-CA", {
                  weekday: "short", month: "short", day: "numeric", year: "numeric",
                })}
                {" · "}
                {new Date(quote.created_at).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" })}
              </div>
            </div>
          </div>
        </div>

        {/* Section 1: Trip details */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          {/* The organization is the heading of the sheet, not another box —
              it's the one thing that identifies whose trip this is. */}
          <h3 className="text-lg font-bold leading-tight text-foreground">
            {quote.schools?.name ?? "Unknown organization"}
          </h3>

          {/* Four at-a-glance facts. Deliberately just four: date, who's
              going, what's needed, what shape of trip. */}
          <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Stat label="Trip date" value={tripDate} />
            <Stat label="Group size" value={`${ver?.student_count ?? 0} students + ${ver?.adults_count ?? 0} adults`} />
            <Stat
              label="Bus needed"
              // Bus size comes from the estimate, which only auto-runs for
              // quotes with no price yet. Saying "Calculating…" when nothing
              // is running was misleading — it never resolved on its own.
              value={
                estimate ? `${estimate.bus_count} × ${estimate.bench_count}-passenger`
                : estimateBusy ? "Calculating…"
                : "Press Recalculate"
              }
            />
            <Stat label="Trip type" value={formatTripType(ver?.trip_type)} />
          </div>

          {/* The journey, read top to bottom in the order it happens: leave
              from here at this time, come back from there at that time. The
              old layout scattered these across a two-column grid, so the
              times and the places they belonged to never lined up. */}
          <div className="mt-4 space-y-3 border-l-2 border-border pl-4">
            <Leg
              time={formatTime(ver?.departure_time ?? null)}
              timeLabel={ver?.trip_type === "shuttle" || ver?.trip_type === "multi_destination" ? "Bus engaged from" : "Departure"}
              place={quote.schools?.name ?? null}
              address={ver?.pickup_address || null}
              placeLabel="Pickup"
            />
            {ver?.trip_type === "multi_destination" ? (
              <Leg
                time={formatTime(ver?.return_time ?? null)}
                timeLabel="Bus released"
                place={`${ver.multi_stops.length} stop${ver.multi_stops.length === 1 ? "" : "s"} — listed below`}
                address={null}
                placeLabel="Destinations"
              />
            ) : (
              <Leg
                time={formatTime(ver?.return_time ?? null)}
                timeLabel={
                  ver?.trip_type === "one_way" ? "Drop-off"
                  : ver?.trip_type === "shuttle" ? "Bus released"
                  : "Return pickup"
                }
                place={ver?.destination_name || null}
                address={ver?.destination_address || null}
                placeLabel="Destination"
              />
            )}
          </div>

          <div className="mt-3">
            {ver?.distance_km != null ? (
              <div className="text-xs text-muted-foreground">
                One-way distance: <span className="font-medium text-foreground">{ver.distance_km} km</span>
              </div>
            ) : (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                ⚠ Distance unavailable — any long-distance charge may be missing from this estimate
              </div>
            )}
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
                supabase.rpc("set_quote_distance_km" as never, { p_quote_id: quote.id, p_distance_km: r.distanceKm } as never)
                  .then(({ error }) => { if (error) console.error("set_quote_distance_km (admin backfill) failed:", error); });
              }
            }}
          />

          {ver?.trip_type === "shuttle" && ver.shuttle_runs.length > 0 && (
            <div className="mt-3 rounded-xl border border-border bg-surface p-3">
              <div className="mb-1.5 text-xs font-semibold text-foreground">Shuttle runs</div>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {ver.shuttle_runs.map((r) => (
                  <li key={r.run_number}>
                    Run {r.run_number}: {formatTime(r.pickup_time)} → {formatTime(r.dropoff_time)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {ver?.trip_type === "multi_destination" && ver.multi_stops.length > 0 && (
            <div className="mt-3 rounded-xl border border-border bg-surface p-3">
              <div className="mb-1.5 text-xs font-semibold text-foreground">Stops</div>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {ver.multi_stops.map((s) => (
                  <li key={s.stop_number}>
                    Stop {s.stop_number}: {s.destination_name || s.destination_address}
                    {s.destination_name ? ` (${s.destination_address})` : ""} — arrive {formatTime(s.arrival_time)}
                    {s.departure_time ? `, depart ${formatTime(s.departure_time)}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Shown only when they have real content */}
          {(k4Total > 0 || grade5PlusTotal > 0 || !!ver?.adults_count) && (
            <div className="mt-3">
              <Kv
                label="Passenger breakdown"
                value={`K-4: ${k4Total} · Grade 5+: ${grade5PlusTotal} · Adults: ${ver?.adults_count ?? 0}`}
              />
            </div>
          )}
          <div className="mt-3">
            <Kv label="Cargo needed" value={ver?.cargo_needed ? "Yes" : "No"} />
          </div>

          {/* Contacts grouped at the foot of the sheet rather than scattered
              between trip facts — they're who to phone, not what the trip is. */}
          <div className="mt-4 border-t border-border pt-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contact</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Kv label="Primary" value={fmtContact(ver?.contact_primary)} />
              {fmtContact(ver?.contact_secondary) !== "—" && (
                <Kv label="Secondary" value={fmtContact(ver?.contact_secondary)} />
              )}
              <Kv
                label="Day of trip"
                value={fmtContact(ver?.contact_day_of) !== "—" ? fmtContact(ver?.contact_day_of) : "Not provided"}
              />
            </div>
          </div>
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

        {/* Section 2: Price — every component editable in place. Melody's
            typed values survive recalculation; only untouched fields refresh. */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h4 className="text-sm font-semibold text-foreground">Price</h4>
            <button
              disabled={estimateBusy || isCancelled}
              onClick={() => handleEstimate(quote.id)}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent/20 disabled:opacity-50"
            >
              {estimateBusy ? "Calculating…" : "Recalculate"}
            </button>
          </div>
          {estimate ? (
            <div className="grid gap-1.5 text-sm">
              {/* Hours live in one caption instead of being interleaved as
                  rows among the dollar amounts — mixing the two units in a
                  single list was the main thing making this hard to read. */}
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg bg-surface/60 px-3 py-2 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{estimate.billable_hours}h billable</span>
                {" — "}
                {estimate.billable_trip_hours}h trip +
                {/* Driver time was the one override that used to live in the
                    Adjust panel. It's editable here now, in the same place
                    it's displayed, like every other number. */}
                <input
                  key={`dh-${quote.id}-${estimate.driver_hours_used}`}
                  type="number" min={0} step={0.5}
                  disabled={isCancelled}
                  defaultValue={(estimate.billable_hours - estimate.billable_trip_hours).toFixed(1)}
                  title="Driver time — total billable hours minus trip hours"
                  onBlur={(e) => {
                    const raw = e.target.value.trim();
                    if (raw === "") { handleSetApprovedHours(quote.id, ""); return; }
                    const driverPart = Number(raw);
                    if (Number.isNaN(driverPart) || driverPart < 0) return;
                    // approved_driver_hours is TOTAL billable hours, not just
                    // the buffer — add the trip portion back before saving.
                    handleSetApprovedHours(quote.id, String(estimate.billable_trip_hours + driverPart));
                  }}
                  onKeyDown={inlineEditKeys(() => {
                    const el = document.activeElement as HTMLInputElement | null;
                    if (el) el.value = (estimate.billable_hours - estimate.billable_trip_hours).toFixed(1);
                  })}
                  className="w-16 rounded border border-input bg-background px-1.5 py-0.5 text-xs text-foreground outline-none ring-ring focus:ring-2 disabled:opacity-50"
                />
                h driver time
                {estimate.approved_driver_hours != null ? " (manual)" : " (system)"}
                {estimate.billable_trip_hours > estimate.trip_hours && (
                  <> · {estimate.min_hours}h minimum applied to trip time</>
                )}
              </div>
              <PriceRowEditable
                label="Base cost"
                sub={`${estimate.billable_hours}h × ${formatMoney(estimate.hourly_rate)}/hr${estimate.bus_count > 1 ? ` × ${estimate.bus_count} buses` : ""}`}
                disabled={isCancelled}
                effective={estimate.base_cost}
                system={estimate.system_base_cost}
                override={estimate.overrides.base_cost}
                onSave={(v) => handleSetPriceOverride(quote.id, "base_cost", v)}
                rowKey={`base-${quote.id}`}
              />
              <PriceRowEditable
                label="Fuel fee"
                disabled={isCancelled}
                effective={estimate.fuel_surcharge}
                system={estimate.system_fuel_surcharge}
                override={estimate.overrides.fuel}
                onSave={(v) => handleSetPriceOverride(quote.id, "fuel", v)}
                rowKey={`fuel-${quote.id}`}
                // Waive is just "set this component to zero" — one mechanism
                // instead of a separate boolean that could disagree with the
                // typed value.
                action={
                  estimate.fuel_surcharge === 0
                    ? { label: "Un-waive", onClick: () => handleSetPriceOverride(quote.id, "fuel", null) }
                    : { label: "Waive", onClick: () => handleSetPriceOverride(quote.id, "fuel", 0) }
                }
              />
              {/* Overtime and long-distance stay hidden while they're zero AND
                  untouched — showing two permanent $0.00 rows to every quote
                  was noise. They appear as soon as either the system charges
                  them or Melody types one in. */}
              {(estimate.system_overtime_charge > 0 || estimate.overrides.overtime != null) && (
                <PriceRowEditable
                  label="Overtime"
                  disabled={isCancelled}
                  effective={estimate.overtime_charge}
                  system={estimate.system_overtime_charge}
                  override={estimate.overrides.overtime}
                  onSave={(v) => handleSetPriceOverride(quote.id, "overtime", v)}
                  rowKey={`ot-${quote.id}`}
                />
              )}
              {(estimate.system_long_distance_charge > 0 || estimate.overrides.long_distance != null) && (
                <PriceRowEditable
                  label="Long-distance"
                  sub={`${estimate.distance_km} km`}
                  disabled={isCancelled}
                  effective={estimate.long_distance_charge}
                  system={estimate.system_long_distance_charge}
                  override={estimate.overrides.long_distance}
                  onSave={(v) => handleSetPriceOverride(quote.id, "long_distance", v)}
                  rowKey={`ld-${quote.id}`}
                />
              )}
              {/* Subtotal, GST and Total are derived, never editable — that's
                  what keeps GST an honest calculation on a real subtotal. */}
              <Kv label="Subtotal" value={formatMoney(estimate.subtotal)} />
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
                  <span className="text-[11px] text-amber-700">Waiting for the organization to accept the price — they haven't confirmed yet.</span>
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

        {/* Permanent deletion — deliberately separated from the reject/cancel
            actions above, which are reversible status changes. This one isn't. */}
        <div className="rounded-2xl border border-dashed border-rose-200 bg-rose-50/40 p-4">
          {!confirmDelete ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">Delete permanently.</span>{" "}
                Removes the quote, its versions and any draft invoice. Blocked if an invoice has
                been sent or a trip was completed.
              </div>
              <button
                onClick={() => { setConfirmDelete(true); setActionError(null); }}
                className="shrink-0 rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
              >
                Delete quote
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-rose-800">
                Permanently delete <span className="font-semibold">{quote.quote_number}</span>? This can't be undone
                from the app — a snapshot is kept in the deletion log for recovery by hand.
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground"
                >
                  Cancel
                </button>
                <button
                  disabled={actionBusy === "delete"}
                  onClick={() => handleDeleteQuote(quote.id)}
                  className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  {actionBusy === "delete" ? "Deleting…" : "Yes, delete"}
                </button>
              </div>
            </div>
          )}
        </div>

        {deletedNote && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {deletedNote}
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
                ? "This frees up the booked bus and driver and emails the organization that their booking is cancelled."
                : quote.status === "confirmed"
                ? "This cancels the accepted booking and emails the organization."
                : "This declines the request and emails the organization."}
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
      )}
    </div>
  );
}

function fmtContact(c?: { name?: string; email?: string; phone?: string } | null): string {
  if (!c) return "—";
  const parts = [c.name, c.email, c.phone].filter(Boolean);
  return parts.length ? parts.join(" · ") : "—";
}

/**
 * One editable money row in the admin price breakdown.
 *
 * `effective` is what's actually charged, `system` is what the pricing
 * function would charge on its own, and `override` is non-null only when
 * Melody has typed a value in. Clearing the box restores the system value —
 * that's the only way back, which is why the reset affordance is always
 * visible while an override is active.
 */
function PriceRowEditable({
  label, sub, effective, system, override, onSave, disabled, rowKey, action,
}: {
  label: string;
  sub?: string;
  effective: number;
  system: number;
  override: number | null;
  onSave: (value: number | null) => void;
  disabled?: boolean;
  // Remounts the uncontrolled input when the underlying number changes, so a
  // recalculation is reflected instead of leaving a stale value on screen.
  rowKey: string;
  action?: { label: string; onClick: () => void };
}) {
  const isOverridden = override != null;
  const commit = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === "") { onSave(null); return; }          // cleared -> system value
    const n = Number(trimmed.replace(/[$,]/g, ""));
    if (Number.isNaN(n) || n < 0) return;
    if (n === effective) return;                            // no change
    onSave(n);
  };
  return (
    <div className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2 ${
      isOverridden ? "border-amber-300 bg-amber-50/60" : "border-border bg-surface"
    }`}>
      <span className="min-w-0 text-xs uppercase tracking-wide text-muted-foreground">
        {label}
        {(sub || isOverridden) && (
          <span className="mt-0.5 block normal-case tracking-normal text-[11px] text-muted-foreground/70">
            {isOverridden ? `Manually set · system says ${formatMoney(system)}` : sub}
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {isOverridden && (
          <button
            onClick={() => onSave(null)}
            disabled={disabled}
            className="rounded border border-border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-surface disabled:opacity-50"
          >
            Reset
          </button>
        )}
        {action && (
          <button
            onClick={action.onClick}
            disabled={disabled}
            className="rounded border border-border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-surface disabled:opacity-50"
          >
            {action.label}
          </button>
        )}
        <input
          key={`${rowKey}-${effective}`}
          defaultValue={effective.toFixed(2)}
          disabled={disabled}
          inputMode="decimal"
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
            else if (e.key === "Escape") {
              e.preventDefault();
              e.currentTarget.value = effective.toFixed(2);
              e.currentTarget.blur();
            }
          }}
          className="w-24 rounded border border-input bg-background px-2 py-0.5 text-right text-sm font-medium text-foreground outline-none ring-ring focus:ring-2 disabled:opacity-50"
        />
      </span>
    </div>
  );
}

/**
 * The queue, filed into the stages a quote actually moves through.
 *
 * These group the eight `quote_status` values into the four stages Melody
 * works in, plus a collapsed Cancelled section so nothing silently vanishes.
 *
 * Note "Approved" deliberately covers approved + confirmed + scheduled:
 * Melody confirms and schedules in one action, so splitting them would create
 * a box that's empty in practice. Each row still shows its own badge, so an
 * unaccepted price is distinguishable from a booked bus.
 *
 * IMPORTANT: nothing in the system currently sets a quote to `completed` or
 * `invoiced` — those transitions don't exist yet (see PLAN.md Phase 6). Those
 * two sections will stay empty until the "mark trip completed" and "send
 * invoice" steps are built. The empty hints say so rather than looking broken.
 */
/** Mirrors the quote_status enum, so `.in("status", …)` typechecks. */
type QuoteStatus =
  | "requested" | "in_review" | "approved" | "confirmed"
  | "scheduled" | "completed" | "invoiced" | "cancelled";

const QUOTE_SECTIONS: {
  key: string;
  /** Short label for the stage button. */
  tabLabel: string;
  /** One-line explanation under the count on the stage button. */
  cardHint: string;
  /** Fuller heading shown above the list once a tab is open. */
  label: string;
  statuses: QuoteStatus[];
  groupBySchool?: boolean;
  emptyHint: string;
}[] = [
  {
    key: "new",
    cardHint: "Waiting on review",
    tabLabel: "New",
    label: "New — needs review",
    statuses: ["requested", "in_review"],
    emptyHint: "Nothing waiting for review.",
  },
  {
    key: "approved",
    cardHint: "Priced, trip upcoming",
    tabLabel: "Approved",
    label: "Approved — awaiting trip date",
    statuses: ["approved", "confirmed", "scheduled"],
    emptyHint: "No priced quotes waiting on a trip date.",
  },
  {
    key: "completed",
    cardHint: "Trip done, not invoiced",
    tabLabel: "Completed",
    label: "Completed — ready to invoice",
    statuses: ["completed"],
    emptyHint: "Nothing here yet — marking a trip completed isn't built yet.",
  },
  {
    key: "invoiced",
    cardHint: "Awaiting payment",
    tabLabel: "Invoiced",
    label: "Invoiced — awaiting payment",
    statuses: ["invoiced"],
    groupBySchool: true,
    emptyHint: "Nothing here yet — sending an invoice isn't built yet.",
  },
  {
    key: "cancelled",
    cardHint: "No longer going ahead",
    tabLabel: "Cancelled",
    label: "Cancelled",
    statuses: ["cancelled"],
    emptyHint: "No cancelled quotes.",
  },
];

/** Group rows by organization name, alphabetically — the invoiced "folders". */
function groupBySchool(rows: AdminQuoteRow[]): [string, AdminQuoteRow[]][] {
  const map = new Map<string, AdminQuoteRow[]>();
  for (const q of rows) {
    const name = q.schools?.name ?? "Unknown organization";
    const list = map.get(name);
    if (list) list.push(q);
    else map.set(name, [q]);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/** One row in the queue. Extracted so folders and flat sections share it. */
function QuoteRow({
  q, selected, onSelect, indent,
}: {
  q: AdminQuoteRow;
  selected: boolean;
  onSelect: () => void;
  indent?: boolean;
}) {
  const cancelRequested = !!q.cancellation_requested_at && q.status !== "cancelled";
  return (
    <button
      onClick={onSelect}
      className={`flex w-full items-center justify-between py-2.5 pr-4 text-left text-sm transition-colors ${
        indent ? "pl-9" : "pl-4"
      } ${selected ? "bg-primary/5" : "hover:bg-surface"}`}
    >
      <div className="min-w-0">
        <div className="font-semibold text-foreground">{q.quote_number}</div>
        <div className="truncate text-xs text-muted-foreground">
          {q.schools?.name ?? "Unknown organization"}
          {q.quote_versions?.destination_name ? ` → ${q.quote_versions.destination_name}` : ""}
        </div>
        <div className="text-[11px] text-muted-foreground/70">
          {/* trip_date is a bare "YYYY-MM-DD" and must go through
              formatTripDate, or it renders a day early in Pacific time.
              created_at is a full timestamp, so it's safe to format directly. */}
          Trip {q.quote_versions?.trip_date ? formatTripDate(q.quote_versions.trip_date, { month: "short", day: "numeric" }) : "TBD"}
          {" · submitted "}
          {new Date(q.created_at).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {q.status !== "cancelled" && q.quote_versions?.distance_km == null && (
          <span
            title="Distance unavailable — long-distance surcharge may be missing from this estimate"
            className="text-amber-600"
          >
            ⚠
          </span>
        )}
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
          cancelRequested ? "bg-amber-100 text-amber-800" : statusStyle[q.status] ?? "bg-slate-100 text-slate-700"
        }`}>
          {cancelRequested ? "Cancel requested" : STATUS_LABEL[q.status] ?? q.status}
        </span>
      </div>
    </button>
  );
}

/** One of the four at-a-glance facts under the organization heading. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-semibold leading-snug text-foreground">{value}</div>
    </div>
  );
}

/**
 * One leg of the journey: a time, then the place it applies to, then that
 * place's address. Keeping the three together is the whole point — in the
 * previous two-column grid a time could sit beside an unrelated address.
 */
function Leg({
  time, timeLabel, place, address, placeLabel,
}: {
  time: string;
  timeLabel: string;
  place: string | null;
  address: string | null;
  placeLabel: string;
}) {
  return (
    <div className="relative">
      <span className="absolute -left-[22px] top-1.5 h-2 w-2 rounded-full bg-primary" aria-hidden />
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{timeLabel}</span>
        <span className="text-sm font-bold text-foreground">{time}</span>
      </div>
      <div className="mt-0.5 text-sm text-foreground">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{placeLabel}: </span>
        {place || "—"}
      </div>
      {/* Addresses are read aloud down a phone and typed into a sat-nav, so
          they get the same size as the place name rather than fine print. */}
      {address && <div className="mt-0.5 text-sm leading-snug text-foreground/80">{address}</div>}
    </div>
  );
}

function Kv({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2">
      <span className="min-w-0 shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
        {label}
        {/* Optional second line for the working behind a number, so the
            breakdown doesn't need a separate row per intermediate value. */}
        {sub && <span className="mt-0.5 block normal-case tracking-normal text-[11px] text-muted-foreground/70">{sub}</span>}
      </span>
      {/* min-w-0 + break-words let long values (addresses especially) wrap
          inside the box instead of overflowing it. A shrink-0 here would keep
          money amounts on one line but pushes a long street address out the
          side, which is the wrong trade for a shared component. */}
      <span className="min-w-0 break-words text-right text-sm font-medium text-foreground">{value}</span>
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
          school: t.schools?.name ?? "Unknown organization",
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
    { title: "Bus rules & confirmation sheet", desc: "Sent to the organization once the trip goes green." },
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
