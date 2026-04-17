const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const cron = require("node-cron");
const twilio = require("twilio");
const config = require("./config");
const sentry = require("./sentry");

// Initialize error monitoring before anything else can throw. No-op when
// SENTRY_DSN is unset, so local dev and tests are unaffected.
sentry.init();
const { getClientByPhone, listClients, createSampleClient, addClient, rotateOnboardingTokenNonce } = require("./clients");
const { handleMissedCall, handleIncomingSMS } = require("./pipelines/lead-rescue");
const { requestReview, respondToReview, ingestReviewEmail } = require("./pipelines/review-autopilot");
const {
  addEstimate,
  processFollowUps,
  handleEstimateReply,
  ingestEstimateEmail,
  approveQueuedEstimate,
  rejectQueuedEstimate,
  listPendingQueue,
  createEstimateFromPaste,
} = require("./pipelines/estimate-followup");
const estimatesUI = require("./estimatesUI");
const dashboardUI = require("./dashboardUI");
const { checkForNewReviews } = require("./review-monitor");
const { getAuthUrl, consumeOAuthState, handleOAuthCallback, getAvailableSlots, bookAppointment, isCalendarConnected } = require("./calendar");
const { provisionPhoneNumber, originateTestCall } = require("./sms");
const smsRetry = require("./smsRetry");
const { createSubscription, cancelSubscription, createBillingPortalSession, constructWebhookEvent, handleWebhookEvent } = require("./billing");
const { sendWelcomeEmail, sendTrialEndingEmail, sendPaymentFailedEmail, sendVerificationEmail, sendBillingLinkEmail, sendWeeklyDigestEmail, sendCalendarNudgeEmail, sendMonthlyReportEmail } = require("./email");
const { getClientStats, lastWeekWindow, lastMonthWindow, getMonthlyReputationStats } = require("./stats");
const { FEATURES, ALL_FEATURES, hasFeature } = require("./features");
const signedUrl = require("./signedUrl");
const store = require("./store");
const onboarding = require("./onboarding");
const gmailIngest = require("./gmailIngest");

const app = express();

// Behind Railway's load balancer; trust the proxy so req.ip + HTTPS detection work.
// Set to 1 hop — do NOT use "true" (which would let any caller spoof X-Forwarded-For).
app.set("trust proxy", 1);

// Sentry request handler must run before all routes so in-flight requests are
// associated with captured errors. No-op when SENTRY_DSN is unset.
app.use(sentry.requestHandler());

// --- SECURITY HEADERS ---
// Applied before everything else. /signup adds a payment-form CSP on top of these.
app.use((req, res, next) => {
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=(), payment=(self)");
  next();
});

// Redacts local part of an email for safe logging — keeps the domain so we can
// still debug delivery issues, hides the identity. "mike@portland.com" → "m***@portland.com".
function redactEmail(email) {
  if (typeof email !== "string") return "<no-email>";
  const at = email.indexOf("@");
  if (at < 1) return "<invalid-email>";
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

// CSP for owner-facing HTML (wizard, dashboard, profile, estimates paste/queue).
// All HTML is same-origin and uses inline <style>/<script>; no third-party
// script hosts are allowed. Without this, an XSS that bypassed h() could pull
// in external scripts — with it, the attacker is limited to what inline can
// do on this origin.
const OWNER_HTML_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

function setOwnerHtmlCsp(res) {
  res.setHeader("Content-Security-Policy", OWNER_HTML_CSP);
}

// Normalize a North-American phone number to E.164 (+1XXXXXXXXXX). Returns null
// for any input that isn't a plausible NANP or E.164 number. Used for officePhone
// (owner's existing business line we'll call to test call-forwarding) so Twilio
// won't reject the outbound test-call with a 21211.
// Maps the estimate-pipeline error codes to a user-facing string. Keeping the
// translation here so the pipeline stays pure and the UI layer controls copy.
function errorMessage(code) {
  switch (code) {
    case "invalid_phone": return "Please enter a valid customer phone number (e.g., +15035551234).";
    case "invalid_amount": return "Enter a positive dollar amount for the estimate total.";
    case "missing_description": return "Add a short description of the work being quoted.";
    case "not_found": return "That estimate could not be found.";
    case "not_pending": return "That estimate has already been handled.";
    default: return "Something went wrong. Try again.";
  }
}

function normalizePhone(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/[^\d]/g, "");
  if (trimmed.startsWith("+")) {
    if (/^[1-9]\d{7,14}$/.test(digits)) return `+${digits}`;
    return null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

// Stripe webhooks require the raw body for signature verification.
// This route must be defined BEFORE express.json() is applied globally.
//
// Webhook providers (Stripe, Twilio) retry on any non-2xx and occasionally redeliver
// on network hiccups even after success. Without dedup, the same event can double-
// charge emails, double-suspend accounts, or create two leads for the same missed
// call. Keep a bounded in-memory set of processed IDs per namespace with a TTL long
// enough to cover the provider's retry window. For multi-instance deploys, swap to
// a shared store (Redis/Postgres).
function createDedupSet({ ttlMs, maxSize }) {
  const seen = new Map(); // id -> timestamp
  return {
    isProcessed(id) {
      if (!id) return false;
      const ts = seen.get(id);
      if (!ts) return false;
      if (Date.now() - ts > ttlMs) {
        seen.delete(id);
        return false;
      }
      return true;
    },
    mark(id) {
      if (!id) return;
      const now = Date.now();
      seen.set(id, now);
      if (seen.size > maxSize) {
        for (const [k, ts] of seen) {
          if (now - ts > ttlMs) seen.delete(k);
          if (seen.size <= maxSize) break;
        }
      }
    },
  };
}
const stripeEventDedup = createDedupSet({ ttlMs: 24 * 60 * 60 * 1000, maxSize: 10000 });
// Twilio retries delivery for up to a few hours. 6h window easily covers it.
const twilioSmsDedup = createDedupSet({ ttlMs: 6 * 60 * 60 * 1000, maxSize: 20000 });
const twilioCallDedup = createDedupSet({ ttlMs: 6 * 60 * 60 * 1000, maxSize: 20000 });

app.post(
  "/api/billing/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];
    let event;
    try {
      event = constructWebhookEvent(req.body, signature);
    } catch (err) {
      console.error("[Billing Webhook] Signature verification failed:", err.message);
      return res.status(400).send(`Webhook error: ${err.message}`);
    }

    if (stripeEventDedup.isProcessed(event.id)) {
      console.log(`[Billing Webhook] Duplicate event ${event.id} (${event.type}) — acking without reprocessing.`);
      return res.json({ received: true, duplicate: true });
    }

    try {
      // Handle suspension / activation / trial reminders
      await handleWebhookEvent(event);

      // Send transactional emails for billing events
      if (event.type === "customer.subscription.trial_will_end") {
        const sub = event.data.object;
        const businessId = sub.metadata?.businessId;
        if (businessId) {
          const client = await store.findRecordByField("clients", "id", businessId);
          if (client?.ownerEmail) {
            const portalUrl = await createBillingPortalSession(
              client.stripeCustomerId,
              `${config.server.webhookBaseUrl}/billing`
            );
            await sendTrialEndingEmail(client.ownerEmail, client.ownerName, client.name, 3, portalUrl);
          }
        }
      }

      if (event.type === "invoice.payment_failed") {
        const invoice = event.data.object;
        const businessId = invoice.metadata?.businessId;
        if (businessId) {
          const client = await store.findRecordByField("clients", "id", businessId);
          if (client?.ownerEmail) {
            const portalUrl = await createBillingPortalSession(
              client.stripeCustomerId,
              `${config.server.webhookBaseUrl}/billing`
            );
            await sendPaymentFailedEmail(client.ownerEmail, client.ownerName, client.name, portalUrl);
          }
        }
      }

      stripeEventDedup.mark(event.id);
      res.json({ received: true });
    } catch (err) {
      logAndFail("Billing Webhook", err, res);
    }
  }
);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// --- ERROR HELPERS ---

// Every 5xx response includes a short correlation id. The detailed error is logged
// server-side under that id; the client gets a generic message so internal details
// never leak.
function newCorrelationId() {
  return crypto.randomBytes(8).toString("hex");
}

function logAndFail(scope, err, res, status = 500) {
  const id = newCorrelationId();
  console.error(`[${scope}] error=${err?.message || err} cid=${id}`);
  if (err?.stack) console.error(err.stack);
  res.status(status).json({ error: "Internal error. Contact support with this id.", correlationId: id });
}

// --- AUTH MIDDLEWARE ---

function requireApiKey(req, res, next) {
  const key =
    req.headers["x-api-key"] ||
    req.headers["authorization"]?.replace(/^Bearer\s+/i, "");
  const expected = process.env.API_KEY;
  if (!key || !expected) return res.status(401).json({ error: "Unauthorized" });

  // Pad both sides to a fixed length so timingSafeEqual never throws on mismatched
  // input — we still reject any request where the *original* lengths differ.
  const a = Buffer.from(String(key));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return res.status(401).json({ error: "Unauthorized" });
  if (!crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// Middleware factory for HMAC-signed passwordless URLs. The :businessId path param
// is the subject bound into the MAC, so a token signed for one business can never
// be replayed against another.
//
// When opts.bindToClientNonce is set, the MAC also incorporates the target
// client's onboardingTokenNonce. Rotating that nonce invalidates every
// outstanding onboarding link for the client (e.g. if the owner suspects the
// welcome email was forwarded). Legacy clients with no nonce fall through to
// the empty-string binding — their old links keep working until the nonce is
// rotated for the first time.
function requireSignedUrl(purpose, opts = {}) {
  return async (req, res, next) => {
    const subject = req.params.businessId;
    const token = req.query.t;
    const expiresAt = req.query.e;
    if (!subject || !token || !expiresAt) {
      return res.status(403).send("Link missing or invalid. Request a new one from your email.");
    }
    let nonce = "";
    if (opts.bindToClientNonce) {
      const client = await store.findRecordByField("clients", "id", subject);
      if (!client) {
        // Don't leak client-existence via timing — just fail the same way as an expired link.
        return res.status(403).send("Link expired or invalid. Request a new one from your email.");
      }
      nonce = client.onboardingTokenNonce || "";
    }
    if (!signedUrl.verify(purpose, subject, token, expiresAt, nonce)) {
      return res.status(403).send("Link expired or invalid. Request a new one from your email.");
    }
    next();
  };
}

// --- TWILIO SIGNATURE VALIDATION ---

function validateTwilioSignature(req, res, next) {
  const signature = req.headers["x-twilio-signature"] || "";
  const url = `${config.server.webhookBaseUrl}${req.originalUrl}`;
  const isValid = twilio.validateRequest(
    config.twilio.authToken,
    signature,
    url,
    req.body
  );
  if (!isValid) {
    console.warn("[Webhook] Invalid Twilio signature from", req.ip);
    return res.status(403).send("Forbidden");
  }
  next();
}

// --- RATE LIMITING ---
// In-memory per-instance counter. Fine for a single Railway dyno; if we ever
// scale horizontally the limit is bypassable by round-robining instances.
// Relies on app.set("trust proxy", 1) above so req.ip reflects the real client.
//
// TODO(scale): migrate to a Redis-backed limiter when we move beyond one dyno.
// Drop-in path: replace rateLimitStore with `rate-limiter-flexible`'s
// RateLimiterRedis, keep the same (key, windowMs, max) shape, and keep the
// middleware factory below untouched — each limiter becomes a named key prefix
// (e.g. "rl:signup", "rl:verify"). Set `blockDuration` to 0 so the window
// resets on the next request after expiry, matching current behavior. Add
// REDIS_URL to required env in config.js. For now, a single dyno means bypass
// requires a botnet large enough that Stripe/Twilio-side abuse protections
// (card velocity, per-number throttles) are the effective ceiling anyway.
const rateLimitStore = new Map();

function rateLimit(windowMs, max) {
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    const entry = rateLimitStore.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > entry.resetAt) {
      entry.count = 0;
      entry.resetAt = now + windowMs;
    }
    entry.count++;
    rateLimitStore.set(key, entry);
    if (entry.count > max) return res.status(429).json({ error: "Too many requests" });
    next();
  };
}

// Signup is expensive downstream (Stripe customer + trial sub + verification
// email + eventual Twilio provisioning). 10/hr per IP was too generous —
// tightened to 5/hr so a single origin can't chew through 100 Stripe customer
// records in a day while we wait for the per-email dedup below to reject them.
const signupLimiter = rateLimit(60 * 60 * 1000, 5);
const verifyLimiter = rateLimit(60 * 60 * 1000, 20);
const billingLinkLimiter = rateLimit(60 * 60 * 1000, 10);
// Dashboard fires 3 list-queries per load; cap refresh storms from a broken tab
// or auto-reloader. Signed token is already subject-scoped so this is a DB-load
// safety, not an auth boundary.
const dashboardLimiter = rateLimit(60 * 1000, 60);

// --- HEALTH CHECK ---

app.get("/health", async (req, res) => {
  try {
    await store.healthCheck();
    const mem = process.memoryUsage();
    res.json({
      status: "ok",
      uptime: process.uptime(),
      memory: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
      },
    });
  } catch {
    res.status(503).json({ status: "error", db: "unreachable" });
  }
});

