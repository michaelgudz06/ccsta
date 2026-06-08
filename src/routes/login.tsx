import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { useAuth, type Role } from "@/lib/auth-store";
import { User, Bus, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Log In — School Field Trip Busing" },
      { name: "description", content: "Log in to the school field-trip busing platform to view your quotes, trips, and driver schedule. Demo accounts available." },
      { property: "og:title", content: "Log In — School Field Trip Busing" },
      { property: "og:description", content: "Sign in to manage your school field-trip quotes, trips, and schedule." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LoginPage,
});

type LoginRole = Exclude<Role, null>;

function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<LoginRole>("customer");
  const { login } = useAuth();
  const navigate = useNavigate();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    login(role, email || `${role}@example.com`);
    const dest = role === "customer" ? "/portal" : role === "driver" ? "/driver" : "/admin";
    navigate({ to: dest });
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
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Log in to your account</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Demo login — pick a role to preview that experience.
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <label className="block text-sm">
              <span className="font-medium text-foreground">Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none ring-ring focus:ring-2"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-foreground">Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none ring-ring focus:ring-2"
              />
            </label>

            <div className="pt-2">
              <span className="text-sm font-medium text-foreground">I am a…</span>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <RoleCard active={role === "customer"} onClick={() => setRole("customer")} icon={<User className="h-5 w-5" />} title="Customer" desc="Schools & groups" />
                <RoleCard active={role === "driver"} onClick={() => setRole("driver")} icon={<Bus className="h-5 w-5" />} title="Driver" desc="Trips & schedule" />
                <RoleCard active={role === "admin"} onClick={() => setRole("admin")} icon={<ShieldCheck className="h-5 w-5" />} title="Admin" desc="Melody & Alan" />
              </div>
            </div>

            <Button type="submit" variant="hero" size="lg" className="w-full">
              Log In
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Mock authentication — no real account required.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}

function RoleCard({
  active, onClick, icon, title, desc,
}: {
  active: boolean; onClick: () => void; icon: React.ReactNode; title: string; desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-all ${
        active
          ? "border-primary bg-primary/5 shadow-soft ring-2 ring-primary/20"
          : "border-border bg-card hover:border-primary/40"
      }`}
    >
      <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${active ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"}`}>
        {icon}
      </span>
      <span className="text-sm font-semibold text-foreground">{title}</span>
      <span className="text-[11px] text-muted-foreground">{desc}</span>
    </button>
  );
}
