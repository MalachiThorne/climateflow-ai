// Regression tests for two security findings raised in the adversarial review:
//
//  1. gmailIngest.parsePlusAddress must refuse to route unless the To/
//     Delivered-To header matches BOTH the configured local-part AND the
//     configured platform mailbox domain. A lookalike or attacker-controlled
//     domain in the To header used to be enough to misroute mail cross-tenant.
//
//  2. smsRetry.sendWithFallback must never throw. The original implementation
//     awaited enqueue() unguarded, so a simultaneous Twilio outage + DB
//     outage would bubble the error out of sendWithFallback, leaving the
//     pipeline in a half-committed state with no retry row.

process.env.NODE_ENV = "test";
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "sk-ant-dummy";
process.env.TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "ACdummy";
process.env.TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "dummy";
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_dummy";
process.env.URL_SIGNING_SECRET = process.env.URL_SIGNING_SECRET || "x".repeat(32);
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://dummy";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

// ---------------------------------------------------------------------------
// Fix 1 — Gmail plus-address domain validation
// ---------------------------------------------------------------------------
const { parsePlusAddress } = require("../src/gmailIngest");

test("parsePlusAddress fails closed when expectedDomain is not provided", () => {
  assert.equal(
    parsePlusAddress("support+estimates-biz_abc@climateflow.ai"),
    null,
  );
});

test("parsePlusAddress routes a correctly-domained address", () => {
  const r = parsePlusAddress(
    "support+estimates-biz_abc@climateflow.ai",
    "support",
    "climateflow.ai",
  );
  assert.deepEqual(r, { purpose: "estimates", businessId: "biz_abc" });
});

test("parsePlusAddress rejects a lookalike subdomain", () => {
  // Attacker tries to chain a second domain after ours. The trailing domain
  // lookahead must reject this — otherwise \b on the `.` would let it through.
  assert.equal(
    parsePlusAddress(
      "support+estimates-biz_abc@climateflow.ai.attacker.test",
      "support",
      "climateflow.ai",
    ),
    null,
  );
});

test("parsePlusAddress rejects an entirely different domain", () => {
  assert.equal(
    parsePlusAddress(
      "support+estimates-biz_abc@attacker.test",
      "support",
      "climateflow.ai",
    ),
    null,
  );
});

test("parsePlusAddress still matches inside a display-name header", () => {
  const r = parsePlusAddress(
    '"ClimateFlow" <support+reviews-biz_xyz@climateflow.ai>, other@elsewhere.com',
    "support",
    "climateflow.ai",
  );
  assert.deepEqual(r, { purpose: "reviews", businessId: "biz_xyz" });
});

test("parsePlusAddress is case-insensitive on the domain", () => {
  const r = parsePlusAddress(
    "support+reviews-biz_xyz@CLIMATEFLOW.AI",
    "support",
    "climateflow.ai",
  );
  assert.deepEqual(r, { purpose: "reviews", businessId: "biz_xyz" });
});

test("parsePlusAddress ignores the correct suffix embedded in a longer token", () => {
  // `xsupport+estimates-biz_abc@climateflow.ai` should not match because
  // \b before the local-part prevents local-part prefixing.
  assert.equal(
    parsePlusAddress(
      "xsupport+estimates-biz_abc@climateflow.ai",
      "support",
      "climateflow.ai",
    ),
    null,
  );
});

// ---------------------------------------------------------------------------
// Fix 2 — smsRetry dual-failure is non-throwing
// ---------------------------------------------------------------------------
//
// Load smsRetry with a controllable stub for `../sms` (sendSMS) and for
// `../store` (addRecord). require.cache injection beats module rewiring
// because smsRetry destructures its imports at load time.
function loadSmsRetryWithStubs({ sendImpl, addRecordImpl }) {
  const smsPath = require.resolve("../src/sms");
  const storePath = require.resolve("../src/store");
  const retryPath = require.resolve("../src/smsRetry");

  require.cache[smsPath] = {
    id: smsPath,
    filename: smsPath,
    loaded: true,
    exports: { sendSMS: sendImpl },
  };
  require.cache[storePath] = {
    id: storePath,
    filename: storePath,
    loaded: true,
    exports: {
      addRecord: addRecordImpl,
      // Not called by sendWithFallback, but keep the shape populated so any
      // transitive load path finds something sensible.
      findRecordsByField: async () => [],
      claimDueRecord: async () => null,
      updateRecord: async () => {},
    },
  };
  delete require.cache[retryPath];
  return require("../src/smsRetry");
}

