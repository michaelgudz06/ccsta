import { Link } from "@tanstack/react-router";
import { Logo } from "./Logo";
import { Button } from "@/components/ui/button";

export function SiteNav() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Logo />
        <nav className="hidden items-center gap-8 md:flex">
          <a href="/#how" className="text-sm font-medium text-muted-foreground hover:text-foreground">How It Works</a>
          <Link to="/about" className="text-sm font-medium text-muted-foreground hover:text-foreground">About</Link>
          <a href="/#reviews" className="text-sm font-medium text-muted-foreground hover:text-foreground">Reviews</a>
          <a href="/#contact" className="text-sm font-medium text-muted-foreground hover:text-foreground">Contact</a>
        </nav>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to="/login">Log In</Link>
          </Button>
          <Button asChild variant="accent" size="sm">
            <Link to="/quote">Get a Quote</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