// --- SELF-SERVE SIGNUP ---

// Serve the signup page with Stripe publishable key injected.
// The CSP here is intentionally tight — Stripe.js is the only external script allowed,
// and Stripe iframes are the only permitted frame sources. 'unsafe-inline' is required
// for the small script block in signup.html but not for any script fetched cross-origin.
app.get("/signup", (req, res) => {
  const landingBaseUrl = (config.server.landingBaseUrl || "").replace(/\/$/, "");
  const html = fs
    .readFileSync(path.join(__dirname, "signup.html"), "utf8")
    .split("__STRIPE_PUBLISHABLE_KEY__").join(config.stripe.publishableKey || "")
    .split("__LANDING_BASE_URL__").join(landingBaseUrl);
  res.setHeader("Content-Type", "text/html");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://js.stripe.com",
      "frame-src https://js.stripe.com https://hooks.stripe.com",
      "connect-src 'self' https://api.stripe.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ")
  );
  res.send(html);
});

// Expose available plans so the signup page can render the picker without hardcoding prices.
app.get("/api/plans", (req, res) => {
  const plans = Object.values(config.stripe.plans).map((p) => ({
    id: p.id,
    label: p.label,
    price: p.price,
    features: p.features,
    available: Boolean(p.priceId),
  }));
  res.json({ plans });
});

const PENDING_SIGNUPS = "pending_signups";
const OAUTH_STATES = "calendar_oauth_states";
const VERIFICATION_TTL_SECONDS = 24 * 60 * 60;
const VERIFICATION_TTL_MS = VERIFICATION_TTL_SECONDS * 1000;
const BILLING_LINK_TTL_SECONDS = 30 * 60;

