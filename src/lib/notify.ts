import { supabase } from "@/lib/supabase";

/**
 * Fire-and-forget: ask the notify-send Edge Function to deliver any emails
 * queued in notification_log. Called right after actions that queue one
 * (quote submitted / approved / accepted / cancellation request).
 * Failures are ignored — undelivered rows stay 'pending' and go out on the
 * next dispatch.
 */
export function dispatchNotifications() {
  void supabase.functions.invoke("notify-send").catch(() => {});
}
