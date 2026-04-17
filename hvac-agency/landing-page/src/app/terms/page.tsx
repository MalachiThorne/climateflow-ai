import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service — ClimateFlow AI",
  description:
    "Terms governing use of ClimateFlow AI lead response, review management, and estimate follow-up services.",
};

const EFFECTIVE_DATE = "April 17, 2026";

export default function TermsOfService() {
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
          Terms of Service
        </h1>
        <p className="text-muted mb-10">Effective {EFFECTIVE_DATE}</p>

        <div className="prose prose-slate max-w-none space-y-6 text-foreground leading-relaxed">
          <p>
            These Terms of Service (&quot;Terms&quot;) govern your use of
            ClimateFlow AI (&quot;Service&quot;), operated by ClimateFlow AI
            (&quot;we,&quot; &quot;us,&quot; &quot;our&quot;). By signing up for
            or using the Service, you agree to these Terms. If you do not agree,
            do not use the Service.
          </p>

          <h2 className="text-2xl font-bold mt-10 mb-3">1. The Service</h2>
          <p>
            ClimateFlow AI provides three automation modules for HVAC businesses:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <strong>Lead Rescue</strong> — an AI assistant that responds to
              missed calls and inbound SMS, qualifies leads, and books
              appointments on your behalf via your connected Google Calendar.
            </li>
            <li>
              <strong>Review Autopilot</strong> — automated review request SMS
              after completed jobs and AI-drafted responses to new Google
              reviews.
            </li>
            <li>
              <strong>Estimate Follow-Up</strong> — AI-driven SMS and email
              follow-ups on open estimates, with owner approval gates for
              outgoing messages where configured.
            </li>
          </ul>
          <p>
            Specific features available to you depend on the plan you select.
            We may add, modify, or remove features over time; material changes
            will be communicated in advance.
          </p>

          <h2 className="text-2xl font-bold mt-10 mb-3">2. Account &amp; Eligibility</h2>
          <p>
            You must be at least 18 years old, authorized to bind your business,
            and operating a lawful HVAC or related home-services business in the
            United States to use the Service. You are responsible for keeping
            your login credentials secure and for all activity under your
            account.
          </p>

          <h2 className="text-2xl font-bold mt-10 mb-3">3. Subscription, Trial, and Billing</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <strong>Free trial.</strong> New accounts receive a 7-day free
              trial. A valid payment method is required at signup. Your card is
              not charged until the trial ends.
            </li>
            <li>
              <strong>Recurring billing.</strong> After the trial, the plan fee
              is charged monthly in advance via Stripe until you cancel.
            </li>
            <li>
              <strong>Cancellation.</strong> You may cancel any time from the
              billing portal. Service continues through the end of the current
              billing period; we do not prorate partial months.
            </li>
            <li>
              <strong>Failed payments.</strong> If a payment fails, we will
              email you and retry. Repeated failures may result in feature
              suspension.
            </li>
            <li>
              <strong>Taxes.</strong> Fees are exclusive of applicable taxes,
              which you are responsible for.
            </li>
            <li>
              <strong>Refunds.</strong> Monthly fees are non-refundable except
              where required by law.
            </li>
          </ul>

          <h2 className="text-2xl font-bold mt-10 mb-3">4. Usage Limits</h2>
          <p>
            Plans include reasonable-use quotas for SMS, voice minutes, and AI
            tokens. If your usage materially exceeds the intended fair-use
            envelope (e.g., 10x typical volume), we may contact you to discuss
            a higher tier or apply usage-based overages with advance notice.
          </p>

          <h2 className="text-2xl font-bold mt-10 mb-3">5. Acceptable Use</h2>
          <p>You agree not to use the Service to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              Send unsolicited marketing SMS (spam), violate the TCPA, CAN-SPAM,
              carrier 10DLC rules, or any other applicable messaging law.
            </li>
            <li>
              Impersonate a person or business you do not represent, or engage
              in deceptive practices.
            </li>
            <li>
              Upload or transmit content that is unlawful, harassing,
              infringing, or harmful.
            </li>
            <li>
              Attempt to reverse-engineer, scrape, overload, or circumvent
              access controls on the Service.
            </li>
            <li>
              Use the Service to provide services that compete directly with
              ClimateFlow AI.
            </li>
          </ul>
          <p>
            We may suspend or terminate accounts that violate these rules,
            typically with notice where practicable.
          </p>

          <h2 className="text-2xl font-bold mt-10 mb-3">6. Your Responsibilities</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              You are responsible for the accuracy of business information you
              provide (service area, pricing, hours).
            </li>
            <li>
              You are responsible for obtaining the consent required under the
              TCPA and applicable state laws before phone numbers are provided
              to the Service for outbound SMS (e.g., estimate follow-up text
              messages to your customers).
            </li>
            <li>
              You are responsible for the content of estimates, review
              responses, and other materials you approve or publish through the
              Service, including any AI-drafted content you send.
            </li>
            <li>
              You are responsible for maintaining your Stripe account, Twilio
              sub-account relationships where applicable, and your Google
              account connections.
            </li>
          </ul>

          <h2 className="text-2xl font-bold mt-10 mb-3">7. AI-Generated Content</h2>
          <p>
            The Service uses large language models to draft replies, review
            responses, and follow-up messages. AI output can be incorrect,
            incomplete, or inappropriate in context. Where the Service sends
            messages automatically (such as immediate missed-call responses),
            you agree that you have reviewed and configured the Service to match
            your intended behavior. Where the Service queues drafts for your
            approval (such as estimate follow-up approval mode), you are
            responsible for reviewing drafts before approving them.
          </p>
          <p>
            ClimateFlow AI is not a substitute for licensed HVAC advice,
            diagnosis, or emergency response. The AI will not provide safety
            guidance on gas leaks, carbon monoxide, or other emergencies and is
            instructed to escalate such calls to a human.
          </p>

          <h2 className="text-2xl font-bold mt-10 mb-3">8. Intellectual Property</h2>
          <p>
            The Service, including its software, branding, and documentation, is
            owned by ClimateFlow AI and protected by applicable IP laws. You
            retain ownership of the content you provide to the Service
            (&quot;Customer Content&quot;). You grant us a limited license to
            use Customer Content solely to operate, improve, and support the
            Service.
          </p>

          <h2 className="text-2xl font-bold mt-10 mb-3">9. Third-Party Services</h2>
          <p>
            The Service integrates with Stripe, Twilio, Anthropic, Google, and
            other providers. Your use of those integrations is subject to their
            own terms. We are not responsible for third-party outages or changes
            beyond our reasonable control.
          </p>

          <h2 className="text-2xl font-bold mt-10 mb-3">10. Service Availability</h2>
          <p>
            We target high availability but do not offer a formal uptime SLA on
            standard plans. Scheduled maintenance will be announced when
            feasible. The Service is provided &quot;as is&quot; and &quot;as
            available.&quot;
          </p>

          <h2 className="text-2xl font-bold mt-10 mb-3">11. Warranties &amp; Disclaimers</h2>
          <p>
            TO THE FULLEST EXTENT PERMITTED BY LAW, THE SERVICE IS PROVIDED
            WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
            MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND
            NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE
            UNINTERRUPTED, ERROR-FREE, OR PRODUCE ANY PARTICULAR BUSINESS
            OUTCOME.
          </p>

          <h2 className="text-2xl font-bold mt-10 mb-3">12. Limitation of Liability</h2>
          <p>
            TO THE FULLEST EXTENT PERMITTED BY LAW, CLIMATEFLOW AI&apos;S TOTAL
            AGGREGATE LIABILITY ARISING OUT OF OR RELATING TO THESE TERMS OR THE
            SERVICE SHALL NOT EXCEED THE GREATER OF (A) $500 OR (B) THE AMOUNTS
            YOU PAID US IN THE 12 MONTHS PRECEDING THE EVENT GIVING RISE TO THE
            CLAIM. WE ARE NOT LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL,
            CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOST PROFITS OR LOST
            BUSINESS, EVEN IF WE HAVE BEEN ADVISED OF THE POSSIBILITY OF SUCH
            DAMAGES.
          </p>

          <h2 className="text-2xl font-bold mt-10 mb-3">13. Indemnification</h2>
          <p>
            You agree to indemnify and hold ClimateFlow AI harmless from any
            third-party claim arising out of (a) your breach of these Terms,
            (b) your violation of applicable law, including the TCPA or
            CAN-SPAM, or (c) Customer Content you provide or messages you
            approve for sending.
          </p>

          <h2 className="text-2xl font-bold mt-10 mb-3">14. Termination</h2>
          <p>
            You may cancel at any time as described in Section 3. We may suspend
            or terminate your access for breach of these Terms, non-payment, or
            to comply with law. Upon termination, your right to use the Service
            ends. Sections that by their nature should survive termination
            (including 8, 11, 12, 13, and 16) will survive.
          </p>

          <h2 className="text-2xl font-bold mt-10 mb-3">15. Changes to These Terms</h2>
          <p>
            We may update these Terms from time to time. Material changes will
            be communicated at least 14 days in advance by email or in-app
            notice. Continued use of the Service after the effective date of the
            updated Terms constitutes acceptance.
          </p>

          <h2 className="text-2xl font-bold mt-10 mb-3">16. Governing Law &amp; Disputes</h2>
          <p>
            These Terms are governed by the laws of the State of Oregon,
            excluding its conflict-of-laws rules. Any dispute will be resolved
            in the state or federal courts located in Multnomah County, Oregon,
            and you consent to personal jurisdiction there.
          </p>

          <h2 className="text-2xl font-bold mt-10 mb-3">17. Contact</h2>
          <p>
            Questions about these Terms?{" "}
            <a
              href="mailto:support@climateflow.ai"
              className="text-primary underline"
            >
              support@climateflow.ai
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
