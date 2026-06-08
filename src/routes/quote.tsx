import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Check, Plus, Trash2 } from "lucide-react";

export const Route = createFileRoute("/quote")({
  head: () => ({
    meta: [
      { title: "Get a Field Trip Quote — School Field Trip Busing" },
      { name: "description", content: "Request a school field-trip quote in minutes. Tell us your destination, date, and group — no account required." },
      { property: "og:title", content: "Get a Field Trip Quote" },
      { property: "og:description", content: "Smart estimate for your next school field trip. Tell us the trip, get a price in minutes." },
    ],
  }),
  component: QuotePage,
});

type GradeRow = { id: string; grade: string; count: string };

function QuotePage() {
  const [step, setStep] = useState(1);
  const totalSteps = 5;
  const navigate = useNavigate();

  // Step 1
  const [school, setSchool] = useState("");
  const [pickup, setPickup] = useState("");
  const [destination, setDestination] = useState("");
  const [date, setDate] = useState("");
  const [departTime, setDepartTime] = useState("");
  const [returnTime, setReturnTime] = useState("");

  // Step 2
  const [students, setStudents] = useState("");
  const [grades, setGrades] = useState<GradeRow[]>([{ id: "g1", grade: "", count: "" }]);
  const [adults, setAdults] = useState("");
  const [cargo, setCargo] = useState(false);

  // Step 3
  const [c1n, setC1n] = useState("");
  const [c1e, setC1e] = useState("");
  const [c1p, setC1p] = useState("");
  const [c2n, setC2n] = useState("");
  const [c2e, setC2e] = useState("");
  const [c2p, setC2p] = useState("");
  const [dayN, setDayN] = useState("");
  const [dayP, setDayP] = useState("");

  // Step 4
  const [notes, setNotes] = useState("");

  const quoteNumber = useMemo(
    () => `Q-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`,
    [],
  );

  const next = () => setStep((s) => Math.min(s + 1, totalSteps));
  const back = () => setStep((s) => Math.max(s - 1, 1));

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-border bg-card/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
            ← Back to site
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Get a Quote</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            No account needed — takes about 3 minutes.
          </p>
          <Progress current={step} total={totalSteps} />
        </div>

        <div className="rounded-3xl border border-border bg-card p-6 shadow-soft sm:p-8">
          {step === 1 && (
            <StepWrap title="Trip basics">
              <Field label="School name" value={school} onChange={setSchool} placeholder="e.g. Maple Ridge Elementary" />
              <Field label="Pickup address" value={pickup || school} onChange={setPickup} placeholder="Defaults to school" />
              <Field label="Destination address" value={destination} onChange={setDestination} placeholder="e.g. Science World, Vancouver" />
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Trip date" type="date" value={date} onChange={setDate} />
                <Field label="Departure time" type="time" value={departTime} onChange={setDepartTime} />
                <Field label="Pickup-from-destination" type="time" value={returnTime} onChange={setReturnTime} />
              </div>
              <p className="text-xs text-muted-foreground">
                We will calculate travel time, return time and driver pre-trip time for you.
              </p>
            </StepWrap>
          )}

          {step === 2 && (
            <StepWrap title="Group details">
              <Field label="Number of students" type="number" value={students} onChange={setStudents} placeholder="e.g. 48" />
              <div>
                <div className="text-sm font-medium text-foreground">Grades</div>
                <p className="text-xs text-muted-foreground">
                  Younger students (K–4) seat 3 per bench, older students seat 2 — grade affects which bus you need.
                </p>
                <div className="mt-3 space-y-2">
                  {grades.map((g, i) => (
                    <div key={g.id} className="flex gap-2">
                      <input
                        placeholder="Grade (e.g. 2)"
                        value={g.grade}
                        onChange={(e) =>
                          setGrades((rows) => rows.map((r, idx) => (idx === i ? { ...r, grade: e.target.value } : r)))
                        }
                        className="w-1/2 rounded-xl border border-input bg-background px-3 py-2 text-sm"
                      />
                      <input
                        placeholder="Student count"
                        type="number"
                        value={g.count}
                        onChange={(e) =>
                          setGrades((rows) => rows.map((r, idx) => (idx === i ? { ...r, count: e.target.value } : r)))
                        }
                        className="w-1/2 rounded-xl border border-input bg-background px-3 py-2 text-sm"
                      />
                      {grades.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setGrades((rows) => rows.filter((_, idx) => idx !== i))}
                          className="rounded-xl border border-border bg-card px-3 text-muted-foreground hover:text-destructive"
                          aria-label="Remove"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setGrades((rows) => [...rows, { id: `g${Date.now()}`, grade: "", count: "" }])
                    }
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add grade group
                  </button>
                </div>
              </div>
              <Field label="Adults / chaperones" type="number" value={adults} onChange={setAdults} placeholder="Counted in capacity" />
              <label className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3">
                <input type="checkbox" checked={cargo} onChange={(e) => setCargo(e.target.checked)} className="h-4 w-4" />
                <span className="text-sm">
                  <span className="font-medium text-foreground">Cargo needed?</span>{" "}
                  <span className="text-muted-foreground">For equipment, instruments, sports gear, etc.</span>
                </span>
              </label>
            </StepWrap>
          )}

          {step === 3 && (
            <StepWrap title="Contacts">
              <div className="rounded-xl border border-border p-4">
                <div className="text-sm font-semibold text-foreground">Primary contact</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <Field label="Name" value={c1n} onChange={setC1n} />
                  <Field label="Email" type="email" value={c1e} onChange={setC1e} />
                  <Field label="Phone" value={c1p} onChange={setC1p} />
                </div>
              </div>
              <div className="rounded-xl border border-border p-4">
                <div className="text-sm font-semibold text-foreground">
                  Secondary contact <span className="font-normal text-muted-foreground">(optional)</span>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <Field label="Name" value={c2n} onChange={setC2n} />
                  <Field label="Email" type="email" value={c2e} onChange={setC2e} />
                  <Field label="Phone" value={c2p} onChange={setC2p} />
                </div>
              </div>
              <div className="rounded-xl border border-border p-4">
                <div className="text-sm font-semibold text-foreground">Day-of contact</div>
                <p className="text-xs text-muted-foreground">This is who the driver will contact on the day of the trip.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label="Name" value={dayN} onChange={setDayN} />
                  <Field label="Phone" value={dayP} onChange={setDayP} />
                </div>
              </div>
            </StepWrap>
          )}

          {step === 4 && (
            <StepWrap title="Anything else?">
              <label className="text-sm">
                <span className="font-medium text-foreground">Special requests</span>
                <textarea
                  rows={6}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Accessibility or special-needs seating, a requested driver, anything we should know."
                  className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                />
              </label>
            </StepWrap>
          )}

          {step === 5 && (
            <StepWrap title="Your estimate">
              <div className="rounded-2xl border border-border bg-surface p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Quote number</div>
                    <div className="text-lg font-semibold text-foreground">{quoteNumber}</div>
                  </div>
                  <span className="rounded-full bg-accent/30 px-3 py-1 text-xs font-semibold text-primary">
                    Estimate
                  </span>
                </div>

                <table className="mt-5 w-full text-sm">
                  <tbody className="divide-y divide-border">
                    <Row label="Suggested bus" value="[47-seat coach — placeholder]" />
                    <Row label="Hourly rate" value="$[xxx]/hr" />
                    <Row label="Estimated hours" value="[x.x] hrs" />
                    <Row label="Fuel surcharge" value="$[xx]" />
                    <Row label="Out-of-radius surcharge" value="$[xx]" />
                    <Row label="Estimated total" value="$[xxx.xx]" emphasize />
                  </tbody>
                </table>

                <div className="mt-5 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                  <TimePlaceholder label="Estimated departure" />
                  <TimePlaceholder label="Estimated pickup at destination" />
                  <TimePlaceholder label="Estimated return" />
                  <TimePlaceholder label="Estimated total travel time" />
                </div>
              </div>

              <ul className="space-y-1.5 rounded-xl border border-dashed border-border bg-card p-4 text-xs text-muted-foreground">
                <li>• Estimate only.</li>
                <li>• Parking and other fees not included.</li>
                <li>• Based on Surrey yard travel time.</li>
                <li>• One week to change or cancel.</li>
              </ul>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <Button
                  variant="accent"
                  size="lg"
                  onClick={() => {
                    alert(`Demo — quote ${quoteNumber} submitted.`);
                    navigate({ to: "/" });
                  }}
                >
                  Submit request
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link to="/login">Create an account to track this quote</Link>
                </Button>
              </div>
            </StepWrap>
          )}

          <div className="mt-8 flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={back} disabled={step === 1}>
              ← Back
            </Button>
            {step < totalSteps ? (
              <Button variant="hero" size="lg" onClick={next}>
                Continue →
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">Step {step} of {totalSteps}</span>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function Progress({ current, total }: { current: number; total: number }) {
  return (
    <div className="mt-5">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Step {current} of {total}</span>
        <span>{Math.round((current / total) * 100)}%</span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(current / total) * 100}%` }} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        {["Trip", "Group", "Contacts", "Notes", "Estimate"].map((label, i) => {
          const n = i + 1;
          const done = n < current;
          const active = n === current;
          return (
            <span
              key={label}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ${
                active
                  ? "border-primary bg-primary/5 text-primary"
                  : done
                    ? "border-accent/40 bg-accent/20 text-primary"
                    : "border-border bg-card text-muted-foreground"
              }`}
            >
              {done ? <Check className="h-3 w-3" /> : <span className="text-[10px] font-bold">{n}</span>}
              {label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function StepWrap({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <h2 className="text-xl font-semibold text-foreground">{title}</h2>
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-foreground">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none ring-ring focus:ring-2"
      />
    </label>
  );
}

function Row({ label, value, emphasize }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <tr>
      <td className="py-2 text-muted-foreground">{label}</td>
      <td className={`py-2 text-right ${emphasize ? "text-base font-bold text-foreground" : "text-foreground"}`}>{value}</td>
    </tr>
  );
}

function TimePlaceholder({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold text-foreground">[--:--]</div>
    </div>
  );
}
