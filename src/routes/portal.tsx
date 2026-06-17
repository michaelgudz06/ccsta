import { createFileRoute, Navigate, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { AppTopBar } from "@/components/AppTopBar";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { dispatchNotifications } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Plus, ChevronDown, CheckCircle2, XCircle, Phone } from "lucide-react";
import { formatTripDate, formatTime, formatMoney } from "@/lib/format";
import { COMPANY } from "@/lib/company";

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
type VersionDetail = {
  id: string;
  trip_date: string | null;
  destination_name: string | null;
  destination_address: string | null;
  pickup_address: string | null;
  departure_time: string | null;
  return_time: string | null;
  student_count: number | null;
  adults_count: number | null;
  subtotal: number | null;
  surcharge_total: number | null;
  total: number | null;
  contact_primary: Contact | null;
  special_requests: string | null;
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
  const { role, email, loading } = useAuth();
  const [quotes, setQuotes] = useState<QuoteRow[]>([]);
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [quotesLoading, setQuotesLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setQuotesLoading(true);
    const { data: rows } = await supabase
      .from("quotes")
      .select("id, quote_number, status, created_at, current_version_id, cancellation_requested_at, schools(name)")
      .order("created_at", { ascending: false });
    if (!rows) { setQuotesLoading(false); return; }

    const versionIds = rows.map((r: any) => r.current_version_id).filter(Boolean) as string[];
    let versionMap: Record<string, VersionDetail> = {};
    if (versionIds.length > 0) {
      const { data: versions } = await supabase
        .from("quote_versions")
        .select("id, trip_date, destination_name, destination_address, pickup_address, departure_time, return_time, student_count, adults_count, subtotal, surcharge_total, total, contact_primary, special_requests")
        .in("id", versionIds);
      versionMap = Object.fromEntries(
        (versions ?? []).map((v) => [v.id, v as unknown as VersionDetail]),
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
  }, []);

  useEffect(() => {
    if (loading || role !== "customer") return;
    load();
  }, [loading, role, load]);

  async function doAction(
    fn: string,
    quoteId: string,
    extraArgs?: Record<string, unknown>,
  ) {
    setActionBusy(quoteId + fn);
    setActionError(null);
    const { error } = await supabase.rpc(fn, { p_quote_id: quoteId, ...extraArgs });
    setActionBusy(null);
    if (error) { setActionError(error.message); return; }
    dispatchNotifications();
    await load();
  }

  if (loading) return null;
  if (!role) return <Navigate to="/login" />;
  if (role === "admin") return <Navigate to="/admin" />;
  if (role === "driver") return <Navigate to="/driver" />;

  // Profile is derived from the customer's most recent quote.
  const latest = quotes[0];
  const profileSchool = latest?.schools?.name ?? null;
  const profileContact = latest?.version?.contact_primary ?? null;
  const upcomingTrips = trips.filter((t) => t.status !== "cancelled" && t.status !== "completed");

  return (
    <div className="min-h-screen bg-surface">
      <AppTopBar />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">My Field Trips</h1>
            <p className="mt-1 text-sm text-muted-foreground">Signed in as {email ?? "you@school.ca"}</p>
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
                return (
                  <div key={q.id} className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
                    <button
                      onClick={() => setOpenId(open ? null : q.id)}
                      className="flex w-full items-center gap-4 px-4 py-4 text-left hover:bg-surface"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground">{v?.destination_name ?? "Field trip"}</span>
                          <span className="text-xs text-muted-foreground">#{q.quote_number}</span>
                        </div>
                        <div className="mt-0.5 text-sm text-muted-foreground">
                          {formatTripDate(v?.trip_date)} · {(v?.student_count ?? 0) + (v?.adults_count ?? 0)} riders
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
                          <Detail label="Pickup" value={v.pickup_address || q.schools?.name || "—"} />
                          <Detail label="Destination" value={v.destination_address || v.destination_name || "—"} />
                          <Detail label="Trip date" value={formatTripDate(v.trip_date)} />
                          <Detail label="Times" value={`${formatTime(v.departure_time)} → ${formatTime(v.return_time)}`} />
                          <Detail label="Students" value={String(v.student_count ?? 0)} />
                          <Detail label="Adults / chaperones" value={String(v.adults_count ?? 0)} />
                        </div>

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
                            Need it urgently? Call us at {COMPANY.phoneMelody}.
                          </p>
                        )}

                        {(canAccept || canCancel || canRequestCancel) && (
                          <div className="mt-4 flex flex-wrap gap-2">
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
                                onClick={() => { if (confirm("Cancel this quote request?")) doAction("cancel_own_quote", q.id); }}
                                disabled={actionBusy === q.id + "cancel_own_quote"}
                              >
                                <XCircle className="h-4 w-4" />
                                {actionBusy === q.id + "cancel_own_quote" ? "Cancelling…" : "Cancel request"}
                              </Button>
                            )}
                            {canRequestCancel && (
                              <Button
                                variant="outline"
                                onClick={() => {
                                  const reason = prompt(
                                    "This trip has already been accepted by our office, so cancellation needs their confirmation.\n\nReason for cancelling (optional):",
                                  );
                                  if (reason === null) return; // dismissed
                                  doAction("request_quote_cancellation", q.id, { p_reason: reason });
                                }}
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
              <ProfRow label="School" value={profileSchool ?? "Add one by requesting a quote"} />
              <ProfRow label="Primary contact" value={profileContact?.name || "—"} />
              <ProfRow label="Email" value={profileContact?.email || email || "—"} />
              <ProfRow label="Phone" value={profileContact?.phone || "—"} />
              <p className="mt-4 flex items-center gap-2 rounded-xl bg-accent/20 px-3 py-2 text-xs text-primary">
                <Phone className="h-3.5 w-3.5" />
                Need help? Call us at {COMPANY.phoneMelody} or {COMPANY.phoneAlan}.
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
