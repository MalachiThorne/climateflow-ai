// Gmail ingest for the shared system mailbox (support@climateflow.ai).
//
// Architecture:
//   - One mailbox, one OAuth token record (singleton id=SYSTEM_MAILBOX_ID).
//   - Per-client routing via Gmail plus-addressing on the recipient line:
//       support+reviews-<businessId>@climateflow.ai   → review pipeline (#23)
//       support+estimates-<businessId>@climateflow.ai → estimate pipeline (#24)
//   - pollInbox() runs from a 60s cron, lists unread messages, extracts the
//     business-id + purpose from the plus-suffix, hands the raw message off to
//     a handler, then marks the message read so it won't be re-processed.
//
// This module is the skeleton only. The two handlers — routeReview and
// routeEstimate — are stubs that log and mark-read. The actual parsers land
// in tasks #23 and #24.
const { randomBytes } = require("crypto");
const { google } = require("googleapis");
const config = require("./config");
const store = require("./store");
const { encryptTokens, decryptTokens } = require("./tokenCrypto");

const TOKENS = "gmail_tokens";
const OAUTH_STATES = "gmail_oauth_states";
const PROCESSED = "gmail_processed";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

// The system mailbox is a singleton. We store its tokens under a constant id so
// a second successful OAuth run overwrites rather than multiplies records.
const SYSTEM_MAILBOX_ID = "system";

// Max messages to process per cron tick. Caps fan-out if a backlog builds up;
// the cron fires every 60s, so 50 × 60 = ~3k/hr sustained. Beyond that, we're
// past the point where a batch ingest workflow makes sense anyway.
const POLL_BATCH_SIZE = 50;

// How long to remember a processed message id. Gmail messageIds are stable, but
// we also mark the thread UNREAD→READ which on its own prevents re-processing.
// The processed log is a belt-and-suspenders safeguard against races where the
// label update fails after the handler succeeded.
const PROCESSED_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function createOAuth2Client() {
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.gmailRedirectUri
  );
}

// Admin-initiated OAuth. Unlike calendar OAuth, this isn't scoped to a
// businessId — the connected mailbox is a platform-wide singleton. The state
// nonce still exists to bind the callback to a specific connect request and
// prevent replay.
async function getAuthUrl() {
  const state = randomBytes(32).toString("hex");
  await store.addRecord(OAUTH_STATES, {
    id: state,
    purpose: "gmail_system",
    expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
  });
  const oauth2Client = createOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/gmail.modify"],
    state,
  });
}

async function consumeOAuthState(state) {
  if (typeof state !== "string" || state.length !== 64) return null;
  const record = await store.deleteRecord(OAUTH_STATES, state);
  if (!record || record.purpose !== "gmail_system") return null;
  if (record.expiresAt && record.expiresAt < Date.now()) return null;
  return true;
}

async function handleOAuthCallback(code) {
  const oauth2Client = createOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  const encrypted = encryptTokens(tokens);
  const existing = await store.findRecordByField(TOKENS, "id", SYSTEM_MAILBOX_ID);
  if (existing) {
    await store.updateRecord(TOKENS, SYSTEM_MAILBOX_ID, { tokens: encrypted, connectedAt: new Date().toISOString() });
  } else {
    await store.addRecord(TOKENS, { id: SYSTEM_MAILBOX_ID, tokens: encrypted, connectedAt: new Date().toISOString() });
  }
  return true;
}

async function getAuthenticatedClient() {
  const record = await store.findRecordByField(TOKENS, "id", SYSTEM_MAILBOX_ID);
  if (!record) return null;
  const plainTokens = decryptTokens(record.tokens);
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials(plainTokens);

  // Persist refreshed tokens so the next cron tick doesn't re-use a stale
  // access_token. Google rotates the refresh_token on occasion; losing the new
  // one would silently disconnect the mailbox.
  oauth2Client.on("tokens", async (newTokens) => {
    try {
      const merged = encryptTokens({ ...plainTokens, ...newTokens });
      await store.updateRecord(TOKENS, SYSTEM_MAILBOX_ID, { tokens: merged });
      Object.assign(plainTokens, newTokens);
    } catch (err) {
      console.error(`[Gmail] CRITICAL: failed to persist refreshed OAuth tokens. err=${err.message}`);
    }
  });

  return oauth2Client;
}

