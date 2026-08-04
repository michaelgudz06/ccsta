import { createFileRoute, Navigate, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { AppTopBar } from "@/components/AppTopBar";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { dispatchNotifications } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Plus, ChevronDown, CheckCircle2, XCircle, Phone, Pencil } from "lucide-react";
import { formatTripDate, formatTime, formatMoney, formatTripType, todayISO, addDaysISO } from "@/lib/format";
import { COMPANY } from "@/lib/company";
import { friendlyError } from "@/lib/errors";

export const Route = createFileRoute("/portal")({
  head: () => ({ meta: [{ title: `My Field Trips — ${COMPANY.name}` }, { name: "robots", content: "noindex" }] }),
  component: PortalPage,
});

const STATUS_LABEL: Record<string, string> = {
  requested: "Waiting for review",
  in_review: "Being reviewed",
  approved: "Price ready — please accept",
  confirmed: "Accepted — booking your bus",
  scheduled: "Booked & scheduled",
  completed: "Completed",
  invoiced: "Invoiced",
  cancelled: "Cancelled",
};

const statusStyle: Record<string, string> = {
  requested: "bg-slate-100 text-slate-700",
  in_review: "bg-amber-100 text-amber-800",
  approved: "bg-blue-100 text-blue-800",
  confirmed: "bg-emerald-100 text-emerald-800",
  scheduled: "bg-emerald-100 text-emerald-800",
  completed: "bg-slate-100 text-slate-700",
  invoiced: "bg-purple-100 text-purple-800",
  cancelled: "bg-rose-100 text-rose-800",
};

type Contact = { name?: string; email?: string; phone?: string };
type ShuttleRun = { run_number: number; pickup_time: string; dropoff_time: string };
type MultiStop = { stop_number: number; destination_name: string | null; destination_address: string; arrival_time: string; departure_time: string | null };
type VersionDetail = {
  id: string;
  trip_date: string | null;
  destination_name: string | null;
  destination_address: string | null;
  pickup_address: string | null;
  departure_time: string | null;
  return_time: string | null;
  trip_type: "two_way" | "one_way" | "shuttle" | "multi_destination" | "multi_trip";
  grade_breakdown: { grade?: string; count?: string }[] | null;
  student_count: number | null;
  adults_count: number | null;
  subtotal: number | null;
  surcharge_total: number | null;
  total: number | null;
  contact_primary: Contact | null;
  special_requests: string | null;
  shuttle_runs: ShuttleRun[];
  multi_stops: MultiStop[];
};
type QuoteRow = {
  id: string;
  quote_number: string;
  status: string;
  created_at: string;
  current_version_id: string | null;
  cancellation_requested_at: string | null;
  schools: { name: string } | null;
  version: VersionDetail | null;
};
type TripRow = {
  trip_number: string;
  trip_date: string;
  destination_name: string | null;
  departure_time: string | null;
  status: string;
};

