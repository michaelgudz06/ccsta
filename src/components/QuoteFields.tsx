import { useEffect, useState } from "react";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";

// Shared form primitives used by both the quote form (quote.tsx) and the
// customer portal's edit modal (portal.tsx). Pulled out to their own file
// rather than exported from quote.tsx directly, since quote.tsx is a
// TanStack Router route file (createFileRoute) and the router plugin
// code-splits route components — importing route-to-route risks fighting
// that transform. Plain component files have no such concern.

export type ShuttleRun = { pickup: string; dropoff: string };
export type MultiStop = { address: string; arrivalTime: string; departureTime: string };
export type ReturnStop = { address: string; arrivalTime: string };

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
export function TimeField({
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

export function Stepper({
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

export function Field({
  label, value, onChange, type = "text", placeholder, error, required, step, id, disabled, hint, min, max,
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; error?: string; required?: boolean; step?: number; id?: string; disabled?: boolean; hint?: string; min?: string; max?: string;
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
        disabled={disabled}
        {...(type === "number" ? { min: 0, step: step ?? 1, inputMode: "numeric" as const } : {})}
        {...(type === "time" && step !== undefined ? { step } : {})}
        {...(type === "date" ? { min, max } : {})}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={(e) => { if (type === "number" && (e.key === "-" || e.key === "e")) e.preventDefault(); }}
        placeholder={placeholder}
        className={`mt-1.5 w-full rounded-xl border ${error ? "border-destructive ring-1 ring-destructive/30" : "border-input"} bg-background px-3 py-2 text-sm shadow-sm outline-none ring-ring focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60`}
      />
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </label>
  );
}

// Run-count stepper + one pickup/drop-off TimeField pair per run, each
// clearly labeled "Run N pickup" / "Run N drop-off" so it's obvious which
// run is being edited. Used by both the new-quote form (quote.tsx) and the
// portal's edit modal (portal.tsx) — fully controlled, no internal state.
export function ShuttleRunsEditor({
  id, runs, onChange, error, onErrorClear,
}: {
  id?: string;
  runs: ShuttleRun[];
  onChange: (runs: ShuttleRun[]) => void;
  error?: string;
  onErrorClear?: () => void;
}) {
  return (
    <div id={id} className="space-y-4">
      <Stepper
        label="Number of runs"
        value={String(runs.length)}
        onChange={(v) => {
          const n = Math.max(1, parseInt(v || "1", 10) || 1);
          if (n === runs.length) return;
          onChange(
            n > runs.length
              ? [...runs, ...Array.from({ length: n - runs.length }, () => ({ pickup: "", dropoff: "" }))]
              : runs.slice(0, n),
          );
          onErrorClear?.();
        }}
      />
      {runs.map((run, i) => (
        <div key={i} className="grid gap-4 rounded-2xl border border-border bg-surface p-4 sm:grid-cols-2 sm:p-5">
          <TimeField
            label={`Run ${i + 1} pickup`} required
            value={run.pickup}
            onChange={(v) => {
              onChange(runs.map((r, ri) => (ri === i ? { ...r, pickup: v } : r)));
              onErrorClear?.();
            }}
          />
          <TimeField
            label={`Run ${i + 1} drop-off`} required
            value={run.dropoff}
            onChange={(v) => {
              onChange(runs.map((r, ri) => (ri === i ? { ...r, dropoff: v } : r)));
              onErrorClear?.();
            }}
          />
        </div>
      ))}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

// Per-stop cards (address + arrival/departure + remove) plus the "return to
// school" leg, each stop clearly labeled "Stop N — [address]" so it's
// obvious which stop is being edited. Used by both the new-quote form
// (quote.tsx) and the portal's edit modal (portal.tsx) — fully controlled,
// no internal state. The top-level pickup departure time is NOT part of
// this component (it's a separate, already-shared TimeField the caller
// renders alongside this one) since it isn't a per-stop concern.
export function MultiStopsEditor({
  id, stops, onChange, includeReturnLeg, onIncludeReturnLegChange,
  returnStop, onReturnStopChange, onReturnAddressTouched, error, onErrorClear,
}: {
  id?: string;
  stops: MultiStop[];
  onChange: (stops: MultiStop[]) => void;
  includeReturnLeg: boolean;
  onIncludeReturnLegChange: (v: boolean) => void;
  returnStop: ReturnStop;
  onReturnStopChange: (r: ReturnStop) => void;
  onReturnAddressTouched?: () => void;
  error?: string;
  onErrorClear?: () => void;
}) {
  return (
    <div id={id} className="space-y-4">
      {stops.map((stop, i) => (
        <div key={i} className="space-y-3 rounded-2xl border border-border bg-surface p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Stop {i + 1}{stop.address ? ` — ${stop.address}` : ""}
            </div>
            {stops.length > 1 && (
              <button
                type="button"
                onClick={() => { onChange(stops.filter((_, si) => si !== i)); onErrorClear?.(); }}
                className="text-xs font-semibold text-destructive hover:underline"
              >
                Remove
              </button>
            )}
          </div>
          <AddressAutocomplete
            label="Destination address"
            value={stop.address}
            onChange={(v) => {
              onChange(stops.map((st, si) => (si === i ? { ...st, address: v } : st)));
              onErrorClear?.();
            }}
            placeholder="e.g. 1455 Quebec St, Vancouver, BC"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TimeField
              label="Arrival time"
              value={stop.arrivalTime}
              onChange={(v) => {
                onChange(stops.map((st, si) => (si === i ? { ...st, arrivalTime: v } : st)));
                onErrorClear?.();
              }}
            />
            <TimeField
              label="Departure time"
              value={stop.departureTime}
              onChange={(v) => {
                onChange(stops.map((st, si) => (si === i ? { ...st, departureTime: v } : st)));
                onErrorClear?.();
              }}
            />
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          onChange([...stops, { address: "", arrivalTime: "", departureTime: "" }]);
          onErrorClear?.();
        }}
        className="text-sm font-semibold text-primary hover:underline"
      >
        + Add another stop
      </button>

      <div className="space-y-3 rounded-2xl border border-dashed border-border bg-surface p-4 sm:p-5">
        <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          <input
            type="checkbox"
            checked={includeReturnLeg}
            onChange={(e) => onIncludeReturnLegChange(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          Return to origin
        </label>
        {includeReturnLeg && (
          <>
            <AddressAutocomplete
              label="Return address"
              value={returnStop.address}
              onChange={(v) => {
                onReturnStopChange({ ...returnStop, address: v });
                onReturnAddressTouched?.();
                onErrorClear?.();
              }}
              placeholder="Defaults to your pick-up address"
            />
            <TimeField
              label="Arrival time"
              value={returnStop.arrivalTime}
              onChange={(v) => {
                onReturnStopChange({ ...returnStop, arrivalTime: v });
                onErrorClear?.();
              }}
            />
          </>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