async function isConnected() {
  return !!(await store.findRecordByField(TOKENS, "id", SYSTEM_MAILBOX_ID));
}

// Parses a recipient line like:
//   "ClimateFlow Support" <support+reviews-biz_abc123@climateflow.ai>, other@x.com
// Returns the first match as { purpose: "reviews"|"estimates", businessId } or null.
//
// The regex is anchored on BOTH the configured local-part AND the platform
// mailbox domain so a header with a lookalike domain (support+estimates-biz@
// attacker.test, support+estimates-biz@climateflow.ai.attacker.test, etc.)
// cannot produce a route. Callers without an expectedDomain get a no-op match —
// so the parser always fails closed if the domain isn't passed in.
function parsePlusAddress(toHeader, expectedLocalPart = "support", expectedDomain = null) {
  if (!toHeader) return null;
  if (!expectedDomain || typeof expectedDomain !== "string") return null;
  const escLocal = String(expectedLocalPart).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escDomain = expectedDomain.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Trailing lookahead rejects any continuation that looks like a domain
  // character (letter, digit, `.`, `-`) — blocks `…climateflow.ai.attacker.test`.
  const pattern = new RegExp(
    `\\b${escLocal}\\+(reviews|estimates)-([A-Za-z0-9_-]{1,64})@${escDomain}(?![\\w.-])`,
    "i"
  );
  const m = toHeader.match(pattern);
  if (!m) return null;
  return { purpose: m[1].toLowerCase(), businessId: m[2] };
}

// Redacts an address for safe logging. An unroutable To-header can reveal
// customer identity (full local-part) and might encode a lookalike domain we
// don't want preserved in logs verbatim — keep only the @domain suffix when
// it's ours, otherwise a length placeholder. We still emit the message id so
// the operator can pull the raw header from Gmail if they need to.
function redactRouteTarget(raw, expectedDomain) {
  if (typeof raw !== "string" || !raw) return "<empty>";
  const at = raw.lastIndexOf("@");
  if (at < 0) return `<no-at len=${raw.length}>`;
  const tail = raw.slice(at + 1).toLowerCase().replace(/[>\s,;].*$/, "");
  if (expectedDomain && tail === String(expectedDomain).toLowerCase()) {
    return `[redacted]@${tail}`;
  }
  return `[redacted]@<foreign-domain> len=${raw.length}`;
}

// Derives the domain half of the platform mailbox from the configured FROM_EMAIL.
// Returns null if FROM_EMAIL is unset or malformed, so the poller can fail
// closed rather than route with an untrusted default.
function expectedMailboxDomain() {
  const from = config.email?.fromEmail;
  if (typeof from !== "string") return null;
  const at = from.lastIndexOf("@");
  if (at < 1 || at === from.length - 1) return null;
  return from.slice(at + 1).toLowerCase();
}

// Returns the first header value from a Gmail message payload headers array,
// case-insensitive. `message.payload.headers` has shape `[{name, value}, ...]`.
function getHeader(headers, name) {
  if (!Array.isArray(headers)) return null;
  const lower = name.toLowerCase();
  for (const h of headers) {
    if (h && typeof h.name === "string" && h.name.toLowerCase() === lower) return h.value || null;
  }
  return null;
}

// Walks the MIME tree and returns the first text/plain body as a string, falling
// back to text/html (stripped of tags). The Gmail API returns bodies as
// base64url-encoded strings, sometimes nested several parts deep.
function extractBody(payload) {
  if (!payload) return "";
  const decode = (data) => Buffer.from(String(data || ""), "base64url").toString("utf8");

  function walk(part, accept) {
    if (!part) return null;
    if (part.mimeType === accept && part.body?.data) return decode(part.body.data);
    if (Array.isArray(part.parts)) {
      for (const sub of part.parts) {
        const hit = walk(sub, accept);
        if (hit) return hit;
      }
    }
    return null;
  }

  const plain = walk(payload, "text/plain");
  if (plain) return plain;
  const html = walk(payload, "text/html");
  if (html) return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  // Top-level inline body (common for very simple messages)
  if (payload.body?.data) return decode(payload.body.data);
  return "";
}

