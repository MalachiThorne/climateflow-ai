const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const cron = require("node-cron");
const twilio = require("twilio");
const config = require("./config");
const { getClientByPhone, listClients, createSampleClient, addClient } = require("./clients");
const { handleMissedCall, handleIncomingSMS } = require("./pipelines/lead-rescue");
const { requestReview, respondToReview } = require("./pipelines/review-autopilot");
const { addEstimate, processFollowUps, handleEstimateReply } = require("./pipelines/estimate-followup");
const { checkForNewReviews } = require("./review-monitor");
const { getAuthUrl, consumeOAuthState, handleOAuthCallback, getAvailableSlots, bookAppointment, isCalendarConnected } = require("./calendar");
const { provisionPhoneNumber } = require("./sms");
const { createSubscription, cancelSubscription, createBillingPortalSession, constructWebhookEvent, handleWebhookEvent } = require("./billing");
const { sendWelcomeEmail, sendTrialEndingEmail, sendPaymentFailedEmail, sendVerificationEmail, sendBillingLinkEmail } = require("./email");
const { FEATURES, ALL_FEATURES, hasFeature } = require("./features");
const signedUrl = require("./signedUrl");
const store = require("./store");

const app = express();

// Behind Railway's load balancer; trust the proxy so req.ip + HTTPS detection work.
// Set to 1 hop — do NOT use "true" (which would let any caller spoof X-Forwarded-For).
app.set("trust proxy", 1);

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

