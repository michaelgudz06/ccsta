import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { AppTopBar } from "@/components/AppTopBar";
import { RouteMap } from "@/components/RouteMap";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { dispatchNotifications } from "@/lib/notify";
import { useAuth } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { COMPANY } from "@/lib/company";

type TripType = "two_way" | "one_way" | "shuttle" | "multi_trip";
type ShuttleRun = { pickup: string; dropoff: string };

const TRIP_TYPE_OPTIONS: { value: TripType; label: string; hint: string }[] = [
  { value: "two_way", label: "Two-way", hint: "Round trip — we drop off and pick the group back up." },
  { value: "one_way", label: "One-way", hint: "Drop-off only, no return leg." },
  { value: "shuttle", label: "Shuttle", hint: "Multiple pickup/drop-off runs the same day." },
  { value: "multi_trip", label: "Multi-trip", hint: "Booking several separate trips at once." },
];

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

function QuotePage() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const [prefilled, setPrefilled] = useState(false);

  // Step 1
  const [school, setSchool] = useState("");
  const [pickup, setPickup] = useState("");
  const [destination, setDestination] = useState("");
  const [destinationAddress, setDestinationAddress] = useState("");
  const [date, setDate] = useState("");
  const [tripType, setTripType] = useState<TripType>("two_way");
  const [departTime, setDepartTime] = useState("");
  const [returnTime, setReturnTime] = useState("");
  const [shuttleRuns, setShuttleRuns] = useState<ShuttleRun[]>([{ pickup: "", dropoff: "" }]);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);

  // Step 2 — passenger calculator (K-4 seat 3-per-bench, Grade 5+ & adults seat 2-per-bench)
  const [kToFour, setKToFour] = useState("");
  const [grade5Plus, setGrade5Plus] = useState("");
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

  // Submission
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedQuoteNo, setSubmittedQuoteNo] = useState<string | null>(null);

  // ── Draft autosave ──────────────────────────────────────────────────────────
  // Keep everything the user types so it survives the signup round-trip:
  // get a rough estimate → create an account → come back with it all pre-filled.
  // A returning visitor with a meaningful saved draft is asked to resume or
  // start fresh (see pendingDraft below) rather than being silently repopulated.
  const DRAFT_KEY = "ccsta_quote_draft_v1";

  const [pendingDraft, setPendingDraft] = useState<Record<string, unknown> | null>(null);
  // Gates the autosave effect below so it can't fire (and overwrite the saved
  // draft with the form's blank initial state) before we've checked for one.
  const [draftReady, setDraftReady] = useState(false);

  const applyDraft = (d: Record<string, unknown>) => {
    if (d.school) setSchool(d.school as string);
    if (d.pickup) setPickup(d.pickup as string);
    if (d.destination) setDestination(d.destination as string);
    if (d.destinationAddress) setDestinationAddress(d.destinationAddress as string);
    if (d.date) setDate(d.date as string);
    if (d.tripType) setTripType(d.tripType as TripType);
    if (d.departTime) setDepartTime(d.departTime as string);
    if (d.returnTime) setReturnTime(d.returnTime as string);
    if (Array.isArray(d.shuttleRuns) && d.shuttleRuns.length) setShuttleRuns(d.shuttleRuns as ShuttleRun[]);
    if (d.kToFour) setKToFour(d.kToFour as string);
    if (d.grade5Plus) setGrade5Plus(d.grade5Plus as string);
    if (d.adults) setAdults(d.adults as string);
    if (typeof d.cargo === "boolean") setCargo(d.cargo);
    if (d.c1n) setC1n(d.c1n as string); if (d.c1e) setC1e(d.c1e as string); if (d.c1p) setC1p(d.c1p as string);
    if (d.c2n) setC2n(d.c2n as string); if (d.c2e) setC2e(d.c2e as string); if (d.c2p) setC2p(d.c2p as string);
    if (d.dayN) setDayN(d.dayN as string); if (d.dayP) setDayP(d.dayP as string);
    if (d.notes) setNotes(d.notes as string);
    if (d.driverPref) setDriverPref(d.driverPref as string);
  };

  // A draft is only worth asking about if it has some identifying content —
  // an empty shell (e.g. someone bounced off step 1 having typed nothing)
  // shouldn't trigger a prompt.
  const draftHasContent = (d: Record<string, unknown>) =>
    Boolean(
      d.school || d.pickup || d.destination || d.destinationAddress || d.date ||
      (d.tripType && d.tripType !== "two_way") ||
      d.departTime || d.returnTime ||
      (Array.isArray(d.shuttleRuns) && d.shuttleRuns.some((r) => (r as ShuttleRun).pickup || (r as ShuttleRun).dropoff)) ||
      d.kToFour || d.grade5Plus || d.adults ||
      d.c1n || d.c1e || d.c1p || d.dayN || d.dayP || d.notes || d.driverPref,
    );

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) { setDraftReady(true); return; }
      const d = JSON.parse(raw);
      if (draftHasContent(d)) {
        setPendingDraft(d);
      } else {
        setDraftReady(true);
      }
    } catch {
      setDraftReady(true); // malformed draft — ignore and proceed
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleResumeDraft = () => {
    if (pendingDraft) applyDraft(pendingDraft);
    setPendingDraft(null);
    setDraftReady(true);
  };

  const handleStartFresh = () => {
    if (typeof window !== "undefined") localStorage.removeItem(DRAFT_KEY);
    setPendingDraft(null);
    setDraftReady(true);
  };

  useEffect(() => {
    if (typeof window === "undefined" || !draftReady) return;
    const draft = { school, pickup, destination, destinationAddress, date, tripType, departTime, returnTime, shuttleRuns, kToFour, grade5Plus, adults, cargo, c1n, c1e, c1p, c2n, c2e, c2p, dayN, dayP, notes, driverPref };
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* quota */ }
  }, [draftReady, school, pickup, destination, destinationAddress, date, tripType, departTime, returnTime, shuttleRuns, kToFour, grade5Plus, adults, cargo, c1n, c1e, c1p, c2n, c2e, c2p, dayN, dayP, notes, driverPref]);

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

  // Bus-engaged envelope: for two-way/one-way this is just departure->return;
  // for shuttle it's the first pickup -> last drop-off across all runs (the
  // bus is tied up continuously, gaps between runs included). "HH:MM" strings
  // compare lexicographically within a single day, so min/max works directly.
  const filledRuns = shuttleRuns.filter((r) => r.pickup && r.dropoff);
  const envelopeDepart = tripType === "shuttle"
    ? filledRuns.reduce((min, r) => (!min || r.pickup < min ? r.pickup : min), "")
    : departTime;
  const envelopeReturn = tripType === "shuttle"
    ? filledRuns.reduce((max, r) => (r.dropoff > max ? r.dropoff : max), "")
    : returnTime;

  // Trip-duration helper (minutes)
  const tripMinutes = (() => {
    if (!envelopeDepart || !envelopeReturn) return null;
    const [dh, dm] = envelopeDepart.split(":").map(Number);
    const [rh, rm] = envelopeReturn.split(":").map(Number);
    let diff = (rh * 60 + rm) - (dh * 60 + dm);
    if (diff < 0) diff += 24 * 60;
    return diff;
  })();
  const tripHoursCalc = tripMinutes !== null ? tripMinutes / 60 : null;

  // Client-side preview estimate using real 2026-2027 non-member rates.
  // Seat-based capacity: each bus has bench seats (18->9, 47->23.67, 56->28);
  // older riders (Gr 5+ & adults) take 2 per seat, younger (K-4) take 3 per seat.
  const youngN = parseInt(kToFour) || 0;
  const olderStudentsN = parseInt(grade5Plus) || 0;
  const adultsN = parseInt(adults) || 0;
  const totalStudents = youngN + olderStudentsN;
  const olderN = olderStudentsN + adultsN;
  const seatsNeeded = youngN / 3 + olderN / 2;
  const BUS_SEATS: Record<number, number> = { 18: 9, 47: 23.67, 56: 28 };
  const headcount = totalStudents + adultsN;
  const benchCount = seatsNeeded <= 9 ? 18 : seatsNeeded <= 23.67 ? 47 : 56;
  const busCount   = seatsNeeded > 0 ? Math.max(1, Math.ceil(seatsNeeded / BUS_SEATS[benchCount])) : 1;
  const hourlyRate = benchCount === 56 ? 105.00 : 92.50;
  const minHours   = 4;
  // Use actual trip duration if entered, otherwise fall back to minimum
  const tripHours  = tripHoursCalc !== null ? tripHoursCalc : minHours;
  // System estimate: flat 1hr driver-time buffer (matches calculate_estimate's
  // driver_time_buffer_hours default — Melody can set a more accurate time
  // later, but the public preview always shows this flat-buffer figure).
  const DRIVER_TIME_BUFFER_HOURS = 1;
  const driverHours = tripHours + DRIVER_TIME_BUFFER_HOURS;
  const billHours  = Math.max(driverHours, minHours);
  const baseCost   = billHours * hourlyRate * busCount;
  const fuelSurcharge = 50 * busCount;
  const LONG_DISTANCE_THRESHOLD_KM = 200;
  const LONG_DISTANCE_RATE_PER_KM = 1;
  const longDistanceCharge = distanceKm != null && distanceKm > LONG_DISTANCE_THRESHOLD_KM
    ? (distanceKm - LONG_DISTANCE_THRESHOLD_KM) * LONG_DISTANCE_RATE_PER_KM * busCount
    : 0;
  const subtotal   = baseCost + fuelSurcharge + longDistanceCharge;
  const gst        = subtotal * 0.05;
  const estimatedTotal = subtotal + gst;
  const busLabel   = benchCount === 18 ? "18-passenger mini-bus" : benchCount === 47 ? "47-passenger coach" : "56-passenger coach";

  // Validation — the whole page at once, run on submit. Scrolls to and
  // highlights the first error, in the same top-to-bottom order the
  // sections render in (passenger calculator → trip details → contacts).
  const validateAll = (): boolean => {
    const e: Record<string, string> = {};

    if (totalStudents + adultsN < 1) e.passengers = "Please enter at least 1 passenger.";

    if (!school.trim())            e.school = "Please enter your school name.";
    if (!destination.trim())       e.destination = "Please enter the destination name.";
    if (!destinationAddress.trim()) e.destinationAddress = "Please enter the destination address so we can calculate the route.";
    if (!date)                     e.date = "Please select the trip date.";

    if (tripType === "shuttle") {
      if (shuttleRuns.length === 0 || shuttleRuns.some((r) => !r.pickup || !r.dropoff)) {
        e.shuttleRuns = "Please enter pickup and drop-off times for every run.";
      }
    } else {
      if (!departTime) e.departTime = "Please enter the departure time.";
      if (!returnTime) {
        e.returnTime = tripType === "one_way"
          ? "Please enter the drop-off time."
          : "Please enter the pick-up time from the destination.";
      }
    }

    if (!c1n.trim()) e.c1n = "Name is required.";
    if (!c1e.trim()) e.c1e = "Email is required.";
    if (!c1p.trim()) e.c1p = "Phone is required.";
    // Secondary contact is OPTIONAL — no required checks.

    if (!dayN.trim()) e.dayN = "Name is required.";
    if (!dayP.trim()) e.dayP = "Phone is required.";

    // Primary and secondary must be two different people.
    const norm = (str: string) => str.trim().toLowerCase();
    if (c1e.trim() && c2e.trim() && norm(c1e) === norm(c2e)) {
      e.c2e = "Use a different email — the secondary contact must be a different person.";
    } else if (c1n.trim() && c2n.trim() && norm(c1n) === norm(c2n)) {
      e.c2n = "The secondary contact must be a different person from the primary.";
    }

    setErrors(e);
    if (Object.keys(e).length > 0) {
      const order = ["passengers", "school", "destination", "destinationAddress", "date", "departTime", "returnTime", "shuttleRuns", "c1n", "c1e", "c1p", "c2e", "c2n", "dayN", "dayP"];
      const firstKey = order.find((k) => e[k]);
      if (firstKey && typeof document !== "undefined") {
        document.getElementById(`field-${firstKey}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return false;
    }
    return true;
  };

  const handleSubmit = async () => {
    if (!validateAll()) return;
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
        trip_type:           tripType,
        ...(tripType === "shuttle"
          ? { shuttle_runs: shuttleRuns.map((r, i) => ({ run_number: i + 1, pickup_time: r.pickup, dropoff_time: r.dropoff })) }
          : { departure_time: departTime, return_time: returnTime }),
        student_count:       String(totalStudents),
        adults_count:        adults,
        grade_breakdown:     [{ grade: "K", count: kToFour }, { grade: "5", count: grade5Plus }],
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
    // Save the route distance so the server-side estimate can apply the long-distance surcharge (best-effort).
    if (distanceKm != null && result.quote_id) {
      await supabase.rpc("set_quote_distance_km" as never, { p_quote_id: result.quote_id, p_distance_km: distanceKm } as never);
    }
    dispatchNotifications();
    if (typeof window !== "undefined") localStorage.removeItem(DRAFT_KEY);
    setSubmittedQuoteNo(result.quote_number);
  };

  // Resume-or-start-fresh prompt — shown instead of the form until answered,
  // so nothing autosaves and no field renders until the user picks one.
  if (pendingDraft) {
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
        <main className="mx-auto max-w-xl px-4 py-20 sm:px-6">
          <div className="rounded-3xl border border-border bg-card p-7 shadow-soft">
            <h1 className="text-xl font-semibold text-foreground">Resume your quote?</h1>
            <p className="mt-3 text-sm text-muted-foreground">
              We found a quote you started earlier but didn't finish.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Button className="flex-1" variant="outline" onClick={handleStartFresh}>
                Start fresh
              </Button>
              <Button className="flex-1" variant="accent" onClick={handleResumeDraft}>
                Resume where I left off
              </Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

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
        <main className="mx-auto max-w-xl px-4 py-20 sm:px-6">
          <div className="rounded-3xl border border-border bg-card p-7 text-center shadow-soft sm:p-10">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <Check className="h-7 w-7 text-primary" />
            </div>
            <h1 className="mt-5 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Request received!</h1>
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
          </div>
        </main>
      </div>
    );
  }

  // Whether to show the route map preview in the trip details section
  const showMapPreview = !!(pickup || school) && !!destinationAddress;

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

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Get a Quote</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Takes about 3 minutes. {session ? "" : "You'll need to log in to submit."}
          </p>
        </div>

        <div className="space-y-5">
            <SectionCard number={1} title="Trip type" hint="What kind of trip is this?">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {TRIP_TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setTripType(opt.value)}
                    className={`rounded-2xl border p-3.5 text-left transition-colors ${
                      tripType === opt.value ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "border-border hover:border-primary/40"
                    }`}
                  >
                    <div className="text-sm font-bold text-foreground">{opt.label}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{opt.hint}</div>
                  </button>
                ))}
              </div>
            </SectionCard>

            {tripType === "multi_trip" ? (
              <div className="rounded-3xl border border-border bg-card p-6 text-center shadow-soft sm:p-7">
                <h2 className="text-lg font-bold text-foreground">Booking multiple trips?</h2>
                <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                  Multi-trip bookings are arranged directly with our office rather than through this
                  instant-estimate form. Reach out and Melody will put a custom quote together for you.
                </p>
                <a
                  href={`mailto:${COMPANY.email}`}
                  className="mt-4 inline-block font-semibold text-primary hover:underline"
                >
                  Contact Melody — {COMPANY.email}
                </a>
              </div>
            ) : (
              <>
            <SectionCard number={2} title="Contact info">
              <div>
                <div className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">Primary contact</div>
                <p className="mb-3.5 text-xs text-muted-foreground">
                  The person booking this trip — usually the school secretary or administrator. We'll send the confirmed quote to this person.
                </p>
                <div className="space-y-3.5">
                  <Field id="field-c1n" label="Name" required value={c1n} onChange={(v) => { setC1n(v); setErrors((e) => ({ ...e, c1n: "" })); }} placeholder="Jane Smith" error={errors.c1n} />
                  <div className="grid gap-3.5 sm:grid-cols-2">
                    <Field id="field-c1e" label="Email" type="email" required value={c1e} onChange={(v) => { setC1e(v); setErrors((e) => ({ ...e, c1e: "" })); }} placeholder="jane@school.ca" error={errors.c1e} />
                    <Field id="field-c1p" label="Phone" required value={c1p} onChange={(v) => { setC1p(v); setErrors((e) => ({ ...e, c1p: "" })); }} placeholder="604-555-0100" error={errors.c1p} />
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">Day-of contact</div>
                <p className="mb-3.5 text-xs text-muted-foreground">Who the driver calls on trip day.</p>
                <div className="grid gap-3.5 sm:grid-cols-2">
                  <Field id="field-dayN" label="Name" required value={dayN} onChange={(v) => { setDayN(v); setErrors((e) => ({ ...e, dayN: "" })); }} placeholder="Ms. Johnson" error={errors.dayN} />
                  <Field id="field-dayP" label="Phone (cell preferred)" required value={dayP} onChange={(v) => { setDayP(v); setErrors((e) => ({ ...e, dayP: "" })); }} placeholder="604-555-0102" error={errors.dayP} />
                </div>
              </div>

              <Disclosure
                label="Add secondary contact"
                openLabel="Hide secondary contact"
                defaultOpen={!!(c2n || c2e || c2p)}
              >
                <p className="text-xs text-muted-foreground">
                  An optional backup contact — for example a vice-principal or another administrator.
                </p>
                <div className="grid gap-3.5 sm:grid-cols-3">
                  <Field id="field-c2n" label="Name" value={c2n} onChange={(v) => { setC2n(v); setErrors((e) => ({ ...e, c2n: "" })); }} placeholder="John Doe" error={errors.c2n} />
                  <Field id="field-c2e" label="Email" type="email" value={c2e} onChange={(v) => { setC2e(v); setErrors((e) => ({ ...e, c2e: "" })); }} placeholder="john@school.ca" error={errors.c2e} />
                  <Field label="Phone" value={c2p} onChange={(v) => { setC2p(v); setErrors((e) => ({ ...e, c2p: "" })); }} placeholder="604-555-0101" error={errors.c2p} />
                </div>
              </Disclosure>
            </SectionCard>

            <SectionCard number={3} title="Trip details" hint="We'll size the bus and estimate your route.">
              <div className="rounded-2xl border border-border p-4 space-y-3.5">
                <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">School &amp; pickup</div>
                <Field
                  id="field-school"
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
              </div>

              <div className="rounded-2xl border border-border p-4 space-y-3.5">
                <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Destination</div>
                <Field
                  id="field-destination"
                  label="Destination name" required
                  value={destination} onChange={(v) => { setDestination(v); setErrors((e) => ({ ...e, destination: "" })); }}
                  placeholder="e.g. Science World"
                  error={errors.destination}
                />
                <AddressAutocomplete
                  id="field-destinationAddress"
                  label="Destination address" required
                  value={destinationAddress}
                  onChange={(v) => { setDestinationAddress(v); setErrors((e) => ({ ...e, destinationAddress: "" })); }}
                  placeholder="e.g. 1455 Quebec St, Vancouver, BC"
                  error={errors.destinationAddress}
                />
              </div>

              <Field
                id="field-date"
                label="Trip date" type="date" required
                value={date} onChange={(v) => { setDate(v); setErrors((e) => ({ ...e, date: "" })); }}
                error={errors.date}
              />

              {tripType === "shuttle" ? (
                <div id="field-shuttleRuns" className="space-y-4">
                  <Stepper
                    label="Number of runs"
                    value={String(shuttleRuns.length)}
                    onChange={(v) => {
                      const n = Math.max(1, parseInt(v || "1", 10) || 1);
                      setShuttleRuns((runs) => {
                        if (n === runs.length) return runs;
                        if (n > runs.length) {
                          return [...runs, ...Array.from({ length: n - runs.length }, () => ({ pickup: "", dropoff: "" }))];
                        }
                        return runs.slice(0, n);
                      });
                      setErrors((e) => ({ ...e, shuttleRuns: "" }));
                    }}
                  />
                  {shuttleRuns.map((run, i) => (
                    <div key={i} className="grid gap-4 rounded-2xl border border-border bg-surface p-4 sm:grid-cols-2 sm:p-5">
                      <TimeField
                        label={`Run ${i + 1} pickup`} required
                        value={run.pickup}
                        onChange={(v) => {
                          setShuttleRuns((runs) => runs.map((r, ri) => (ri === i ? { ...r, pickup: v } : r)));
                          setErrors((e) => ({ ...e, shuttleRuns: "" }));
                        }}
                      />
                      <TimeField
                        label={`Run ${i + 1} drop-off`} required
                        value={run.dropoff}
                        onChange={(v) => {
                          setShuttleRuns((runs) => runs.map((r, ri) => (ri === i ? { ...r, dropoff: v } : r)));
                          setErrors((e) => ({ ...e, shuttleRuns: "" }));
                        }}
                      />
                    </div>
                  ))}
                  {errors.shuttleRuns && <p className="text-xs text-destructive">{errors.shuttleRuns}</p>}
                </div>
              ) : (
                <div className="grid gap-4 rounded-2xl border border-border bg-surface p-4 sm:grid-cols-2 sm:p-5">
                  <TimeField
                    id="field-departTime"
                    label="Departure time" required
                    value={departTime} onChange={(v) => { setDepartTime(v); setErrors((e) => ({ ...e, departTime: "" })); }}
                    error={errors.departTime}
                  />
                  <TimeField
                    id="field-returnTime"
                    label={tripType === "one_way" ? "Drop-off time" : "Pick-up from destination"} required
                    value={returnTime} onChange={(v) => { setReturnTime(v); setErrors((e) => ({ ...e, returnTime: "" })); }}
                    error={errors.returnTime}
                  />
                </div>
              )}

              {tripMinutes !== null && (
                <div className="flex items-center justify-between rounded-xl bg-primary/5 px-4 py-3">
                  <span className="text-xs font-semibold text-foreground/80">{tripType === "shuttle" ? "Bus engaged" : "Trip length"}</span>
                  <span className="text-sm font-bold text-primary tabular-nums">
                    {Math.floor(tripMinutes / 60)}h{tripMinutes % 60 > 0 ? ` ${tripMinutes % 60}m` : ""}
                  </span>
                </div>
              )}

              {/* Route map preview — appears as soon as pickup + destination are filled */}
              {showMapPreview && (
                <div className="rounded-2xl border border-border bg-surface overflow-hidden">
                  <div className="px-4 pt-3 pb-1">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Route preview</p>
                  </div>
                  <RouteMap
                    pickup={pickup || school}
                    destination={destinationAddress}
                    departTime={envelopeDepart || undefined}
                    onResult={(r) => setDistanceKm(r.distanceKm)}
                    className="h-52 w-full"
                  />
                  <p className="px-4 py-2 text-xs text-muted-foreground">
                    Distance shown is one-way from your pick-up. Your quote covers the driver's full day — travel to your school, your trip, and the return.
                    Longer routes mean more hours on the clock.
                  </p>
                </div>
              )}

              {tripType === "two_way" && (
                <p className="text-xs text-muted-foreground">
                  "Pick-up from destination" is when you want us to collect the students and head back to school.
                </p>
              )}
              {tripType === "one_way" && (
                <p className="text-xs text-muted-foreground">
                  We won't be picking the group up again — the bus is done once it drops off.
                </p>
              )}
              {tripType === "shuttle" && (
                <p className="text-xs text-muted-foreground">
                  Your bus is booked continuously from the first pickup to the last drop-off, even if there are gaps between runs.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                *All trips are a minimum of 4 hours.
              </p>
            </SectionCard>

            <SectionCard number={4} title="Who's riding?" hint="We'll size the bus for you.">
              <Stepper
                id="field-passengers"
                label="K–4 students · 3 to a seat"
                value={kToFour}
                onChange={(v) => { setKToFour(v); setErrors((e) => ({ ...e, passengers: "" })); }}
              />

              <div className="rounded-2xl border border-border p-1.5 px-4">
                <div className="pb-1 pt-2.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Older riders &middot; 2 to a seat
                </div>
                <div className="divide-y divide-border">
                  <Stepper
                    bare
                    label="Grade 5+ students"
                    value={grade5Plus}
                    onChange={(v) => { setGrade5Plus(v); setErrors((e) => ({ ...e, passengers: "" })); }}
                  />
                  <Stepper
                    bare
                    label="Adults / chaperones"
                    value={adults}
                    onChange={(v) => { setAdults(v); setErrors((e) => ({ ...e, passengers: "" })); }}
                  />
                </div>
              </div>

              {errors.passengers && (
                <p className="text-sm text-destructive">{errors.passengers}</p>
              )}

              <div className={`rounded-2xl border p-4 transition-colors ${headcount > 0 ? "border-primary/30 bg-primary/5" : "border-dashed border-border bg-surface"}`}>
                {headcount > 0 ? (
                  <>
                    <div className="text-base font-bold text-foreground">
                      {busLabel}{busCount > 1 ? ` × ${busCount}` : ""}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {headcount} passenger{headcount === 1 ? "" : "s"}
                    </div>
                  </>
                ) : (
                  <div className="text-sm font-medium text-foreground">Add passengers above to see your bus</div>
                )}
              </div>

              <div>
                <label className="flex items-center gap-3 rounded-2xl border border-border p-3.5">
                  <input type="checkbox" checked={cargo} onChange={(e) => setCargo(e.target.checked)} className="h-[18px] w-[18px] accent-primary" />
                  <span className="text-sm">
                    <span className="font-semibold text-foreground">Cargo needed?</span>{" "}
                    <span className="text-muted-foreground">Equipment, instruments, sports gear, etc.</span>
                  </span>
                </label>
                <p className="mt-2 text-xs text-muted-foreground">
                  *Our cargo busses fit 1 airport carry-on baggage per person.
                </p>
              </div>

              <div>
                <label className="block text-sm">
                  <span className="font-medium text-foreground">Special requests</span>
                  <span className="ml-2 text-xs text-muted-foreground">(optional)</span>
                  <textarea
                    rows={4}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Accessibility or special-needs seating, musical instruments, anything we should know."
                    className="mt-1.5 w-full rounded-xl border border-input bg-background px-3.5 py-2.5 text-sm shadow-sm outline-none ring-ring focus:ring-2"
                  />
                </label>
              </div>
              <div>
                <label className="block text-sm">
                  <span className="font-medium text-foreground">Preferred driver</span>
                  <span className="ml-2 text-xs text-muted-foreground">(optional)</span>
                  <input
                    value={driverPref}
                    onChange={(e) => setDriverPref(e.target.value)}
                    placeholder="If you've had a driver you'd like again, name them here."
                    className="mt-1.5 w-full rounded-xl border border-input bg-background px-3.5 py-2.5 text-sm shadow-sm outline-none ring-ring focus:ring-2"
                  />
                </label>
                <p className="mt-2 text-xs text-muted-foreground">
                  We'll do our best to honour it. If they're not available on your date, we'll reach out so you can choose your date or your driver.
                </p>
              </div>
            </SectionCard>

            <SectionCard number={5} title="Your estimate">
              <section
                className="rounded-2xl p-5 text-white shadow-elevated sm:p-6"
                style={{ background: "linear-gradient(135deg, oklch(0.27 0.07 260), oklch(0.38 0.09 260))" }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-white/60">Instant estimate</div>
                    <div className="mt-1 text-lg font-bold text-white">{destination || "Your destination"}</div>
                    <div className="text-sm text-white/70">
                      {date || "—"} · {envelopeDepart || "—"} → {envelopeReturn || "—"} · {totalStudents || "—"} students
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white">
                    Estimate
                  </span>
                </div>

                <table className="mt-5 w-full text-sm">
                  <tbody className="divide-y divide-white/15">
                    <Row dark label="Suggested bus" value={`${busLabel}${busCount > 1 ? ` × ${busCount}` : ""} (non-member rate)`} />
                    <Row dark label="Hourly rate" value={`${formatMoney(hourlyRate)}/hr`} />
                    <Row dark label={`Billable hours (${billHours > minHours ? `${billHours.toFixed(1)} hrs actual` : `${minHours} hr minimum`})`} value={`${billHours.toFixed(1)} hrs`} />
                    <Row dark label="Base cost" value={formatMoney(baseCost)} />
                    <Row dark label="Fuel surcharge (flat)" value={formatMoney(fuelSurcharge)} />
                    {longDistanceCharge > 0 && (
                      <Row dark label={`Long-distance (${(distanceKm! - LONG_DISTANCE_THRESHOLD_KM).toFixed(1)} km beyond ${LONG_DISTANCE_THRESHOLD_KM}km)`} value={formatMoney(longDistanceCharge)} />
                    )}
                    <Row dark label="Subtotal" value={formatMoney(subtotal)} />
                    <Row dark label="GST (5%)" value={formatMoney(gst)} />
                    <Row dark label="Estimated total" value={formatMoney(estimatedTotal)} emphasize />
                  </tbody>
                </table>
                <p className="mt-4 text-xs leading-relaxed text-white/50">
                  Ballpark only, based on bus size and trip length. Melody or Alan will confirm the exact amount after reviewing your request — it may be higher or lower based on the actual route. No surprise billing.
                </p>
              </section>

              <ul className="space-y-1.5 rounded-2xl border border-dashed border-border bg-card p-4 text-xs text-muted-foreground">
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

              <div className="space-y-3 pt-1">
                <Button variant="accent" size="xl" className="w-full font-bold" onClick={handleSubmit} disabled={submitting}>
                  {submitting ? "Submitting…" : session ? "Submit request" : "Create account & send"}
                </Button>
                {!session && (
                  <Button
                    variant="outline" size="lg" className="w-full"
                    onClick={() => { if (typeof window !== "undefined") window.location.href = "/login?next=/quote"; }}
                  >
                    I already have an account
                  </Button>
                )}
                <p className="text-center text-xs text-muted-foreground">Free &amp; no obligation · Serving the Lower Mainland &amp; beyond</p>
              </div>
            </SectionCard>
              </>
            )}
        </div>
      </main>
    </div>
  );
}

function to12Hour(value: string): { hour: string; minute: string; period: "AM" | "PM" } {
  if (!value) return { hour: "", minute: "", period: "AM" };
  const [h, m] = value.split(":");
  let hourNum = parseInt(h, 10);
  const period: "AM" | "PM" = hourNum >= 12 ? "PM" : "AM";
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

function clampHour12(v: string): number | null {
  const n = parseInt(v, 10);
  return v.trim() === "" || isNaN(n) || n < 1 || n > 12 ? null : n;
}
function clampMinute(v: string): number | null {
  const n = parseInt(v, 10);
  return isNaN(n) || n < 0 || n > 59 ? null : n;
}

// HH:MM text inputs + AM/PM toggle. Internally buffers raw keystrokes so the
// user can type freely; only resolves and commits a full 24h "HH:MM" string
// (the same contract the old <select>-based picker used) on blur / period click.
function TimeField({
  label, value, onChange, error, required, id,
}: {
  label: string; value: string; onChange: (v: string) => void; error?: string; required?: boolean; id?: string;
}) {
  const parsed = to12Hour(value);
  const [hourText, setHourText] = useState(parsed.hour);
  const [minText, setMinText] = useState(parsed.minute);

  useEffect(() => {
    const p = to12Hour(value);
    setHourText(p.hour);
    setMinText(p.minute);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = (hText: string, mText: string, period: "AM" | "PM") => {
    const hn = clampHour12(hText);
    const mn = mText.trim() === "" ? 0 : clampMinute(mText);
    if (hn == null || mn == null) return;
    onChange(`${to24Hour(String(hn), period)}:${String(mn).padStart(2, "0")}`);
  };

  const handleHourBlur = () => {
    const hn = clampHour12(hourText);
    if (hn == null) { setHourText(parsed.hour); return; }
    setHourText(String(hn));
    commit(String(hn), minText, parsed.period);
  };
  const handleMinBlur = () => {
    const mn = minText.trim() === "" ? 0 : clampMinute(minText);
    if (mn == null) { setMinText(parsed.minute); return; }
    const padded = String(mn).padStart(2, "0");
    setMinText(padded);
    commit(hourText, padded, parsed.period);
  };

  const borderCls = error ? "border-destructive ring-1 ring-destructive/30" : "border-input";

  return (
    <label id={id} className="block text-sm">
      <span className="font-medium text-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </span>
      <div className="mt-1.5 flex items-center gap-2.5">
        <div className={`flex h-11 items-center gap-1.5 rounded-xl border ${borderCls} bg-background px-3.5 focus-within:ring-2 focus-within:ring-ring`}>
          <input
            type="text" inputMode="numeric" maxLength={2}
            value={hourText}
            onChange={(e) => setHourText(e.target.value.replace(/\D/g, "").slice(0, 2))}
            onBlur={handleHourBlur}
            placeholder="HH"
            aria-label={`${label} — hour`}
            className="w-5 border-0 bg-transparent p-0 text-right text-[15px] font-bold tabular-nums text-foreground outline-none"
          />
          <span className="text-[15px] font-bold text-muted-foreground/50">:</span>
          <input
            type="text" inputMode="numeric" maxLength={2}
            value={minText}
            onChange={(e) => setMinText(e.target.value.replace(/\D/g, "").slice(0, 2))}
            onBlur={handleMinBlur}
            placeholder="MM"
            aria-label={`${label} — minute`}
            className="w-5 border-0 bg-transparent p-0 text-[15px] font-bold tabular-nums text-foreground outline-none"
          />
        </div>
        <div className="flex h-11 shrink-0 overflow-hidden rounded-xl border border-input">
          {(["AM", "PM"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => commit(hourText, minText, p)}
              className={`w-10 text-xs font-semibold transition-colors ${p === "PM" ? "border-l border-input" : ""} ${
                parsed.period === p ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
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

function Stepper({
  label, value, onChange, bare, id,
}: {
  label: string; value: string; onChange: (v: string) => void; bare?: boolean; id?: string;
}) {
  const n = parseInt(value, 10) || 0;
  const set = (next: number) => {
    const clamped = Math.max(0, next);
    onChange(clamped === 0 ? "" : String(clamped));
  };
  return (
    <div id={id} className={`flex items-center justify-between gap-4 ${bare ? "py-2.5" : "rounded-2xl border border-border p-3.5"}`}>
      <div className="text-sm font-semibold text-foreground">{label}</div>
      <div className="flex h-[42px] shrink-0 items-center overflow-hidden rounded-xl border border-input">
        <button
          type="button" onClick={() => set(n - 1)} disabled={n <= 0}
          aria-label={`Decrease ${label}`}
          className="flex h-full w-10 items-center justify-center text-xl font-medium text-primary hover:bg-muted disabled:opacity-30"
        >
          &minus;
        </button>
        <input
          type="text" inputMode="numeric"
          value={value === "" ? "0" : value}
          onChange={(e) => {
            const raw = e.target.value.replace(/\D/g, "");
            if (raw === "") { onChange(""); return; }
            const parsedN = Math.max(0, parseInt(raw, 10));
            onChange(parsedN === 0 ? "" : String(parsedN));
          }}
          aria-label={label}
          className="h-full w-11 border-0 bg-transparent text-center text-[17px] font-bold tabular-nums text-foreground outline-none"
        />
        <button
          type="button" onClick={() => set(n + 1)}
          aria-label={`Increase ${label}`}
          className="flex h-full w-10 items-center justify-center text-xl font-medium text-primary hover:bg-muted"
        >
          +
        </button>
      </div>
    </div>
  );
}

function SectionCard({
  number, title, hint, children,
}: {
  number: number; title: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-border bg-card p-6 shadow-soft sm:p-7">
      <div className={`flex items-center gap-2.5 ${hint ? "mb-1" : "mb-5"}`}>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-xs font-bold text-primary">
          {number}
        </span>
        <h2 className="text-lg font-bold tracking-tight text-foreground">{title}</h2>
      </div>
      {hint && <p className="mb-5 pl-[34px] text-sm text-muted-foreground">{hint}</p>}
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function Disclosure({
  label, openLabel, defaultOpen, children,
}: {
  label: string; openLabel: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 border-0 bg-transparent p-0 text-sm font-semibold text-primary hover:text-primary/80"
      >
        <span className={`inline-block text-lg leading-none transition-transform ${open ? "rotate-90" : ""}`}>&rsaquo;</span>
        {open ? openLabel : label}
      </button>
      {open && <div className="mt-4 space-y-3.5 border-t border-border pt-5">{children}</div>}
    </div>
  );
}

function Field({
  label, value, onChange, type = "text", placeholder, error, required, step, id,
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; error?: string; required?: boolean; step?: number; id?: string;
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
    <label id={id} className="block text-sm">
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

function Row({
  label, value, emphasize, dark,
}: {
  label: string; value: string; emphasize?: boolean; dark?: boolean;
}) {
  const labelCls = dark ? "text-white/60" : "text-muted-foreground";
  const valueCls = dark
    ? emphasize ? "text-lg font-extrabold text-white" : "text-white/90"
    : emphasize ? "text-base font-bold text-foreground" : "text-foreground";
  return (
    <tr>
      <td className={`py-2 ${labelCls}`}>{label}</td>
      <td className={`py-2 text-right ${valueCls}`}>{value}</td>
    </tr>
  );
}