test("sendWithFallback returns sent:true on successful Twilio send", async () => {
  const retry = loadSmsRetryWithStubs({
    sendImpl: async () => "SM_OK",
    addRecordImpl: async () => {
      throw new Error("should not be called on success path");
    },
  });
  const result = await retry.sendWithFallback("+15551234567", "hi", null, "test");
  assert.equal(result.sent, true);
  assert.equal(result.sid, "SM_OK");
});

test("sendWithFallback queues for retry when Twilio fails but DB is healthy", async () => {
  let queued = null;
  const retry = loadSmsRetryWithStubs({
    sendImpl: async () => { throw new Error("twilio 503"); },
    addRecordImpl: async (_collection, data) => {
      queued = data;
      return { ...data, id: "q_1", createdAt: new Date().toISOString() };
    },
  });
  const result = await retry.sendWithFallback("+15551234567", "hi", null, "missed_call");
  assert.equal(result.sent, false);
  assert.equal(result.queuedId, "q_1");
  assert.equal(result.error, "twilio 503");
  assert.equal(result.dropped, undefined);
  assert.ok(queued && queued.to === "+15551234567");
});

test("sendWithFallback does NOT throw when BOTH Twilio and DB fail", async () => {
  const retry = loadSmsRetryWithStubs({
    sendImpl: async () => { throw new Error("twilio 503"); },
    addRecordImpl: async () => { throw new Error("db ECONNREFUSED"); },
  });

  // The contract: this call must resolve, never reject. A rejected promise
  // on the dual-failure path would bubble out of the pipeline and leave
  // lead/estimate state mutated with no SMS and no retry row.
  let result;
  await assert.doesNotReject(async () => {
    result = await retry.sendWithFallback("+15551234567", "hi", null, "missed_call");
  });
  assert.equal(result.sent, false);
  assert.equal(result.dropped, true);
  assert.equal(result.error, "twilio 503");
  assert.equal(result.persistError, "db ECONNREFUSED");
  assert.equal(result.queuedId, undefined);
});

// ---------------------------------------------------------------------------
// Fix 3 — onboarding tokens bind to a per-client nonce
// ---------------------------------------------------------------------------
//
// A token minted with nonce A must not verify once the nonce rotates to B,
// even though purpose/subject/expiry are unchanged. Legacy tokens signed
// without a nonce keep working against the empty-string default, so a
// rollout that seeds existing clients with an empty nonce doesn't kill
// outstanding welcome links.
const signedUrl = require("../src/signedUrl");

test("signedUrl.verify accepts a token signed with the same nonce", () => {
  const { token, expiresAt } = signedUrl.sign("onboarding", "biz_abc", 60, "nonce-A");
  assert.equal(signedUrl.verify("onboarding", "biz_abc", token, expiresAt, "nonce-A"), true);
});

test("signedUrl.verify rejects a token when the nonce rotates", () => {
  const { token, expiresAt } = signedUrl.sign("onboarding", "biz_abc", 60, "nonce-A");
  // After rotation the client's stored nonce is "nonce-B". The old token must fail.
  assert.equal(signedUrl.verify("onboarding", "biz_abc", token, expiresAt, "nonce-B"), false);
});

test("signedUrl.verify defaults to empty-string nonce for legacy callers", () => {
  // A token minted without a nonce must verify when the caller also passes no
  // nonce (or empty string). This is the grace-period path for pre-rotation
  // clients whose welcome URLs are still in inboxes.
  const { token, expiresAt } = signedUrl.sign("onboarding", "biz_legacy", 60);
  assert.equal(signedUrl.verify("onboarding", "biz_legacy", token, expiresAt), true);
  assert.equal(signedUrl.verify("onboarding", "biz_legacy", token, expiresAt, ""), true);
});

