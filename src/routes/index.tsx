import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteNav } from "@/components/SiteNav";
import { AnnouncementBanner } from "@/components/AnnouncementBanner";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import heroBus from "@/assets/hero-bus.jpg";
import { COMPANY } from "@/lib/company";
import {
  Bus,
  Users,
  Route as RouteIcon,
  ClipboardCheck,
  Receipt,
  Mail,
  CalendarCheck,
  Gauge,
  ShieldCheck,
  Star,
  Phone,
  MapPin,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: `${COMPANY.name} — School Field Trips, Lower Mainland & Beyond` },
      {
        name: "description",
        content:
          "Book the right bus for your school field trip in minutes. Smart estimates, trusted drivers, serving schools across the Lower Mainland and beyond.",
      },
      { property: "og:title", content: `${COMPANY.name} — School Field Trips` },
      {
        property: "og:description",
        content:
          "Field trips across the Lower Mainland, handled. Smart estimates, the right-sized bus, a trusted driver.",
      },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "LocalBusiness",
          name: COMPANY.name,
          description:
            "Surrey-based student transportation company providing school field-trip busing across the Lower Mainland.",
          address: {
            "@type": "PostalAddress",
            streetAddress: "8888 162 Street",
            addressLocality: "Surrey",
            addressRegion: "BC",
            postalCode: "V4N 3G1",
            addressCountry: "CA",
          },
          telephone: ["+1-778-986-8811", "+1-778-986-9011"],
          areaServed: "Lower Mainland, British Columbia",
          url: "https://ccsta-test.lovable.app/",
        }),
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <AnnouncementBanner />
      <SiteNav />
      <main>
        <Hero />
        <TrustStrip />
        <HowItWorks />
        <WhyUs />
        <Reviews />
        <Drivers />
        <CTABand />
        <Contact />
      </main>
      <SiteFooter />
    </div>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-secondary/60 via-background to-background" />
      <div className="mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:gap-8 lg:px-8 lg:py-24">
        <div className="flex flex-col justify-center">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-soft">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            Serving schools across the Lower Mainland & beyond
          </span>
          <h1 className="mt-5 text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            {COMPANY.tagline}
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted-foreground">
            Smart estimates, the right-sized bus, a trusted driver. Serving
            schools across the Lower Mainland and beyond.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild variant="accent" size="lg">
              <Link to="/quote">Get a Quote</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link to="/login">Log In</Link>
            </Button>
          </div>
          <p className="mt-6 text-xs text-muted-foreground">
            No account required to request a quote.
          </p>
        </div>
        <div className="relative">
          <div className="relative overflow-hidden rounded-3xl border border-border bg-card shadow-elevated">
            <img
              src={heroBus}
              alt="School bus ready for a field trip"
              width={1600}
              height={1200}
              className="aspect-[5/4] w-full object-cover"
            />
          </div>
          <div className="absolute -bottom-6 -left-6 hidden rounded-2xl border border-border bg-card p-4 shadow-elevated sm:block">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="text-sm">
                <div className="font-semibold text-foreground">Live-tracked trips</div>
                <div className="text-muted-foreground">Safety first, every ride</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function TrustStrip() {
  const stats = [
    { value: "18–56", label: "Seats per bus — right-sized to your group" },
    { value: "Minutes", label: "From request to estimate" },
    { value: "Lower Mainland", label: "& beyond" },
    { value: "Trusted", label: "Professional, certified drivers" },
  ];
  return (
    <section className="border-y border-border bg-surface">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-6 px-4 py-10 sm:px-6 lg:grid-cols-4 lg:px-8">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl bg-card p-5 shadow-soft border border-border/60">
            <div className="text-3xl font-bold tracking-tight text-primary">{s.value}</div>
            <div className="mt-1 text-sm text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SectionHeader({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <div className="text-xs font-semibold uppercase tracking-[0.18em]">
        <span className="rounded-full bg-accent/30 px-3 py-1 text-primary">{eyebrow}</span>
      </div>
      <h2 className="mt-4 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{title}</h2>
      {subtitle && <p className="mt-3 text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

function HowItWorks() {
  const steps = [
    { icon: ClipboardCheck, title: "Request a quote", body: "School, destination, date, times, students and grades." },
    { icon: Gauge, title: "Get an instant estimate", body: "The right-sized bus and a fair price — clearly labeled as an estimate." },
    { icon: Mail, title: "We confirm the details", body: "Our coordinator reviews logistics and locks in your date." },
    { icon: Receipt, title: "Ride & get an accurate invoice", body: "Billed on the real trip — not a guess." },
  ];
  return (
    <section id="how" className="py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeader eyebrow="How It Works" title="Four simple steps, from request to ride." />
        <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <div key={s.title} className="rounded-2xl border border-border bg-card p-6 shadow-soft transition-shadow hover:shadow-elevated">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                  <s.icon className="h-5 w-5" />
                </div>
                <span className="text-xs font-semibold text-muted-foreground">Step {i + 1}</span>
              </div>
              <h3 className="mt-4 text-lg font-semibold text-foreground">{s.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function WhyUs() {
  const items = [
    { icon: Users, title: "Grade-aware capacity", body: "Younger students seat 3 per bench, older students seat 2 — the right-sized bus every time." },
    { icon: ShieldCheck, title: "Trusted, certified drivers", body: "Professional, vetted drivers with clean records and ongoing training." },
    { icon: Receipt, title: "Transparent estimates", body: "Hourly rates, fuel and distance spelled out up front." },
    { icon: Gauge, title: "Live tracking for safety", body: "Every trip is tracked live from departure to drop-off." },
    { icon: CalendarCheck, title: "Honest invoicing", body: "Final invoice matches the actual trip — no surprises." },
    { icon: Bus, title: "Built for schools", body: "Designed around the school calendar with simple confirmations." },
  ];
  return (
    <section id="why" className="bg-surface py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeader eyebrow="Why Us" title="Smarter logistics. Safer trips. Fairer bills." />
        <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {items.map((s) => (
            <div key={s.title} className="rounded-2xl border border-border bg-card p-6 shadow-soft">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/30 text-primary">
                <s.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-foreground">{s.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Reviews() {
  const reviews = [
    { name: "Test", school: "Example school", rating: 5, quote: "Test review — coming soon." },
    { name: "Test", school: "Example school", rating: 5, quote: "Test review — coming soon." },
    { name: "Test", school: "Example school", rating: 5, quote: "Test review — coming soon." },
  ];
  return (
    <section id="reviews" className="py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeader eyebrow="Reviews" title="What schools are saying." subtitle="Reviews will appear here once trips begin." />
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {reviews.map((r, i) => (
            <div key={i} className="rounded-2xl border border-border bg-card p-6 shadow-soft">
              <div className="flex gap-0.5">
                {Array.from({ length: r.rating }).map((_, idx) => (
                  <Star key={idx} className="h-4 w-4 fill-accent text-accent" />
                ))}
              </div>
              <p className="mt-4 text-sm text-foreground">"{r.quote}"</p>
              <div className="mt-5 border-t border-border pt-4">
                <div className="text-sm font-semibold text-foreground">{r.name}</div>
                <div className="text-xs text-muted-foreground">{r.school}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Drivers() {
  const drivers = [
    { name: "Veteran driver", years: 12, cert: "Air brake certified" },
    { name: "Field-trip regular", years: 8, cert: "Air brake certified" },
    { name: "Senior driver", years: 20, cert: "Air brake + First Aid" },
    { name: "Local driver", years: 5, cert: "Air brake certified" },
  ];
  return (
    <section className="bg-surface py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="Meet Our Drivers"
          title="Friendly faces behind the wheel."
          subtitle="Some schools like to request a specific driver — here's a preview of who you might ride with."
        />
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {drivers.map((d, i) => (
            <div key={i} className="rounded-2xl border border-border bg-card p-5 shadow-soft text-center">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                <Users className="h-8 w-8" />
              </div>
              <div className="mt-4 text-base font-semibold text-foreground">{d.name}</div>
              <div className="text-xs text-muted-foreground">{d.years} years driving</div>
              <span className="mt-3 inline-block rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-medium text-primary">
                {d.cert}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">Driver photos and profiles coming soon.</p>
      </div>
    </section>
  );
}

function CTABand() {
  return (
    <section className="bg-primary text-primary-foreground">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-4 py-14 text-center sm:px-6 lg:flex-row lg:px-8 lg:text-left">
        <div>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Ready to plan your next field trip?</h2>
          <p className="mt-2 text-primary-foreground/80">Tell us where and when — we'll handle the rest.</p>
        </div>
        <Button asChild variant="accent" size="xl">
          <Link to="/quote">Get a Quote</Link>
        </Button>
      </div>
    </section>
  );
}

function Contact() {
  return (
    <section id="contact" className="py-20 sm:py-24">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="Contact"
          title="Get in touch."
          subtitle="Prefer to start a quote? Use the form — it only takes a few minutes."
        />
        <div className="mt-10 grid gap-4 rounded-3xl border border-border bg-card p-6 shadow-soft sm:p-8 sm:grid-cols-2">
          <ContactRow icon={<MapPin className="h-4 w-4" />} label="Office" value={COMPANY.address} />
          <ContactRow icon={<Mail className="h-4 w-4" />} label="Email" value={COMPANY.email} />
          <ContactRow icon={<Phone className="h-4 w-4" />} label="Alan" value={COMPANY.phoneAlan} />
          <ContactRow icon={<Phone className="h-4 w-4" />} label="Melody" value={COMPANY.phoneMelody} />
          <div className="sm:col-span-2 flex justify-center pt-2">
            <Button asChild variant="accent" size="lg">
              <Link to="/quote">Start a quote request</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function ContactRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">{icon}</div>
      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-sm font-semibold text-foreground">{value}</div>
      </div>
    </div>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-4 lg:px-8">
        <div className="lg:col-span-2">
          <Logo />
          <p className="mt-4 max-w-sm text-sm text-muted-foreground">
            {COMPANY.name} — Surrey-based student transportation. Serving the
            Lower Mainland and beyond.
          </p>
        </div>
        <div>
          <div className="text-sm font-semibold text-foreground">Quick links</div>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li><a href="/#how" className="hover:text-foreground">How It Works</a></li>
            <li><Link to="/about" className="hover:text-foreground">About</Link></li>
            <li><a href="/#reviews" className="hover:text-foreground">Reviews</a></li>
            <li><Link to="/login" className="hover:text-foreground">Log In</Link></li>
          </ul>
        </div>
        <div>
          <div className="text-sm font-semibold text-foreground">Contact</div>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>{COMPANY.address}</li>
            <li>{COMPANY.email}</li>
            <li>Alan: {COMPANY.phoneAlan}</li>
            <li>Melody: {COMPANY.phoneMelody}</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border py-5 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} {COMPANY.name}. All rights reserved.
      </div>
    </footer>
  );
}