// Step 1 of signup: create Stripe customer + trial subscription, stash pending
// record keyed by the email verification subject id, email the verify link.
// Twilio is NOT provisioned until the email is verified — this prevents email-
// spoofing signups from burning a real phone number.
app.post("/api/signup", signupLimiter, async (req, res) => {
  const { businessName, ownerName, ownerEmail, ownerPhone, officePhone, serviceArea, areaCode, paymentMethodId, plan } = req.body;

  if (!businessName || !ownerName || !ownerEmail || !serviceArea || !paymentMethodId || !officePhone) {
    return res.status(400).json({ error: "All fields are required" });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
    return res.status(400).json({ error: "Please enter a valid email address" });
  }
  const normalizedOfficePhone = normalizePhone(officePhone);
  if (!normalizedOfficePhone) {
    return res.status(400).json({ error: "Please enter a valid phone number for your existing business line (e.g., +15035557890)." });
  }
  // Mobile alert number — optional. If provided, it must also be well-formed so
  // we don't silently keep an unparseable value that later fails at Twilio send.
  let normalizedOwnerPhone = null;
  if (ownerPhone) {
    normalizedOwnerPhone = normalizePhone(ownerPhone);
    if (!normalizedOwnerPhone) {
      return res.status(400).json({ error: "Please enter a valid mobile number for job alerts." });
    }
  }

  const planId = plan || "bundle";
  const selectedPlan = config.stripe.plans[planId];
  if (!selectedPlan) {
    return res.status(400).json({ error: `Unknown plan: ${planId}` });
  }
  if (!selectedPlan.priceId) {
    return res.status(400).json({ error: `Plan ${planId} is not currently available` });
  }

  // Per-email dedup: if a non-expired pending_signups row exists for this
  // address, refuse a second signup instead of creating a second Stripe
  // customer + trial sub. Existing owners are tolerated here — a real
  // reacquire flow is for the billing portal, not the signup page — but
  // re-running signup during the 24h verification window would double-charge
  // and double-provision on verify.
  const normalizedEmail = String(ownerEmail).trim().toLowerCase();
  try {
    const existingPending = await store.findRecord(PENDING_SIGNUPS, (r) =>
      typeof r.ownerEmail === "string" &&
      r.ownerEmail.trim().toLowerCase() === normalizedEmail &&
      (!r.expiresAt || r.expiresAt > Date.now()) &&
      !r.verified
    );
    if (existingPending) {
      return res.status(409).json({
        error: "A signup for this email is already in progress. Check your inbox for the verification link, or try again in 24 hours.",
      });
    }
  } catch (err) {
    // If the lookup fails we fall through to the signup path — the unique-ness
    // is a guardrail, not an auth boundary. Logging is enough.
    console.warn(`[Signup] dedup lookup failed: ${err.message}`);
  }

  try {
    // Billing first — if the card fails, don't send a verification email.
    const billing = await createSubscription(
      null,
      businessName,
      ownerEmail,
      paymentMethodId,
      selectedPlan.priceId
    );

    const pending = await store.addRecord(PENDING_SIGNUPS, {
      businessName,
      ownerName,
      ownerEmail,
      ownerPhone: normalizedOwnerPhone,
      officePhone: normalizedOfficePhone,
      serviceArea,
      areaCode: areaCode || "503",
      planId: selectedPlan.id,
      planFeatures: selectedPlan.features,
      stripeCustomerId: billing.customerId,
      stripeSubscriptionId: billing.subscriptionId,
      billingStatus: billing.status,
      trialEnd: billing.trialEnd,
      verified: false,
      // Hard expiry so the cleanup cron can garbage-collect abandoned signups
      // (and cancel their Stripe subscriptions) without guessing from createdAt.
      expiresAt: Date.now() + VERIFICATION_TTL_MS,
    });

    const verifyUrl = signedUrl.buildUrl(
      config.server.webhookBaseUrl,
      `/api/signup/verify/${pending.id}`,
      "signup_verify",
      pending.id,
      VERIFICATION_TTL_SECONDS
    );

    try {
      await sendVerificationEmail(ownerEmail, ownerName, businessName, verifyUrl);
    } catch (err) {
      console.error("[Signup] verification email send failed:", err.message);
    }

    console.log(`[Signup] Pending: ${businessName} — ${redactEmail(ownerEmail)} — awaiting email verification`);

    res.json({
      success: true,
      pending: true,
      email: ownerEmail,
    });
  } catch (err) {
    logAndFail("Signup", err, res);
  }
});

// Step 2 of signup: email verification link lands here, we provision Twilio,
// create the real client record, and send the welcome email with billing portal URL.
//
// Concurrency model: store.claimRecord flips `verified` from false → true atomically.
// The caller that wins the flip owns provisioning; any racing caller sees null and
// falls back to the idempotent success redirect. This prevents double-provisioning
// a Twilio number (and double-billing the account) on duplicate clicks.
app.get("/api/signup/verify/:pendingId", verifyLimiter, async (req, res) => {
  try {
    const { pendingId } = req.params;
    const { t, e } = req.query;
    if (!t || !e || !signedUrl.verify("signup_verify", pendingId, t, e)) {
      return res.status(403).send("Verification link expired or invalid. Please sign up again.");
    }

    const pending = await store.claimRecord(PENDING_SIGNUPS, pendingId, "verified");
    if (!pending) {
      // Either row missing or already verified. Check for idempotent redirect.
      const existing = await store.findRecordByField(PENDING_SIGNUPS, "id", pendingId);
      if (!existing) return res.status(404).send("Signup not found. Please sign up again.");
      if (existing.verified && existing.clientId) {
        return res.redirect(`${config.server.webhookBaseUrl}/signup?verified=1`);
      }
      // Claimed by a concurrent request that hasn't finished provisioning yet,
      // or a prior attempt crashed mid-provision. Tell the user to retry.
      return res.status(409).send("Verification is in progress. Refresh in a few seconds.");
    }

    if (pending.expiresAt && pending.expiresAt < Date.now()) {
      // Claimed an expired row — roll back the flag so cleanup still deletes it.
      await store.updateRecord(PENDING_SIGNUPS, pendingId, { verified: false });
      return res.status(403).send("Verification link expired. Please sign up again.");
    }

    const phone = await provisionPhoneNumber(pending.areaCode || "503");

    const client = await addClient({
      name: pending.businessName,
      ownerName: pending.ownerName,
      ownerEmail: pending.ownerEmail,
      ownerPhone: pending.ownerPhone || null,
      officePhone: pending.officePhone || null,
      serviceArea: pending.serviceArea,
      services: ["AC repair", "Furnace repair", "Heat pump service", "Maintenance plans"],
      hours: "Mon-Fri 8am-6pm, Emergency service 24/7",
      twilioNumber: phone.phoneNumber,
      twilioSid: phone.sid,
      stripeCustomerId: pending.stripeCustomerId,
      stripeSubscriptionId: pending.stripeSubscriptionId,
      billingStatus: pending.billingStatus,
      trialEnd: pending.trialEnd,
      plan: pending.planId,
      planFeatures: pending.planFeatures,
      suspended: false,
    });

    await store.updateRecord(PENDING_SIGNUPS, pendingId, {
      clientId: client.id,
      twilioNumber: phone.phoneNumber,
    });

    const calendarConnectUrl = signedUrl.buildUrl(
      config.server.webhookBaseUrl,
      `/api/calendar/connect/${client.id}`,
      "calendar_connect",
      client.id,
      VERIFICATION_TTL_SECONDS
    );
    const billingUrl = signedUrl.buildUrl(
      config.server.webhookBaseUrl,
      `/billing/${client.id}`,
      "billing",
      client.id,
      BILLING_LINK_TTL_SECONDS
    );
    const wizardUrl = signedUrl.buildUrl(
      config.server.webhookBaseUrl,
      `/onboarding/${client.id}`,
      "onboarding",
      client.id,
      14 * 24 * 60 * 60, // 14-day window — long enough for a small-business owner to work through setup
      {},
      client.onboardingTokenNonce || ""
    );

    try {
      await sendWelcomeEmail(
        pending.ownerEmail,
        pending.ownerName,
        pending.businessName,
        calendarConnectUrl,
        phone.phoneNumber,
        billingUrl,
        wizardUrl
      );
    } catch (err) {
      console.error("[Signup Verify] welcome email failed:", err.message);
    }

    console.log(`[Signup] Verified + provisioned: ${pending.businessName} — ${phone.phoneNumber} (${redactEmail(pending.ownerEmail)})`);

    // Skip the standalone success page — drop the owner directly into the
    // wizard with a signed token good for 14 days. The wizard shows the same
    // phone number + calendar-connect CTA plus the rest of the checklist, so
    // the old terminal success screen is redundant.
    res.redirect(303, wizardUrl);
  } catch (err) {
    logAndFail("Signup Verify", err, res);
  }
});

// Onboarding wizard shell — top-level checklist. Verify success and welcome
// email both target this route; individual steps link off to profile,
// calendar connect, paste form, etc. Signed URL (same "onboarding" purpose
// as the deeper steps) so the whole flow shares one token.
app.get("/onboarding/:businessId", requireSignedUrl("onboarding", { bindToClientNonce: true }), async (req, res) => {
  try {
    const businessId = req.params.businessId;
    const ctx = await onboarding.loadProfileContext(businessId);
    if (!ctx) return res.status(404).send("Not found");
    const qs = new URLSearchParams({ t: req.query.t, e: req.query.e }).toString();
    const linkBuilder = (p) => `${p}?${qs}`;
    const calendarConnected = await isCalendarConnected(businessId);
    const calendarConnectUrl = signedUrl.buildUrl(
      config.server.webhookBaseUrl,
      `/api/calendar/connect/${businessId}`,
      "calendar_connect",
      businessId,
      BILLING_LINK_TTL_SECONDS
    );
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    setOwnerHtmlCsp(res);
    res.send(onboarding.renderWizardPage({
      client: ctx.client,
      state: ctx.state,
      isCalendarConnected: calendarConnected,
      calendarConnectUrl,
      features: {
        leadRescue: hasFeature(ctx.client, FEATURES.LEAD_RESCUE),
        reviewAutopilot: hasFeature(ctx.client, FEATURES.REVIEW_AUTOPILOT),
        estimateFollowUp: hasFeature(ctx.client, FEATURES.ESTIMATE_FOLLOWUP),
      },
      linkBuilder,
    }));
  } catch (err) {
    logAndFail("Onboarding Wizard", err, res);
  }
});

