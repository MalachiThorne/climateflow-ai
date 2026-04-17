const { createHmac, timingSafeEqual } = require("crypto");

function getSecret() {
  const secret = process.env.URL_SIGNING_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("URL_SIGNING_SECRET must be set and at least 32 chars");
  }
  return secret;
}

// purpose is a short string like "billing" or "calendar_connect" that scopes
// the signature — a billing token can never be used to satisfy a calendar route.
//
// nonce is an optional per-subject secret that binds the token to a specific
// server-side state (e.g. the client's onboardingTokenNonce). When present,
// rotating the nonce invalidates every outstanding token for that subject
// without having to rotate the global secret. Legacy callers that pass no
// nonce (or "") continue to work, so existing links keep verifying until the
// subject's nonce is rotated for the first time.
function sign(purpose, subject, ttlSeconds, nonce = "") {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${purpose}:${subject}:${expiresAt}:${nonce}`;
  const mac = createHmac("sha256", getSecret()).update(payload).digest("hex");
  return { token: mac, expiresAt };
}

function verify(purpose, subject, token, expiresAt, nonce = "") {
  const exp = Number(expiresAt);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  if (typeof token !== "string" || token.length !== 64) return false;
  const payload = `${purpose}:${subject}:${exp}:${nonce}`;
  const expected = createHmac("sha256", getSecret()).update(payload).digest();
  const given = Buffer.from(token, "hex");
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}

function buildUrl(baseUrl, path, purpose, subject, ttlSeconds, extraParams = {}, nonce = "") {
  const { token, expiresAt } = sign(purpose, subject, ttlSeconds, nonce);
  const params = new URLSearchParams({ t: token, e: String(expiresAt), ...extraParams });
  return `${baseUrl}${path}?${params.toString()}`;
}

module.exports = { sign, verify, buildUrl };