test("signedUrl.verify rejects legacy token when a nonce is now required", () => {
  // Once a client's nonce is set to any real value, tokens minted under the
  // legacy empty-string path no longer verify.
  const { token, expiresAt } = signedUrl.sign("onboarding", "biz_legacy", 60);
  assert.equal(signedUrl.verify("onboarding", "biz_legacy", token, expiresAt, "nonce-A"), false);
});

// ---------------------------------------------------------------------------
// Fix 4 — tokenCrypto envelope carries a keyVersion for future rotation
// ---------------------------------------------------------------------------
process.env.TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || "a".repeat(64);

test("tokenCrypto round-trips and stamps envelope with a keyVersion", () => {
  const { encryptTokens, decryptTokens } = require("../src/tokenCrypto");
  const envelope = encryptTokens({ access_token: "abc", refresh_token: "xyz" });
  assert.equal(envelope.__enc, true);
  assert.equal(typeof envelope.keyVersion, "string");
  assert.ok(envelope.keyVersion.length > 0);
  const decrypted = decryptTokens(envelope);
  assert.deepEqual(decrypted, { access_token: "abc", refresh_token: "xyz" });
});

test("tokenCrypto decrypts pre-rotation envelopes that lack keyVersion", () => {
  const { encryptTokens, decryptTokens } = require("../src/tokenCrypto");
  // Simulate an envelope written before the keyVersion field existed.
  const envelope = encryptTokens({ a: 1 });
  delete envelope.keyVersion;
  const decrypted = decryptTokens(envelope);
  assert.deepEqual(decrypted, { a: 1 });
});

// ---------------------------------------------------------------------------
// Fix 5 — Gmail ingest must fail closed when handlers are not wired
// ---------------------------------------------------------------------------
//
// Codex caught a real data-loss path: the pre-fix defaultReviewHandler and
// defaultEstimateHandler returned `true` (log-and-ack), so a cron that called
// pollInbox() without real handlers would mark routed customer mail as
// processed and permanently drop it. The fix is twofold:
//
//   1. pollInbox refuses to run at all if either handler is missing.
//   2. The handler ack contract is tightened to `=== true` — a handler that
//      forgets to return anything no longer silently acks.
//
// Both checks run before touching the Gmail API so they need no network
// mocking; we only need to import pollInbox and call it with bad inputs.
const gmailIngest = require("../src/gmailIngest");

test("pollInbox refuses to run with no handlers wired", async () => {
  const result = await gmailIngest.pollInbox({});
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "handlers_not_wired");
});

test("pollInbox refuses to run when only one handler is wired", async () => {
  const result = await gmailIngest.pollInbox({ reviewHandler: async () => true });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "handlers_not_wired");
});

test("defaultReviewHandler and defaultEstimateHandler return false (fail-closed)", async () => {
  // These are not exported, so the behavior is verified indirectly via
  // pollInbox's refusal above — the presence of the handlers_not_wired
  // shortcut guarantees they're never reached in practice. This assertion
  // documents that even if they were reached, they'd refuse the message.
  // (See gmailIngest.js defaultReviewHandler / defaultEstimateHandler.)
  const source = require("fs").readFileSync(require.resolve("../src/gmailIngest"), "utf8");
  // Sanity: neither default returns a literal true anymore.
  assert.match(source, /function defaultReviewHandler[\s\S]*?return false;[\s\S]*?\}/);
  assert.match(source, /function defaultEstimateHandler[\s\S]*?return false;[\s\S]*?\}/);
});

