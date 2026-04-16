// Boot the real Express app on an ephemeral port and hit its routes over loopback.
// These tests do not require Twilio/Stripe/Anthropic credentials or a live database —
// `/health` gracefully returns 503 when the DB is unreachable, and the other routes
// under test don't touch external services.

// Dummy env vars so modules that read config at import time don't see undefined
// where they'd otherwise construct clients with empty strings. These values are
// never used against real services; we only hit routes that don't call out.
process.env.NODE_ENV = "test";
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_dummy";
process.env.STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || "pk_test_dummy";
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_dummy";
process.env.STRIPE_PRICE_ID_BUNDLE = process.env.STRIPE_PRICE_ID_BUNDLE || "price_bundle_dummy";
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "sk-ant-dummy";
process.env.TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "ACdummy";
process.env.TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "dummy";
process.env.API_KEY = process.env.API_KEY || "test-api-key";
process.env.SIGNED_URL_SECRET = process.env.SIGNED_URL_SECRET || "a".repeat(64);
process.env.TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || "b".repeat(64);

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { app } = require("../src/server");

let server;
let baseUrl;

test.before(
  () =>
    new Promise((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        const { port } = server.address();
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    })
);

test.after(() => new Promise((resolve) => server.close(resolve)));

function request(method, path, { body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl + path);
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const req = http.request(
      {
        method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: {
          ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
          ...(headers || {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode, headers: res.headers, text });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test("GET /health responds with a status field (200 w/DB or 503 without)", async () => {
  const res = await request("GET", "/health");
  assert.ok(res.status === 200 || res.status === 503, `unexpected status ${res.status}`);
  const body = JSON.parse(res.text);
  assert.ok("status" in body, "response missing status field");
});

test("GET /api/plans returns the plan catalog with bundle present", async () => {
  const res = await request("GET", "/api/plans");
  assert.equal(res.status, 200);
  const body = JSON.parse(res.text);
  assert.ok(Array.isArray(body.plans), "plans should be an array");
  const bundle = body.plans.find((p) => p.id === "bundle");
  assert.ok(bundle, "bundle plan missing from /api/plans");
  assert.equal(bundle.price, 2500);
  assert.ok(Array.isArray(bundle.features));
});

test("GET /signup serves HTML with the Stripe script tag", async () => {
  const res = await request("GET", "/signup");
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"] || "", /text\/html/);
  assert.match(res.text, /<form id="signup-form">/);
  assert.match(res.text, /js\.stripe\.com/);
});

test("POST /api/signup rejects missing required fields with 400", async () => {
  const res = await request("POST", "/api/signup", { body: { businessName: "Test" } });
  assert.equal(res.status, 400);
  const body = JSON.parse(res.text);
  assert.match(body.error || "", /required/i);
});

test("POST /api/signup rejects invalid email format with 400", async () => {
  const res = await request("POST", "/api/signup", {
    body: {
      businessName: "Test HVAC",
      ownerName: "Test Owner",
      ownerEmail: "not-an-email",
      serviceArea: "Portland",
      paymentMethodId: "pm_dummy",
    },
  });
  assert.equal(res.status, 400);
  const body = JSON.parse(res.text);
  assert.match(body.error || "", /email/i);
});

test("Security headers are set on every response", async () => {
  const res = await request("GET", "/api/plans");
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.equal(res.headers["x-frame-options"], "DENY");
  assert.ok(res.headers["strict-transport-security"]);
});
