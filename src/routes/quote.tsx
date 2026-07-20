import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { AppTopBar } from "@/components/AppTopBar";
import { RouteMap } from "@/components/RouteMap";
import { MultiStopRouteMap, type GeocodePoint } from "@/components/MultiStopRouteMap";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import {
  Field, TimeField, Stepper, ShuttleRunsEditor, MultiStopsEditor,
  type ShuttleRun, type MultiStop, type ReturnStop,
} from "@/components/QuoteFields";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { dispatchNotifications } from "@/lib/notify";
import { useAuth } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { COMPANY } from "@/lib/company";

type TripType = "two_way" | "one_way" | "shuttle" | "multi_destination" | "multi_trip";

const TRIP_TYPE_OPTIONS: { value: TripType; label: string; hint: string }[] = [
  { value: "two_way", label: "Two-way", hint: "Round trip — we drop your group off and pick them back up." },
  { value: "one_way", label: "One-way", hint: "Drop-off only, no return." },
  { value: "shuttle", label: "Shuttle", hint: "Repeated runs between your school and ONE destination throughout the day." },
  { value: "multi_destination", label: "Multi-destination", hint: "Several DIFFERENT destinations in ONE day." },
  { value: "multi_trip", label: "Multi-trip", hint: "Booking across MULTIPLE DAYS — arranged directly with our office." },
];

