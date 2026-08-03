/// <reference types="google.maps" />
/**
 * Address autocomplete backed by Google Maps Places API.
 * Falls back gracefully to a plain text input if the API key is missing
 * or if billing isn't enabled on the Google Cloud project yet.
 *
 * The VITE_GOOGLE_MAPS_API_KEY env var must be set for autocomplete to work.
 * Restrict the key to HTTP referrers in the Google Cloud Console.
 */
import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    google?: typeof google;
    __gmapsLoading?: boolean;
    __gmapsReady?: boolean;
    __gmapsCallbacks?: (() => void)[];
  }
}

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

function loadGoogleMaps(callback: () => void) {
  if (typeof window === "undefined") return;
  if (window.__gmapsReady) { callback(); return; }
  if (!window.__gmapsCallbacks) window.__gmapsCallbacks = [];
  window.__gmapsCallbacks.push(callback);
  if (window.__gmapsLoading) return;
  window.__gmapsLoading = true;
  const script = document.createElement("script");
  script.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}&libraries=places&callback=__gmapsInit`;
  script.async = true;
  script.defer = true;
  (window as any).__gmapsInit = () => {
    window.__gmapsReady = true;
    (window.__gmapsCallbacks ?? []).forEach((cb) => cb());
    window.__gmapsCallbacks = [];
  };
  document.head.appendChild(script);
}

export interface AddressResult {
  formatted: string;
  streetNumber: string;
  route: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
}

interface Props {
  label: string;
  value: string;
  onChange: (value: string, result?: AddressResult) => void;
  placeholder?: string;
  error?: string;
  required?: boolean;
  className?: string;
  id?: string;
}

export function AddressAutocomplete({ label, value, onChange, placeholder, error, required, id }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [mapsReady, setMapsReady] = useState(false);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

  useEffect(() => {
    if (!MAPS_KEY) return;
    loadGoogleMaps(() => setMapsReady(true));
  }, []);

  useEffect(() => {
    if (!mapsReady || !inputRef.current) return;
    if (autocompleteRef.current) return; // already attached

    try {
      const ac = new window.google!.maps.places.Autocomplete(inputRef.current, {
        componentRestrictions: { country: "ca" },
        fields: ["formatted_address", "address_components"],
        types: ["address"],
      });
      autocompleteRef.current = ac;

      ac.addListener("place_changed", () => {
        const place = ac.getPlace();
        if (!place.address_components) return;

        const get = (type: string) =>
          place.address_components!.find((c) => c.types.includes(type))?.long_name ?? "";
        const getShort = (type: string) =>
          place.address_components!.find((c) => c.types.includes(type))?.short_name ?? "";

        const result: AddressResult = {
          formatted:    place.formatted_address ?? "",
          streetNumber: get("street_number"),
          route:        get("route"),
          city:         get("locality") || get("sublocality") || get("administrative_area_level_2"),
          province:     getShort("administrative_area_level_1"),
          postalCode:   get("postal_code"),
          country:      getShort("country"),
        };

        onChange(place.formatted_address ?? "", result);
      });
    } catch (err) {
      // Degrading to a plain text input is the right behaviour (Places may be
      // unavailable if billing lapses or the key restriction rejects the
      // referrer) -- but swallowing it silently left nobody able to diagnose
      // "autocomplete stopped working". BUG_BACKLOG #22.
      console.warn("Address autocomplete unavailable, falling back to plain input:", err);
    }
  }, [mapsReady, onChange]);

  return (
    <label id={id} className="block text-sm">
      <span className="font-medium text-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className={`mt-1.5 w-full rounded-xl border ${
          error ? "border-destructive ring-1 ring-destructive/30" : "border-input"
        } bg-background px-3 py-2 text-sm shadow-sm outline-none ring-ring focus:ring-2`}
      />
      {!MAPS_KEY && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Include the full address: street number, street, city (e.g. 1455 Quebec St, Vancouver, BC).
        </p>
      )}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </label>
  );
}
