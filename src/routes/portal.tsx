import { createFileRoute, Navigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppTopBar } from "@/components/AppTopBar";
import { useAuth } from "@/lib/auth-store";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/portal")({
  head: () => ({ meta: [{ title: "My Field Trip Dashboard — School Field Trip Busing" }, { name: "robots", content: "noindex" }] }),
  component: PortalPage,
});

const QUOTES = [
  { id: "Q-2026-0142", date: "Mar 12, 2026", dest: "Science World", status: "Confirmed", total: "$[862.40]" },
  { id: "Q-2026-0118", date: "Feb 28, 2026", dest: "Grouse Mountain", status: "In review", total: "$[1,140.00]" },
  { id: "Q-2026-0099", date: "Feb 04, 2026", dest: "Reifel Bird Sanctuary", status: "Requested", total: "$[610.00]" },
];

const TRIPS = [
  { id: "T-3041", when: "Mar 12, 2026 · 8:30 AM", dest: "Science World", upcoming: true },
  { id: "T-2980", when: "Jan 22, 2026 · 9:00 AM", dest: "PNE Playland", upcoming: false },
];

const statusStyle: Record<string, string> = {
  Confirmed: "bg-emerald-100 text-emerald-800",
  "In review": "bg-amber-100 text-amber-800",
  Requested: "bg-slate-100 text-slate-700",
};

function PortalPage() {
  const { role, email } = useAuth();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (ready && role !== "customer") return <Navigate to="/login" />;

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
            <table className="w-full text-sm">
              <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr><th className="px-4 py-3">Quote #</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Destination</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Total</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {QUOTES.map((q) => (
                  <tr key={q.id}>
                    <td className="px-4 py-3 font-medium text-foreground">{q.id}</td>
                    <td className="px-4 py-3 text-muted-foreground">{q.date}</td>
                    <td className="px-4 py-3 text-foreground">{q.dest}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusStyle[q.status]}`}>{q.status}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-foreground">{q.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-10 grid gap-6 lg:grid-cols-2">
          <div>
            <h2 className="text-lg font-semibold text-foreground">My trips</h2>
            <div className="mt-4 space-y-3">
              {TRIPS.map((t) => (
                <div key={t.id} className="flex items-center justify-between rounded-2xl border border-border bg-card p-4 shadow-soft">
                  <div>
                    <div className="text-sm font-semibold text-foreground">{t.dest}</div>
                    <div className="text-xs text-muted-foreground">{t.when} · {t.id}</div>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${t.upcoming ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>
                    {t.upcoming ? "Upcoming" : "Completed"}
                  </span>
                </div>
              ))}
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
