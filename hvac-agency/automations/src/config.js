const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const { FEATURES } = require("./features");

module.exports = {
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER,
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
  },
};