async function markRead(gmail, messageId) {
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: { removeLabelIds: ["UNREAD"] },
  });
}

async function recordProcessed(messageId, extras = {}) {
  await store.addRecord(PROCESSED, {
    id: messageId,
    processedAt: new Date().toISOString(),
    expiresAt: Date.now() + PROCESSED_TTL_MS,
    ...extras,
  });
}

async function getProcessedRecord(messageId) {
  return (await store.findRecordByField(PROCESSED, "id", messageId)) || null;
}

// --- ROUTING HANDLERS ---
//
// Signature: `handler({ businessId, message, body, headers })`
//   - businessId: parsed from the plus-suffix (caller has already validated shape).
//   - message: raw Gmail message resource.
//   - body: plain-text body (or stripped HTML fallback).
//   - headers: subject / from / to for convenience.
//
// Handlers MUST NOT throw — a thrown error leaves the message in UNREAD and the
// next poll will retry forever. Wrap all real work in try/catch and return a
// boolean indicating whether to mark the message read.
//
// The defaults below FAIL CLOSED: they log an error and return false so the
// message stays UNREAD. Codex previously caught a real data-loss path where
// stub defaults acked customer mail without creating any durable record — if
// a future caller forgets to wire real handlers, mail survives the next poll
// instead of disappearing.
async function defaultReviewHandler({ businessId, message, headers }) {
  console.error(
    `[Gmail] REFUSING to ack review email id=${message?.id} businessId=${businessId} ` +
    `subject=${JSON.stringify(headers?.subject || "")} — no real reviewHandler was wired into pollInbox(). ` +
    `Message left UNREAD for retry.`
  );
  return false;
}

async function defaultEstimateHandler({ businessId, message, headers }) {
  console.error(
    `[Gmail] REFUSING to ack estimate email id=${message?.id} businessId=${businessId} ` +
    `subject=${JSON.stringify(headers?.subject || "")} — no real estimateHandler was wired into pollInbox(). ` +
    `Message left UNREAD for retry.`
  );
  return false;
}