// Owner dashboard — 7-day pipeline activity plus setup status. Shares the
// "onboarding" signed-URL purpose so one token gates the whole owner-facing
// surface (wizard, profile, estimates, dashboard). Links to the billing portal
// are generated on demand via the request-link flow, so we don't hand out a
// dashboard link that doubles as a billing-portal link.
app.get("/dashboard/:businessId", dashboardLimiter, requireSignedUrl("onboarding", { bindToClientNonce: true }), async (req, res) => {
  try {
    const businessId = req.params.businessId;
    const ctx = await onboarding.loadProfileContext(businessId);
    if (!ctx) return res.status(404).send("Not found");
    const qs = new URLSearchParams({ t: req.query.t, e: req.query.e }).toString();
    const linkBuilder = (p) => `${p}?${qs}`;

    const until = Date.now();
    const since = until - 7 * 24 * 60 * 60 * 1000;
    const inWindow = (ts) => {
      const t = new Date(ts).getTime();
      return t >= since && t < until;
    };

    const features = {
      leadRescue: hasFeature(ctx.client, FEATURES.LEAD_RESCUE),
      reviewAutopilot: hasFeature(ctx.client, FEATURES.REVIEW_AUTOPILOT),
      estimateFollowUp: hasFeature(ctx.client, FEATURES.ESTIMATE_FOLLOWUP),
    };

    // Fetch the per-business rows we need, then compute in JS. Two benefits
    // over getClientStats:
    //   (1) Lead counts use the additive model — a booked lead is credited to
    //       rescued+qualified+booked (states progress linearly; a booked lead
    //       did pass through rescued and qualified by definition).
    //   (2) "Open estimates" reflects the live total, not just estimates
    //       created in the last 7 days — otherwise an owner with 20 older
    //       open estimates reads 0 and thinks the pipeline is broken.
    const [leads, estimates, reviewReqs, reviews, calendarConnected, queue] = await Promise.all([
      features.leadRescue ? store.findRecordsByField("leads", "businessId", businessId) : Promise.resolve([]),
      features.estimateFollowUp ? store.findRecordsByField("estimates", "businessId", businessId) : Promise.resolve([]),
      features.reviewAutopilot ? store.findRecordsByField("review_requests", "businessId", businessId) : Promise.resolve([]),
      features.reviewAutopilot ? store.findRecordsByField("reviews", "businessId", businessId) : Promise.resolve([]),
      isCalendarConnected(businessId),
      features.estimateFollowUp ? listPendingQueue(businessId) : Promise.resolve([]),
    ]);

    const leadsInWindow = leads.filter((l) => inWindow(l.createdAt));
    const stats = {
      missedCallsRescued: leadsInWindow.length,
      leadsQualified: leadsInWindow.filter((l) => l.status === "qualified" || l.status === "booked").length,
      appointmentsBooked: leadsInWindow.filter((l) => l.status === "booked").length,
      estimatesAdded: estimates.filter((e) => inWindow(e.createdAt)).length,
      openEstimatesTotal: estimates.filter((e) => e.status === "open").length,
      estimatesAccepted: estimates.filter((e) => e.status === "accepted" && inWindow(e.acceptedAt || e.updatedAt || e.createdAt)).length,
      reviewRequestsSent: reviewReqs.filter((r) => inWindow(r.createdAt)).length,
      reviewsResponded: reviews.filter((r) => r.status === "responded" && inWindow(r.respondedAt || r.createdAt)).length,
    };

    // Mint a short-lived calendar_connect URL for the "Fix →" link. The
    // dashboard's onboarding token doesn't satisfy /api/calendar/connect
    // (different purpose), so without this the button 403s.
    const calendarConnectUrl = signedUrl.buildUrl(
      config.server.webhookBaseUrl,
      `/api/calendar/connect/${businessId}`,
      "calendar_connect",
      businessId,
      BILLING_LINK_TTL_SECONDS
    );

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    setOwnerHtmlCsp(res);
    res.send(dashboardUI.renderDashboardPage({
      client: ctx.client,
      stats,
      calendarConnected,
      calendarConnectUrl,
      forwardingVerified: !!ctx.state.forwardingVerified,
      profileComplete: !!ctx.state.profileComplete,
      pendingQueueCount: queue.length,
      features,
      linkBuilder,
    }));
  } catch (err) {
    logAndFail("Dashboard Page", err, res);
  }
});

// Onboarding profile editor — lets the owner replace the hardcoded defaults
// (services, hours, pricing, emergency definition, financing, review link) that
// flow into AI prompts. Signed URL because there's no session auth on this app
// and we don't want random visitors reading a business's profile.
app.get("/onboarding/:businessId/profile", requireSignedUrl("onboarding", { bindToClientNonce: true }), async (req, res) => {
  try {
    const ctx = await onboarding.loadProfileContext(req.params.businessId);
    if (!ctx) return res.status(404).send("Not found");
    const qs = new URLSearchParams({ t: req.query.t, e: req.query.e }).toString();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    setOwnerHtmlCsp(res);
    res.send(onboarding.renderProfilePage(ctx.client, ctx.state, qs));
  } catch (err) {
    logAndFail("Onboarding Profile GET", err, res);
  }
});

app.post("/onboarding/:businessId/profile", requireSignedUrl("onboarding", { bindToClientNonce: true }), async (req, res) => {
  try {
    const businessId = req.params.businessId;
    const ctx = await onboarding.loadProfileContext(businessId);
    if (!ctx) return res.status(404).send("Not found");
    const parsed = onboarding.parseProfileSubmission(req.body, normalizePhone);
    if (!parsed.ok) {
      const qs = new URLSearchParams({ t: req.query.t, e: req.query.e, error: parsed.error }).toString();
      return res.redirect(303, `/onboarding/${businessId}/profile?${qs}`);
    }
    await store.updateRecord("clients", businessId, parsed.updates);
    await onboarding.updateState(businessId, {
      profileComplete: true,
      profileCompletedAt: new Date().toISOString(),
    });
    const qs = new URLSearchParams({ t: req.query.t, e: req.query.e, saved: "1" }).toString();
    res.redirect(303, `/onboarding/${businessId}/profile?${qs}`);
  } catch (err) {
    logAndFail("Onboarding Profile POST", err, res);
  }
});

// Forwarding self-test — originates a Twilio call to the owner's existing
// business line from a dedicated test caller number. If call-forwarding is
// wired correctly, that call hits the client's Twilio DID and the voice webhook
// credits it to the pending test record, flipping forwardingVerified.
app.post("/onboarding/:businessId/forwarding-test/start", requireSignedUrl("onboarding", { bindToClientNonce: true }), async (req, res) => {
  try {
    const businessId = req.params.businessId;
    const result = await onboarding.startForwardingTest(businessId, async (officePhone) => {
      const sid = await originateTestCall(officePhone);
      return { callSid: sid, testCallerNumber: config.twilio.testCallerNumber };
    });
    if (!result.ok) {
      if (result.error === "not_found") return res.status(404).json({ error: "Business not found" });
      if (result.error === "no_office_phone") {
        return res.status(400).json({ error: "Set your business line in the profile first." });
      }
      if (result.error === "daily_cap_reached") {
        return res.status(429).json({ error: "Too many test calls today. Try again tomorrow or reach support." });
      }
      return res.status(400).json({ error: result.error });
    }
    res.status(202).json({
      ok: true,
      reused: !!result.reused,
      expiresAt: result.test.expiresAt,
    });
  } catch (err) {
    const cid = newCorrelationId();
    console.error(`[Forwarding Test Start] error=${err.message} cid=${cid}`);
    res.status(500).json({ error: "Failed to originate test call. Try again in a minute." });
  }
});

app.get("/onboarding/:businessId/forwarding-test/status", requireSignedUrl("onboarding", { bindToClientNonce: true }), async (req, res) => {
  try {
    const status = await onboarding.getForwardingTestStatus(req.params.businessId);
    res.json(status);
  } catch (err) {
    logAndFail("Forwarding Test Status", err, res);
  }
});

