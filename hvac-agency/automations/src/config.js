const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const { FEATURES } = require("./features");

// Fail-fast validation. Missing required vars used to crash later at the point of
// first use (Stripe, Twilio, DB, crypto), leading to partial startup where the HTTP
// server answers but webhooks 500. Enumerate here and exit cleanly on boot instead.
// Skipped in tests so modules can be imported with a minimal env.
function validateRequiredEnv() {
  if (process.env.NODE_ENV === "test" || process.env.SKIP_CONFIG_VALIDATION === "1") {
    return;
  }
  const required = {
    DATABASE_URL: "Postgres connection string",
    ANTHROPIC_API_KEY: "Claude API key",
    TWILIO_ACCOUNT_SID: "Twilio account SID",
    TWILIO_AUTH_TOKEN: "Twilio auth token (also used for webhook signature validation)",
    TWILIO_PHONE_NUMBER: "Default Twilio phone number",
    TWILIO_TEST_CALLER_NUMBER: "Dedicated Twilio number used to originate the forwarding self-test call (must differ from TWILIO_PHONE_NUMBER)",
    STRIPE_SECRET_KEY: "Stripe secret key (sk_live_ or sk_test_)",
    STRIPE_WEBHOOK_SECRET: "Stripe webhook signing secret (whsec_...)",
    STRIPE_PUBLISHABLE_KEY: "Stripe publishable key (used on /signup payment form)",
    GOOGLE_CLIENT_ID: "Google OAuth client id (calendar booking)",
    GOOGLE_CLIENT_SECRET: "Google OAuth client secret",
    GOOGLE_REDIRECT_URI: "Google OAuth redirect URI",
    SMTP_USER: "SMTP username",
    SMTP_PASS: "SMTP password / app password",
    FROM_EMAIL: "Outbound email From: address",
    API_KEY: "Internal API key for /api/review/* and /api/estimate endpoints",
    URL_SIGNING_SECRET: "HMAC secret for signed billing/signup URLs",
    TOKEN_ENCRYPTION_KEY: "64-char hex (32 bytes) AES-256 key for OAuth token at-rest encryption",
    WEBHOOK_BASE_URL: "Public base URL of this server (used to build Stripe/Twilio callback URLs)",
  };
  const missing = [];
  for (const [name, description] of Object.entries(required)) {
    if (!process.env[name] || String(process.env[name]).trim() === "") {
      missing.push(`  - ${name}: ${description}`);
    }
  }
  if (missing.length > 0) {
    console.error(
      "\n[config] FATAL: required environment variables are missing:\n" +
      missing.join("\n") +
      "\n\nSet them in automations/.env (see .env.example) and restart.\n"
    );
    process.exit(1);
  }
  // Bonus: spot-check shapes that commonly get truncated/pasted wrong.
  if (process.env.TOKEN_ENCRYPTION_KEY && process.env.TOKEN_ENCRYPTION_KEY.length !== 64) {
    console.error("[config] FATAL: TOKEN_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes).");
    process.exit(1);
  }
  if (process.env.STRIPE_WEBHOOK_SECRET && !process.env.STRIPE_WEBHOOK_SECRET.startsWith("whsec_")) {
    console.error("[config] FATAL: STRIPE_WEBHOOK_SECRET must start with 'whsec_'.");
    process.exit(1);
  }
  // The test caller must be a distinct Twilio-owned number. If it matches the
  // default business line, the test loop would originate a call from our own
  // DID and we'd have no reliable way to distinguish forwarded legs from a real
  // inbound call.
  if (
    process.env.TWILIO_PHONE_NUMBER &&
    process.env.TWILIO_TEST_CALLER_NUMBER &&
    process.env.TWILIO_PHONE_NUMBER.trim() === process.env.TWILIO_TEST_CALLER_NUMBER.trim()
  ) {
    console.error("[config] FATAL: TWILIO_TEST_CALLER_NUMBER must differ from TWILIO_PHONE_NUMBER.");
    process.exit(1);
  }
}

validateRequiredEnv();

module.exports = {
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER,
    testCallerNumber: process.env.TWILIO_TEST_CALLER_NUMBER,
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    // Legacy: single bundle priceId. Still read as the bundle fallback below.
    priceId: process.env.STRIPE_PRICE_ID,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    // Per-plan Stripe price IDs. Create each as a recurring monthly price in the Stripe dashboard.
    plans: {
      bundle: {
        id: "bundle",
        label: "Full Bundle",
        price: 2500,
        priceId: process.env.STRIPE_PRICE_ID_BUNDLE || process.env.STRIPE_PRICE_ID,
        features: [FEATURES.LEAD_RESCUE, FEATURES.REVIEW_AUTOPILOT, FEATURES.ESTIMATE_FOLLOWUP],
      },
      lead_rescue: {
        id: "lead_rescue",
        label: "Lead Rescue",
        price: 1500,
        priceId: process.env.STRIPE_PRICE_ID_LEAD_RESCUE,
        features: [FEATURES.LEAD_RESCUE],
      },
      review_autopilot: {
        id: "review_autopilot",
        label: "Review Autopilot",
        price: 500,
        priceId: process.env.STRIPE_PRICE_ID_REVIEW_AUTOPILOT,
        features: [FEATURES.REVIEW_AUTOPILOT],
      },
      estimate_followup: {
        id: "estimate_followup",
        label: "Estimate Follow-Up",
        price: 1000,
        priceId: process.env.STRIPE_PRICE_ID_ESTIMATE_FOLLOWUP,
        features: [FEATURES.ESTIMATE_FOLLOWUP],
      },
    },
  },
  email: {
    smtpHost: process.env.SMTP_HOST || "smtp.gmail.com",
    smtpPort: parseInt(process.env.SMTP_PORT || "465", 10),
    smtpUser: process.env.SMTP_USER,
    smtpPass: process.env.SMTP_PASS,
    fromEmail: process.env.FROM_EMAIL,
    fromName: process.env.FROM_NAME || "ClimateFlow AI",
  },
  database: {
    url: process.env.DATABASE_URL,
  },
  server: {
    port: parseInt(process.env.PORT || "3001", 10),
    webhookBaseUrl: process.env.WEBHOOK_BASE_URL || "http://localhost:3001",
    // Public marketing-site URL (Next.js landing page). Used by signup.html to
    // link out to /privacy and /terms. Leave empty to use same-origin relative
    // paths (useful when landing + server are behind a shared reverse proxy).
    landingBaseUrl: process.env.LANDING_BASE_URL || "https://climateflow.ai",
  },
  sentry: {
    dsn: process.env.SENTRY_DSN || "",
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
    release: process.env.SENTRY_RELEASE || "",
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || "0"),
  },
};