// ---------------------------------------------------------------------------
// Fix 6 — Gmail ingest quarantines unroutable mail instead of acking it
// ---------------------------------------------------------------------------
//
// Codex round 3 caught that the unroutable branch was silently marking mail
// read and writing a processed record — a real data-loss path if a customer
// typo'd the plus-suffix or BCC'd the raw mailbox. The fix: leave UNREAD so
// the operator still sees it, but write a processed record with a
// `quarantined` flag so subsequent polls skip it without re-fetching.
function loadGmailIngestWithStubs({ tokenEnvelope, processedRecordsByMessageId = {}, listMessages, getMessage, modifyCalls = [], addedProcessedRecords = [] }) {
  const storePath = require.resolve("../src/store");
  const tokenCryptoPath = require.resolve("../src/tokenCrypto");
  const googleapisPath = require.resolve("googleapis");
  const ingestPath = require.resolve("../src/gmailIngest");

  require.cache[storePath] = {
    id: storePath,
    filename: storePath,
    loaded: true,
    exports: {
      findRecordByField: async (collection, field, value) => {
        if (collection === "gmail_tokens" && field === "id" && value === "system") {
          return { id: "system", tokens: tokenEnvelope, connectedAt: "2026-01-01T00:00:00Z" };
        }
        if (collection === "gmail_processed" && field === "id") {
          return processedRecordsByMessageId[value] || null;
        }
        return null;
      },
      addRecord: async (collection, data) => {
        if (collection === "gmail_processed") {
          addedProcessedRecords.push(data);
        }
        return { ...data, createdAt: new Date().toISOString() };
      },
      updateRecord: async () => {},
      deleteRecord: async () => null,
      findRecordsByField: async () => [],
      claimDueRecord: async () => null,
    },
  };
  require.cache[tokenCryptoPath] = {
    id: tokenCryptoPath,
    filename: tokenCryptoPath,
    loaded: true,
    exports: {
      encryptTokens: (t) => ({ __enc: true, keyVersion: "v1", iv: "00", data: "00", tag: "00", _plain: t }),
      decryptTokens: (env) => env._plain || { access_token: "fake", refresh_token: "fake" },
    },
  };
  // Fake googleapis — only the surface pollInbox touches.
  const fakeGmail = {
    users: {
      messages: {
        list: async () => ({ data: { messages: (await listMessages()).map((m) => ({ id: m.id })) } }),
        get: async ({ id }) => ({ data: await getMessage(id) }),
        modify: async (args) => { modifyCalls.push(args); },
      },
    },
  };
  require.cache[googleapisPath] = {
    id: googleapisPath,
    filename: googleapisPath,
    loaded: true,
    exports: {
      google: {
        auth: {
          OAuth2: class {
            generateAuthUrl() { return "https://fake"; }
            setCredentials() {}
            on() {}
          },
        },
        gmail: () => fakeGmail,
      },
    },
  };
  delete require.cache[ingestPath];
  return require("../src/gmailIngest");
}

test("pollInbox unroutable mail is quarantined — left UNREAD, processed record flagged", async () => {
  // Preserve original FROM_EMAIL so we don't leak between tests.
  const prevFromEmail = process.env.FROM_EMAIL;
  process.env.FROM_EMAIL = "support@climateflow.ai";

  const modifyCalls = [];
  const addedProcessedRecords = [];
  try {
    const ingest = loadGmailIngestWithStubs({
      tokenEnvelope: { __enc: true, _plain: { access_token: "x", refresh_token: "y" } },
      listMessages: async () => [{ id: "msg_unroutable_1" }],
      getMessage: async () => ({
        id: "msg_unroutable_1",
        payload: {
          headers: [
            { name: "To", value: "someone-else@attacker.test" },
            { name: "From", value: "customer@example.com" },
            { name: "Subject", value: "hi" },
          ],
        },
      }),
      modifyCalls,
      addedProcessedRecords,
    });

    const result = await ingest.pollInbox({
      reviewHandler: async () => { throw new Error("should not be called on unroutable"); },
      estimateHandler: async () => { throw new Error("should not be called on unroutable"); },
      domain: "climateflow.ai",
    });

    assert.equal(result.processed, 1);
    assert.equal(result.routed, 0);
    assert.equal(result.skipped, 1);
    // The critical regression assertion: modify (markRead) was NOT called.
    assert.equal(modifyCalls.length, 0, "unroutable mail must not be marked read");
    // And a quarantine record was written.
    assert.equal(addedProcessedRecords.length, 1);
    assert.equal(addedProcessedRecords[0].id, "msg_unroutable_1");
    assert.equal(addedProcessedRecords[0].quarantined, true);
    assert.equal(addedProcessedRecords[0].reason, "unroutable");
  } finally {
    if (prevFromEmail === undefined) delete process.env.FROM_EMAIL;
    else process.env.FROM_EMAIL = prevFromEmail;
  }
});

