import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { COMPANY } from "@/lib/company";
import { User, Bus, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: `Log In — ${COMPANY.name}` },
      { name: "description", content: "Log in to view your quotes, trips, and driver schedule." },
      { property: "og:title", content: `Log In — ${COMPANY.name}` },
      { property: "og:description", content: "Sign in to manage your school field-trip quotes, trips, and schedule." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { login, signup, role, loading } = useAuth();
  const navigate = useNavigate();

  // Forgot-password + signup flow
  const [mode, setMode] = useState<"login" | "forgot" | "signup">("login");
  const [resetSent, setResetSent] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [confirmPw, setConfirmPw] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  // Where to go after auth (e.g. back to /quote to finish a saved quote).
  const safeNext = (() => {
    if (typeof window === "undefined") return null;
    const n = new URLSearchParams(window.location.search).get("next");
    return n && n.startsWith("/") ? n : null;
  })();

  async function doSignup(e: { preventDefault(): void }) {
    e.preventDefault();
    setError(null); setNotice(null);
    if (password.length < 8) { setError("Use at least 8 characters for your password."); return; }
    if (password !== confirmPw) { setError("Those passwords don't match."); return; }
    setSubmitting(true);
    try {
      const { needsConfirmation } = await signup(email, password);
      if (needsConfirmation) {
        setNotice("Account created! Check your email to confirm it, then log in here — your quote answers are saved.");
        setMode("login");
      }
      // Otherwise the auth state updates and the redirect effect below takes over.
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : "Could not create your account.";
      setError(/already|registered/i.test(m) ? "That email already has an account — try logging in instead." : m);
    } finally {
      setSubmitting(false);
    }
  }

  async function sendReset(e: { preventDefault(): void }) {
    e.preventDefault();
    setError(null);
    setResetBusy(true);
    const redirectTo = typeof window !== "undefined" ? `${window.location.origin}/reset-password` : undefined;
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    setResetBusy(false);
    if (err) { setError(err.message); return; }
    setResetSent(true);
  }

  // Redirect once role resolves — covers both "already logged in" and "just logged in"
  useEffect(() => {
    if (!loading && role) {
      const roleDest = role === "customer" ? "/portal" : role === "driver" ? "/driver" : "/admin";
      navigate({ to: safeNext ?? roleDest });
    }
  }, [loading, role, navigate, safeNext]);

  // Arriving from the quote form to create an account → open signup directly.
  useEffect(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("new") === "1") {
      setMode("signup");
    }
  }, []);

  const submit = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      // useAuth will update role from the DB; navigate after the auth state settles
      // Role-based redirect happens in the useEffect below once role is set
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Login failed";
      setError(message === "Invalid login credentials" ? "Incorrect email or password." : message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-6 sm:px-6 lg:px-8">
        <Logo />
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to site
        </Link>
      </div>
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md rounded-3xl border border-border bg-card p-8 shadow-elevated">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {mode === "login" ? "Log in to your account" : mode === "signup" ? "Create your account" : "Reset your password"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "login"
              ? "Enter your email and password to continue."
              : mode === "signup"
              ? "Sign up to submit and track your field-trip quotes."
              : "Enter your email and we'll send you a link to set a new password."}
          </p>

          {notice && (
            <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {notice}
            </p>
          )}

          {mode === "signup" ? (
            <form onSubmit={doSignup} className="mt-6 space-y-4">
              <label className="block text-sm">
                <span className="font-medium text-foreground">Email</span>
                <input
                  type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@school.ca" required autoComplete="email"
                  className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none ring-ring focus:ring-2"
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-foreground">Password</span>
                <input
                  type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters" required autoComplete="new-password"
                  className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none ring-ring focus:ring-2"
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-foreground">Confirm password</span>
                <input
                  type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)}
                  placeholder="Re-enter password" required autoComplete="new-password"
                  className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none ring-ring focus:ring-2"
                />
              </label>
              {error && (
                <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
              )}
              <Button type="submit" variant="hero" size="lg" className="w-full" disabled={submitting}>
                {submitting ? "Creating account…" : "Create account"}
              </Button>
              <button
                type="button"
                onClick={() => { setMode("login"); setError(null); }}
                className="w-full text-center text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Already have an account? Log in
              </button>
            </form>
          ) : mode === "login" ? (
            <form onSubmit={submit} className="mt-6 space-y-4">
              <label className="block text-sm">
                <span className="font-medium text-foreground">Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@school.ca"
                  required
                  autoComplete="email"
                  className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none ring-ring focus:ring-2"
                />
              </label>
              <label className="block text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">Password</span>
                  <button
                    type="button"
                    onClick={() => { setMode("forgot"); setError(null); setResetSent(false); }}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none ring-ring focus:ring-2"
                />
              </label>

              {error && (
                <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}

              <Button type="submit" variant="hero" size="lg" className="w-full" disabled={submitting}>
                {submitting ? "Logging in…" : "Log In"}
              </Button>
              <button
                type="button"
                onClick={() => { setMode("signup"); setError(null); setNotice(null); }}
                className="w-full text-center text-sm text-muted-foreground"
              >
                New here? <span className="font-semibold text-primary hover:underline">Create an account</span>
              </button>
            </form>
          ) : resetSent ? (
            <div className="mt-6 space-y-4">
              <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
                If an account exists for <span className="font-semibold">{email}</span>, a password-reset link is on its way.
                Check your inbox (and spam folder).
              </p>
              <Button variant="outline" size="lg" className="w-full" onClick={() => { setMode("login"); setResetSent(false); }}>
                ← Back to log in
              </Button>
            </div>
          ) : (
            <form onSubmit={sendReset} className="mt-6 space-y-4">
              <label className="block text-sm">
                <span className="font-medium text-foreground">Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@school.ca"
                  required
                  autoComplete="email"
                  className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none ring-ring focus:ring-2"
                />
              </label>
              {error && (
                <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" variant="hero" size="lg" className="w-full" disabled={resetBusy}>
                {resetBusy ? "Sending…" : "Send reset link"}
              </Button>
              <button
                type="button"
                onClick={() => { setMode("login"); setError(null); }}
                className="w-full text-center text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                ← Back to log in
              </button>
            </form>
          )}

          <div className="mt-8 border-t border-border pt-6">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              What you'll see after logging in
            </p>
            <div className="grid grid-cols-3 gap-2">
              <PortalCard icon={<User className="h-5 w-5" />} title="Customer" desc="Quotes & trips" />
              <PortalCard icon={<Bus className="h-5 w-5" />} title="Driver" desc="Schedule & checklist" />
              <PortalCard icon={<ShieldCheck className="h-5 w-5" />} title="Admin" desc="Melody & Alan" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PortalCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex flex-col items-start gap-1 rounded-xl border border-border bg-surface p-3">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-foreground">
        {icon}
      </span>
      <span className="text-sm font-semibold text-foreground">{title}</span>
      <span className="text-[11px] text-muted-foreground">{desc}</span>
    </div>
  );
}
