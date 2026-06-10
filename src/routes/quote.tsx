import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Check, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

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
  const { session } = useAuth();

  // Step 1
  const [school, setSchool] = useState("");
  const [pickup, setPickup] = useState("");
  const [destination, setDestination] = useState("");
  const [destinationAddress, setDestinationAddress] = useState("");
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

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedQuoteNo, setSubmittedQuoteNo] = useState<string | null>(null);

  // Client-side preview estimate using real 2026-2027 non-member rates.
  // The exact quote is confirmed by admin after review.
  const headcount = (parseInt(students) || 0) + (parseInt(adults) || 0);
  const benchCount = headcount <= 36 ? 18 : headcount <= 94 ? 47 : 56;
  const benchCap   = benchCount === 18 ? 36 : benchCount === 47 ? 94 : 112;
  const busCount   = headcount > 0 ? Math.ceil(headcount / benchCap) : 1;
  const hourlyRate = benchCount === 56 ? 105.00 : 92.50; // non-member rate
  const minHours   = 4;
  const baseCost   = minHours * hourlyRate * busCount;
  const fuelSurcharge = 50 * busCount;
  const subtotal   = baseCost + fuelSurcharge;
  const gst        = subtotal * 0.05;
  const estimatedTotal = subtotal + gst;
  const busLabel   = benchCount === 18 ? "18-seat mini-bus" : benchCount === 47 ? "47-seat coach" : "56-seat coach";

  const next = () => setStep((s) => Math.min(s + 1, totalSteps));
  const back = () => setStep((s) => Math.max(s - 1, 1));

  const handleSubmit = async () => {
    if (!session) {
      // Not logged in — redirect to login, come back after
      navigate({ to: "/login" });
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    const { data, error } = await supabase.rpc("submit_quote", {
      p_data: {
        school_name:         school,
        pickup_address:      pickup || school,
        destination_name:    destination,
        destination_address: destinationAddress,
        trip_date:           date,
        departure_time:      departTime,
        return_time:         returnTime,
        student_count:       students,
        adults_count:        adults,
        grade_breakdown:     grades.filter((g) => g.grade || g.count),
        cargo_needed:        cargo,
        contact_primary:     { name: c1n, email: c1e, phone: c1p },
        contact_secondary:   { name: c2n, email: c2e, phone: c2p },
        contact_day_of:      { name: dayN, phone: dayP },
        special_requests:    notes,
      },
    });

    setSubmitting(false);

    if (error) {
      setSubmitError(error.message);
      return;
    }

    setSubmittedQuoteNo((data as { quote_number: string }).quote_number);
  };

  // Show success screen after submission
  if (submittedQuoteNo) {
    return (
      <div className="min-h-screen bg-surface">
        <header className="border-b border-border bg-card/80 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
            <Logo />
            <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">← Back to site</Link>
          </div>
        </header>
        <main className="mx-auto max-w-xl px-4 py-20 text-center sm:px-6">
          <div className="flex h-16 w-16 mx-auto items-center justify-center rounded-full bg-primary/10">
            <Check className="h-8 w-8 text-primary" />
          </div>
          <h1 className="mt-6 text-3xl font-bold tracking-tight text-foreground">Request received</h1>
          <p className="mt-3 text-muted-foreground">
            Your quote number is <span className="font-semibold text-foreground">{submittedQuoteNo}</span>.
            Melody or Alan will review it and send you a confirmed estimate, usually within one business day.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Button variant="hero" size="lg" onClick={() => navigate({ to: "/portal" })}>
              View my dashboard →
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link to="/">Back to site</Link>
            </Button>
          </div>
        </main>
      </div>
    );
  }

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
            Takes about 3 minutes. {session ? "" : "You'll need to log in to submit."}
          </p>
          <Progress current={step} total={totalSteps} />
        </div>

        <div className="rounded-3xl border border-border bg-card p-6 shadow-soft sm:p-8">
          {step === 1 && (
            <StepWrap title="Trip basics">
              <Field label="School name" value={school} onChange={setSchool} placeholder="e.g. Maple Ridge Elementary" />
              <Field label="Pickup address" value={pickup} onChange={setPickup} placeholder="Leave blank to use school name" />
              <Field label="Destination name" value={destination} onChange={setDestination} placeholder="e.g. Science World" />
              <Field label="Destination address" value={destinationAddress} onChange={setDestinationAddress} placeholder="e.g. 1455 Quebec St, Vancouver" />
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Trip date" type="date" value={date} onChange={setDate} />
                <Field label="Departure time" type="time" value={departTime} onChange={setDepartTime} />
                <Field label="Pick up from destination" type="time" value={returnTime} onChange={setReturnTime} />
              </div>
              <p className="text-xs text-muted-foreground">
                We calculate travel time, driver pre-trip time, and return to yard for you.
              </p>
            </StepWrap>
          )}

          {step === 2 && (
            <StepWrap title="Group details">
              <Field label="Number of students" type="number" value={students} onChange={setStudents} placeholder="e.g. 48" />
              <div>
                <div className="text-sm font-medium text-foreground">Grades</div>
                <p className="text-xs text-muted-foreground">
                  K–4 seat 3 per bench, grades 5+ seat 2 — helps us pick the right bus size.
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
                        min={0}
                        step={1}
                        inputMode="numeric"
                        value={g.count}
                        onKeyDown={(e) => { if (e.key === "-" || e.key === "e") e.preventDefault(); }}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const val = raw === "" ? "" : String(Math.max(0, Math.floor(Number(raw)) || 0));
                          setGrades((rows) => rows.map((r, idx) => (idx === i ? { ...r, count: val } : r)));
                        }}
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
                    onClick={() => setGrades((rows) => [...rows, { id: `g${Date.now()}`, grade: "", count: "" }])}
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
                  <span className="text-muted-foreground">Equipment, instruments, sports gear, etc.</span>
                </span>
              </label>
            </StepWrap>
          )}

          {step === 3 && (
            <StepWrap title="Contacts">
              <div className="rounded-xl border border-border p-4">
                <div className="text-sm font-semibold text-foreground">Primary contact</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <Field label="Name" value={c1n} onChange={setC1n} placeholder="Jane Smith" />
                  <Field label="Email" type="email" value={c1e} onChange={setC1e} placeholder="jane@school.ca" />
                  <Field label="Phone" value={c1p} onChange={setC1p} placeholder="604-555-0100" />
                </div>
              </div>
              <div className="rounded-xl border border-border p-4">
                <div className="text-sm font-semibold text-foreground">
                  Secondary contact <span className="font-normal text-muted-foreground">(optional)</span>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <Field label="Name" value={c2n} onChange={setC2n} placeholder="John Doe" />
                  <Field label="Email" type="email" value={c2e} onChange={setC2e} placeholder="john@school.ca" />
                  <Field label="Phone" value={c2p} onChange={setC2p} placeholder="604-555-0101" />
                </div>
              </div>
              <div className="rounded-xl border border-border p-4">
                <div className="text-sm font-semibold text-foreground">Day-of contact</div>
                <p className="text-xs text-muted-foreground">Who the driver contacts on the day of the trip.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label="Name" value={dayN} onChange={setDayN} placeholder="On-site coordinator" />
                  <Field label="Phone" value={dayP} onChange={setDayP} placeholder="604-555-0102" />
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
                  placeholder="Accessibility or special-needs seating, a preferred driver, anything we should know."
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
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Destination</div>
                    <div className="text-lg font-semibold text-foreground">{destination || "[destination]"}</div>
                    <div className="text-sm text-muted-foreground">{date || "—"} · {students || "—"} students</div>
                  </div>
                  <span className="rounded-full bg-accent/30 px-3 py-1 text-xs font-semibold text-primary">
                    Estimate
                  </span>
                </div>

                <table className="mt-5 w-full text-sm">
                  <tbody className="divide-y divide-border">
                    <Row label="Suggested bus" value={`${busLabel}${busCount > 1 ? ` × ${busCount}` : ""} (non-member rate)`} />
                    <Row label="Hourly rate" value={`$${hourlyRate.toFixed(2)}/hr`} />
                    <Row label="Minimum hours" value={`${minHours} hrs`} />
                    <Row label="Base cost" value={`$${baseCost.toFixed(2)}`} />
                    <Row label="Fuel surcharge" value={`$${fuelSurcharge.toFixed(2)} flat`} />
                    <Row label="GST (5%)" value={`$${gst.toFixed(2)}`} />
                    <Row label="Estimated total" value={`$${estimatedTotal.toFixed(2)}`} emphasize />
                  </tbody>
                </table>
                <p className="mt-3 text-xs text-muted-foreground">
                  Prices are estimates only. Melody or Alan will confirm the exact amount after reviewing your request.
                </p>
              </div>

              <ul className="space-y-1.5 rounded-xl border border-dashed border-border bg-card p-4 text-xs text-muted-foreground">
                <li>• Estimate only — exact rate confirmed after admin review.</li>
                <li>• Parking and other destination fees not included.</li>
                <li>• Based on travel time from Surrey Main yard.</li>
                <li>• Cancellations: one week notice required.</li>
              </ul>

              {submitError && (
                <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {submitError}
                </p>
              )}

              {!session && (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  You need to be logged in to submit. Your form data is saved — log in and come back to this step.
                </p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <Button
                  variant="accent"
                  size="lg"
                  onClick={handleSubmit}
                  disabled={submitting}
                >
                  {submitting ? "Submitting…" : session ? "Submit request" : "Log in to submit"}
                </Button>
                {!session && (
                  <Button asChild variant="outline" size="lg">
                    <Link to="/login">Log in / Create account</Link>
                  </Button>
                )}
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
  label, value, onChange, type = "text", placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string;
}) {
  // For number fields, never allow a negative value — floor at 0.
  const handleChange = (raw: string) => {
    if (type === "number") {
      if (raw === "") { onChange(""); return; }
      const n = Math.max(0, Math.floor(Number(raw)));
      onChange(Number.isNaN(n) ? "" : String(n));
      return;
    }
    onChange(raw);
  };
  return (
    <label className="block text-sm">
      <span className="font-medium text-foreground">{label}</span>
      <input
        type={type}
        {...(type === "number" ? { min: 0, step: 1, inputMode: "numeric" as const } : {})}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={(e) => { if (type === "number" && (e.key === "-" || e.key === "e")) e.preventDefault(); }}
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