// Manual estimate paste form — the escape hatch for owners whose workflow
// doesn't route through BCC'd email (e.g., they quote over the phone).
app.get("/onboarding/:businessId/estimates/paste", requireSignedUrl("onboarding", { bindToClientNonce: true }), async (req, res) => {
  try {
    const ctx = await onboarding.loadProfileContext(req.params.businessId);
    if (!ctx) return res.status(404).send("Not found");
    const qs = new URLSearchParams({ t: req.query.t, e: req.query.e }).toString();
    const flash = { saved: req.query.saved === "1", error: req.query.error || null };
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    setOwnerHtmlCsp(res);
    res.send(estimatesUI.renderPastePage(ctx.client, ctx.state, qs, flash));
  } catch (err) {
    logAndFail("Estimate Paste GET", err, res);
  }
});

app.post("/onboarding/:businessId/estimates/paste", requireSignedUrl("onboarding", { bindToClientNonce: true }), async (req, res) => {
  try {
    const businessId = req.params.businessId;
    const ctx = await onboarding.loadProfileContext(businessId);
    if (!ctx) return res.status(404).send("Not found");
    const result = await createEstimateFromPaste(req.body || {}, ctx.client);
    const qs = new URLSearchParams({
      t: req.query.t,
      e: req.query.e,
      ...(result.ok ? { saved: "1" } : { error: errorMessage(result.error) }),
    }).toString();
    res.redirect(303, `/onboarding/${businessId}/estimates/paste?${qs}`);
  } catch (err) {
    logAndFail("Estimate Paste POST", err, res);
  }
});

app.get("/onboarding/:businessId/estimates/queue", requireSignedUrl("onboarding", { bindToClientNonce: true }), async (req, res) => {
  try {
    const businessId = req.params.businessId;
    const ctx = await onboarding.loadProfileContext(businessId);
    if (!ctx) return res.status(404).send("Not found");
    const queue = await listPendingQueue(businessId);
    const qs = new URLSearchParams({ t: req.query.t, e: req.query.e }).toString();
    const flash = {
      saved: req.query.saved ? decodeURIComponent(req.query.saved) : null,
      error: req.query.error ? decodeURIComponent(req.query.error) : null,
    };
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    setOwnerHtmlCsp(res);
    res.send(estimatesUI.renderQueuePage(ctx.client, queue, qs, flash));
  } catch (err) {
    logAndFail("Estimate Queue GET", err, res);
  }
});

app.post("/onboarding/:businessId/estimates/queue/:queueId/approve", requireSignedUrl("onboarding", { bindToClientNonce: true }), async (req, res) => {
  try {
    const { businessId, queueId } = req.params;
    const ctx = await onboarding.loadProfileContext(businessId);
    if (!ctx) return res.status(404).send("Not found");
    const result = await approveQueuedEstimate(queueId, req.body || {}, ctx.client);
    const qs = new URLSearchParams({
      t: req.query.t,
      e: req.query.e,
      ...(result.ok
        ? { saved: "Estimate approved — follow-ups start in 24 hours." }
        : { error: errorMessage(result.error) }),
    }).toString();
    res.redirect(303, `/onboarding/${businessId}/estimates/queue?${qs}`);
  } catch (err) {
    logAndFail("Estimate Queue Approve", err, res);
  }
});

app.post("/onboarding/:businessId/estimates/queue/:queueId/reject", requireSignedUrl("onboarding", { bindToClientNonce: true }), async (req, res) => {
  try {
    const { businessId, queueId } = req.params;
    const ctx = await onboarding.loadProfileContext(businessId);
    if (!ctx) return res.status(404).send("Not found");
    const result = await rejectQueuedEstimate(queueId, ctx.client);
    const qs = new URLSearchParams({
      t: req.query.t,
      e: req.query.e,
      ...(result.ok
        ? { saved: "Dismissed." }
        : { error: errorMessage(result.error) }),
    }).toString();
    res.redirect(303, `/onboarding/${businessId}/estimates/queue?${qs}`);
  } catch (err) {
    logAndFail("Estimate Queue Reject", err, res);
  }
});

// Rotate the onboarding-token nonce and return a fresh long-lived wizard link.
// Requires a currently-valid onboarding token (proof of present access). Any
// previously-issued onboarding link for this business stops verifying as soon
// as this rotation commits — useful if the owner suspects a forwarded welcome
// email or wants to revoke a link that was shared.
//
// The new URL is returned in the response body so a browser tab or CLI caller
// can follow it immediately. No escalation: the caller already proved access
// to the current onboarding token, which gates the same surface.
app.post("/onboarding/:businessId/rotate-link", requireSignedUrl("onboarding", { bindToClientNonce: true }), async (req, res) => {
  try {
    const businessId = req.params.businessId;
    const newNonce = await rotateOnboardingTokenNonce(businessId);
    if (!newNonce) return res.status(404).json({ error: "Not found" });
    const wizardUrl = signedUrl.buildUrl(
      config.server.webhookBaseUrl,
      `/onboarding/${businessId}`,
      "onboarding",
      businessId,
      14 * 24 * 60 * 60,
      {},
      newNonce
    );
    res.json({ ok: true, wizardUrl });
  } catch (err) {
    logAndFail("Rotate Onboarding Link", err, res);
  }
});

// Billing portal — requires a signed URL from email (no session auth on this app).
app.get("/billing/:businessId", requireSignedUrl("billing"), async (req, res) => {
  try {
    const client = await store.findRecordByField("clients", "id", req.params.businessId);
    if (!client?.stripeCustomerId) return res.status(404).send("Not found");
    const url = await createBillingPortalSession(
      client.stripeCustomerId,
      `${config.server.webhookBaseUrl}/`
    );
    res.redirect(url);
  } catch (err) {
    logAndFail("Billing Portal", err, res);
  }
});

// Owner requests a fresh billing portal link by email. Rate-limited to 10/hr/IP.
// Always returns 202 in the same amount of time whether the email matched or not
// — anti-enumeration: send is fire-and-forget so match/miss paths return identically.
app.post("/api/billing/request-link", billingLinkLimiter, async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Valid email required" });
    }
    const normalized = String(email).trim().toLowerCase();
    const clients = await store.readCollection("clients");
    const match = clients.find((c) => (c.ownerEmail || "").toLowerCase() === normalized);
    if (match && match.stripeCustomerId) {
      const billingUrl = signedUrl.buildUrl(
        config.server.webhookBaseUrl,
        `/billing/${match.id}`,
        "billing",
        match.id,
        BILLING_LINK_TTL_SECONDS
      );
      // Do not await — response latency must not depend on whether the email matched.
      sendBillingLinkEmail(match.ownerEmail, match.ownerName, match.name, billingUrl)
        .catch((err) => console.error("[Billing Link] email send failed:", err.message));
    }
    res.status(202).json({ ok: true });
  } catch (err) {
    logAndFail("Billing Link", err, res);
  }
});

// --- TWILIO WEBHOOKS ---

// Check suspension before processing any Twilio event
async function requireActiveAccount(business, res) {
  if (business.suspended) {
    console.log(`[Webhook] Ignoring event for suspended account: ${business.name}`);
    res.sendStatus(200);
    return false;
  }
  return true;
}

app.post("/webhooks/voice/status", validateTwilioSignature, async (req, res) => {
  try {
    const { Called, From, CallStatus, CallSid } = req.body;
    // Twilio retries on any non-2xx and occasionally on network hiccups. Dedup by
    // (CallSid, CallStatus) so a retry of the same status doesn't create a second
    // lead + duplicate outbound SMS. Different statuses on the same call (e.g.
    // ringing → no-answer) are intentionally distinct and pass through.
    const dedupKey = CallSid ? `${CallSid}:${CallStatus}` : null;
    if (dedupKey && twilioCallDedup.isProcessed(dedupKey)) {
      console.log(`[Voice Status] Duplicate CallSid=${CallSid} status=${CallStatus} — acking.`);
      return res.sendStatus(200);
    }

    // Forwarding self-test detection runs before the missed-call flow so a
    // successful test never spawns a Lead Rescue SMS. Fast-path guard: only
    // bother hitting the DB when From exactly matches the configured test
    // caller DID. Most US carriers preserve the original CLID when conditional
    // call-forwarding fires, so this catches the overwhelming majority of real
    // test calls without adding a DB round-trip to every inbound webhook event.
    // Carriers that rewrite CLID to the forwarding line are covered by a manual
    // "Mark verified" escape hatch in the onboarding UI.
    if (From && Called && From === config.twilio.testCallerNumber) {
      const businessForTest = await getClientByPhone(Called);
      if (businessForTest) {
        const consumed = await onboarding.maybeConsumeForwardingTest({
          called: Called,
          from: From,
          business: businessForTest,
        });
        if (consumed) {
          console.log(`[Voice Status] Forwarding test verified for ${businessForTest.name} (CallSid=${CallSid})`);
          twilioCallDedup.mark(dedupKey);
          return res.sendStatus(200);
        }
      }
    }

    if (CallStatus === "no-answer" || CallStatus === "busy" || CallStatus === "failed") {
      const business = await getClientByPhone(Called);
      if (business && await requireActiveAccount(business, res)) {
        if (!hasFeature(business, FEATURES.LEAD_RESCUE)) {
          console.log(`[Voice Status] ${business.name} not subscribed to Lead Rescue — skipping`);
          twilioCallDedup.mark(dedupKey);
          return res.sendStatus(200);
        }
        await handleMissedCall(From, business);
        twilioCallDedup.mark(dedupKey);
        res.sendStatus(200);
      }
    } else {
      twilioCallDedup.mark(dedupKey);
      res.sendStatus(200);
    }
  } catch (err) {
    const cid = newCorrelationId();
    console.error(`[Voice Status] error=${err.message} cid=${cid}`);
    res.sendStatus(500);
  }
});

