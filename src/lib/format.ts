// Date helpers that treat "YYYY-MM-DD" as a plain calendar date, NOT a UTC
// timestamp. `new Date("2026-07-09")` parses as UTC midnight, which renders as
// the *previous* day in Pacific time — that was the trip-date off-by-one bug.
// Always go through these helpers when showing or comparing trip dates.

/** Parse a "YYYY-MM-DD" string into a Date at LOCAL midnight (no UTC shift). */
export function parseLocalDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/** Format a "YYYY-MM-DD" trip date for display, e.g. "Jul 9, 2026". */
export function formatTripDate(
  dateStr: string | null | undefined,
  opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" },
): string {
  if (!dateStr) return "—";
  const d = parseLocalDate(dateStr);
  return d ? d.toLocaleDateString("en-CA", opts) : "—";
}

/** Today as "YYYY-MM-DD" in the user's LOCAL timezone. */
export function todayISO(): string {
  const d = new Date();
  return toISODate(d);
}

/** A Date → "YYYY-MM-DD" using local calendar fields (no UTC shift). */
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Add `n` days to a "YYYY-MM-DD" string, returning a new "YYYY-MM-DD". */
export function addDaysISO(dateStr: string, n: number): string {
  const d = parseLocalDate(dateStr) ?? new Date();
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

/** Format a time string "HH:MM[:SS]" as "8:30 AM". */
export function formatTime(timeStr: string | null | undefined): string {
  if (!timeStr) return "—";
  const [h, m] = timeStr.split(":").map(Number);
  if (Number.isNaN(h)) return "—";
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m ?? 0).padStart(2, "0")} ${period}`;
}

/** Format a dollar amount, e.g. 1234.5 → "$1,234.50". */
export function formatMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-CA", { style: "currency", currency: "CAD" });
}

export const TRIP_TYPE_LABELS: Record<string, string> = {
  two_way: "Two-way",
  one_way: "One-way",
  shuttle: "Shuttle",
  multi_destination: "Multi-destination",
  multi_trip: "Multi-trip",
};

/** Format a `quote_versions.trip_type` value for display, e.g. "two_way" → "Two-way". */
export function formatTripType(t?: string | null): string {
  return t ? (TRIP_TYPE_LABELS[t] ?? t) : "—";
}
