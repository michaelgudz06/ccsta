import { Link } from "@tanstack/react-router";
import { COMPANY } from "@/lib/company";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link to="/" className={`flex items-center gap-3 group shrink-0 ${className}`}>
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-soft shrink-0">
        <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 17V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9" />
          <path d="M3 14h18" />
          <path d="M19 11h2v3h-2" />
          <circle cx="7" cy="18" r="2" />
          <circle cx="17" cy="18" r="2" />
        </svg>
      </div>
      <div className="flex flex-col md:flex-row md:items-baseline md:gap-2 leading-none">
        <span className="text-base font-semibold tracking-tight text-foreground">
          {COMPANY.name}
        </span>
        <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground whitespace-nowrap">
          Combined Christian School Transportation Association
        </span>
      </div>
    </Link>
  );
}
