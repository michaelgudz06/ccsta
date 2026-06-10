import { createFileRoute } from "@tanstack/react-router";
import { SiteNav } from "@/components/SiteNav";
import { COMPANY } from "@/lib/company";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — School Field Trip Busing" },
      { name: "description", content: "How we collect, use, and protect personal information on our school bus booking platform." },
      { property: "og:title", content: "Privacy Policy" },
      { property: "og:description", content: "How we handle personal information on the booking platform." },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteNav />
      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        <span className="rounded-full bg-accent/30 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          Legal
        </span>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          Privacy Policy
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: June 2026</p>

        <div className="mt-8 space-y-6 text-muted-foreground leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold text-foreground">1. Who We Are</h2>
            <p className="mt-2">
              {COMPANY.fullName} ({COMPANY.name}) operates this booking platform for member
              schools in British Columbia. We comply with BC's Personal Information
              Protection Act (PIPA) and Canada's PIPEDA.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">2. Information We Collect</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>School and contact details (name, email, phone, school address)</li>
              <li>Trip details (destination, date, time, passenger counts)</li>
              <li>Driver employment records (for staff accounts only)</li>
              <li>Technical data: IP address, browser, pages visited</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">3. How We Use It</h2>
            <p className="mt-2">
              We use this information to generate quotes, dispatch buses, communicate
              about trips, issue invoices, and improve the platform. We do not sell
              personal information.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">4. Sharing</h2>
            <p className="mt-2">
              We share information only with: (a) the driver assigned to your trip; (b)
              service providers that host our platform and process payments (under
              confidentiality); and (c) authorities when required by law.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">5. Data Retention</h2>
            <p className="mt-2">
              Trip and invoice records are kept for 7 years to meet tax and insurance
              requirements. Account contact information is kept while your account is
              active and for 1 year after closure.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">6. Security</h2>
            <p className="mt-2">
              Data is stored with reputable cloud providers using encryption in transit
              (TLS) and at rest. Access is limited to authorized {COMPANY.name} staff.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">7. Your Rights</h2>
            <p className="mt-2">
              You can request access to, correction of, or deletion of your personal
              information by contacting us. We will respond within 30 days.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">8. Cookies</h2>
            <p className="mt-2">
              We use cookies and local storage to keep you signed in and remember
              preferences. We do not use third-party advertising trackers.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground">9. Contact</h2>
            <p className="mt-2">
              Privacy questions or requests? Contact {COMPANY.name} via the contact
              details on our home page.
            </p>
          </section>

          <p className="text-xs italic">
            This is a starter Privacy Policy drafted for {COMPANY.name}. It is not legal
            advice. Have it reviewed by a lawyer before relying on it.
          </p>
        </div>
      </main>
    </div>
  );
}
