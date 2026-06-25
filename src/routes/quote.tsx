import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { AppTopBar } from "@/components/AppTopBar";
import { RouteMap } from "@/components/RouteMap";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { Button } from "@/components/ui/button";
import { Check, Plus, Trash2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { dispatchNotifications } from "@/lib/notify";
import { useAuth } from "@/lib/auth";
import { formatMoney } from "@/lib/format";

export const Route = createFileRoute("/quote")({
  head: () => ({
    meta: [
      { title: "Get a Field Trip Quote — CCSTA" },
      { name: "description", content: "Request a school field-trip quote in minutes. Tell us your destination, date, and group — no account required." },
      { property: "og:title", content: "Get a Field Trip Quote — CCSTA" },
      { property: "og:description", content: "Smart estimate for your next school field trip. Tell us the trip, get a price in minutes." },
    ],
  }),
  component: QuotePage,
});

type GradeRow = { id: string; grade: string; count: string };

function QuotePage() {
  const [step, setStep] = useState(1);
  const totalSteps = 4;
  const navigate = useNavigate();
  const { session } = useAuth();
  const [prefilled, setPrefilled] = useState(false);

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
  const [showGrades, setShowGrades] = useState(false);
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
  const [driverPref, setDriverPref] = useState("");

  // Validation
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showTimeWarning, setShowTimeWarning] = useState(false);
  const [pendingNext, setPendingNext] = useState(false);

  // Submission
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedQuoteNo, setSubmittedQuoteNo] = useState<string | null>(null);

  // ── Draft autosave ──────────────────────────────────────────────────────────
  // Keep everything the user types so it survives the signup round-trip:
  // get a rough estimate → create an account → come back with it all pre-filled.
  const DRAFT_KEY = "ccsta_quote_draft_v1";

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.school) setSchool(d.school);
      if (d.pickup) setPickup(d.pickup);
      if (d.destination) setDestination(d.destination);
      if (d.destinationAddress) setDestinationAddress(d.destinationAddress);
      if (d.date) setDate(d.date);
      if (d.departTime) setDepartTime(d.departTime);
      if (d.returnTime) setReturnTime(d.returnTime);
      if (d.students) setStudents(d.students);
      if (Array.isArray(d.grades) && d.grades.length) setGrades(d.grades);
      if (d.adults) setAdults(d.adults);
      if (typeof d.cargo === "boolean") setCargo(d.cargo);
      if (d.c1n) setC1n(d.c1n); if (d.c1e) setC1e(d.c1e); if (d.c1p) setC1p(d.c1p);
      if (d.c2n) setC2n(d.c2n); if (d.c2e) setC2e(d.c2e); if (d.c2p) setC2p(d.c2p);
      if (d.dayN) setDayN(d.dayN); if (d.dayP) setDayP(d.dayP);
      if (d.notes) setNotes(d.notes);
      if (d.driverPref) setDriverPref(d.driverPref);
      if (d.step) setStep(d.step);
    } catch { /* ignore malformed draft */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const draft = { school, pickup, destination, destinationAddress, date, departTime, returnTime, students, grades, adults, cargo, c1n, c1e, c1p, c2n, c2e, c2p, dayN, dayP, notes, driverPref, step };
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* quota */ }
  }, [school, pickup, destination, destinationAddress, date, departTime, returnTime, students, grades, adults, cargo, c1n, c1e, c1p, c2n, c2e, c2p, dayN, dayP, notes, driverPref, step]);

  // Prefill from previous quote
  useEffect(() => {
    if (!session || prefilled) return;
    setPrefilled(true);
    (async () => {
      const { data: q } = await supabase
        .from("quotes")
        .select("current_version_id, schools(name)")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!q?.current_version_id) return;
      const { data: v } = await supabase
        .from("quote_versions")
        .select("pickup_address, contact_primary, contact_secondary, contact_day_of")
        .eq("id", q.current_version_id)
        .maybeSingle();
      const c1 = (v?.contact_primary ?? {}) as { name?: string; email?: string; phone?: string };
      const c2 = (v?.contact_secondary ?? {}) as { name?: string; email?: string; phone?: string };
      const cd = (v?.contact_day_of ?? {}) as { name?: string; phone?: string };
      setSchool((s) => s || (q.schools as { name?: string } | null)?.name || "");
      setPickup((s) => s || v?.pickup_address || "");
      setC1n((s) => s || c1.name || "");
      setC1e((s) => s || c1.email || "");
      setC1p((s) => s || c1.phone || "");
      setC2n((s) => s || c2.name || "");
      setC2e((s) => s || c2.email || "");
      setC2p((s) => s || c2.phone || "");
      setDayN((s) => s || cd.name || "");
      setDayP((s) => s || cd.phone || "");
    })();
  }, [session, prefilled]);

  // Trip-duration helper (minutes)
  const tripMinutes = (() => {
    if (!departTime || !returnTime) return null;
    const [dh, dm] = departTime.split(":").map(Number);
    const [rh, rm] = returnTime.split(":").map(Number);
    let diff = (rh * 60 + rm) - (dh * 60 + dm);
    if (diff < 0) diff += 24 * 60;
    return diff;
  })();
  const tripHoursCalc = tripMinutes !== null ? tripMinutes / 60 : null;

  // Client-side preview estimate using real 2026-2027 non-member rates.
  // Seat-based capacity: each bus has bench seats (18->9, 47->23.67, 56->28);
  // older riders (Gr 5+ & adults) take 2 per seat, younger (K-4) take 3 per seat.
  const totalStudents = parseInt(students) || 0;
  const adultsN = parseInt(adults) || 0;
  const youngN = Math.min(
    grades.reduce((sum, g) => sum + (["K", "1", "2", "3", "4"].includes(g.grade) ? (parseInt(g.count) || 0) : 0), 0),
    totalStudents,
  );
  const olderN = Math.max(totalStudents - youngN, 0) + adultsN;
  const seatsNeeded = youngN / 3 + olderN / 2;
  const BUS_SEATS: Record<number, number> = { 18: 9, 47: 23.67, 56: 28 };
  const headcount = totalStudents + adultsN;
  const benchCount = seatsNeeded <= 9 ? 18 : seatsNeeded <= 23.67 ? 47 : 56;
  const busCount   = seatsNeeded > 0 ? Math.max(1, Math.ceil(seatsNeeded / BUS_SEATS[benchCount])) : 1;
  const hourlyRate = benchCount === 56 ? 105.00 : 92.50;
  const minHours   = 4;
  // Use actual trip duration if entered, otherwise fall back to minimum
  const tripHours  = tripHoursCalc !== null ? tripHoursCalc : minHours;
  const billHours  = Math.max(tripHours, minHours);
  const baseCost   = billHours * hourlyRate * busCount;
  const fuelSurcharge = 50 * busCount;
  const subtotal   = baseCost + fuelSurcharge;
  const gst        = subtotal * 0.05;
  const estimatedTotal = subtotal + gst;
  const busLabel   = benchCount === 18 ? "18-seat mini-bus" : benchCount === 47 ? "47-seat coach" : "56-seat coach";

  // Validation per step
  const validateStep = (s: number): boolean => {
    const e: Record<string, string> = {};
    if (s === 1) {
      if (!school.trim())            e.school = "Please enter your school name.";
      if (!destination.trim())       e.destination = "Please enter the destination name.";
      if (!destinationAddress.trim()) e.destinationAddress = "Please enter the destination address so we can calculate the route.";
      if (!date)                     e.date = "Please select the trip date.";
      if (!departTime)               e.departTime = "Please enter the departure time.";
      if (!returnTime)               e.returnTime = "Please enter the pick-up time from the destination.";
    }
    if (s === 2) {
      if (!students || parseInt(students) < 1) e.students = "Please enter the number of students (at least 1).";
    }
    if (s === 3) {
      if (!c1n.trim()) e.c1n = "Name is required.";
      if (!c1e.trim()) e.c1e = "Email is required.";
      if (!c1p.trim()) e.c1p = "Phone is required.";
      // Secondary contact is OPTIONAL — no required checks.

      // Primary and secondary must be two different people.
      const norm = (str: string) => str.trim().toLowerCase();
      if (c1e.trim() && c2e.trim() && norm(c1e) === norm(c2e)) {
        e.c2e = "Use a different email — the secondary contact must be a different person.";
      } else if (c1n.trim() && c2n.trim() && norm(c1n) === norm(c2n)) {
        e.c2n = "The secondary contact must be a different person from the primary.";
      }
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const next = () => {
    if (!validateStep(step)) return;

    // Time-gap warning on step 1
    if (step === 1 && tripMinutes !== null && tripMinutes < 60) {
      setPendingNext(true);
      setShowTimeWarning(true);
      return;
    }

    setStep((s) => Math.min(s + 1, totalSteps));
  };

  const confirmTimeAndNext = () => {
    setShowTimeWarning(false);
    setPendingNext(false);
    setStep((s) => Math.min(s + 1, totalSteps));
  };

  const back = () => setStep((s) => Math.max(s - 1, 1));

  const handleSubmit = async () => {
    if (!session) {
      // Their answers are already saved to the draft above. Send them to create
      // an account, then straight back here to finish — nothing is lost.
      if (typeof window !== "undefined") window.location.href = "/login?next=/quote&new=1";
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
    if (error) { setSubmitError(error.message); return; }
    const result = data as { quote_number: string; quote_id: string };
    // Save the optional driver preference onto the new quote (best-effort).
    if (driverPref.trim() && result.quote_id) {
      await supabase.rpc("set_quote_driver_preference" as never, { p_quote_id: result.quote_id, p_pref: driverPref.trim() } as never);
    }
    dispatchNotifications();
    if (typeof window !== "undefined") localStorage.removeItem(DRAFT_KEY);
    setSubmittedQuoteNo(result.quote_number);
  };

  // Success screen
  if (submittedQuoteNo) {
    return (
      <div className="min-h-screen bg-surface">
        {session ? <AppTopBar /> : (
          <header className="border-b border-border bg-card/80 backdrop-blur">
            <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
              <Logo />
              <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">← Back to site</Link>
            </div>
          </header>
        )}
        <main className="mx-auto max-w-xl px-4 py-20 text-center sm:px-6">
          <div className="flex h-16 w-16 mx-auto items-center justify-center rounded-full bg-primary/10">
            <Check className="h-8 w-8 text-primary" />
          </div>
          <h1 className="mt-6 text-3xl font-bold tracking-tight text-foreground">Request received!</h1>
          <p className="mt-3 text-muted-foreground">
            Your quote number is <span className="font-semibold text-foreground">{submittedQuoteNo}</span>.
            Melody or Alan will review it and send you a confirmed price — usually within one business day.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Button variant="hero" size="lg" onClick={() => navigate({ to: "/portal" })}>
              View my quotes →
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link to="/">Back to site</Link>
            </Button>
          </div>
        </main>
      </div>
    );
  }

  // Whether to show the route map preview in step 1
  const showMapPreview = !!(pickup || school) && !!destinationAddress;

  return (
    <div className="min-h-screen bg-surface">
      {/* Short-trip warning modal */}
      {showTimeWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-2xl">
            <div className="flex items-start justify-between">
              <h3 className="text-lg font-semibold text-foreground">Short trip time — are you sure?</h3>
              <button onClick={() => { setShowTimeWarning(false); setPendingNext(false); }} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Your departure time and pick-up time are less than 1 hour apart (
              {tripMinutes} minutes). That's a very short trip — is the pick-up time correct?
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              The "pick-up time" is when we should collect the students <em>from the destination</em>, not the departure time from school.
            </p>
            <div className="mt-5 flex gap-3">
              <Button className="flex-1" variant="outline" onClick={() => { setShowTimeWarning(false); setPendingNext(false); }}>
                Go back and fix
              </Button>
              <Button className="flex-1" variant="accent" onClick={confirmTimeAndNext}>
                Yes, it's correct
              </Button>
            </div>
          </div>
        </div>
      )}

      {session ? <AppTopBar /> : (
        <header className="border-b border-border bg-card/80 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
            <Logo />
            <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">← Back to site</Link>
          </div>
        </header>
      )}

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
              <Field
                label="Organization name" required
                value={school} onChange={(v) => { setSchool(v); setErrors((e) => ({ ...e, school: "" })); }}
                placeholder="e.g. Maple Ridge Christian School"
                error={errors.school}
              />
              <AddressAutocomplete
                label="Pick-up address (leave blank to use school name)"
                value={pickup} onChange={(v) => setPickup(v)}
                placeholder="e.g. 123 Main St, Maple Ridge, BC"
              />
              <Field
                label="Destination name" required
                value={destination} onChange={(v) => { setDestination(v); setErrors((e) => ({ ...e, destination: "" })); }}
                placeholder="e.g. Science World"
                error={errors.destination}
              />
              <AddressAutocomplete
                label="Destination address" required
                value={destinationAddress}
                onChange={(v) => { setDestinationAddress(v); setErrors((e) => ({ ...e, destinationAddress: "" })); }}
                placeholder="e.g. 1455 Quebec St, Vancouver, BC"
                error={errors.destinationAddress}
              />

              {/* Route map preview — appears as soon as pickup + destination are filled */}
              {showMapPreview && (
                <div className="rounded-2xl border border-border bg-surface overflow-hidden">
                  <div className="px-4 pt-3 pb-1">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Route preview</p>
                  </div>
                  <RouteMap
                    pickup={pickup || school}
                    destination={destinationAddress}
                    departTime={departTime || undefined}
                    className="h-52 w-full"
                  />
                  <p className="px-4 py-2 text-xs text-muted-foreground">
                    Distance shown is one-way from your pick-up. Your quote covers the driver's full day — travel to your school, your trip, and the return.
                  </p>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-3">
                <Field
                  label="Trip date" type="date" required
                  value={date} onChange={(v) => { setDate(v); setErrors((e) => ({ ...e, date: "" })); }}
                  error={errors.date}
                />
                <TimeField
                  label="Departure time" required
                  value={departTime} onChange={(v) => { setDepartTime(v); setErrors((e) => ({ ...e, departTime: "" })); }}
                  error={errors.departTime}
                />
                <TimeField
                  label="Pick-up from destination" required
                  value={returnTime} onChange={(v) => { setReturnTime(v); setErrors((e) => ({ ...e, returnTime: "" })); }}
                  error={errors.returnTime}
                />
              </div>
              {departTime && returnTime && tripMinutes !== null && tripMinutes >= 60 && (
                <p className="text-xs text-muted-foreground">
                  Trip duration: <span className="font-medium text-foreground">{Math.floor(tripMinutes / 60)}h {tripMinutes % 60 > 0 ? `${tripMinutes % 60}m` : ""}</span>
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                "Pick-up from destination" is when you want us to collect the students and head back to school.
              </p>
              <p className="text-xs text-muted-foreground">
                *All trips are a minimum of 4 hours.
              </p>
            </StepWrap>
          )}

          {step === 2 && (
            <StepWrap title="Group details">
              <Field
                label="Total number of attendees" type="number" required
                value={students} onChange={(v) => { setStudents(v); setErrors((e) => ({ ...e, students: "" })); }}
                placeholder="e.g. 48"
                error={errors.students}
              />
              {!showGrades && (
                <button
                  type="button"
                  onClick={() => setShowGrades(true)}
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                  <Plus className="h-4 w-4" /> Add grade breakdown (helps us size the bus)
                </button>
              )}
              {showGrades && (
              <div>
                <div className="text-sm font-medium text-foreground">Grades <span className="font-normal text-muted-foreground">(optional)</span></div>
                <p className="text-xs text-muted-foreground">
                  K–4 seat 3 per bench, grades 5+ seat 2 — helps us pick the right bus size.
                </p>
                <div className="mt-3 space-y-2">
                  {grades.map((g, i) => (
                    <div key={g.id} className="flex gap-2">
                      <select
                        value={g.grade}
                        onChange={(e) =>
                          setGrades((rows) => rows.map((r, idx) => (idx === i ? { ...r, grade: e.target.value } : r)))
                        }
                        className="w-1/2 rounded-xl border border-input bg-background px-3 py-2 text-sm"
                      >
                        <option value="">Select grade…</option>
                        <option value="K">Kindergarten (K)</option>
                        {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                          <option key={n} value={String(n)}>Grade {n} — Elementary</option>
                        ))}
                        {[8, 9, 10, 11, 12].map((n) => (
                          <option key={n} value={String(n)}>Grade {n} — Secondary</option>
                        ))}
                      </select>
                      <input
                        placeholder="# students"
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
              )}
              <Field
                label="Adults / chaperones" type="number"
                value={adults} onChange={setAdults}
                placeholder="Counted in total capacity"
              />
              <label className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3">
                <input type="checkbox" checked={cargo} onChange={(e) => setCargo(e.target.checked)} className="h-4 w-4" />
                <span className="text-sm">
                  <span className="font-medium text-foreground">Cargo needed?</span>{" "}
                  <span className="text-muted-foreground">Equipment, instruments, sports gear, etc.</span>
                </span>
              </label>
              <p className="text-xs text-muted-foreground">
                *Our cargo busses fit 1 airport carry-on baggage per person.
              </p>
            </StepWrap>
          )}

          {step === 3 && (
            <StepWrap title="Contacts">
              {/* Primary contact */}
              <div className="rounded-xl border border-border p-4 space-y-3">
                <div>
                  <div className="text-sm font-semibold text-foreground">Primary contact <span className="text-destructive">*</span></div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    The person booking this trip — usually the school secretary or administrator. We'll send the confirmed quote to this person.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Name" required value={c1n} onChange={(v) => { setC1n(v); setErrors((e) => ({ ...e, c1n: "" })); }} placeholder="Jane Smith" error={errors.c1n} />
                  <Field label="Email" type="email" required value={c1e} onChange={(v) => { setC1e(v); setErrors((e) => ({ ...e, c1e: "" })); }} placeholder="jane@school.ca" error={errors.c1e} />
                  <Field label="Phone" required value={c1p} onChange={(v) => { setC1p(v); setErrors((e) => ({ ...e, c1p: "" })); }} placeholder="604-555-0100" error={errors.c1p} />
                </div>
              </div>

              {/* Secondary contact */}
              <div className="rounded-xl border border-border p-4 space-y-3">
                <div>
                  <div className="text-sm font-semibold text-foreground">Secondary contact <span className="font-normal text-muted-foreground">(optional)</span></div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    An optional backup contact — for example a vice-principal or another administrator. Leave blank if you'd rather not add one.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Name" value={c2n} onChange={(v) => { setC2n(v); setErrors((e) => ({ ...e, c2n: "" })); }} placeholder="John Doe" error={errors.c2n} />
                  <Field label="Email" type="email" value={c2e} onChange={(v) => { setC2e(v); setErrors((e) => ({ ...e, c2e: "" })); }} placeholder="john@school.ca" error={errors.c2e} />
                  <Field label="Phone" value={c2p} onChange={(v) => { setC2p(v); setErrors((e) => ({ ...e, c2p: "" })); }} placeholder="604-555-0101" error={errors.c2p} />
                </div>
              </div>

              {/* Day-of contact */}
              <div className="rounded-xl border border-border p-4 space-y-3">
                <div>
                  <div className="text-sm font-semibold text-foreground">Day-of contact <span className="font-normal text-muted-foreground">(optional)</span></div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    The teacher taking the class on the trip — who the driver calls on the day. You can add this later if you don't know yet.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Name" value={dayN} onChange={(v) => { setDayN(v); setErrors((e) => ({ ...e, dayN: "" })); }} placeholder="Ms. Johnson" error={errors.dayN} />
                  <Field label="Phone (cell preferred)" value={dayP} onChange={(v) => { setDayP(v); setErrors((e) => ({ ...e, dayP: "" })); }} placeholder="604-555-0102" error={errors.dayP} />
                </div>
              </div>

              {/* Notes + preferred driver (merged in — no separate step) */}
              <div>
                <label className="text-sm">
                  <span className="font-medium text-foreground">Special requests</span>
                  <span className="ml-2 text-xs text-muted-foreground">(optional)</span>
                  <textarea
                    rows={4}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Accessibility or special-needs seating, musical instruments, anything we should know."
                    className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                  />
                </label>
              </div>
              <div>
                <label className="text-sm">
                  <span className="font-medium text-foreground">Preferred driver</span>
                  <span className="ml-2 text-xs text-muted-foreground">(optional)</span>
                  <input
                    value={driverPref}
                    onChange={(e) => setDriverPref(e.target.value)}
                    placeholder="If you've had a driver you'd like again, name them here."
                    className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                  />
                </label>
                <p className="mt-2 text-xs text-muted-foreground">
                  We'll do our best to honour it. If they're not available on your date, we'll reach out so you can choose your date or your driver.
                </p>
              </div>
            </StepWrap>
          )}

          {step === 4 && (
            <StepWrap title="Your estimate">
              <div>
                <div className="mb-2 text-sm font-medium text-foreground">Your route</div>
                <RouteMap
                  pickup={pickup || school}
                  destination={destinationAddress || destination}
                  departTime={departTime}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  Why distance matters: your price covers the driver's full day — travel to your school, the trip itself, and the return drive back. Longer routes mean more hours on the clock.
                </p>
              </div>

              <div className="rounded-2xl border border-border bg-surface p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Destination</div>
                    <div className="text-lg font-semibold text-foreground">{destination || "Your destination"}</div>
                    <div className="text-sm text-muted-foreground">
                      {date || "—"} · {departTime || "—"} → {returnTime || "—"} · {students || "—"} students
                    </div>
                  </div>
                  <span className="rounded-full bg-accent/30 px-3 py-1 text-xs font-semibold text-primary">
                    Estimate
                  </span>
                </div>

                <table className="mt-5 w-full text-sm">
                  <tbody className="divide-y divide-border">
                    <Row label="Suggested bus" value={`${busLabel}${busCount > 1 ? ` × ${busCount}` : ""} (non-member rate)`} />
                    <Row label="Hourly rate" value={`${formatMoney(hourlyRate)}/hr`} />
                    <Row label={`Billable hours (${billHours > minHours ? `${billHours.toFixed(1)} hrs actual` : `${minHours} hr minimum`})`} value={`${billHours.toFixed(1)} hrs`} />
                    <Row label="Base cost" value={formatMoney(baseCost)} />
                    <Row label="Fuel surcharge (flat)" value={formatMoney(fuelSurcharge)} />
                    <Row label="Subtotal" value={formatMoney(subtotal)} />
                    <Row label="GST (5%)" value={formatMoney(gst)} />
                    <Row label="Estimated total" value={formatMoney(estimatedTotal)} emphasize />
                  </tbody>
                </table>
                <p className="mt-3 text-xs text-muted-foreground">
                  This is a ballpark estimate only. Melody or Alan will confirm the exact amount after reviewing your request — it may be higher or lower based on the actual route.
                </p>
              </div>

              <ul className="space-y-1.5 rounded-xl border border-dashed border-border bg-card p-4 text-xs text-muted-foreground">
                <li>• Estimate only — exact rate confirmed after admin review.</li>
                <li>• Parking and other destination fees not included.</li>
                <li>• Cancellations: one week notice required.</li>
              </ul>

              {submitError && (
                <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {submitError}
                </p>
              )}

              {!session && (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Like this estimate? Create a free account to send it to us. Everything you typed is saved — you'll come right back here to finish.
                </p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <Button variant="accent" size="lg" onClick={handleSubmit} disabled={submitting}>
                  {submitting ? "Submitting…" : session ? "Submit request" : "Create account & send"}
                </Button>
                {!session && (
                  <Button variant="outline" size="lg" onClick={() => { if (typeof window !== "undefined") window.location.href = "/login?next=/quote"; }}>
                    I already have an account
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
        {["Trip", "Group", "Contacts", "Estimate"].map((label, i) => {
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

function to12Hour(value: string) {
  if (!value) return { hour: "", minute: "", period: "AM" as "AM" | "PM" };
  const [h, m] = value.split(":");
  let hourNum = parseInt(h, 10);
  const period = hourNum >= 12 ? "PM" : "AM";
  hourNum = hourNum % 12;
  if (hourNum === 0) hourNum = 12;
  return { hour: String(hourNum), minute: m || "", period };
}

function to24Hour(hour: string, period: "AM" | "PM") {
  let h = parseInt(hour, 10);
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return String(h).padStart(2, "0");
}

function TimeField({
  label, value, onChange, error, required,
}: {
  label: string; value: string; onChange: (v: string) => void; error?: string; required?: boolean;
}) {
  const { hour, minute, period } = to12Hour(value);
  const minutes = ["00", "15", "30", "45"];
  const hours = ["5", "6", "7", "8", "9", "10", "11", "12", "1", "2", "3", "4"];
  const baseSelect = "flex-1 bg-transparent px-2 py-2 text-sm outline-none appearance-none cursor-pointer";
  const borderCls = error
    ? "border-destructive ring-1 ring-destructive/30"
    : "border-input";
  return (
    <label className="block text-sm">
      <span className="font-medium text-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </span>
      <div className={`mt-1.5 flex overflow-hidden rounded-xl border ${borderCls} bg-background shadow-sm focus-within:ring-2 focus-within:ring-ring`}>
        <select
          value={hour}
          onChange={(e) => onChange(`${to24Hour(e.target.value, period as "AM" | "PM")}:${minute || "00"}`)}
          className={`${baseSelect} border-r border-input`}
        >
          <option value="">Hr</option>
          {hours.map((h) => (
            <option key={h} value={h}>{h}</option>
          ))}
        </select>
        <select
          value={minute}
          onChange={(e) => onChange(`${to24Hour(hour || "12", period as "AM" | "PM")}:${e.target.value}`)}
          className={`${baseSelect} border-r border-input`}
        >
          <option value="">Min</option>
          {minutes.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <select
          value={period}
          onChange={(e) => onChange(`${to24Hour(hour || "12", e.target.value as "AM" | "PM")}:${minute || "00"}`)}
          className={baseSelect}
        >
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </label>
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
  label, value, onChange, type = "text", placeholder, error, required, step,
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; error?: string; required?: boolean; step?: number;
}) {
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
      <span className="font-medium text-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </span>
      <input
        type={type}
        {...(type === "number" ? { min: 0, step: step ?? 1, inputMode: "numeric" as const } : {})}
        {...(type === "time" && step !== undefined ? { step } : {})}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={(e) => { if (type === "number" && (e.key === "-" || e.key === "e")) e.preventDefault(); }}
        placeholder={placeholder}
        className={`mt-1.5 w-full rounded-xl border ${error ? "border-destructive ring-1 ring-destructive/30" : "border-input"} bg-background px-3 py-2 text-sm shadow-sm outline-none ring-ring focus:ring-2`}
      />
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
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
