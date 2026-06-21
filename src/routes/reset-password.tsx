import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { PasswordInput } from "@/components/PasswordInput";
import { COMPANY } from "@/lib/company";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: `Set a New Password — ${COMPANY.name}` },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  // Supabase puts a recovery session in place from the email link. Wait for it.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setReady(!!data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError("Use at least 8 characters."); return; }
    if (password !== confirm) { setError("Those passwords don't match."); return; }
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setDone(true);
    setTimeout(() => navigate({ to: "/login" }), 1800);
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-6 sm:px-6 lg:px-8">
        <Logo />
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">← Back to site</Link>
      </div>
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md rounded-3xl border border-border bg-card p-8 shadow-elevated">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Set a new password</h1>

          {done ? (
            <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
              Password updated. Taking you to the login page…
            </p>
          ) : !ready ? (
            <p className="mt-4 text-sm text-muted-foreground">
              Open this page from the reset link in your email. If you got here by mistake,{" "}
              <Link to="/login" className="font-medium text-primary hover:underline">go back to log in</Link>.
            </p>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-4">
              <label className="block text-sm">
                <span className="font-medium text-foreground">New password</span>
                <PasswordInput value={password} onChange={setPassword} placeholder="At least 8 characters" autoComplete="new-password" />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-foreground">Confirm new password</span>
                <PasswordInput value={confirm} onChange={setConfirm} placeholder="Re-enter password" autoComplete="new-password" />
              </label>
              {error && (
                <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
              )}
              <Button type="submit" variant="hero" size="lg" className="w-full" disabled={busy}>
                {busy ? "Saving…" : "Save new password"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