app.post("/webhooks/sms", validateTwilioSignature, async (req, res) => {
  try {
    const { To, From, Body, MessageSid } = req.body;
    // Dedup retries by MessageSid — otherwise the pipeline runs twice, the customer
    // gets two identical AI-generated replies, and the quota counter ticks twice.
    if (MessageSid && twilioSmsDedup.isProcessed(MessageSid)) {
      console.log(`[SMS] Duplicate MessageSid=${MessageSid} — acking.`);
      return res.sendStatus(200);
    }
    const business = await getClientByPhone(To);
    if (!business) {
      console.warn(`[SMS] No business found for number ${To}`);
      return res.sendStatus(404);
    }
    if (!(await requireActiveAccount(business, res))) return;

    // If the client has Estimate Follow-Up, try matching to an open estimate first.
    let estimateReply = null;
    if (hasFeature(business, FEATURES.ESTIMATE_FOLLOWUP)) {
      estimateReply = await handleEstimateReply(From, Body, business);
    }

    if (!estimateReply && hasFeature(business, FEATURES.LEAD_RESCUE)) {
      await handleIncomingSMS(From, Body, business);
    } else if (!estimateReply) {
      console.log(`[SMS] ${business.name} has no pipeline for this message — ignoring`);
    }
    twilioSmsDedup.mark(MessageSid);
    res.sendStatus(200);
  } catch (err) {
    const cid = newCorrelationId();
    console.error(`[SMS] error=${err.message} cid=${cid}`);
    res.sendStatus(500);
  }
});

// --- REVIEW AUTOPILOT ---

app.post("/api/review/request", requireApiKey, async (req, res) => {
  try {
    const { customerPhone, customerName, jobType, businessId } = req.body;
    const business = await store.findRecordByField("clients", "id", businessId);
    if (!business) return res.status(404).json({ error: "Business not found" });
    if (!hasFeature(business, FEATURES.REVIEW_AUTOPILOT)) {
      return res.status(403).json({ error: "Business does not have Review Autopilot enabled" });
    }
    await requestReview(customerPhone, customerName, jobType, business);
    res.json({ success: true });
  } catch (err) {
    logAndFail("Review Request", err, res);
  }
});

app.post("/api/review/incoming", requireApiKey, async (req, res) => {
  try {
    const { authorName, rating, text, platform, businessId } = req.body;
    const business = await store.findRecordByField("clients", "id", businessId);
    if (!business) return res.status(404).json({ error: "Business not found" });
    if (!hasFeature(business, FEATURES.REVIEW_AUTOPILOT)) {
      return res.status(403).json({ error: "Business does not have Review Autopilot enabled" });
    }
    const result = await respondToReview({ authorName, rating, text, platform }, business);
    res.json(result);
  } catch (err) {
    logAndFail("Review Incoming", err, res);
  }
});

// --- ESTIMATE FOLLOW-UP ---

app.post("/api/estimate", requireApiKey, async (req, res) => {
  try {
    const { customerName, customerPhone, customerEmail, amount, description, businessId } = req.body;
    const business = await store.findRecordByField("clients", "id", businessId);
    if (!business) return res.status(404).json({ error: "Business not found" });
    if (!hasFeature(business, FEATURES.ESTIMATE_FOLLOWUP)) {
      return res.status(403).json({ error: "Business does not have Estimate Follow-Up enabled" });
    }
    const entry = await addEstimate({ customerName, customerPhone, customerEmail, amount, description }, business);
    res.json(entry);
  } catch (err) {
    logAndFail("Add Estimate", err, res);
  }
});

// --- INTERNAL ONBOARDING (API-key protected; self-serve uses /api/signup) ---

app.post("/api/onboard", requireApiKey, rateLimit(60 * 60 * 1000, 10), async (req, res) => {
  try {
    const { businessName, ownerName, ownerEmail, serviceArea, services, hours, googleReviewLink, financingAvailable, areaCode, plan } = req.body;
    if (!businessName || !ownerName || !serviceArea) {
      return res.status(400).json({ error: "businessName, ownerName, and serviceArea are required" });
    }
    const planId = plan || "bundle";
    const selectedPlan = config.stripe.plans[planId];
    if (!selectedPlan) {
      return res.status(400).json({ error: `Unknown plan: ${planId}` });
    }
    const phone = await provisionPhoneNumber(areaCode || "503");
    const client = await addClient({
      name: businessName, ownerName, ownerEmail, serviceArea,
      services: services || ["AC repair", "Furnace repair", "Heat pump service", "Maintenance plans"],
      hours: hours || "Mon-Fri 8am-6pm, Emergency service 24/7",
      twilioNumber: phone.phoneNumber, twilioSid: phone.sid,
      googleReviewLink: googleReviewLink || "", financingAvailable: financingAvailable || false,
      plan: selectedPlan.id,
      planFeatures: selectedPlan.features,
      suspended: false,
    });
    const calendarConnectUrl = signedUrl.buildUrl(
      config.server.webhookBaseUrl,
      `/api/calendar/connect/${client.id}`,
      "calendar_connect",
      client.id,
      VERIFICATION_TTL_SECONDS
    );
    console.log(`[Onboard] New client: ${businessName} — ${phone.phoneNumber}`);
    res.json({ success: true, client: { id: client.id, name: client.name, phoneNumber: phone.phoneNumber }, nextSteps: { calendarConnect: calendarConnectUrl } });
  } catch (err) {
    logAndFail("Onboard", err, res);
  }
});

app.get("/api/clients", requireApiKey, async (req, res) => {
  try {
    const clients = await store.readCollection("clients");
    res.json(clients.map((c) => ({ id: c.id, name: c.name, ownerName: c.ownerName, phoneNumber: c.twilioNumber, serviceArea: c.serviceArea, suspended: c.suspended, billingStatus: c.billingStatus })));
  } catch (err) {
    logAndFail("List Clients", err, res);
  }
});

// --- CALENDAR ---

// Signed URL gate: connect link from email is short-lived and single-business.
// getAuthUrl() then generates a random OAuth state nonce that is validated in
// the callback, preventing CSRF where an attacker tricks an owner into authorizing
// Google against the attacker's business id.
app.get("/api/calendar/connect/:businessId", requireSignedUrl("calendar_connect"), async (req, res) => {
  try {
    const url = await getAuthUrl(req.params.businessId);
    res.redirect(url);
  } catch (err) {
    logAndFail("Calendar Connect", err, res);
  }
});

app.get("/api/calendar/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) return res.status(400).send("Missing code or state");
    const businessId = await consumeOAuthState(state);
    if (!businessId) return res.status(403).send("Invalid or expired OAuth state. Please retry the connect flow.");
    await handleOAuthCallback(code, businessId);
    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Connected</title><style>body{background:#070c18;color:#f1f5f9;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}.box{background:#0d1526;border:1px solid #1e3a5f;border-radius:12px;padding:48px;max-width:400px}h1{color:#34d399;font-size:28px;margin-bottom:12px}p{color:#94a3b8;line-height:1.6}</style></head><body><div class="box"><h1>✓ Calendar Connected</h1><p>Google Calendar is now linked. The AI can book appointments directly into your schedule. You can close this window.</p></div></body></html>`);
  } catch (err) {
    logAndFail("Calendar OAuth", err, res);
  }
});

