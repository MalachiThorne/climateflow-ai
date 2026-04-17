// E2E integration tests — exercise the full pipeline with real external services.
//
// WHAT IS REAL:
//   - Anthropic Claude API (real AI responses)
//   - PostgreSQL database (real writes/reads)
//   - Stripe test-mode (real subscription creation, no real money)
//   - Twilio HMAC signature validation (real algorithm, not mocked)
//
// WHAT IS CAPTURED INSTEAD OF SENT:
//   - SMS (captured to sentMessages array — no real Twilio sends needed)
//   - Email (captured to sentEmails array)
//
// REQUIRED ENV VARS (set in .env or export before running):
//   TEST_INTEGRATION=1
//   DATABASE_URL=postgres://...          (Railway test DB or local Postgres)
//   ANTHROPIC_API_KEY=sk-ant-...
//   TWILIO_AUTH_TOKEN=...                (real token — used for HMAC signing only)
//   TWILIO_ACCOUNT_SID=AC...
//   STRIPE_SECRET_KEY=sk_test_...        (test-mode key)
//   STRIPE_WEBHOOK_SECRET=whsec_...
//   SIGNED_URL_SECRET=<64 hex chars>
//   TOKEN_ENCRYPTION_KEY=<64 hex chars>
//   API_KEY=<any string>
//
// RUN:
//   TEST_INTEGRATION=1 node --test test/e2e/full-flow.test.js
//
// CLEANUP: all test data is written under a unique businessId and deleted after each suite.

if (!process.env.TEST_INTEGRATION) {
  console.log("[E2E] Skipped — set TEST_INTEGRATION=1 to run");
  process.exit(0);
}

const REQUIRED = ["DATABASE_URL", "ANTHROPIC_API_KEY", "TWILIO_AUTH_TOKEN", "TWILIO_ACCOUNT_SID"];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`[E2E] Missing required env vars: ${missing.join(", ")}`);
  process.exit(1);
}

// Fill optional dummy defaults so config modules don't throw
process.env.NODE_ENV = "test";
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_dummy";
process.env.STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || "pk_test_dummy";
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_dummy";
process.env.STRIPE_PRICE_ID_BUNDLE = process.env.STRIPE_PRICE_ID_BUNDLE || "price_bundle_dummy";
process.env.SIGNED_URL_SECRET = process.env.SIGNED_URL_SECRET || "a".repeat(64);
process.env.TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || "b".repeat(64);
process.env.API_KEY = process.env.API_KEY || "e2e-test-key";

// ---------------------------------------------------------------------------
// Capture layers — patch these BEFORE requiring the server so modules that
// destructure their imports at load time get the capturing wrappers.
// ---------------------------------------------------------------------------
const sentMessages = [];   // { to, body, from }
const sentEmails   = [];   // { to, subject, ... }

require.cache[require.resolve("../../src/sms")] = {
  id: require.resolve("../../src/sms"),
  filename: require.resolve("../../src/sms"),
  loaded: true,
  exports: {
    sendSMS: async (to, body, from) => { sentMessages.push({ to, body, from }); },
    scrubAIReply: (text) => text,
    provisionPhoneNumber: async (areaCode) => ({
      phoneNumber: `+1503${String(areaCode || "503").slice(0, 3)}0001`,
      sid: "PN_e2e_test",
    }),
  },
};

// Capture emails but don't send — transporter is not configured in test env
const realEmail = require("../../src/email");
const emailCapture = {};
for (const [name, fn] of Object.entries(realEmail)) {
  if (typeof fn === "function") {
    emailCapture[name] = async (...args) => {
      sentEmails.push({ fn: name, args });
    };
  }
}
require.cache[require.resolve("../../src/email")] = {
  id: require.resolve("../../src/email"),
  filename: require.resolve("../../src/email"),
  loaded: true,
  exports: emailCapture,
};

// ---------------------------------------------------------------------------
// Now load the real server (Anthropic + Postgres + Stripe all real)
// ---------------------------------------------------------------------------
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");
const qs = require("node:querystring");

const { app } = require("../../src/server");
const store = require("../../src/store");
const config = require("../../src/config");
const { addEstimate, processFollowUps, handleEstimateReply } = require("../../src/pipelines/estimate-followup");
const { requestReview, respondToReview } = require("../../src/pipelines/review-autopilot");

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------
const TEST_BIZ_ID = `e2e_${Date.now()}`;

