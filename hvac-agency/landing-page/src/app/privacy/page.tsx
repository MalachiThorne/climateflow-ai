import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — ClimateFlow AI",
  description:
    "How ClimateFlow AI collects, uses, and protects information for HVAC businesses and their customers.",
};

const EFFECTIVE_DATE = "April 17, 2026";

export default function PrivacyPolicy() {
  return (
    <>
      <nav className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-border">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <svg
                className="w-5 h-5 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            </div>
            <span className="text-xl font-bold text-foreground">
              ClimateFlow AI
            </span>
          </Link>
          <Link
            href="/"
            className="text-sm text-muted hover:text-primary transition-colors"
          >
            ← Back to home
          </Link>
        </div>
      </nav>

      <main className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-4xl font-bold text-foreground mb-2">
          Privacy Policy
        </h1>
        <p className="text-muted mb-10">Effective {EFFECTIVE_DATE}</p>

        <div className="prose prose-slate max-w-none space-y-6 text-foreground leading-relaxed">
          <p>
            ClimateFlow AI (&quot;ClimateFlow,&quot; &quot;we,&quot; &quot;our&quot;) provides AI-powered
            lead response, review management, and estimate follow-up services to
            HVAC businesses. This Privacy Policy explains what information we
            collect, how we use it, and the choices available to you.
          </p>
          <p>
            Two groups interact with our service: (1) <strong>Customers</strong>{" "}
            — the HVAC business owners who sign up for a ClimateFlow subscription,
            and (2) <strong>End Users</strong> — the callers, texters, and email
            recipients of the businesses we serve. This policy covers both.
          </p>

          <h2 className="text-2xl font-bold mt-10 mb-3">1. Information We Collect</h2>

          <h3 className="text-lg font-semibold mt-6 mb-2">From Customers (business owners)</h3>
          <ul className="list-disc pl-6 space-y-1">
            <li>Business name, contact name, business email and phone number.</li>
            <li>
              Service area, plan selection, and payment information (processed
              and stored by Stripe — we never store full card numbers).
            </li>
            <li>
              Google account credentials (OAuth tokens only) scoped to Calendar
              read/write for appointment booking and, where enabled, Gmail read
              access for review and estimate email ingestion. Tokens are
              encrypted at rest (AES-256-GCM).
            </li>
            <li>
              Business content you add (estimate text, review responses, service
              offerings, pricing, onboarding notes).
            </li>
          </ul>

          <h3 className="text-lg font-semibold mt-6 mb-2">From End Users (your callers and customers)</h3>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              Caller phone numbers, call metadata (time, duration, voicemail
              transcripts) when a call is placed to or from the dedicated
              business number we provision.
            </li>
            <li>
              SMS content exchanged with the AI assistant (lead qualification,
              appointment booking, estimate follow-up, review requests).
            </li>
            <li>
              Name, service address, and service details voluntarily provided
              during AI-assisted conversations.
            </li>
            <li>
              Email content when an End User replies to a review request,
              estimate follow-up, or appointment confirmation.
            </li>
            <li>
              Google review content (star rating, review text, reviewer name)
              retrieved via the business&apos;s Google account to draft AI
              responses.
            </li>
          </ul>

          <h3 className="text-lg font-semibold mt-6 mb-2">Automatically collected</h3>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              Server logs (IP address, user agent, timestamps) for security,
              abuse prevention, and service reliability.
            </li>
            <li>
              Operational telemetry (error reports, request timing) — scrubbed of
              End-User message content before transmission to our monitoring
              provider.
            </li>
          </ul>

          <h2 className="text-2xl font-bold mt-10 mb-3">2. How We Use Information</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              Operate the service: answer missed calls, reply to SMS, book
              appointments, follow up on estimates, and draft review responses
              on behalf of the Customer.
            </li>
            <li>
              Send transactional messages (welcome, verification, billing, trial
              reminders, digest reports) to Customers.
            </li>
            <li>Process payments and manage subscriptions via Stripe.</li>
            <li>Detect and prevent fraud, abuse, and spam.</li>
            <li>
              Improve service reliability through aggregate analytics and error
              monitoring.
            </li>
          </ul>
          <p>
            We do <strong>not</strong> sell personal information. We do not use
            End-User SMS content to train third-party general-purpose AI models.
          </p>

          <h2 className="text-2xl font-bold mt-10 mb-3">3. Service Providers We Share With</h2>
          <p>
            ClimateFlow is built on a small, well-known stack. The following
            subprocessors receive data strictly to deliver the service:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <strong>Anthropic</strong> — conversational AI used to generate
              replies. Message content is sent over TLS; Anthropic does not train
              on our API traffic by default.
            </li>
            <li>
              <strong>Twilio</strong> — telephony provider for dedicated phone
              numbers, SMS, and voice. Call metadata and SMS content transit
              Twilio&apos;s network.
            </li>
            <li>
              <strong>Stripe</strong> — payment processing. Card details are
              entered directly into Stripe-hosted elements; we store only a
              Stripe customer ID and subscription state.
            </li>
            <li>
              <strong>Google (Calendar &amp; Gmail APIs)</strong> — calendar
              availability and appointment booking; optional Gmail ingestion for
              review and estimate emails. We request only the scopes required
              and store encrypted refresh tokens.
            </li>
            <li>
              <strong>Railway</strong> — cloud hosting for our application and
              Postgres database. Data at rest is encrypted.
            </li>
            <li>
              <strong>Sentry</strong> — error monitoring. Request bodies and SMS
              content are scrubbed before transmission.
            </li>
            <li>
              <strong>SMTP provider</strong> — transactional email delivery.
            </li>
          </ul>

          <h2 className="text-2xl font-bold mt-10 mb-3">4. SMS Messaging Terms</h2>
          <p>
            ClimateFlow sends SMS on behalf of the HVAC businesses we serve. Our
            A2P 10DLC campaigns are registered with U.S. carriers and include:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <strong>Consent.</strong> SMS is sent to End Users who have
              contacted the business (e.g., by calling the dedicated number) or
              who have otherwise provided their phone number to the business for
              the purpose of estimate, appointment, or review follow-up.
            </li>
            <li>
              <strong>Opt-out.</strong> Reply <code>STOP</code> to any message
              to stop receiving further SMS from that business. Opt-out is honored
              immediately and is stored in a per-business suppression list.
            </li>
            <li>
              <strong>Help.</strong> Reply <code>HELP</code> for instructions and
              contact information.
            </li>
            <li>
              <strong>Frequency.</strong> Message frequency varies based on the
              conversation (typically 1–4 messages per interaction). Message and
              data rates may apply.
            </li>
            <li>
              <strong>No mobile data resale.</strong> Mobile phone numbers
              collected for SMS are not shared with third parties for marketing
              or resold.
            </li>
          </ul>

          <h2 className="text-2xl font-bold mt-10 mb-3">5. Data Retention</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              Customer account data is retained for the life of the subscription
              and for up to 90 days after cancellation to handle refunds, tax,
              and dispute resolution.
            </li>
            <li>
              Call and SMS conversation records are retained for 24 months to
              support reporting and dispute resolution, then purged.
            </li>
            <li>
              Stripe billing records are retained per Stripe&apos;s retention
              policies and applicable tax law (typically 7 years).
            </li>
            <li>
              Encrypted OAuth tokens are deleted within 30 days of subscription
              cancellation or disconnect.
            </li>
          </ul>

          <h2 className="text-2xl font-bold mt-10 mb-3">6. Security</h2>
          <p>
            We use TLS for data in transit, AES-256-GCM for encrypting
            third-party OAuth tokens at rest, HMAC-signed URLs for
            single-use billing and calendar links, and strict Content Security
            Policy headers on all owner-facing pages. Access to production
            systems is limited to authorized personnel.
          </p>
          <p>
            No system is perfectly secure. If we learn of a breach affecting
            your data, we will notify affected Customers without undue delay.
          </p>

          <h2 className="text-2xl font-bold mt-10 mb-3">7. Your Rights</h2>
          <p>
            Depending on where you live (including under the CCPA/CPRA and other
            U.S. state privacy laws), you may have the right to:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Access the personal information we hold about you.</li>
            <li>Request correction or deletion.</li>
            <li>Opt out of sale or sharing (we do neither).</li>
            <li>Receive a portable copy of your data.</li>
          </ul>
          <p>
            To exercise any of these rights, email{" "}
            <a
              href="mailto:privacy@climateflow.ai"
              className="text-primary underline"
            >
              privacy@climateflow.ai
            </a>
            . End Users should contact the HVAC business they interacted with
            directly; we will assist that business in fulfilling the request.
          </p>

          <h2 className="text-2xl font-bold mt-10 mb-3">8. Children</h2>
          <p>
            ClimateFlow is a B2B service and is not directed to children under
            13. We do not knowingly collect information from children.
          </p>

          <h2 className="text-2xl font-bold mt-10 mb-3">9. Changes</h2>
          <p>
            We may update this policy from time to time. When we do, we will
            update the effective date above and, for material changes, notify
            Customers by email.
          </p>

          <h2 className="text-2xl font-bold mt-10 mb-3">10. Contact</h2>
          <p>
            Questions about this policy or our privacy practices?{" "}
            <a
              href="mailto:privacy@climateflow.ai"
              className="text-primary underline"
            >
              privacy@climateflow.ai
            </a>
          </p>
        </div>
      </main>

      <footer className="bg-foreground text-white py-8 mt-16">
        <div className="max-w-4xl mx-auto px-6 text-center text-sm text-gray-400">
          <div className="flex justify-center gap-6 mb-4">
            <Link href="/" className="hover:text-white">Home</Link>
            <Link href="/privacy" className="hover:text-white">Privacy</Link>
            <Link href="/terms" className="hover:text-white">Terms</Link>
          </div>
          <p>&copy; {new Date().getFullYear()} ClimateFlow AI. All rights reserved.</p>
        </div>
      </footer>
    </>
  );
}