export const Route = createFileRoute("/quote")({
  validateSearch: (search: Record<string, unknown>): { edit?: string } => ({
    edit: typeof search.edit === "string" ? search.edit : undefined,
  }),
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
  const { edit: editQuoteId } = Route.useSearch();
  const [prefilled, setPrefilled] = useState(false);

  // "Edit mode": reopens this same form pre-filled with an existing quote's
  // data instead of starting blank. editLoading gates rendering until the
  // fetch resolves; editBlocked holds a user-facing reason (wrong status,
  // pending cancellation, not found/not yours) when the quote can't be
  // edited online, checked client-side for a nicer experience than filling
  // out the whole form only to hit a server error at the end. The real
  // enforcement is still edit_own_quote itself.
  const [editLoading, setEditLoading] = useState(!!editQuoteId);
  const [editBlocked, setEditBlocked] = useState<string | null>(null);
  const [editLoaded, setEditLoaded] = useState(false);

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
  const [multiStops, setMultiStops] = useState<MultiStop[]>([{ address: "", arrivalTime: "", departureTime: "" }]);
  const [includeReturnLeg, setIncludeReturnLeg] = useState(true);
  const [returnStop, setReturnStop] = useState<ReturnStop>({ address: "", arrivalTime: "" });
  const [returnAddressTouched, setReturnAddressTouched] = useState(false);
  const [multiStopGeocode, setMultiStopGeocode] = useState<GeocodePoint[]>([]);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  // Member pricing (2hr minimum vs 4hr): only looked up for logged-in
  // customers, since RLS only permits reading `schools` when authenticated.
  // Logged-out customers always see the non-member 4hr minimum, unchanged
  // from today — Melody's admin review is the safety net for a member
  // school that quoted while logged out.
  const [isMemberSchool, setIsMemberSchool] = useState(false);

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
    if (Array.isArray(d.multiStops) && d.multiStops.length) setMultiStops(d.multiStops as MultiStop[]);
    if (typeof d.includeReturnLeg === "boolean") setIncludeReturnLeg(d.includeReturnLeg);
    if (d.returnStop) setReturnStop(d.returnStop as ReturnStop);
    if (typeof d.returnAddressTouched === "boolean") setReturnAddressTouched(d.returnAddressTouched);
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
      (Array.isArray(d.multiStops) && d.multiStops.some((s) => (s as MultiStop).address || (s as MultiStop).arrivalTime || (s as MultiStop).departureTime)) ||
      d.kToFour || d.grade5Plus || d.adults ||
      d.c1n || d.c1e || d.c1p || d.dayN || d.dayP || d.notes || d.driverPref,
    );

  useEffect(() => {
    // Editing an existing quote has nothing to do with the anonymous
    // new-quote draft mechanism -- skip the resume-prompt entirely.
    if (editQuoteId) { setDraftReady(true); return; }
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
    if (editQuoteId || typeof window === "undefined" || !draftReady) return;
    const draft = { school, pickup, destination, destinationAddress, date, tripType, departTime, returnTime, shuttleRuns, multiStops, includeReturnLeg, returnStop, returnAddressTouched, kToFour, grade5Plus, adults, cargo, c1n, c1e, c1p, c2n, c2e, c2p, dayN, dayP, notes, driverPref };
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* quota */ }
  }, [editQuoteId, draftReady, school, pickup, destination, destinationAddress, date, tripType, departTime, returnTime, shuttleRuns, multiStops, includeReturnLeg, returnStop, returnAddressTouched, kToFour, grade5Plus, adults, cargo, c1n, c1e, c1p, c2n, c2e, c2p, dayN, dayP, notes, driverPref]);

  // Prefill from previous quote (blank-form convenience only — skipped
  // entirely in edit mode, where the load-existing-quote effect below
  // populates everything instead).
  useEffect(() => {
    if (!session || prefilled || editQuoteId) return;
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
  }, [session, prefilled, editQuoteId]);

  // Edit mode: load the existing quote and pre-fill the entire form. RLS
  // already scopes `quotes`/`quote_versions` reads to the owning customer
  // (or an admin), so a foreign quote id simply comes back empty -- treated
  // the same as "not found" below, no separate ownership check needed.
  useEffect(() => {
    if (!editQuoteId || editLoaded) return;
    setEditLoaded(true);
    (async () => {
      const { data: q } = await supabase
        .from("quotes")
        .select("status, current_version_id, cancellation_requested_at, schools(name)")
        .eq("id", editQuoteId)
        .maybeSingle();
      if (!q || !q.current_version_id) {
        setEditBlocked("This quote couldn't be found.");
        setEditLoading(false);
        return;
      }
      const currentVersionId = q.current_version_id;
      if (!["requested", "in_review", "approved", "confirmed"].includes(q.status)) {
        setEditBlocked("This quote can no longer be edited online — please call us.");
        setEditLoading(false);
        return;
      }
      if (q.cancellation_requested_at) {
        setEditBlocked("A cancellation request is already pending for this quote — it can't be edited at the same time.");
        setEditLoading(false);
        return;
      }
      const { data: v } = await supabase
        .from("quote_versions")
        .select("destination_name, destination_address, pickup_address, trip_date, trip_type, departure_time, return_time, student_count, adults_count, grade_breakdown, cargo_needed, contact_primary, contact_secondary, contact_day_of, special_requests, driver_preference")
        .eq("id", currentVersionId)
        .maybeSingle();
      if (!v) {
        setEditBlocked("This quote couldn't be found.");
        setEditLoading(false);
        return;
      }
      const [runsRes, stopsRes] = await Promise.all([
        supabase.from("quote_shuttle_runs").select("run_number, pickup_time, dropoff_time").eq("quote_version_id", currentVersionId).order("run_number", { ascending: true }),
        supabase.from("quote_multi_stops").select("stop_number, destination_name, destination_address, arrival_time, departure_time").eq("quote_version_id", currentVersionId).order("stop_number", { ascending: true }),
      ]);

      setSchool((q.schools as { name?: string } | null)?.name ?? "");
      setPickup(v.pickup_address ?? "");
      setDestination(v.destination_name ?? "");
      setDestinationAddress(v.destination_address ?? "");
      setDate(v.trip_date ?? "");
      setTripType(v.trip_type as TripType);
      setDepartTime(v.departure_time ?? "");
      setReturnTime(v.return_time ?? "");

      const runs = runsRes.data ?? [];
      setShuttleRuns(runs.length > 0 ? runs.map((r) => ({ pickup: r.pickup_time, dropoff: r.dropoff_time })) : [{ pickup: "", dropoff: "" }]);

      // A return-to-school leg has no departure_time (arrival-only, last in
      // the sequence) -- regular stops always have both. That's the only
      // signal we have to split the flat DB rows back into the "regular
      // stops" + "return leg" shape this form uses.
      const stopRows = stopsRes.data ?? [];
      const lastStop = stopRows[stopRows.length - 1];
      const hasReturnLeg = stopRows.length > 0 && lastStop.departure_time == null;
      const regularStops = hasReturnLeg ? stopRows.slice(0, -1) : stopRows;
      setMultiStops(
        regularStops.length > 0
          ? regularStops.map((s) => ({ address: s.destination_address, arrivalTime: s.arrival_time, departureTime: s.departure_time ?? "" }))
          : [{ address: "", arrivalTime: "", departureTime: "" }],
      );
      setIncludeReturnLeg(hasReturnLeg);
      setReturnStop(hasReturnLeg ? { address: lastStop.destination_address, arrivalTime: lastStop.arrival_time } : { address: "", arrivalTime: "" });
      // The return-leg address is already an explicit saved value here, not
      // a blank default waiting to be auto-filled from pickup.
      setReturnAddressTouched(true);

      const grades = Array.isArray(v.grade_breakdown) ? (v.grade_breakdown as { grade?: string; count?: string }[]) : [];
      setKToFour(String(grades.find((g) => String(g.grade).toUpperCase() === "K")?.count ?? ""));
      setGrade5Plus(String(grades.find((g) => String(g.grade) === "5")?.count ?? ""));
      setAdults(v.adults_count != null ? String(v.adults_count) : "");
      setCargo(!!v.cargo_needed);

      const c1 = (v.contact_primary ?? {}) as { name?: string; email?: string; phone?: string };
      const c2 = (v.contact_secondary ?? {}) as { name?: string; email?: string; phone?: string };
      const cd = (v.contact_day_of ?? {}) as { name?: string; phone?: string };
      setC1n(c1.name ?? ""); setC1e(c1.email ?? ""); setC1p(c1.phone ?? "");
      setC2n(c2.name ?? ""); setC2e(c2.email ?? ""); setC2p(c2.phone ?? "");
      setDayN(cd.name ?? ""); setDayP(cd.phone ?? "");

      setNotes(v.special_requests ?? "");
      setDriverPref(v.driver_preference ?? "");

      setEditLoading(false);
    })();
  }, [editQuoteId, editLoaded]);

  // Multi-destination: default the return-leg address to the pickup address
  // until the customer edits it themselves — still fully editable/removable.
  useEffect(() => {
    if (tripType !== "multi_destination" || returnAddressTouched) return;
    const fallback = pickup || school;
    if (fallback && returnStop.address !== fallback) {
      setReturnStop((r) => ({ ...r, address: fallback }));
    }
  }, [tripType, pickup, school, returnAddressTouched, returnStop.address]);

  // Member pricing: logged-in customers only (RLS: schools_auth_read
  // requires auth.uid() IS NOT NULL). Debounced so this doesn't fire on
  // every keystroke while typing the school name. Case-insensitive exact
  // match on the trimmed name, same matching approach submit_quote already
  // uses server-side (lower(trim(name))).
  useEffect(() => {
    if (!session || !school.trim()) { setIsMemberSchool(false); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      supabase
        .from("schools")
        .select("is_member")
        .ilike("name", school.trim())
        .limit(1)
        .maybeSingle()
        .then(({ data }) => {
          if (!cancelled) setIsMemberSchool(data?.is_member ?? false);
        });
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [session, school]);

  // Bus-engaged envelope: for two-way/one-way this is just departure->return;
  // for shuttle it's the first pickup -> last drop-off across all runs (the
  // bus is tied up continuously, gaps between runs included); for
  // multi-destination the start is the explicit pickup departure time (same
  // field/logic as two-way/one-way — no longer derived from stop times) and
  // the end is the latest arrival time across all stops, whether that's the
  // last regular stop or the return leg. The distance route is a SEPARATE
  // calculation below — driver-time hours only ever come from these times.
  // "HH:MM" strings compare lexicographically within a single day, so
  // min/max works directly.
  const filledRuns = shuttleRuns.filter((r) => r.pickup && r.dropoff);
  const allMultiStopArrivals = [
    ...multiStops.map((s) => s.arrivalTime),
    ...(includeReturnLeg ? [returnStop.arrivalTime] : []),
  ].filter(Boolean);
  const filledMultiStops = [...multiStops, ...(includeReturnLeg ? [returnStop] : [])].filter((s) => s.address);
  const envelopeDepart = tripType === "shuttle"
    ? filledRuns.reduce((min, r) => (!min || r.pickup < min ? r.pickup : min), "")
    : departTime;
  const envelopeReturn = tripType === "shuttle"
    ? filledRuns.reduce((max, r) => (r.dropoff > max ? r.dropoff : max), "")
    : tripType === "multi_destination"
    ? allMultiStopArrivals.reduce((max, t) => (t > max ? t : max), "")
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

  // Client-side preview estimate using real 2026-2027 rates (member and
  // non-member — see the isMemberSchool lookup above, same signal used for
  // the minimum-hours floor below).
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
  const hourlyRate = isMemberSchool
    ? (benchCount === 56 ? 78.75 : 68.25)
    : (benchCount === 56 ? 105.00 : 92.50);
  // 2hr minimum for a recognized member school (logged-in only — see the
  // isMemberSchool lookup above), 4hr otherwise.
  const minHours   = isMemberSchool ? 2 : 4;
  // Use actual trip duration if entered, otherwise fall back to minimum
  const tripHours  = tripHoursCalc !== null ? tripHoursCalc : minHours;
  // Minimum applies to TRIP TIME ONLY (matches calculate_estimate) — the
  // driver-time buffer always adds on top of the (possibly floored) trip
  // time, never absorbed into the minimum.
  const billableTripHours = Math.max(tripHours, minHours);
  // System estimate: flat 1hr driver-time buffer (matches calculate_estimate's
  // driver_time_buffer_hours default — Melody can set a more accurate time
  // later, but the public preview always shows this flat-buffer figure).
  const DRIVER_TIME_BUFFER_HOURS = 1;
  const driverHours = billableTripHours + DRIVER_TIME_BUFFER_HOURS;
  const billHours  = driverHours;
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
    if (tripType !== "multi_destination") {
      if (!destination.trim())       e.destination = "Please enter the destination name.";
      if (!destinationAddress.trim()) e.destinationAddress = "Please enter the destination address so we can calculate the route.";
    }
    if (!date)                     e.date = "Please select the trip date.";

    if (tripType === "shuttle") {
      if (shuttleRuns.length === 0 || shuttleRuns.some((r) => !r.pickup || !r.dropoff)) {
        e.shuttleRuns = "Please enter pickup and drop-off times for every run.";
      }
    } else if (tripType === "multi_destination") {
      if (!departTime) e.departTime = "Please enter the pickup departure time.";
      // Unresolved addresses do NOT block submission (Melody confirms those
      // by hand) — this only requires every stop to actually have an
      // address and times filled in.
      const stopsIncomplete = multiStops.some((s) => !s.address || !s.arrivalTime || !s.departureTime);
      const returnIncomplete = includeReturnLeg && (!returnStop.address || !returnStop.arrivalTime);
      if (multiStops.length === 0 || stopsIncomplete || returnIncomplete) {
        e.multiStops = "Please enter an address and time for every stop.";
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
      const order = ["passengers", "school", "destination", "destinationAddress", "date", "departTime", "returnTime", "shuttleRuns", "multiStops", "c1n", "c1e", "c1p", "c2e", "c2n", "dayN", "dayP"];
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

    // Shared shape both submit_quote and edit_own_quote accept — school_name
    // (create-only, school isn't editable here) and driver_preference
    // (placement differs below) are the only fields not in common.
    const tripFields = {
      pickup_address:      pickup || school,
      trip_date:           date,
      trip_type:           tripType,
      // Destinations for multi-destination live per-stop below, not here.
      ...(tripType !== "multi_destination"
        ? { destination_name: destination, destination_address: destinationAddress }
        : {}),
      ...(tripType === "shuttle"
        ? { shuttle_runs: shuttleRuns.map((r, i) => ({ run_number: i + 1, pickup_time: r.pickup, dropoff_time: r.dropoff })) }
        : tripType === "multi_destination"
        ? {
            departure_time: departTime,
            stops: [
              ...multiStops.map((s, i) => ({
                stop_number: i + 1,
                destination_address: s.address,
                arrival_time: s.arrivalTime,
                departure_time: s.departureTime,
                lat: multiStopGeocode[i + 1]?.lat ?? undefined,
                lng: multiStopGeocode[i + 1]?.lng ?? undefined,
              })),
              ...(includeReturnLeg
                ? [{
                    stop_number: multiStops.length + 1,
                    destination_address: returnStop.address,
                    arrival_time: returnStop.arrivalTime,
                    lat: multiStopGeocode[multiStops.length + 1]?.lat ?? undefined,
                    lng: multiStopGeocode[multiStops.length + 1]?.lng ?? undefined,
                  }]
                : []),
            ],
          }
        : { departure_time: departTime, return_time: returnTime }),
      student_count:       String(totalStudents),
      adults_count:        adults,
      grade_breakdown:     [{ grade: "K", count: kToFour }, { grade: "5", count: grade5Plus }],
      cargo_needed:        cargo,
      contact_primary:     { name: c1n, email: c1e, phone: c1p },
      contact_secondary:   { name: c2n, email: c2e, phone: c2p },
      contact_day_of:      { name: dayN, phone: dayP },
      special_requests:    notes,
    };

    if (editQuoteId) {
      const { error } = await supabase.rpc("edit_own_quote" as never, {
        p_quote_id: editQuoteId,
        // driver_preference goes straight into the edit payload (no
        // separate best-effort call needed, unlike the create path below).
        p_data: { ...tripFields, driver_preference: driverPref },
      } as never);
      setSubmitting(false);
      if (error) { setSubmitError(error.message); return; }
      // Save the route distance so the server-side estimate can apply the
      // long-distance surcharge (best-effort) — same call the create path
      // makes, just against the already-known quote id.
      if (distanceKm != null) {
        await supabase.rpc("set_quote_distance_km" as never, { p_quote_id: editQuoteId, p_distance_km: distanceKm } as never);
      }
      dispatchNotifications();
      navigate({ to: "/portal" });
      return;
    }

    const { data, error } = await supabase.rpc("submit_quote", {
      p_data: { school_name: school, ...tripFields },
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

  // Edit mode: loading or blocked states take over the whole page, same
  // pattern as the draft-resume prompt and success screen below.
  if (editQuoteId && editLoading) {
    return (
      <div className="min-h-screen bg-surface">
        <AppTopBar />
        <main className="mx-auto max-w-xl px-4 py-20 text-center text-sm text-muted-foreground sm:px-6">
          Loading your quote…
        </main>
      </div>
    );
  }
  if (editBlocked) {
    return (
      <div className="min-h-screen bg-surface">
        <AppTopBar />
        <main className="mx-auto max-w-xl px-4 py-20 sm:px-6">
          <div className="rounded-3xl border border-border bg-card p-7 text-center shadow-soft">
            <h1 className="text-xl font-semibold text-foreground">Can't edit this quote online</h1>
            <p className="mt-3 text-sm text-muted-foreground">{editBlocked}</p>
            <Button className="mt-6" variant="accent" onClick={() => navigate({ to: "/portal" })}>
              Back to my quotes
            </Button>
          </div>
        </main>
      </div>
    );
  }

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
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            {editQuoteId ? "Update your trip request" : "Get a Quote"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {editQuoteId
              ? "Change what you need, then save — we'll review the changes and confirm a new price."
              : <>Takes about 3 minutes. {session ? "" : "You'll need to log in to submit."}</>}
          </p>
        </div>

        <div className="space-y-5">
            <SectionCard number={1} title="Trip type" hint="What kind of trip is this?">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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
                <h2 className="text-lg font-bold text-foreground">Booking across multiple days?</h2>
                <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                  Planning several separate trips on different days is arranged directly with our office
                  rather than through this instant-estimate form. Reach out and Melody will put a custom
                  quote together for you.
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
                  disabled={!!editQuoteId}
                  hint={editQuoteId ? "Can't be changed here — call us if this needs to change." : undefined}
                />
                <AddressAutocomplete
                  label="Pick-up address (leave blank to use school name)"
                  value={pickup} onChange={(v) => setPickup(v)}
                  placeholder="e.g. 123 Main St, Maple Ridge, BC"
                />
              </div>

              {tripType !== "multi_destination" && (
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
              )}

              <Field
                id="field-date"
                label="Trip date" type="date" required
                value={date} onChange={(v) => { setDate(v); setErrors((e) => ({ ...e, date: "" })); }}
                error={errors.date}
              />

              {tripType === "shuttle" ? (
                <ShuttleRunsEditor
                  id="field-shuttleRuns"
                  runs={shuttleRuns}
                  onChange={setShuttleRuns}
                  error={errors.shuttleRuns}
                  onErrorClear={() => setErrors((e) => ({ ...e, shuttleRuns: "" }))}
                />
              ) : tripType === "multi_destination" ? (
                <div className="space-y-4">
                  <TimeField
                    id="field-departTime"
                    label="Departure time from pickup" required
                    value={departTime} onChange={(v) => { setDepartTime(v); setErrors((e) => ({ ...e, departTime: "" })); }}
                    error={errors.departTime}
                  />
                  <MultiStopsEditor
                    id="field-multiStops"
                    stops={multiStops}
                    onChange={setMultiStops}
                    includeReturnLeg={includeReturnLeg}
                    onIncludeReturnLegChange={setIncludeReturnLeg}
                    returnStop={returnStop}
                    onReturnStopChange={setReturnStop}
                    onReturnAddressTouched={() => setReturnAddressTouched(true)}
                    error={errors.multiStops}
                    onErrorClear={() => setErrors((e) => ({ ...e, multiStops: "" }))}
                  />
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
                  <span className="text-xs font-semibold text-foreground/80">{tripType === "shuttle" || tripType === "multi_destination" ? "Bus engaged" : "Trip length"}</span>
                  <span className="text-sm font-bold text-primary tabular-nums">
                    {Math.floor(tripMinutes / 60)}h{tripMinutes % 60 > 0 ? ` ${tripMinutes % 60}m` : ""}
                  </span>
                </div>
              )}

              {/* Route map preview — appears as soon as pickup + destination are filled */}
              {tripType === "multi_destination" ? (
                (pickup || school) && filledMultiStops.length > 0 && (
                  <div className="rounded-2xl border border-border bg-surface overflow-hidden">
                    <div className="px-4 pt-3 pb-1">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Route preview</p>
                    </div>
                    <MultiStopRouteMap
                      addresses={[pickup || school, ...multiStops.map((s) => s.address), ...(includeReturnLeg ? [returnStop.address] : [])]}
                      departTime={envelopeDepart || undefined}
                      onResult={(r) => setDistanceKm(r?.distanceKm ?? null)}
                      onGeocodeUpdate={setMultiStopGeocode}
                      className="h-52 w-full"
                    />
                    <p className="px-4 py-2 text-xs text-muted-foreground">
                      Distance shown is the full route: pickup → every stop → return leg (if included), all summed.
                      Longer routes mean more hours on the clock.
                    </p>
                  </div>
                )
              ) : (
                showMapPreview && (
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
                )
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
                  Runs back and forth between the same pickup and destination all day. Your bus is booked
                  continuously from the first pickup to the last drop-off, even if there are gaps between runs.
                </p>
              )}
              {tripType === "multi_destination" && (
                <p className="text-xs text-muted-foreground">
                  Your bus is booked from the earliest stop time to the latest. If an address can't be located
                  automatically, your request still goes through — Melody will confirm the route by hand.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                *All trips are a minimum of {minHours} hours{isMemberSchool ? " (member rate)" : ""}.
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
                    <Row dark label="Suggested bus" value={`${busLabel}${busCount > 1 ? ` × ${busCount}` : ""} (${isMemberSchool ? "member" : "non-member"} rate)`} />
                    <Row dark label="Hourly rate" value={`${formatMoney(hourlyRate)}/hr`} />
                    <Row dark label="Trip time" value={`${billableTripHours.toFixed(1)} hrs`} />
                    <Row dark label="Driver time" value={`${(billHours - billableTripHours).toFixed(1)} hrs`} />
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
                  "Driver time" covers time on the clock beyond the trip itself — getting the bus to your pickup and
                  back, plus our minimum booking length. Ballpark only, based on bus size and trip length. Melody or
                  Alan will confirm the exact amount after reviewing your request — it may be higher or lower based
                  on the actual route. No surprise billing.
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
                  {editQuoteId
                    ? (submitting ? "Saving…" : "Save changes")
                    : (submitting ? "Submitting…" : session ? "Submit request" : "Create account & send")}
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

function StepWrap({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <h2 className="text-xl font-semibold text-foreground">{title}</h2>
      {children}
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
