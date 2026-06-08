import { Link, useNavigate } from "@tanstack/react-router";
import { Logo } from "./Logo";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-store";

export function AppTopBar() {
  const { logout, role } = useAuth();
  const navigate = useNavigate();
  const roleLabel = role === "admin" ? "Admin" : role === "driver" ? "Driver" : role === "customer" ? "Customer" : "";
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-card/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <Logo />
          {roleLabel && (
            <span className="hidden rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary sm:inline-block">
              {roleLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to="/">Home</Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { logout(); navigate({ to: "/" }); }}
          >
            Log Out
          </Button>
        </div>
      </div>
    </header>
  );
}
