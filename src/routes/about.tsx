import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteNav } from "@/components/SiteNav";
import { Button } from "@/components/ui/button";
import { COMPANY } from "@/lib/company";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About — School Field Trip Busing" },
      { name: "description", content: "Surrey-based student transportation serving schools across the Lower Mainland and beyond. Safe, reliable field-trip busing built around the school calendar." },
      { property: "og:title", content: "About — School Field Trip Busing" },
      { property: "og:description", content: "Surrey-based student transportation serving schools across the Lower Mainland and beyond." },
    ],
  }),
  component: AboutPage,
});

function AboutPage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteNav />
      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        <span className="rounded-full bg-accent/30 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          About
        </span>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          About {COMPANY.name}
        </h1>
        <div className="mt-8 space-y-5 text-muted-foreground">
          <p>
            <span className="font-semibold text-foreground">{COMPANY.fullName} ({COMPANY.name})</span> is
            a Surrey-based student transportation association built around safe and
            reliable field-trip busing for member Christian schools across the Lower Mainland and
            beyond. From Vancouver to the Fraser Valley, if your class needs to
            get somewhere, we get them there.
          </p>
          <p>
            We are making booking a bus effortless. Instead of phone tag and
            hand-built estimates, our platform lets schools request a trip and
            get an accurate estimate in minutes. Behind the scenes we match each
            trip to the right-sized bus and a trusted driver, size seating to
            student grade levels, and account for pre-trip inspections and
            travel time so the estimate reflects the real trip.
          </p>
          <p>
            We're a Surrey-based association that has spent years moving students safely
            around the Lower Mainland. We built this platform because booking a
            field trip shouldn't mean a week of phone calls — member schools deserve a
            fast, clear quote and a driver they can trust.
          </p>
          <p>
            Every trip is tracked live from departure to drop-off, and when it
            is done we reconcile the estimate against the actual time and
            distance — so schools get a fair and accurate invoice every time.
          </p>
        </div>
        <div className="mt-10 flex flex-wrap gap-3">
          <Button asChild variant="accent" size="lg">
            <Link to="/quote">Get a Quote</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link to="/">Back to home</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