// --- GMAIL SYSTEM MAILBOX (support@climateflow.ai) ---
//
// Admin-only. Connects the shared mailbox that receives Google review
// notifications and BCC'd estimate emails, both routed per-business via
// plus-addressing (support+reviews-<businessId>, support+estimates-<businessId>).
app.get("/api/gmail/connect", requireApiKey, async (req, res) => {
  try {
    res.redirect(await gmailIngest.getAuthUrl());
  } catch (err) {
    logAndFail("Gmail Connect", err, res);
  }
});

app.get("/api/gmail/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) return res.status(400).send("Missing code or state");
    const ok = await gmailIngest.consumeOAuthState(state);
    if (!ok) return res.status(403).send("Invalid or expired OAuth state. Please retry the connect flow.");
    await gmailIngest.handleOAuthCallback(code);
    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Connected</title><style>body{background:#070c18;color:#f1f5f9;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}.box{background:#0d1526;border:1px solid #1e3a5f;border-radius:12px;padding:48px;max-width:420px}h1{color:#34d399;font-size:28px;margin-bottom:12px}p{color:#94a3b8;line-height:1.6}</style></head><body><div class="box"><h1>✓ Mailbox Connected</h1><p>The ClimateFlow system mailbox is now ingesting inbound review and estimate emails.</p></div></body></html>`);
  } catch (err) {
    logAndFail("Gmail OAuth", err, res);
  }
});

app.get("/api/gmail/status", requireApiKey, async (req, res) => {
  try {
    res.json({ connected: await gmailIngest.isConnected() });
  } catch (err) {
    logAndFail("Gmail Status", err, res);
  }
});

app.get("/api/calendar/status/:businessId", requireApiKey, async (req, res) => {
  try {
    res.json({ connected: await isCalendarConnected(req.params.businessId) });
  } catch (err) {
    logAndFail("Calendar Status", err, res);
  }
});

app.get("/api/calendar/availability/:businessId", requireApiKey, async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: "Date required (YYYY-MM-DD)" });
    res.json(await getAvailableSlots(req.params.businessId, date));
  } catch (err) {
    logAndFail("Calendar Availability", err, res);
  }
});

app.post("/api/calendar/book", requireApiKey, async (req, res) => {
  try {
    const { businessId, customerName, customerPhone, date, time, serviceType, address } = req.body;
    res.json(await bookAppointment(businessId, { customerName, customerPhone, date, time, serviceType, address }));
  } catch (err) {
    logAndFail("Calendar Book", err, res);
  }
});

// --- DASHBOARD ---

app.get("/api/dashboard/:businessId", requireApiKey, async (req, res) => {
  try {
    const { businessId } = req.params;
    const business = await store.findRecordByField("clients", "id", businessId);
    if (!business) return res.status(404).json({ error: "Business not found" });

    const [leads, estimates, reviews, reviewRequests, bookings] = await Promise.all([
      store.findRecordsByField("leads", "businessId", businessId),
      store.findRecordsByField("estimates", "businessId", businessId),
      store.findRecordsByField("reviews", "businessId", businessId),
      store.findRecordsByField("review_requests", "businessId", businessId),
      store.findRecordsByField("bookings", "businessId", businessId),
    ]);
    res.json({
      plan: {
        id: business.plan || null,
        features: business.legacyAllFeatures ? ALL_FEATURES : (business.planFeatures || []),
        leadRescue: hasFeature(business, FEATURES.LEAD_RESCUE),
        reviewAutopilot: hasFeature(business, FEATURES.REVIEW_AUTOPILOT),
        estimateFollowUp: hasFeature(business, FEATURES.ESTIMATE_FOLLOWUP),
      },
      leads: { total: leads.length, new: leads.filter((l) => l.status === "new").length, qualified: leads.filter((l) => l.status === "qualified").length, booked: leads.filter((l) => l.status === "booked").length },
      estimates: { total: estimates.length, open: estimates.filter((e) => e.status === "open").length, accepted: estimates.filter((e) => e.status === "accepted").length, declined: estimates.filter((e) => e.status === "declined").length, expired: estimates.filter((e) => e.status === "expired").length },
      reviews: { responded: reviews.filter((r) => r.status === "responded").length, pendingApproval: reviews.filter((r) => r.status === "pending_owner_approval").length, requestsSent: reviewRequests.length },
      bookings: { total: bookings.length, confirmed: bookings.filter((b) => b.status === "confirmed").length },
      calendar: { connected: await isCalendarConnected(businessId) },
    });
  } catch (err) {
    logAndFail("Dashboard", err, res);
  }
});

// --- CRON HELPERS ---

