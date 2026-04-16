// Smoke tests for Twilio webhook routes.
//
// Strategy:
//   - We need to prove that (a) unsigned requests are rejected 403, and
//     (b) correctly-signed requests are passed through the middleware layer.
//   - We generate valid Twilio signatures using the same HMAC-SHA1 algorithm
//     Twilio uses, so these tests exercise real signature validation with no
//     mocks and no Twilio account required.
//   - Routes do DB lookups after signature validation passes; without a real
//     Postgres instance the handlers throw and return 500. That's fine here —
//     a 500 proves the request cleared the security middleware. We assert ≠ 403.

process.env.NODE_ENV = "test";
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_dummy";
process.env.STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || "pk_test_dummy";
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_dummy";
process.env.STRIPE_PRICE_ID_BUNDLE = process.env.STRIPE_PRICE_ID_BUNDLE || "price_bundle_dummy";
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "sk-ant-dummy";
process.env.TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "ACdummy";
// Use a known, stable test token so we can compute matching signatures.
process.env.TWILIO_AUTH_TOKEN = "test_auth_token_0000000000000000";
process.env.API_KEY = process.env.API_KEY || "test-api-key";
process.env.SIGNED_URL_SECRET = process.env.SIGNED_URL_SECRET || "a".repeat(64);
process.env.TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || "b".repeat(64);

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");
const qs = require("node:querystring");

const { app } = require("../src/server");
// config is already loaded (cached) — patch webhookBaseUrl after we know the port
// so the Twilio signature validator uses the same URL our test signs against.
const config = require("../src/config");

let server;
let baseUrl;

test.before(
  () =>
    new Promise((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        const { port } = server.address();
        baseUrl = `http://127.0.0.1:${port}`;
        config.server.webhookBaseUrl = baseUrl;
        resolve();
      });
    })
);

test.after(() => new Promise((resolve) => server.close(resolve)));

// ---------------------------------------------------------------------------
// Twilio signature helper — matches Twilio's algorithm exactly:
// 1. Start with the full URL (including query string if present)
// 2. Sort POST params alphabetically and append key+value pairs to URL string
// 3. HMAC-SHA1 sign with authToken, base64-encode
// ---------------------------------------------------------------------------
function twilioSign(authToken, url, params = {}) {
  const sorted = Object.keys(params)
    .sort()
    .reduce((s, k) => s + k + params[k], "");
  const mac = crypto
    .createHmac("sha1", authToken)
    .update(url + sorted)
    .digest("base64");
  return mac;
}

function webhookRequest(path, params, signed = true) {
  return new Promise((resolve, reject) => {
    const url = baseUrl + path;
    const body = qs.stringify(params);
    const signature = signed
      ? twilioSign(process.env.TWILIO_AUTH_TOKEN, url, params)
      : "bad_signature";

    const req = http.request(
      {
        method: "POST",
        hostname: "127.0.0.1",
        port: new URL(baseUrl).port,
        path,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
          "X-Twilio-Signature": signature,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString() })
        );
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// --- /webhooks/voice/status ---

test("POST /webhooks/voice/status rejects unsigned request with 403", async () => {
  const res = await webhookRequest(
    "/webhooks/voice/status",
    { Called: "+15550000001", From: "+15550000002", CallStatus: "no-answer" },
    false // unsigned
  );
  assert.equal(res.status, 403);
});

test("POST /webhooks/voice/status accepts signed request (passes middleware)", async () => {
  const res = await webhookRequest("/webhooks/voice/status", {
    Called: "+15550000001",
    From: "+15550000002",
    CallStatus: "no-answer",
  });
  // 403 = middleware rejected it — that's a failure.
  // 200 or 500 both mean the signature passed and the handler ran.
  assert.notEqual(res.status, 403, "signature validation should have passed");
});

test("POST /webhooks/voice/status returns 200 for non-missed-call status", async () => {
  const res = await webhookRequest("/webhooks/voice/status", {
    Called: "+15550000001",
    From: "+15550000002",
    CallStatus: "completed", // not a missed call — handler returns 200 immediately
  });
  assert.notEqual(res.status, 403, "signature validation should have passed");
  // completed calls short-circuit before DB — expect 200
  assert.equal(res.status, 200);
});

// --- /webhooks/sms ---

test("POST /webhooks/sms rejects unsigned request with 403", async () => {
  const res = await webhookRequest(
    "/webhooks/sms",
    { To: "+15550000001", From: "+15550000002", Body: "Hello" },
    false // unsigned
  );
  assert.equal(res.status, 403);
});

test("POST /webhooks/sms accepts signed request (passes middleware)", async () => {
  const res = await webhookRequest("/webhooks/sms", {
    To: "+15550000001",
    From: "+15550000002",
    Body: "Is anyone there?",
  });
  assert.notEqual(res.status, 403, "signature validation should have passed");
});
