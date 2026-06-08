import { createFileRoute, Navigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppTopBar } from "@/components/AppTopBar";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/portal")({
  head: () => ({ meta: [{ title: "My Field Trip Dashboard — School Field Trip Busing" }, { name: "robots", content: "noindex" }] }),
  component: PortalPage,
});

const STATUS_LABEL: Record<string, string> = {
  requested:  "Requested",
  in_review:  "In review",
  approved:   "Approved",
  confirmed:  "Confirmed",
  scheduled:  "Scheduled",
  completed:  "Completed",
  invoiced:   "Invoiced",
  cancelled:  "Cancelled",
};

const statusStyle: Record<string, string> = {
  requested:  "bg-slate-100 text-slate-700",
  in_review:  "bg-amber-100 text-amber-800",
  approved:   "bg-blue-100 text-blue-800",
  confirmed:  "bg-emerald-100 text-emerald-800",
  scheduled:  "bg-emerald-100 text-emerald-800",
  completed:  "bg-slate-100 text-slate-700",
  invoiced:   "bg-purple-100 text-purple-800",
  cancelled:  "bg-rose-100 text-rose-800",
};

type VersionDetail = { trip_date: string | null; destination_name: string | null; total: number | null };
type QuoteRow = {
  id: string;
  quote_number: string;
  status: string;
  created_at: string;
  current_version_id: string | null;
  schools: { name: string } | null;
  quote_versions: VersionDetail | null;
};

function PortalPage() {
  const { role, email, loading } = useAuth();
  const [quotes, setQuotes] = useState<QuoteRow[]>([]);
  const [quotesLoading, setQuotesLoading] = useState(true);

  useEffect(() => {
    if (loading || role !== "customer") return;
    // Two-step fetch: quotes first, then versions — avoids PostgREST FK ambiguity
    // (quotes has two FKs to quote_versions: current_version_id and the reverse quote_id)
    supabase
      .from("quotes")
      .select("id, quote_number, status, created_at, current_version_id, schools(name)")
      .order("created_at", { ascending: false })
      .then(async ({ data: rows }) => {
        if (!rows) { setQuotesLoading(false); return; }
        const versionIds = rows.map((r: { current_version_id: string | null }) => r.current_version_id).filter(Boolean) as string[];
        let versionMap: Record<string, VersionDetail> = {};
        if (versionIds.length > 0) {
          const { data: versions } = await supabase
            .from("quote_versions")
            .select("id, trip_date, destination_name, total")
            .in("id", versionIds);
          versionMap = Object.fromEntries((versions ?? []).map((v: VersionDetail & { id: string }) => [v.id, v]));
        }
        setQuotes(rows.map((r: QuoteRow) => ({ ...r, quote_versions: r.current_version_id ? (versionMap[r.current_version_id] ?? null) : null })));
        setQuotesLoading(false);
      });
  }, [loading, role]);

  if (loading) return null;
  if (!role || role !== "customer") return <Navigate to="/login" />;

  return (
    <div className="min-h-screen bg-surface">
      <AppTopBar />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">My Field Trip Dashboard</h1>
            <p className="mt-1 text-sm text-muted-foreground">{email ?? "you@school.ca"}</p>
          </div>
          <Button asChild variant="accent" size="lg">
            <Link to="/quote"><Plus className="h-4 w-4" /> Request another quote</Link>
          </Button>
        </div>

        <section className="mt-10">
          <h2 className="text-lg font-semibold text-foreground">My quotes</h2>
          <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
            {quotesLoading ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">Loading…</div>
            ) : quotes.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                No quotes yet.{" "}
                <Link to="/quote" className="font-medium text-primary hover:underline">Request your first quote →</Link>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Quote #</th>
                    <th className="px-4 py-3">Trip date</th>
                    <th className="px-4 py-3">Destination</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Estimate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {quotes.map((q) => {
                    const ver = q.quote_versions;
                    const tripDate = ver?.trip_date
                      ? new Date(ver.trip_date).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })
                      : "—";
                    return (
                      <tr key={q.id}>
                        <td className="px-4 py-3 font-medium text-foreground">{q.quote_number}</td>
                        <td className="px-4 py-3 text-muted-foreground">{tripDate}</td>
                        <td className="px-4 py-3 text-foreground">{ver?.destination_name ?? "—"}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusStyle[q.status] ?? "bg-slate-100 text-slate-700"}`}>
                            {STATUS_LABEL[q.status] ?? q.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-foreground">
                          {ver?.total != null ? `$${Number(ver.total).toFixed(2)}` : "Pending review"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="mt-10 grid gap-6 lg:grid-cols-2">
          <div>
            <h2 className="text-lg font-semibold text-foreground">My trips</h2>
            <div className="mt-4 rounded-2xl border border-dashed border-border bg-card p-5 text-sm text-muted-foreground">
              Confirmed trips will appear here once Melody or Alan schedules them.
            </div>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground">My profile</h2>
            <div className="mt-4 rounded-2xl border border-border bg-card p-5 shadow-soft">
              <ProfRow label="School" value="[Placeholder] Maple Ridge Elementary" />
              <ProfRow label="Primary contact" value="[Placeholder] Jane Doe" />
              <ProfRow label="Email" value={email ?? "[Placeholder]"} />
              <ProfRow label="Phone" value="[Placeholder] (604) 555-0188" />
              <p className="mt-4 rounded-xl bg-accent/20 px-3 py-2 text-xs text-primary">
                Member schools have additional saved details — coming soon.
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function ProfRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border py-2.5 last:border-0">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}