// Process items in parallel batches. delayMs throttles between batches to avoid
// spiking Anthropic TPM limits when 100 clients all get AI follow-ups in one tick.
async function runConcurrent(items, fn, limit = 10, delayMs = 0) {
  const results = [];
  for (let i = 0; i < items.length; i += limit) {
    const settled = await Promise.allSettled(items.slice(i, i + limit).map(fn));
    for (const outcome of settled) {
      if (outcome.status === "rejected") console.error("[Cron] Task failed:", outcome.reason?.message);
      else results.push(outcome.value);
    }
    if (delayMs > 0 && i + limit < items.length) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return results;
}

// Wrap a cron body so a slow run can't overlap the next tick.
// If a job is still running when the timer fires, the new tick is skipped
// and logged — prevents cascading backlogs at 100+ clients.
const cronRunning = {};
function guardedCron(name, fn) {
  return async () => {
    if (cronRunning[name]) {
      console.warn(`[Cron] ${name} already running — skipping this tick`);
      return;
    }
    cronRunning[name] = true;
    try {
      await fn();
    } catch (err) {
      console.error(`[Cron] ${name} error: ${err.message}`);
    } finally {
      cronRunning[name] = false;
    }
  };
}

// --- CRON JOBS ---
//
// Registration is wrapped in a function and called only from start() so tests
// that import this module for its Express app don't keep the event loop alive
// on cron timers.
function registerCronJobs() {
cron.schedule("0 9-18 * * 1-6", guardedCron("estimate-followup", async () => {
  const all = await listClients();
  const clients = all.filter((c) => !c.suspended && hasFeature(c, FEATURES.ESTIMATE_FOLLOWUP));
  console.log(`[Cron] Estimate follow-ups: ${clients.length}/${all.length} clients`);
  // delayMs=200: throttle AI calls across 100 clients — 10 batches × 200ms = 2s extra
  await runConcurrent(clients, async (client) => {
    const results = await processFollowUps(client);
    if (results.length > 0) console.log(`[Cron] Sent ${results.length} follow-ups for ${client.name}`);
  }, 10, 200);
}));

cron.schedule("*/30 * * * *", guardedCron("review-check", async () => {
  const all = await listClients();
  const clients = all.filter((c) => !c.suspended && hasFeature(c, FEATURES.REVIEW_AUTOPILOT));
  console.log(`[Cron] Review check: ${clients.length}/${all.length} clients`);
  await runConcurrent(clients, async (client) => {
    const results = await checkForNewReviews(client, respondToReview);
    if (results.length > 0) console.log(`[Cron] Processed ${results.length} reviews for ${client.name}`);
  }, 10, 200);
}));

// Monday 8am: send each active client a digest of last week's activity.
cron.schedule("0 8 * * 1", guardedCron("weekly-digest", async () => {
  const all = await listClients();
  const active = all.filter((c) => !c.suspended);
  console.log(`[Weekly Digest] Sending to ${active.length} clients`);
  const { since, until } = lastWeekWindow();
  await runConcurrent(active, async (client) => {
    try {
      const stats = await getClientStats(client.id, since, until);
      await sendWeeklyDigestEmail(client.ownerEmail, client.ownerName, client.name, stats);
      console.log(`[Weekly Digest] Sent to ${client.name}`);
    } catch (err) {
      console.error(`[Weekly Digest] Failed for ${client.name}: ${err.message}`);
    }
  }, 10, 100);
}));

// Hourly: nudge clients who signed up 24–48h ago but still haven't connected
// their Google Calendar. After 48h we stop nudging to avoid spam.
cron.schedule("0 * * * *", guardedCron("calendar-nudge", async () => {
  const all = await listClients();
  const now = Date.now();
  const H24 = 24 * 60 * 60 * 1000;
  const H48 = 48 * 60 * 60 * 1000;

  for (const client of all) {
    if (client.suspended) continue;
    const age = now - new Date(client.createdAt).getTime();
    if (age < H24 || age > H48) continue;

    try {
      const connected = await isCalendarConnected(client.id);
      if (connected) continue;

      const calendarConnectUrl = signedUrl.buildUrl(
        config.server.webhookBaseUrl,
        `/api/calendar/connect/${client.id}`,
        "calendar_connect",
        client.id,
        7 * 24 * 60 * 60  // 7-day window for the nudge link
      );
      await sendCalendarNudgeEmail(client.ownerEmail, client.ownerName, client.name, calendarConnectUrl);
      console.log(`[Onboarding Nudge] Calendar nudge sent to ${client.name}`);
    } catch (err) {
      console.error(`[Onboarding Nudge] Failed for ${client.name}: ${err.message}`);
    }
  }
}));

// Hourly: send review requests to customers whose appointment was booked 24h+ ago.
// reviewDue is set on the lead when booking succeeds; reviewRequested guards against
// duplicate sends if the cron fires more than once before the flag is written.
cron.schedule("20 * * * *", guardedCron("review-trigger", async () => {
  const all = await listClients();
  const clients = all.filter((c) => !c.suspended && hasFeature(c, FEATURES.REVIEW_AUTOPILOT));
  const now = new Date();

  await runConcurrent(clients, async (client) => {
    const bookedLeads = await store.findRecordsByFields("leads", {
      businessId: client.id,
      status: "booked",
    });
    const ready = bookedLeads.filter((l) => !l.reviewRequested && l.reviewDue && new Date(l.reviewDue) <= now);
    for (const lead of ready) {
      try {
        const customerName = lead.customerName || "Valued Customer";
        const jobType = lead.serviceType || "HVAC service";
        await requestReview(lead.phone, customerName, jobType, client);
        await store.updateRecord("leads", lead.id, { reviewRequested: true });
        console.log(`[Review Trigger] Sent review request to ${customerName} (${lead.phone})`);
      } catch (err) {
        console.error(`[Review Trigger] Failed for lead ${lead.id}: ${err.message}`);
      }
    }
  }, 10, 200);
}));

// Every minute: poll the system Gmail mailbox and route ingested emails to the
// review / estimate pipelines via plus-addressing. Skeleton only right now —
// the per-pipeline parsers land in #23 (reviews) and #24 (estimates).
cron.schedule("* * * * *", guardedCron("gmail-ingest", async () => {
  const result = await gmailIngest.pollInbox({
    reviewHandler: async ({ businessId, message, body, headers }) => {
      try {
        await ingestReviewEmail({
          businessId,
          messageId: message.id,
          subject: headers.subject || "",
          body,
          fromHeader: headers.from || null,
        });
        return true;
      } catch (err) {
        console.error(`[Gmail] review ingest failed id=${message.id}: ${err.message}`);
        return false;
      }
    },
    estimateHandler: async ({ businessId, message, body, headers }) => {
      try {
        await ingestEstimateEmail({
          businessId,
          messageId: message.id,
          subject: headers.subject || "",
          body,
          fromHeader: headers.from || null,
        });
        return true;
      } catch (err) {
        console.error(`[Gmail] estimate ingest failed id=${message.id}: ${err.message}`);
        return false;
      }
    },
  });
  if (result.skipped) return;
  if (result.processed > 0) {
    console.log(`[Cron] Gmail ingest: processed=${result.processed} routed=${result.routed} skipped=${result.skipped}`);
  }
}));

// Every 5 minutes: drain the SMS retry queue. Pipelines enqueue outbound messages
// here when Twilio rejects the first try; backoff is handled inside smsRetry.
cron.schedule("*/5 * * * *", guardedCron("sms-retry-drain", async () => {
  const result = await smsRetry.processPending();
  if (result.processed > 0) {
    console.log(`[Cron] SMS retry drain: processed=${result.processed} succeeded=${result.succeeded} failed=${result.failed}`);
  }
}));

// 1st of month at 8am: send each active client their monthly reputation report.
cron.schedule("0 8 1 * *", guardedCron("monthly-report", async () => {
  const all = await listClients();
  const active = all.filter((c) => !c.suspended && hasFeature(c, FEATURES.REVIEW_AUTOPILOT));
  console.log(`[Monthly Report] Sending to ${active.length} clients`);
  const { since, until } = lastMonthWindow();
  await runConcurrent(active, async (client) => {
    try {
      const stats = await getMonthlyReputationStats(client.id, since, until);
      await sendMonthlyReportEmail(client.ownerEmail, client.ownerName, client.name, stats);
      console.log(`[Monthly Report] Sent to ${client.name}`);
    } catch (err) {
      console.error(`[Monthly Report] Failed for ${client.name}: ${err.message}`);
    }
  }, 10, 100);
}));

// Hourly cleanup: expire abandoned pending signups (cancel their Stripe subs
// first so we don't leak customers), purge OAuth states, and sweep the in-memory
// rate-limit Map so it doesn't grow unbounded on a long-lived dyno.
cron.schedule("15 * * * *", guardedCron("cleanup", async () => {
  try {
    const now = Date.now();

    const stalePending = await store.findExpiredRecords(PENDING_SIGNUPS, now);
    for (const p of stalePending) {
      if (p.stripeSubscriptionId) {
        try {
          await cancelSubscription(p.stripeSubscriptionId);
        } catch (err) {
          // Ignore "already gone" cases; log others and keep going.
          if (err?.code !== "resource_missing") {
            console.error(`[Cleanup] Stripe cancel failed for ${p.id}: ${err.message}`);
          }
        }
      }
      await store.deleteRecord(PENDING_SIGNUPS, p.id);
    }

    const oauthPurged = await store.deleteExpiredRecords(OAUTH_STATES, now);
    const gmailOauthPurged = await store.deleteExpiredRecords(gmailIngest.OAUTH_STATES, now);
    // Gmail processed-id log TTLs out after 7 days — older rows are just noise.
    const gmailProcessedPurged = await store.deleteExpiredRecords(gmailIngest.PROCESSED, now);
    // Daily AI-usage counters carry expiresAt ~48h out; sweep anything past-due.
    const aiUsagePurged = await store.deleteExpiredRecords("ai_usage", now);

    // Purge expired in-memory rate-limit buckets — prevents unbounded Map growth
    // on a long-running dyno at 100+ clients hitting webhooks continuously.
    let rateLimitPurged = 0;
    for (const [key, entry] of rateLimitStore) {
      if (now > entry.resetAt) { rateLimitStore.delete(key); rateLimitPurged++; }
    }

    if (stalePending.length || oauthPurged || aiUsagePurged || rateLimitPurged || gmailOauthPurged || gmailProcessedPurged) {
      console.log(`[Cleanup] pending_signups=${stalePending.length} oauth_states=${oauthPurged} gmail_oauth=${gmailOauthPurged} gmail_processed=${gmailProcessedPurged} ai_usage=${aiUsagePurged} rate_limit_buckets=${rateLimitPurged}`);
    }
  } catch (err) {
    console.error("[Cleanup] Error:", err.message);
  }
}));
}

// --- ERROR HANDLING ---
// Must come after all routes. Sentry.errorHandler only forwards 5xx /
// uncaught errors; 4xx responses thrown by handlers are left alone.
app.use(sentry.errorHandler());

// Final fallback so Express doesn't leak stack traces to the client. The
// error is already captured by Sentry above (if configured).
app.use((err, req, res, next) => {
  console.error("[server] unhandled error:", err && err.stack || err);
  if (res.headersSent) return next(err);
  const status = (err && (err.status || err.statusCode)) || 500;
  res.status(status).json({ error: status >= 500 ? "internal_error" : (err.message || "error") });
});

// --- STARTUP & GRACEFUL SHUTDOWN ---

async function start() {
  await store.init();

  if (process.env.NODE_ENV !== "production") {
    await createSampleClient();
  }

  registerCronJobs();

  const server = app.listen(config.server.port, () => {
    console.log(`\n=== ClimateFlow AI Automation Server ===`);
    console.log(`Port:    ${config.server.port}`);
    console.log(`Signup:  ${config.server.webhookBaseUrl}/signup`);
    console.log(`Health:  ${config.server.webhookBaseUrl}/health`);
    console.log(`========================================\n`);
  });

  process.on("SIGTERM", () => {
    console.log("[Server] SIGTERM — shutting down gracefully...");
    server.close(async () => {
      console.log("[Server] HTTP server closed.");
      await sentry.flush(2000);
      process.exit(0);
    });
  });
}

if (require.main === module) {
  start().catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}

module.exports = { app, start };