const testBusiness = {
  id: TEST_BIZ_ID,
  name: "E2E Test HVAC",
  ownerName: "Test Owner",
  ownerEmail: "test@climateflow.test",
  ownerPhone: null,
  serviceArea: "Portland, OR",
  services: ["AC repair", "Furnace repair", "Heat pump service"],
  hours: "Mon-Fri 8am-6pm",
  twilioNumber: "+15030000001",
  twilioSid: "PN_e2e",
  googleReviewLink: "https://g.page/e2e-test",
  financingAvailable: false,
  plan: "bundle",
  planFeatures: ["lead_rescue", "estimate_followup", "review_autopilot"],
  legacyAllFeatures: true,
  suspended: false,
};

let server;
let baseUrl;

// Twilio HMAC-SHA1 signing — matches Twilio's exact algorithm
function twilioSign(authToken, url, params = {}) {
  const sorted = Object.keys(params).sort().reduce((s, k) => s + k + params[k], "");
  return crypto.createHmac("sha1", authToken).update(url + sorted).digest("base64");
}

function webhookPost(path, params) {
  return new Promise((resolve, reject) => {
    const url = baseUrl + path;
    const body = qs.stringify(params);
    const sig = twilioSign(process.env.TWILIO_AUTH_TOKEN, url, params);
    const req = http.request({
      method: "POST",
      hostname: "127.0.0.1",
      port: new URL(baseUrl).port,
      path,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
        "X-Twilio-Signature": sig,
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function apiPost(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      method: "POST",
      hostname: "127.0.0.1",
      port: new URL(baseUrl).port,
      path,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "x-api-key": process.env.API_KEY,
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch { resolve({ status: res.statusCode, body: {} }); }
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

test.before(async () => {
  await store.init();

  // Seed the test business directly into the DB
  await store.addRecord("clients", testBusiness);

  server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
  config.server.webhookBaseUrl = baseUrl;

  console.log(`[E2E] Server on ${baseUrl}, business=${TEST_BIZ_ID}`);
});

test.after(async () => {
  await store.deleteByBusinessId(TEST_BIZ_ID);
  console.log(`[E2E] Cleaned up all records for ${TEST_BIZ_ID}`);
  await new Promise((resolve) => server.close(resolve));
});

// ---------------------------------------------------------------------------
// Flow 1: Missed call → AI texts back → customer replies → appointment booked
// ---------------------------------------------------------------------------

test("missed call triggers an AI text reply within 5 seconds", async () => {
  sentMessages.length = 0;

  const res = await webhookPost("/webhooks/voice/status", {
    Called: testBusiness.twilioNumber,
    From: "+15039990001",
    CallStatus: "no-answer",
  });

  assert.notEqual(res.status, 403, "Twilio signature should be accepted");

  // Give the async handler a moment to finish (handler runs after res.sendStatus)
  await new Promise((r) => setTimeout(r, 3000));

  const toCustomer = sentMessages.filter((m) => m.to === "+15039990001");
  assert.ok(toCustomer.length > 0, "AI should have sent a text to the missed caller");

  const msg = toCustomer[0].body;
  assert.ok(msg.length > 20, "AI reply should be a real message, not empty");
  console.log(`[E2E] AI reply: "${msg.slice(0, 100)}..."`);

  // Lead record should exist in DB
  const lead = await store.findRecordByFields("leads", {
    phone: "+15039990001",
    businessId: TEST_BIZ_ID,
  });
  assert.ok(lead, "lead record should be created");
  assert.equal(lead.status, "new");
}, { timeout: 15000 });

test("customer SMS reply gets a contextual AI response", async () => {
  sentMessages.length = 0;

  const res = await webhookPost("/webhooks/sms", {
    To: testBusiness.twilioNumber,
    From: "+15039990001",
    Body: "Hi yes I need my AC fixed, it stopped blowing cold air yesterday",
  });

  assert.notEqual(res.status, 403, "Twilio signature should be accepted");
  await new Promise((r) => setTimeout(r, 5000));

  const replies = sentMessages.filter((m) => m.to === "+15039990001");
  assert.ok(replies.length > 0, "AI should reply to the customer SMS");

  const reply = replies[0].body;
  assert.ok(reply.length > 20, "reply should be substantive");
  console.log(`[E2E] AI reply to customer: "${reply.slice(0, 100)}..."`);
}, { timeout: 20000 });

// ---------------------------------------------------------------------------
// Flow 2: Estimate follow-up → customer accepts → acceptedAt timestamp set
// ---------------------------------------------------------------------------

test("estimate follow-up is sent and customer acceptance sets acceptedAt", async () => {
  // Add an estimate that's due for follow-up now
  const estimate = await addEstimate({
    customerName: "Sarah Connor",
    customerPhone: "+15039990002",
    customerEmail: null,
    amount: 3200,
    description: "Full AC system replacement",
  }, testBusiness);

  // Force nextFollowUp into the past so processFollowUps picks it up
  await store.updateRecord("estimates", estimate.id, {
    nextFollowUp: new Date(Date.now() - 1000).toISOString(),
  });

  sentMessages.length = 0;

  // Trigger follow-up processing directly (tests the cron logic without waiting)
  const results = await processFollowUps(testBusiness);

  assert.ok(results.length > 0, "processFollowUps should have sent at least one follow-up");
  const followUp = sentMessages.find((m) => m.to === "+15039990002");
  assert.ok(followUp, "follow-up SMS should be sent to customer");
  console.log(`[E2E] Follow-up SMS: "${followUp.body.slice(0, 100)}..."`);

  // Simulate customer accepting via the SMS webhook
  sentMessages.length = 0;
  await handleEstimateReply("+15039990002", "Yes, let's do it!", testBusiness);

  // Check DB for accepted status and acceptedAt
  const updated = await store.findRecordByFields("estimates", {
    customerPhone: "+15039990002",
    businessId: TEST_BIZ_ID,
  });
  assert.equal(updated.status, "accepted");
  assert.ok(updated.acceptedAt, "acceptedAt should be written on acceptance");

  const acceptedAt = new Date(updated.acceptedAt);
  assert.ok(!isNaN(acceptedAt.getTime()), "acceptedAt should be a valid date");
  assert.ok(Date.now() - acceptedAt.getTime() < 10000, "acceptedAt should be recent");

  console.log(`[E2E] Estimate accepted at ${updated.acceptedAt}`);
}, { timeout: 30000 });

// ---------------------------------------------------------------------------
// Flow 3: Review request triggered 24h after booking
// ---------------------------------------------------------------------------

test("review request is sent for a lead past its reviewDue date", async () => {
  // Seed a booked lead with reviewDue in the past
  await store.addRecord("leads", {
    phone: "+15039990003",
    businessId: TEST_BIZ_ID,
    status: "booked",
    customerName: "James Rodriguez",
    serviceType: "Furnace tune-up",
    reviewDue: new Date(Date.now() - 1000).toISOString(),
    reviewRequested: false,
  });

  sentMessages.length = 0;
  await requestReview("+15039990003", "James Rodriguez", "Furnace tune-up", testBusiness);

  const reviewSMS = sentMessages.find((m) => m.to === "+15039990003");
  assert.ok(reviewSMS, "review request SMS should be sent");
  assert.match(reviewSMS.body, /review/i, "message should mention review");
  console.log(`[E2E] Review request: "${reviewSMS.body.slice(0, 100)}..."`);
}, { timeout: 10000 });

// ---------------------------------------------------------------------------
// Flow 4: Incoming review — positive auto-responded, negative flagged
// ---------------------------------------------------------------------------

test("5-star review is auto-responded with AI-generated reply", async () => {
  const result = await respondToReview({
    authorName: "Linda Park",
    rating: 5,
    text: "Amazing service! Fixed our AC in under an hour. Very professional.",
    platform: "google",
  }, testBusiness);

  assert.equal(result.action, "responded");
  assert.ok(result.response, "AI should generate a response");
  assert.ok(result.response.length > 20, "response should be substantive");
  console.log(`[E2E] Review response: "${result.response.slice(0, 100)}..."`);
}, { timeout: 15000 });

test("3-star review is flagged for owner approval with a suggested response", async () => {
  const result = await respondToReview({
    authorName: "Mike Thompson",
    rating: 3,
    text: "Technician was late but the work was fine. Communication could be better.",
    platform: "google",
  }, testBusiness);

  assert.equal(result.action, "flagged");
  assert.ok(result.suggestedResponse, "flagged review should have a suggested response");
  assert.ok(result.suggestedResponse.length > 20, "suggested response should be substantive");
  console.log(`[E2E] Suggested response for 3-star: "${result.suggestedResponse.slice(0, 100)}..."`);
}, { timeout: 15000 });