test("pollInbox skips previously-quarantined mail without re-marking or re-routing", async () => {
  const prevFromEmail = process.env.FROM_EMAIL;
  process.env.FROM_EMAIL = "support@climateflow.ai";

  const modifyCalls = [];
  const addedProcessedRecords = [];
  try {
    const ingest = loadGmailIngestWithStubs({
      tokenEnvelope: { __enc: true, _plain: { access_token: "x", refresh_token: "y" } },
      processedRecordsByMessageId: {
        msg_prev_quarantined: { id: "msg_prev_quarantined", quarantined: true, reason: "unroutable" },
      },
      listMessages: async () => [{ id: "msg_prev_quarantined" }],
      getMessage: async () => { throw new Error("should not fetch body of already-processed quarantined mail"); },
      modifyCalls,
      addedProcessedRecords,
    });

    const result = await ingest.pollInbox({
      reviewHandler: async () => true,
      estimateHandler: async () => true,
      domain: "climateflow.ai",
    });

    assert.equal(result.skipped, 1);
    assert.equal(result.routed, 0);
    // Regression: we must NOT mark quarantined mail read on subsequent polls
    // — that would undo the quarantine signal to the operator.
    assert.equal(modifyCalls.length, 0, "already-quarantined mail must not be marked read");
    // No new processed record (the existing one is the source of truth).
    assert.equal(addedProcessedRecords.length, 0);
  } finally {
    if (prevFromEmail === undefined) delete process.env.FROM_EMAIL;
    else process.env.FROM_EMAIL = prevFromEmail;
  }
});

test("pollInbox retries markRead for non-quarantined processed mail", async () => {
  // A previous tick successfully handed mail to a handler and recorded it,
  // but the markRead API call failed. The next tick should retry the label
  // update — not re-route, not re-fetch the body.
  const prevFromEmail = process.env.FROM_EMAIL;
  process.env.FROM_EMAIL = "support@climateflow.ai";

  const modifyCalls = [];
  const addedProcessedRecords = [];
  try {
    const ingest = loadGmailIngestWithStubs({
      tokenEnvelope: { __enc: true, _plain: { access_token: "x", refresh_token: "y" } },
      processedRecordsByMessageId: {
        msg_prev_routed: { id: "msg_prev_routed" }, // no quarantined flag
      },
      listMessages: async () => [{ id: "msg_prev_routed" }],
      getMessage: async () => { throw new Error("should not fetch body of already-processed mail"); },
      modifyCalls,
      addedProcessedRecords,
    });

    const result = await ingest.pollInbox({
      reviewHandler: async () => true,
      estimateHandler: async () => true,
      domain: "climateflow.ai",
    });

    assert.equal(result.skipped, 1);
    assert.equal(modifyCalls.length, 1, "non-quarantined processed mail must get its markRead retried");
    assert.equal(modifyCalls[0].id, "msg_prev_routed");
  } finally {
    if (prevFromEmail === undefined) delete process.env.FROM_EMAIL;
    else process.env.FROM_EMAIL = prevFromEmail;
  }
});

