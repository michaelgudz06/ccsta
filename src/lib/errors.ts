import { COMPANY } from "@/lib/company";

// Turn raw Postgres/network errors into something safe to show a customer.
// Most of our own RAISE EXCEPTION messages (submit_quote, edit_own_quote,
// cancel_own_quote, request_quote_cancellation, confirm_own_quote) are
// already written in plain English and safe to pass through as-is — so
// instead of a brittle allowlist, this blocks known-bad shapes (network
// failures, raw SQL/constraint text, bare technical words) and only falls
// back to a generic message for those. New well-written server messages
// added later pass through automatically without this file needing an update.
const RAW_ERROR_PATTERNS = [
  /fetch/i,
  /network/i,
  /typeerror/i,
  /violates/i,
  /constraint/i,
  /syntax error/i,
  /^unauthorized$/i,
  /not authenticated/i,
  /^quote not found$/i,
];

export function friendlyError(error: unknown, fallback?: string): string {
  const raw =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message
      : "";
  console.error(fallback ?? "Error:", error);

  const genericFallback = fallback ??
    `Something went wrong. Please try again, or call us at ${COMPANY.phoneDispatch} if it keeps happening.`;

  if (!raw || raw.includes("\n") || RAW_ERROR_PATTERNS.some((re) => re.test(raw))) {
    return genericFallback;
  }
  return raw;
}
