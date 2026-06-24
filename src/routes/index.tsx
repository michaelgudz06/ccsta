import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteNav } from "@/components/SiteNav";
import { AnnouncementBanner } from "@/components/AnnouncementBanner";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import heroBusAsset from "@/assets/hero-bus-new.png.asset.json";
const heroBus = heroBusAsset.url;
import scenicBusAsset from "@/assets/scenic-bus.png.asset.json";
const scenicBus = scenicBusAsset.url;
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
          "Adventure Awaits, Your Journey Starts Here. Smart estimates, the right-sized bus, a trusted driver.",
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
            "Student transportation company providing school field-trip busing across the Lower Mainland.",
          telephone: ["+1-778-986-8811", "+1-778-986-9011"],
          areaServed: "Lower Mainland, British Columbia",
          url: "https://ccsta.ca/",
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
          <h1 className="mt-5 text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl whitespace-pre-line">
            {COMPANY.tagline}
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted-foreground">
            Fair Pricing, Trusted Drivers, and Excellent Customer Service.
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
            Get a free estimate in minutes — no account needed to start.
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
                <div className="font-semibold text-foreground">GPS tracked trips</div>
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
    { value: "Greater Vancouver", label: "Serving the Lower Mainland and surrounding areas." },
    { value: "Certified Drivers", label: "Professional and reliable." },
    { value: "Variety of Busses", label: "To meet all transportation needs." },
    { value: "Instant Estimates", label: "Simple, fast, and no obligation." },
  ];
  return (
    <section className="border-y border-border bg-surface">
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-4 py-10 sm:grid-cols-2 sm:px-6 lg:grid-cols-4 lg:px-8 items-stretch">
        {stats.map((s) => (
          <div key={s.label} className="flex h-full flex-col rounded-2xl bg-card p-5 shadow-soft border border-border/60">
            <div className="text-2xl font-bold tracking-tight text-primary leading-tight">{s.value}</div>
            <div className="mt-2 text-sm text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}


function SectionHeader({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <div className="text-xs font-semibold uppercase tracking-[0.18em]">
        <span className="rounded-full bg-accent/30 px-3 py-1 text-primary">{eyebrow}</span>
      </div>
      <h2 className="mt-4 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{title}</h2>
      {subtitle && <p className="mt-3 text-muted-foreground">{subtitle}</p>}
    </div>
  );
}


function WhyUs() {
  const items = [
    { icon: RouteIcon, title: "40+ Years on the Road", body: "Decades in, and still the best ride in BC." },
    { icon: Receipt, title: "No Surprise Billing", body: "Every cost upfront, your invoice always matches." },
    { icon: Bus, title: "Service That Stands Out", body: "Come for the ride, stay for the service." },
  ];
  return (
    <section id="why" className="bg-surface py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeader eyebrow="Why Us" title="We Go the Extra Mile" />
        <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {items.map((s) => (
            <div key={s.title} className="rounded-2xl border border-border bg-card p-6 shadow-soft">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/30 text-primary">
                <s.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-foreground">{s.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground whitespace-pre-line">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Reviews() {
  return (
    <section id="reviews" className="py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeader eyebrow="Reviews" title="What schools are saying." subtitle="We're just getting started — reviews from member schools will appear here after our first trips." />
        <div className="mt-10 flex items-center justify-center rounded-3xl border border-dashed border-border bg-card px-8 py-16 text-center">
          <div>
            <div className="flex justify-center gap-1">
              {[1,2,3,4,5].map((i) => <Star key={i} className="h-5 w-5 text-border" />)}
            </div>
            <p className="mt-4 text-sm text-muted-foreground max-w-sm">
              Once our customers complete their first trips, their feedback will be shown here.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Drivers() {
  return (
    <section className="bg-surface py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="Our Drivers"
          title="Safe, Skilled, and Ready."
        />
        <div className="mt-10 grid gap-6 sm:grid-cols-3">
          {[
            { icon: ShieldCheck, title: "Background Checked", body: "Every driver passes a criminal record check before their first trip." },
            { icon: ClipboardCheck, title: "Commercially Licensed", body: "Fully licensed to operate passenger buses across BC." },
            { icon: Users, title: "Group Travel Trained", body: "Experienced with schools, sports teams, churches and more." },
          ].map((c) => (
            <div key={c.title} className="rounded-2xl border border-border bg-card p-6 shadow-soft">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/30 text-primary">
                <c.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-foreground">{c.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{c.body}</p>
            </div>
          ))}
        </div>
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
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="Contact"
          title="Get in touch."
        />
        <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_2fr] items-start">
          <div className="relative overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
            <img
              src={scenicBus}
              alt="School bus driving through a scenic British Columbia landscape"
              width={896}
              height={672}
              className="aspect-[4/3] w-full object-cover"
              loading="lazy"
            />
          </div>
          <div className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-6 shadow-soft sm:p-8">
            <ContactRow icon={<Phone className="h-4 w-4" />} label="ALAN - OPERATIONS MANAGER" value={COMPANY.phoneAlan} />
            <ContactRow icon={<Phone className="h-4 w-4" />} label="MELODY - DISPATCH OFFICE" value={COMPANY.phoneMelody} />
            <ContactRow icon={<Mail className="h-4 w-4" />} label="Email" value={COMPANY.email} />
            <div className="pt-2">
              <Button asChild variant="accent" size="lg" className="w-full">
                <Link to="/quote">Start a quote request</Link>
              </Button>
            </div>
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
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4 lg:px-8">
        <div className="sm:col-span-2 lg:col-span-2">
          <Logo />
        </div>
        <div>
          <div className="text-sm font-semibold text-foreground">Quick links</div>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            
            <li><Link to="/about" className="hover:text-foreground">About</Link></li>
            <li><a href="/#reviews" className="hover:text-foreground">Reviews</a></li>
            <li><Link to="/login" className="hover:text-foreground">Log In</Link></li>
          </ul>
        </div>
        <div>
          <div className="text-sm font-semibold text-foreground">Contact</div>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>{COMPANY.email}</li>
            <li>Operations : {COMPANY.phoneAlan}</li>
            <li>Dispatch : {COMPANY.phoneMelody}</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border py-5 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} {COMPANY.name}. All rights reserved.
      </div>
    </footer>
  );
}
