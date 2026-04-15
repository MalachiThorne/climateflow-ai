export default function Home() {
  return (
    <>
      <nav className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-border">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
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
          </div>
          <a
            href="#contact"
            className="bg-primary text-white px-5 py-2.5 rounded-lg font-medium hover:bg-primary-dark transition-colors"
          >
            Get Started
          </a>
        </div>
      </nav>

      <main>
        {/* Hero */}
        <section className="bg-gradient-to-b from-surface to-white py-20 md:py-28">
          <div className="max-w-6xl mx-auto px-6 text-center">
            <div className="inline-block bg-accent/10 text-accent font-semibold text-sm px-4 py-1.5 rounded-full mb-6">
              Built for HVAC Companies
            </div>
            <h1 className="text-4xl md:text-6xl font-bold text-foreground leading-tight max-w-4xl mx-auto">
              Stop Losing Leads.
              <br />
              <span className="text-primary">
                Start Closing More Jobs.
              </span>
            </h1>
            <p className="text-lg md:text-xl text-muted mt-6 max-w-2xl mx-auto leading-relaxed">
              Our AI responds to every missed call, follows up on every
              estimate, and manages your reviews — so your techs stay in the
              field and your phone never goes unanswered.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center mt-10">
              <a
                href="#contact"
                className="bg-primary text-white px-8 py-4 rounded-lg font-semibold text-lg hover:bg-primary-dark transition-colors shadow-lg shadow-primary/25"
              >
                Start Free 7-Day Trial
              </a>
              <a
                href="#services"
                className="border-2 border-border text-foreground px-8 py-4 rounded-lg font-semibold text-lg hover:border-primary hover:text-primary transition-colors"
              >
                See How It Works
              </a>
            </div>
            <div className="flex items-center justify-center gap-8 mt-12 text-sm text-muted">
              <div className="flex items-center gap-2">
                <svg
                  className="w-5 h-5 text-green-500"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                No contracts
              </div>
              <div className="flex items-center gap-2">
                <svg
                  className="w-5 h-5 text-green-500"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                Setup in 24 hours
              </div>
              <div className="flex items-center gap-2">
                <svg
                  className="w-5 h-5 text-green-500"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                Cancel anytime
              </div>
            </div>
          </div>
        </section>

        {/* Problem Section */}
        <section className="py-20 bg-white">
          <div className="max-w-6xl mx-auto px-6">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground">
                Sound Familiar?
              </h2>
            </div>
            <div className="grid md:grid-cols-3 gap-8">
              {[
                {
                  icon: "M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z",
                  title: "Missed Calls = Lost Revenue",
                  desc: "Every call that goes to voicemail is a $3,000-$15,000 job walking to your competitor. After hours, weekends, and busy days are your biggest leak.",
                },
                {
                  icon: "M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z",
                  title: "Reviews Go Unanswered",
                  desc: "Google rewards businesses that respond to reviews. Your competitors are responding within hours — are you?",
                },
                {
                  icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2",
                  title: "Estimates Die on the Vine",
                  desc: "You send a quote, the customer ghosts. Without follow-up, 60% of estimates never close. That's tens of thousands left on the table every month.",
                },
              ].map((item) => (
                <div
                  key={item.title}
                  className="bg-surface border border-border rounded-xl p-8"
                >
                  <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center mb-4">
                    <svg
                      className="w-6 h-6 text-red-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d={item.icon}
                      />
                    </svg>
                  </div>
                  <h3 className="text-xl font-bold text-foreground mb-3">
                    {item.title}
                  </h3>
                  <p className="text-muted leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Services */}
        <section id="services" className="py-20 bg-surface">
          <div className="max-w-6xl mx-auto px-6">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground">
                Three Services. One Goal.
              </h2>
              <p className="text-lg text-muted mt-4">
                More booked jobs, less wasted time.
              </p>
            </div>
            <div className="grid md:grid-cols-3 gap-8">
              {[
                {
                  name: "Lead Rescue",
                  price: "$1,500",
                  color: "bg-blue-500",
                  features: [
                    "AI responds to missed calls in under 60 seconds",
                    "Qualifies leads automatically (service type, urgency, location)",
                    "Books appointments directly into your calendar",
                    "Handles after-hours and weekend inquiries",
                    "Weekly lead report with conversion metrics",
                  ],
                },
                {
                  name: "Review Autopilot",
                  price: "$500",
                  color: "bg-green-500",
                  features: [
                    "Automated review requests after every completed job",
                    "AI responds to all Google & Yelp reviews",
                    "Escalates negative reviews to you before responding",
                    "Monthly reputation report with rating trends",
                    "Boost your Google ranking with consistent reviews",
                  ],
                },
                {
                  name: "Estimate Follow-Up",
                  price: "$1,000",
                  color: "bg-orange-500",
                  features: [
                    "AI follows up on open estimates via text & email",
                    "Personalized messages — not generic templates",
                    "Handles customer questions and objections",
                    "Alerts you when estimates are accepted",
                    "Tracks close rate and time-to-close",
                  ],
                },
              ].map((service) => (
                <div
                  key={service.name}
                  className="bg-white border border-border rounded-xl p-8 flex flex-col"
                >
                  <div
                    className={`w-full h-1 ${service.color} rounded-full mb-6`}
                  />
                  <h3 className="text-2xl font-bold text-foreground">
                    {service.name}
                  </h3>
                  <div className="mt-2 mb-6">
                    <span className="text-3xl font-bold text-foreground">
                      {service.price}
                    </span>
                    <span className="text-muted">/month</span>
                  </div>
                  <ul className="space-y-3 flex-1">
                    {service.features.map((f) => (
                      <li key={f} className="flex items-start gap-3">
                        <svg
                          className="w-5 h-5 text-green-500 mt-0.5 shrink-0"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                        <span className="text-muted text-sm">{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <div className="mt-12 text-center">
              <div className="inline-block bg-primary/5 border-2 border-primary rounded-xl p-8">
                <div className="text-sm font-semibold text-primary uppercase tracking-wide mb-2">
                  Best Value
                </div>
                <h3 className="text-2xl font-bold text-foreground">
                  Full Bundle — $2,500/month
                </h3>
                <p className="text-muted mt-2">
                  All three services. Save $500/month. Most HVAC companies start
                  here.
                </p>
                <a
                  href="#contact"
                  className="inline-block mt-6 bg-primary text-white px-8 py-3 rounded-lg font-semibold hover:bg-primary-dark transition-colors"
                >
                  Start Free Trial
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className="py-20 bg-white">
          <div className="max-w-6xl mx-auto px-6">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground">
                Up and Running in 24 Hours
              </h2>
            </div>
            <div className="grid md:grid-cols-4 gap-8">
              {[
                {
                  step: "1",
                  title: "Quick Setup Call",
                  desc: "15-minute call to connect your phone system and calendar.",
                },
                {
                  step: "2",
                  title: "We Configure Your AI",
                  desc: "Custom-trained on your services, pricing, and service area.",
                },
                {
                  step: "3",
                  title: "Go Live",
                  desc: "AI starts handling leads, reviews, and follow-ups immediately.",
                },
                {
                  step: "4",
                  title: "Watch Jobs Roll In",
                  desc: "Weekly reports show exactly how many leads converted to booked jobs.",
                },
              ].map((item) => (
                <div key={item.step} className="text-center">
                  <div className="w-12 h-12 bg-primary text-white rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-4">
                    {item.step}
                  </div>
                  <h3 className="text-lg font-bold text-foreground mb-2">
                    {item.title}
                  </h3>
                  <p className="text-muted text-sm">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Stats */}
        <section className="py-16 bg-primary">
          <div className="max-w-6xl mx-auto px-6">
            <div className="grid md:grid-cols-3 gap-8 text-center text-white">
              {[
                {
                  stat: "< 60 sec",
                  label: "Average response time to missed calls",
                },
                {
                  stat: "3x",
                  label: "More reviews collected per month",
                },
                {
                  stat: "40%",
                  label: "Increase in estimate close rate",
                },
              ].map((item) => (
                <div key={item.label}>
                  <div className="text-4xl md:text-5xl font-bold">
                    {item.stat}
                  </div>
                  <div className="text-blue-100 mt-2">{item.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-20 bg-surface">
          <div className="max-w-3xl mx-auto px-6">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground text-center mb-12">
              Questions? We Got You.
            </h2>
            <div className="space-y-6">
              {[
                {
                  q: "Will my customers know they're talking to AI?",
                  a: "The AI introduces itself as your office assistant. It's conversational, professional, and trained on your specific business. Most customers can't tell the difference — and they appreciate the instant response.",
                },
                {
                  q: "What if a lead has a complex question?",
                  a: "The AI is trained to handle common HVAC inquiries. For anything outside its knowledge, it takes the customer's info and immediately alerts you or your team for a personal callback.",
                },
                {
                  q: "How does it connect to my existing systems?",
                  a: "We integrate with your existing phone number (no changes needed), Google Calendar, ServiceTitan, Housecall Pro, Jobber, and most other HVAC software. Setup takes about 15 minutes.",
                },
                {
                  q: "What if I want to cancel?",
                  a: "No contracts, no commitments. Cancel anytime with 30 days notice. But our clients typically see ROI within the first week — one recovered lead pays for a month of service.",
                },
                {
                  q: "How is this different from an answering service?",
                  a: "Answering services take messages. We book jobs. Our AI qualifies leads, checks your availability, and schedules appointments — all in real-time, 24/7, for a fraction of the cost of a live operator.",
                },
              ].map((item) => (
                <details
                  key={item.q}
                  className="bg-white border border-border rounded-xl p-6 group"
                >
                  <summary className="text-lg font-semibold text-foreground cursor-pointer list-none flex items-center justify-between">
                    {item.q}
                    <svg
                      className="w-5 h-5 text-muted group-open:rotate-180 transition-transform"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </summary>
                  <p className="text-muted mt-4 leading-relaxed">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Contact / CTA */}
        <section id="contact" className="py-20 bg-white">
          <div className="max-w-3xl mx-auto px-6">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground">
                Start Your Free 7-Day Trial
              </h2>
              <p className="text-lg text-muted mt-4">
                No credit card required. See exactly how many leads you&apos;re
                missing — then decide.
              </p>
            </div>
            <form
              action="https://formspree.io/f/placeholder"
              method="POST"
              className="bg-surface border border-border rounded-xl p-8 space-y-6"
            >
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Your Name
                  </label>
                  <input
                    type="text"
                    name="name"
                    required
                    className="w-full px-4 py-3 rounded-lg border border-border bg-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                    placeholder="John Smith"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Company Name
                  </label>
                  <input
                    type="text"
                    name="company"
                    required
                    className="w-full px-4 py-3 rounded-lg border border-border bg-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                    placeholder="Smith HVAC"
                  />
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Email
                  </label>
                  <input
                    type="email"
                    name="email"
                    required
                    className="w-full px-4 py-3 rounded-lg border border-border bg-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                    placeholder="john@smithhvac.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    name="phone"
                    required
                    className="w-full px-4 py-3 rounded-lg border border-border bg-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                    placeholder="(555) 123-4567"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  How many techs do you have?
                </label>
                <select
                  name="team_size"
                  className="w-full px-4 py-3 rounded-lg border border-border bg-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                >
                  <option value="1-5">1-5 techs</option>
                  <option value="6-15">6-15 techs</option>
                  <option value="16-30">16-30 techs</option>
                  <option value="30+">30+ techs</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Which services interest you?
                </label>
                <div className="grid md:grid-cols-3 gap-4">
                  {[
                    "Lead Rescue",
                    "Review Autopilot",
                    "Estimate Follow-Up",
                  ].map((s) => (
                    <label
                      key={s}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        name="services"
                        value={s}
                        className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                      />
                      <span className="text-sm text-foreground">{s}</span>
                    </label>
                  ))}
                </div>
              </div>
              <button
                type="submit"
                className="w-full bg-primary text-white py-4 rounded-lg font-semibold text-lg hover:bg-primary-dark transition-colors"
              >
                Start My Free Trial
              </button>
              <p className="text-sm text-muted text-center">
                We&apos;ll reach out within 2 hours to get you set up.
              </p>
            </form>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-foreground text-white py-12">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
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
            <span className="text-xl font-bold">ClimateFlow AI</span>
          </div>
          <p className="text-gray-400">
            AI-powered operations for HVAC companies.
          </p>
          <p className="text-gray-500 text-sm mt-6">
            &copy; {new Date().getFullYear()} ClimateFlow AI. All rights
            reserved.
          </p>
        </div>
      </footer>
    </>
  );
}