function PortalPage() {
  const { role, email, loading, user } = useAuth();
  const [quotes, setQuotes] = useState<QuoteRow[]>([]);
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [quotesLoading, setQuotesLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancelModal, setCancelModal] = useState<{ id: string; mode: "cancel" | "request" } | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  // Distinguishes "your list is empty" from "we couldn't fetch your list".
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setQuotesLoading(true);
    setLoadError(null);
    // Explicitly scoped to the signed-in user. For customers this is what RLS
    // enforces anyway, so it changes nothing — but an admin viewing this page
    // would otherwise see EVERY customer's quotes here, which defeats the
    // purpose of looking at the customer view.
    let q = supabase
      .from("quotes")
      .select("id, quote_number, status, created_at, current_version_id, cancellation_requested_at, schools(name)")
      .order("created_at", { ascending: false });
    if (user?.id) q = q.eq("customer_id", user.id);
    const { data: rows, error: rowsErr } = await q;
    // BUG_BACKLOG #13: this used to bail silently, so a failed query looked
    // exactly like a customer who has never booked anything. Distinguish the
    // two — "you have no quotes" is reassuring and wrong when the request
    // actually failed.
    if (rowsErr) {
      setLoadError("We couldn't load your trips just now. Check your connection and try again.");
      setQuotesLoading(false);
      return;
    }
    if (!rows) { setQuotesLoading(false); return; }

    const versionIds = rows.map((r: any) => r.current_version_id).filter(Boolean) as string[];
    let versionMap: Record<string, VersionDetail> = {};
    if (versionIds.length > 0) {
      const { data: versions } = await supabase
        .from("quote_versions")
        .select("id, trip_date, destination_name, destination_address, pickup_address, departure_time, return_time, trip_type, grade_breakdown, student_count, adults_count, subtotal, surcharge_total, total, contact_primary, special_requests")
        .in("id", versionIds);
      const { data: runs } = await supabase
        .from("quote_shuttle_runs")
        .select("quote_version_id, run_number, pickup_time, dropoff_time")
        .in("quote_version_id", versionIds)
        .order("run_number", { ascending: true });
      const runsByVersion: Record<string, ShuttleRun[]> = {};
      for (const r of runs ?? []) {
        (runsByVersion[r.quote_version_id] ??= []).push(r);
      }
      const { data: stops } = await supabase
        .from("quote_multi_stops")
        .select("quote_version_id, stop_number, destination_name, destination_address, arrival_time, departure_time")
        .in("quote_version_id", versionIds)
        .order("stop_number", { ascending: true });
      const stopsByVersion: Record<string, MultiStop[]> = {};
      for (const s of stops ?? []) {
        (stopsByVersion[s.quote_version_id] ??= []).push(s);
      }
      versionMap = Object.fromEntries(
        (versions ?? []).map((v) => [
          v.id,
          { ...v, shuttle_runs: runsByVersion[v.id] ?? [], multi_stops: stopsByVersion[v.id] ?? [] } as unknown as VersionDetail,
        ]),
      );
    }
    setQuotes(
      rows.map((r: any) => ({
        ...r,
        version: r.current_version_id ? versionMap[r.current_version_id] ?? null : null,
      })),
    );

    const { data: tripRows } = await supabase
      .from("trips")
      .select("trip_number, trip_date, destination_name, departure_time, status")
      .order("trip_date", { ascending: true });
    setTrips((tripRows as TripRow[]) ?? []);
    setQuotesLoading(false);
  }, [user?.id]);

  useEffect(() => {
    if (loading || (role !== "customer" && role !== "admin")) return;
    load();
  }, [loading, role, load]);

  async function doAction(
    fn: any,
    quoteId: string,
    extraArgs?: Record<string, unknown>,
  ) {
    setActionBusy(quoteId + fn);
    setActionError(null);
    const { error } = await supabase.rpc(fn as any, { p_quote_id: quoteId, ...extraArgs });
    setActionBusy(null);
    if (error) {
      setActionError(friendlyError(error, `Something went wrong. Please try again, or call us at ${COMPANY.phoneDispatch} if it keeps happening.`));
      return;
    }
    dispatchNotifications();
    await load();
  }

  async function confirmCancel() {
    if (!cancelModal) return;
    const { id, mode } = cancelModal;
    if (mode === "cancel") await doAction("cancel_own_quote", id);
    else await doAction("request_quote_cancellation", id, { p_reason: cancelReason.trim() });
    setCancelModal(null);
    setCancelReason("");
  }

  if (loading) return null;
  if (!role) return <Navigate to="/login" />;
  // Admins are allowed in so they can walk the customer journey themselves.
  // They see only their OWN quotes here (the query filters by customer_id),
  // not the whole queue — the point is to see what a customer sees.
  if (role === "driver") return <Navigate to="/driver" />;

  // Profile is derived from the customer's most recent quote.
  const latest = quotes[0];
  const profileSchool = latest?.schools?.name ?? null;
  const profileContact = latest?.version?.contact_primary ?? null;
  const upcomingTrips = trips.filter((t) => t.status !== "cancelled" && t.status !== "completed");

  return (
    <div className="min-h-screen bg-surface">
      <AppTopBar />
      {role === "admin" && (
        <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900">
          Viewing the customer portal as an admin — showing only your own quotes.{" "}
          <Link to="/admin" className="font-semibold underline">Back to admin</Link>
        </div>
      )}
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">My Field Trips</h1>
            <p className="mt-1 text-sm text-muted-foreground">Signed in as {email ?? "you@example.com"}</p>
          </div>
          <Button asChild variant="accent" size="lg">
            <Link to="/quote"><Plus className="h-4 w-4" /> Request a new quote</Link>
          </Button>
        </div>

        {actionError && (
          <p className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {actionError}
          </p>
        )}

        {/* QUOTES */}
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-foreground">My quote requests</h2>
          <p className="text-sm text-muted-foreground">Tap any row to see the details and price breakdown.</p>
          <div className="mt-4 space-y-3">
            {quotesLoading ? (
              <div className="rounded-2xl border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">Loading…</div>
            ) : loadError ? (
              // Never show the reassuring empty state when the fetch failed —
              // "you have no quotes" would be a lie the customer might act on.
              <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-8 text-center text-sm text-amber-900">
                {loadError}
                <button onClick={() => load()} className="ml-2 font-semibold underline">Try again</button>
              </div>
            ) : quotes.length === 0 ? (
              <div className="rounded-2xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
                You haven't requested any quotes yet.{" "}
                <Link to="/quote" className="font-medium text-primary hover:underline">Request your first quote →</Link>
              </div>
            ) : (
              quotes.map((q) => {
                const v = q.version;
                const open = openId === q.id;
                const cancelPending = !!q.cancellation_requested_at && q.status !== "cancelled";
                // Not accepted by the office yet → cancel directly.
                const canCancel = ["requested", "in_review"].includes(q.status);
                // Already accepted (priced/booked) → must ask the office to cancel.
                const canRequestCancel =
                  ["approved", "confirmed", "scheduled"].includes(q.status) && !cancelPending;
                const canAccept = q.status === "approved" && !cancelPending;
                // Editable pre-scheduling only (a bus/driver assigned needs
                // the office involved for now), and not alongside a pending
                // cancellation request.
                // BUG_BACKLOG #15: the server (migration 042) also refuses an
                // online edit inside 7 days of the trip unless the date is
                // being pushed later. Without mirroring that here, a customer
                // filled in the entire edit form and only then hit a generic
                // rejection. The button is hidden instead, with the reason
                // shown in its place.
                const tripDate = q.version?.trip_date ?? null;
                const withinLockWindow =
                  !!tripDate && tripDate < addDaysISO(todayISO(), 7);
                const canEdit =
                  ["requested", "in_review", "approved", "confirmed"].includes(q.status)
                  && !cancelPending
                  && !withinLockWindow;
                return (
                  <div key={q.id} className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
                    <button
                      onClick={() => setOpenId(open ? null : q.id)}
                      className="flex w-full items-center gap-4 px-4 py-4 text-left hover:bg-surface"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground">
                            {v?.trip_type === "multi_destination" ? "Multiple destinations" : (v?.destination_name ?? "Field trip")}
                            {" · "}{formatTripDate(v?.trip_date)}
                            {" · "}{formatTripType(v?.trip_type)}
                          </span>
                          <span className="text-xs text-muted-foreground">#{q.quote_number}</span>
                        </div>
                        <div className="mt-0.5 text-sm text-muted-foreground">
                          {(v?.student_count ?? 0) + (v?.adults_count ?? 0)} riders
                        </div>
                      </div>
                      <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${cancelPending ? "bg-amber-100 text-amber-800" : statusStyle[q.status] ?? "bg-slate-100 text-slate-700"}`}>
                        {cancelPending ? "Cancellation requested" : STATUS_LABEL[q.status] ?? q.status}
                      </span>
                      <div className="text-right">
                        <div className="font-semibold text-foreground">{v?.total != null ? formatMoney(v.total) : "—"}</div>
                        <div className="text-[11px] text-muted-foreground">{v?.total != null ? "estimate" : "pending"}</div>
                      </div>
                      <ChevronDown className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
                    </button>

                    {open && v && (
                      <div className="border-t border-border bg-surface/50 px-4 py-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                          <Detail label="Trip type" value={formatTripType(v.trip_type)} />
                          <Detail label="Pickup" value={v.pickup_address || q.schools?.name || "—"} />
                          {v.trip_type !== "multi_destination" && (
                            <Detail label="Destination" value={v.destination_address || v.destination_name || "—"} />
                          )}
                          <Detail label="Trip date" value={formatTripDate(v.trip_date)} />
                          <Detail
                            label={v.trip_type === "shuttle" || v.trip_type === "multi_destination" ? "Bus engaged" : "Times"}
                            value={`${formatTime(v.departure_time)} → ${formatTime(v.return_time)}`}
                          />
                          <Detail label="Students" value={String(v.student_count ?? 0)} />
                          <Detail label="Adults / chaperones" value={String(v.adults_count ?? 0)} />
                        </div>

                        {v.trip_type === "shuttle" && v.shuttle_runs.length > 0 && (
                          <div className="mt-3 rounded-xl border border-dashed border-border bg-card p-3 text-sm">
                            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Shuttle runs</span>
                            <ul className="mt-1 space-y-1 text-foreground">
                              {v.shuttle_runs.map((r) => (
                                <li key={r.run_number}>
                                  Run {r.run_number}: {formatTime(r.pickup_time)} → {formatTime(r.dropoff_time)}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {v.trip_type === "multi_destination" && v.multi_stops.length > 0 && (
                          <div className="mt-3 rounded-xl border border-dashed border-border bg-card p-3 text-sm">
                            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stops</span>
                            <ul className="mt-1 space-y-1 text-foreground">
                              {v.multi_stops.map((s) => (
                                <li key={s.stop_number}>
                                  Stop {s.stop_number}: {s.destination_name || s.destination_address}
                                  {s.destination_name ? ` (${s.destination_address})` : ""} — arrive {formatTime(s.arrival_time)}
                                  {s.departure_time ? `, depart ${formatTime(s.departure_time)}` : ""}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {v.special_requests && (
                          <div className="mt-3 rounded-xl border border-dashed border-border bg-card p-3 text-sm">
                            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your notes</span>
                            <p className="mt-1 text-foreground">{v.special_requests}</p>
                          </div>
                        )}

                        {v.total != null && (
                          <div className="mt-4 rounded-xl border border-border bg-card p-4">
                            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Price breakdown</div>
                            <table className="mt-2 w-full text-sm">
                              <tbody className="divide-y divide-border">
                                <PriceRow label="Bus & driver time" value={formatMoney(v.subtotal)} />
                                <PriceRow label="Fuel & other surcharges" value={formatMoney(v.surcharge_total)} />
                                <PriceRow label="Total (incl. GST)" value={formatMoney(v.total)} emphasize />
                              </tbody>
                            </table>
                            <p className="mt-2 text-xs text-muted-foreground">
                              Parking and destination admission are not included. Final amount is confirmed by {COMPANY.name}.
                            </p>
                          </div>
                        )}

                        {cancelPending && (
                          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                            We've received your cancellation request — the office will confirm it shortly.
                            Need it urgently? Call us at {COMPANY.phoneDispatch}.
                          </p>
                        )}

                        {/* Say why editing is unavailable rather than just
                            omitting the button — otherwise it looks broken. */}
                        {withinLockWindow
                          && ["requested", "in_review", "approved", "confirmed"].includes(q.status)
                          && !cancelPending && (
                          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                            This trip is within a week, so it can no longer be changed online.
                            Call us at {COMPANY.phoneDispatch} and we'll sort it out.
                          </p>
                        )}

                        {(canAccept || canCancel || canRequestCancel || canEdit) && (
                          <div className="mt-4 flex flex-wrap gap-2">
                            {canEdit && (
                              <Button asChild variant="outline">
                                <Link to="/quote" search={{ edit: q.id }}>
                                  <Pencil className="h-4 w-4" />
                                  Edit trip
                                </Link>
                              </Button>
                            )}
                            {canAccept && (
                              <Button
                                variant="accent"
                                onClick={() => doAction("confirm_own_quote", q.id)}
                                disabled={actionBusy === q.id + "confirm_own_quote"}
                              >
                                <CheckCircle2 className="h-4 w-4" />
                                {actionBusy === q.id + "confirm_own_quote" ? "Accepting…" : "Accept this price"}
                              </Button>
                            )}
                            {canCancel && (
                              <Button
                                variant="outline"
                                onClick={() => setCancelModal({ id: q.id, mode: "cancel" })}
                                disabled={actionBusy === q.id + "cancel_own_quote"}
                              >
                                <XCircle className="h-4 w-4" />
                                {actionBusy === q.id + "cancel_own_quote" ? "Cancelling…" : "Cancel request"}
                              </Button>
                            )}
                            {canRequestCancel && (
                              <Button
                                variant="outline"
                                onClick={() => { setCancelReason(""); setCancelModal({ id: q.id, mode: "request" }); }}
                                disabled={actionBusy === q.id + "request_quote_cancellation"}
                              >
                                <XCircle className="h-4 w-4" />
                                {actionBusy === q.id + "request_quote_cancellation" ? "Sending…" : "Request cancellation"}
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>

        {cancelModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setCancelModal(null)}>
            <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-elevated" onClick={(e) => e.stopPropagation()}>
              {cancelModal.mode === "cancel" ? (
                <>
                  <h3 className="text-lg font-bold text-foreground">Cancel this request?</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    This withdraws your quote request. You can always submit a new one later.
                  </p>
                </>
              ) : (
                <>
                  <h3 className="text-lg font-bold text-foreground">Request cancellation</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    This trip has already been accepted by our office, so cancelling needs their confirmation. We'll email you once it's sorted.
                  </p>
                  <label className="mt-3 block text-sm">
                    <span className="font-medium text-foreground">Reason (optional)</span>
                    <textarea
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      rows={3}
                      placeholder="Let us know why, if you'd like."
                      className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
                    />
                  </label>
                </>
              )}
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setCancelModal(null)}>
                  {cancelModal.mode === "cancel" ? "Keep it" : "Never mind"}
                </Button>
                <Button
                  variant="destructive"
                  onClick={confirmCancel}
                  disabled={actionBusy === cancelModal.id + (cancelModal.mode === "cancel" ? "cancel_own_quote" : "request_quote_cancellation")}
                >
                  {cancelModal.mode === "cancel" ? "Yes, cancel" : "Send request"}
                </Button>
              </div>
            </div>
          </div>
        )}

        <section className="mt-10 grid gap-6 lg:grid-cols-2">
          {/* TRIPS */}
          <div>
            <h2 className="text-lg font-semibold text-foreground">My booked trips</h2>
            <div className="mt-4 space-y-2">
              {upcomingTrips.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-card p-5 text-sm text-muted-foreground">
                  Once you accept a price and we book a bus, your confirmed trips show up here.
                </div>
              ) : (
                upcomingTrips.map((t) => (
                  <div key={t.trip_number} className="rounded-2xl border border-border bg-card p-4 shadow-soft">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-foreground">{t.destination_name ?? "Field trip"}</span>
                      <span className="text-xs text-muted-foreground">{t.trip_number}</span>
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {formatTripDate(t.trip_date)} · departs {formatTime(t.departure_time)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* PROFILE */}
          <div>
            <h2 className="text-lg font-semibold text-foreground">My details</h2>
            <div className="mt-4 rounded-2xl border border-border bg-card p-5 shadow-soft">
              <ProfRow label="Organization" value={profileSchool ?? "Add one by requesting a quote"} />
              <ProfRow label="Primary contact" value={profileContact?.name || "—"} />
              <ProfRow label="Email" value={profileContact?.email || email || "—"} />
              <ProfRow label="Phone" value={profileContact?.phone || "—"} />
              <p className="mt-4 flex items-center gap-2 rounded-xl bg-accent/20 px-3 py-2 text-xs text-primary">
                <Phone className="h-3.5 w-3.5" />
                Need help? Call us at {COMPANY.phoneDispatch}
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm text-foreground">{value}</div>
    </div>
  );
}

function PriceRow({ label, value, emphasize }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <tr>
      <td className="py-2 text-muted-foreground">{label}</td>
      <td className={`py-2 text-right ${emphasize ? "text-base font-bold text-foreground" : "text-foreground"}`}>{value}</td>
    </tr>
  );
}

function ProfRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-0">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}