// ---------------------------------------------------------------------------
// Fix 7 — smsRetry.processPending never double-sends after a persist failure
// ---------------------------------------------------------------------------
//
// Codex round 3 caught: sendSMS and the post-send updateRecord were in the
// same try block. If Twilio accepted the message but the DB write failed,
// the catch branch rescheduled the row → next cron tick would re-send,
// delivering a duplicate SMS to the customer. The fix writes a pre-send
// marker (sendAttemptedAt) under the existing lease. On any stale-lease
// reclaim where that marker is set, the row flips to sent_unknown and never
// re-enters the retry loop.
function loadSmsRetryWithProcessingStubs({ records, sendImpl, updateImpls = {}, claimOverride }) {
  const smsPath = require.resolve("../src/sms");
  const storePath = require.resolve("../src/store");
  const retryPath = require.resolve("../src/smsRetry");

  const updates = [];
  const sendCalls = [];

  require.cache[smsPath] = {
    id: smsPath,
    filename: smsPath,
    loaded: true,
    exports: {
      sendSMS: async (...args) => {
        sendCalls.push(args);
        return sendImpl(...args);
      },
    },
  };
  require.cache[storePath] = {
    id: storePath,
    filename: storePath,
    loaded: true,
    exports: {
      addRecord: async () => ({}),
      findRecordsByField: async (_collection, field, value) => {
        return records.filter((r) => r[field] === value);
      },
      claimDueRecord: async (_collection, id, leaseToken) => {
        if (typeof claimOverride === "function") return claimOverride(id, leaseToken);
        const hit = records.find((r) => r.id === id);
        return hit ? { ...hit, leaseToken } : null;
      },
      updateRecord: async (_collection, id, patch) => {
        // Simulate DB atomicity: if the impl throws, the patch is not
        // applied (as with a failed UPDATE in Postgres). Only record the
        // update and mutate the record on successful impl return.
        const priorCount = updates.filter((u) => u.id === id).length;
        const impl = updateImpls[id];
        if (typeof impl === "function") {
          await impl(patch, priorCount + 1);
        }
        updates.push({ id, patch });
        const hit = records.find((r) => r.id === id);
        if (hit) Object.assign(hit, patch);
      },
    },
  };
  delete require.cache[retryPath];
  return { retry: require("../src/smsRetry"), updates, sendCalls };
}

test("processPending does NOT re-send when Twilio succeeds but persist fails", async () => {
  const records = [
    {
      id: "q_dup_risk",
      to: "+15551234567",
      body: "hi",
      status: "pending",
      attempts: 0,
      nextAttemptAt: new Date(Date.now() - 1000).toISOString(),
    },
  ];

  const { retry, updates, sendCalls } = loadSmsRetryWithProcessingStubs({
    records,
    sendImpl: async () => "SM_ACCEPTED",
    updateImpls: {
      q_dup_risk: (patch, callIndex) => {
        // The first update stamps sendAttemptedAt (pre-send marker).
        // The second update is the post-send "sent" persist — simulate DB failure.
        if (callIndex === 2) throw new Error("db ECONNREFUSED");
      },
    },
  });

  const result = await retry.processPending();

  // sendSMS was called exactly once.
  assert.equal(sendCalls.length, 1);
  assert.equal(result.succeeded, 0);
  // After the CRITICAL log, the row retains sendAttemptedAt. Simulate the
  // next cron tick by re-invoking processPending with the record now in
  // "processing" state (its status never got flipped to sent).
  assert.equal(records[0].sendAttemptedAt != null, true, "sendAttemptedAt must remain set so the next poll flips to sent_unknown");
  // The lease is still held; stale-lease reclaim on the next tick would
  // re-claim it. Reset sendCalls/updates, run again.
  sendCalls.length = 0;
  updates.length = 0;
  // Simulate a stale lease by backdating the lease so claimDueRecord returns it.
  const result2 = await retry.processPending();
  // sendSMS must NOT be called again.
  assert.equal(sendCalls.length, 0, "retry tick must not re-invoke sendSMS after a prior send attempt");
  // The row must have been moved to sent_unknown.
  assert.equal(records[0].status, "sent_unknown");
  assert.ok(result2.succeeded === 0);
});

test("processPending reschedules (not sent_unknown) when sendSMS fails cleanly", async () => {
  // Sanity: a plain send failure clears sendAttemptedAt so the next tick
  // tries again normally. Without this, every transient Twilio failure
  // would trap messages in sent_unknown.
  const records = [
    {
      id: "q_transient",
      to: "+15551234567",
      body: "hi",
      status: "pending",
      attempts: 0,
      nextAttemptAt: new Date(Date.now() - 1000).toISOString(),
    },
  ];

  const { retry, sendCalls } = loadSmsRetryWithProcessingStubs({
    records,
    sendImpl: async () => { throw new Error("twilio 503"); },
  });

  const result = await retry.processPending();
  assert.equal(sendCalls.length, 1);
  assert.equal(result.succeeded, 0);
  assert.equal(records[0].status, "pending");
  assert.equal(records[0].attempts, 1);
  assert.equal(records[0].sendAttemptedAt, null, "sendAttemptedAt must be cleared on clean send-failure so the next tick can try again");
});