// Poll loop — intended to run from a 60s cron tick. Handlers are injected so
// tests can substitute mocks and so #23/#24 can wire in real parsers without
// this module importing them (avoids a circular dependency when the pipelines
// eventually want to write back into other stores).
async function pollInbox({ reviewHandler, estimateHandler, localPart = "support", domain } = {}) {
  // Fail-closed guard: refuse to poll at all unless BOTH real handlers are
  // wired. The defaults exist only as a last-resort safety net so that
  // forgetting a handler loses no mail; if we got this far without them, the
  // caller is misconfigured and we'd rather skip the tick than risk a default
  // path drifting back to ack-on-success.
  if (typeof reviewHandler !== "function" || typeof estimateHandler !== "function") {
    console.error(
      "[Gmail] pollInbox refusing to run — both reviewHandler and estimateHandler must be provided. " +
      "Messages remain UNREAD."
    );
    return { skipped: true, reason: "handlers_not_wired" };
  }

  const auth = await getAuthenticatedClient();
  if (!auth) return { skipped: true, reason: "not_connected" };

  // Fail-closed guard: without a known platform domain we cannot safely route
  // anything, because a spoofed To/Delivered-To header would match on the
  // local-part alone. Refuse to run until FROM_EMAIL (or an explicit override)
  // gives us an anchor.
  const expectedDomain = (domain || expectedMailboxDomain() || "").toLowerCase() || null;
  if (!expectedDomain) {
    console.error("[Gmail] pollInbox refusing to route — no expected mailbox domain configured (set FROM_EMAIL).");
    return { skipped: true, reason: "no_expected_domain" };
  }

  const gmail = google.gmail({ version: "v1", auth });
  const { data: list } = await gmail.users.messages.list({
    userId: "me",
    q: "is:unread",
    maxResults: POLL_BATCH_SIZE,
  });
  const ids = (list.messages || []).map((m) => m.id);
  if (ids.length === 0) return { processed: 0, routed: 0, skipped: 0 };

  let routed = 0;
  let skipped = 0;
  const onReview = reviewHandler || defaultReviewHandler;
  const onEstimate = estimateHandler || defaultEstimateHandler;

  for (const messageId of ids) {
    try {
      const processed = await getProcessedRecord(messageId);
      if (processed) {
        // We already saw this id. Two cases:
        //   - quarantined: left UNREAD deliberately so the operator notices it
        //     in the shared inbox. Do NOT mark read, do NOT re-route.
        //   - normal: last handler ack succeeded but the label update failed.
        //     Retry the UNREAD→READ transition so it clears on the next tick.
        if (!processed.quarantined) {
          await markRead(gmail, messageId).catch(() => {});
        }
        skipped++;
        continue;
      }

      const { data: message } = await gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "full",
      });
      const headerList = message.payload?.headers || [];
      const headers = {
        to: getHeader(headerList, "To"),
        from: getHeader(headerList, "From"),
        subject: getHeader(headerList, "Subject"),
        deliveredTo: getHeader(headerList, "Delivered-To"),
      };
      // Gmail's plus-address is more reliably preserved in Delivered-To than in
      // the user-facing To header (which some senders collapse to just the
      // display name + canonical address). Whichever header we use, the domain
      // must still match our configured platform mailbox — the To header is
      // sender-controlled and can contain anything.
      const routeTarget = headers.deliveredTo || headers.to;
      const route = parsePlusAddress(routeTarget, localPart, expectedDomain);
      if (!route) {
        // Quarantine, do NOT auto-ack. Codex round 3 caught that silently
        // marking unroutable mail as read was a real data-loss path — any
        // mis-addressed customer email (typo in the plus-suffix, bcc to the
        // raw mailbox, forwarded thread) would vanish from the inbox with
        // no operator signal. Instead: leave UNREAD so it stays visible in
        // the shared mailbox, but write a processed record with a
        // `quarantined` flag so the next poll's pre-loop short-circuit
        // skips it without re-logging or re-fetching the body.
        console.warn(
          `[Gmail] QUARANTINED id=${messageId} — no valid route. ` +
          `to=${redactRouteTarget(routeTarget, expectedDomain)} Left UNREAD for operator review.`
        );
        await recordProcessed(messageId, { quarantined: true, reason: "unroutable" });
        skipped++;
        continue;
      }

      const body = extractBody(message.payload);
      const ctx = { businessId: route.businessId, message, body, headers };
      const ok = route.purpose === "reviews"
        ? await onReview(ctx)
        : await onEstimate(ctx);

      // Strict ack: only a literal `true` counts. A handler that returns
      // undefined, null, or a truthy-but-non-true sentinel no longer silently
      // acks — the message stays UNREAD for the next poll.
      if (ok === true) {
        await markRead(gmail, messageId).catch((err) => {
          console.error(`[Gmail] failed to mark id=${messageId} as read: ${err.message}`);
        });
        await recordProcessed(messageId);
        routed++;
      } else {
        skipped++;
      }
    } catch (err) {
      // Any unhandled error leaves the message UNREAD for the next tick so we
      // don't silently drop customer data on a transient failure.
      console.error(`[Gmail] poll error for id=${messageId}: ${err.message}`);
    }
  }

  return { processed: ids.length, routed, skipped };
}

module.exports = {
  TOKENS,
  OAUTH_STATES,
  PROCESSED,
  SYSTEM_MAILBOX_ID,
  PROCESSED_TTL_MS,
  getAuthUrl,
  consumeOAuthState,
  handleOAuthCallback,
  isConnected,
  pollInbox,
  parsePlusAddress,
  expectedMailboxDomain,
  extractBody,
  getHeader,
};