// Stripe webhooks require the raw body for signature verification.
// This route must be defined BEFORE express.json() is applied globally.
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
function requireSignedUrl(purpose) {
  return (req, res, next) => {
    const subject = req.params.businessId;
    const token = req.query.t;
    const expiresAt = req.query.e;
    if (!subject || !token || !expiresAt) {
      return res.status(403).send("Link missing or invalid. Request a new one from your email.");
    }
    if (!signedUrl.verify(purpose, subject, token, expiresAt)) {
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
// In-memory per-instance counter. Fine for a single Railway dyno; if we ever scale
// horizontally, swap this for a Redis-backed limiter (e.g. rate-limiter-flexible)
// so limits aren't bypassable by hitting different instances round-robin.
// Relies on app.set("trust proxy", 1) above so req.ip reflects the real client.
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

const signupLimiter = rateLimit(60 * 60 * 1000, 10); // 10 per hour per IP
const verifyLimiter = rateLimit(60 * 60 * 1000, 20);
const billingLinkLimiter = rateLimit(60 * 60 * 1000, 10);

// --- HEALTH CHECK ---

app.get("/health", async (req, res) => {
  try {
    await store.healthCheck();
    res.json({ status: "ok", uptime: process.uptime() });
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
  const html = fs
    .readFileSync(path.join(__dirname, "signup.html"), "utf8")
    .split("__STRIPE_PUBLISHABLE_KEY__").join(config.stripe.publishableKey || "");
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
  const { businessName, ownerName, ownerEmail, serviceArea, areaCode, paymentMethodId, plan } = req.body;

  if (!businessName || !ownerName || !ownerEmail || !serviceArea || !paymentMethodId) {
    return res.status(400).json({ error: "All fields are required" });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
    return res.status(400).json({ error: "Please enter a valid email address" });
  }

  const planId = plan || "bundle";
  const selectedPlan = config.stripe.plans[planId];
  if (!selectedPlan) {
    return res.status(400).json({ error: `Unknown plan: ${planId}` });
  }
  if (!selectedPlan.priceId) {
    return res.status(400).json({ error: `Plan ${planId} is not currently available` });
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

    try {
      await sendWelcomeEmail(
        pending.ownerEmail,
        pending.ownerName,
        pending.businessName,
        calendarConnectUrl,
        phone.phoneNumber,
        billingUrl
      );
    } catch (err) {
      console.error("[Signup Verify] welcome email failed:", err.message);
    }

    console.log(`[Signup] Verified + provisioned: ${pending.businessName} — ${phone.phoneNumber} (${redactEmail(pending.ownerEmail)})`);

    const safePhone = String(phone.phoneNumber).replace(/[^\d+]/g, "");
    const safeCal = calendarConnectUrl.replace(/[^a-zA-Z0-9:/?=&._\-%]/g, "");
    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Verified</title><style>body{background:#070c18;color:#f1f5f9;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}.box{background:#0d1526;border:1px solid #1e3a5f;border-radius:12px;padding:40px;max-width:480px;text-align:center}h1{color:#34d399;font-size:26px;margin:0 0 12px}p{color:#94a3b8;line-height:1.6;margin:0 0 16px}.phone{background:#0a1020;border:1px solid #1e3a5f;border-radius:8px;padding:12px 20px;font-size:22px;font-weight:700;color:#38bdf8;margin:16px 0;display:inline-block}a.btn{display:inline-block;background:linear-gradient(135deg,#0ea5e9,#38bdf8);color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600}</style></head><body><div class="box"><h1>Email verified</h1><p>Your ClimateFlow AI automation is live. Your dedicated business number:</p><div class="phone">${safePhone}</div><p>We sent setup details to your email. One last step — connect your Google Calendar so the AI can book jobs:</p><a class="btn" href="${safeCal}">Connect Google Calendar →</a></div></body></html>`);
  } catch (err) {
    logAndFail("Signup Verify", err, res);
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
    const { Called, From, CallStatus } = req.body;
    if (CallStatus === "no-answer" || CallStatus === "busy" || CallStatus === "failed") {
      const business = await getClientByPhone(Called);
      if (business && await requireActiveAccount(business, res)) {
        if (!hasFeature(business, FEATURES.LEAD_RESCUE)) {
          console.log(`[Voice Status] ${business.name} not subscribed to Lead Rescue — skipping`);
          return res.sendStatus(200);
        }
        await handleMissedCall(From, business);
        res.sendStatus(200);
      }
    } else {
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
    const { To, From, Body } = req.body;
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

async function runConcurrent(items, fn, limit = 10) {
  const results = [];
  for (let i = 0; i < items.length; i += limit) {
    const settled = await Promise.allSettled(items.slice(i, i + limit).map(fn));
    for (const outcome of settled) {
      if (outcome.status === "rejected") console.error("[Cron] Task failed:", outcome.reason?.message);
      else results.push(outcome.value);
    }
  }
  return results;
}

// --- CRON JOBS ---
//
// Registration is wrapped in a function and called only from start() so tests
// that import this module for its Express app don't keep the event loop alive
// on cron timers.
function registerCronJobs() {
cron.schedule("0 9-18 * * 1-6", async () => {
  const all = await listClients();
  const clients = all.filter((c) => !c.suspended && hasFeature(c, FEATURES.ESTIMATE_FOLLOWUP));
  console.log(`[Cron] Estimate follow-ups: ${clients.length}/${all.length} clients`);
  await runConcurrent(clients, async (client) => {
    const results = await processFollowUps(client);
    if (results.length > 0) console.log(`[Cron] Sent ${results.length} follow-ups for ${client.name}`);
  });
});

cron.schedule("*/30 * * * *", async () => {
  const all = await listClients();
  const clients = all.filter((c) => !c.suspended && hasFeature(c, FEATURES.REVIEW_AUTOPILOT));
  console.log(`[Cron] Review check: ${clients.length}/${all.length} clients`);
  await runConcurrent(clients, async (client) => {
    const results = await checkForNewReviews(client, respondToReview);
    if (results.length > 0) console.log(`[Cron] Processed ${results.length} reviews for ${client.name}`);
  });
});

// Hourly cleanup: expire abandoned pending signups (cancel their Stripe subs
// first so we don't leak customers) and purge consumed / expired OAuth states.
cron.schedule("15 * * * *", async () => {
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
    // Daily AI-usage counters carry expiresAt ~48h out; sweep anything past-due.
    const aiUsagePurged = await store.deleteExpiredRecords("ai_usage", now);

    if (stalePending.length || oauthPurged || aiUsagePurged) {
      console.log(`[Cleanup] pending_signups=${stalePending.length} oauth_states=${oauthPurged} ai_usage=${aiUsagePurged}`);
    }
  } catch (err) {
    console.error("[Cleanup] Error:", err.message);
  }
});
}

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
    server.close(() => {
      console.log("[Server] HTTP server closed.");
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
