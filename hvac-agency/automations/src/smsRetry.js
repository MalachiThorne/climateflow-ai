// SMS retry queue.
//
// Twilio's outbound API can fail transiently (rate-limit, 5xx, network). When it
// does, the lead-rescue / estimate-followup pipelines must NOT bubble the error:
//   (a) the lead/conversation state has already been updated, and
//   (b) we now dedup Twilio inbound webhooks by MessageSid, so a retry from Twilio
//       won't trigger a second pipeline run.
// Instead, we persist the outbound message to a `pending_sms` collection and let a
// cron job drain it. Attempts are capped; after MAX_ATTEMPTS the record is marked
// `failed` and logged for human review.
const { randomUUID } = require("crypto");
const store = require("./store");
const { sendSMS } = require("./sms");

const PENDING_SMS = "pending_sms";
const MAX_ATTEMPTS = 6;
// Exponential-ish backoff in minutes. We don't store a perfectly-computed next-run
// time; the cron re-checks every few minutes, and we just skip records whose next
// attempt is in the future.
const BACKOFF_MINUTES = [1, 5, 15, 30, 60, 180];
// Processing-lease TTL. If a worker crashes mid-send the row stays in "processing"
// until another runner reclaims it after this window. Longer than sendSMS's own
// timeout so a slow-but-alive send isn't pre-empted.
const STALE_LEASE_MS = 10 * 60 * 1000;

async function enqueue({ to, body, fromNumber, reason = "", meta = {} }) {
  if (!to || !body) return null;
  const record = await store.addRecord(PENDING_SMS, {
    to,
    body,
    fromNumber: fromNumber || null,
    reason,
    meta,
    attempts: 0,
    lastError: null,
    status: "pending",
    nextAttemptAt: new Date().toISOString(),
  });
  console.warn(
    `[SMS Retry] Queued ${record.id} to=${to} reason=${reason} — will retry via cron.`
  );
  return record;
}

// Wrap a sendSMS call: on failure, persist the message for retry and swallow the
// error. Returns { sent: true, sid } on success, { sent: false, queuedId } on
// send failure that was safely queued, or { sent: false, dropped: true,
// persistError } when BOTH the send and the queue write fail — the payload is
// unrecoverable in that path, but the caller's state stays consistent and we
// log loudly so an operator can reconstruct manually.
//
// Critical invariant: this function must never throw. Pipelines call it AFTER
// advancing lead/estimate state, and a thrown error on the dual-failure path
// would leave durable state that claims a message was sent when it wasn't and
// also wasn't queued for retry.
async function sendWithFallback(to, body, fromNumber, reason = "") {
  try {
    const sid = await sendSMS(to, body, fromNumber);
    return { sent: true, sid };
  } catch (sendErr) {
    console.error(`[SMS Retry] Initial send failed to=${to} reason=${reason}: ${sendErr.message}`);
    try {
      const queued = await enqueue({
        to,
        body,
        fromNumber,
        reason,
        meta: { initialError: sendErr.message },
      });
      return { sent: false, queuedId: queued?.id, error: sendErr.message };
    } catch (persistErr) {
      // Twilio down AND the datastore is unhealthy. We cannot retry this
      // message — log everything we need to reconstruct it by hand so the
      // message isn't silently lost.
      console.error(
        `[SMS Retry] CRITICAL: dual failure — send AND queue-write both failed. to=${to} reason=${reason} ` +
        `sendError=${sendErr.message} persistError=${persistErr.message} bodyLen=${body ? body.length : 0}`
      );
      return {
        sent: false,
        dropped: true,
        error: sendErr.message,
        persistError: persistErr.message,
      };
    }
  }
}

async function processPending() {
  // Two concerns: (1) rows whose status is "pending" and whose nextAttemptAt has
  // elapsed, and (2) rows stuck in "processing" because a previous worker crashed.
  // Both are drained here — claimDueRecord handles the atomic transition and
  // stale-lease reclaim in a single UPDATE, so only one worker wins per row.
  const candidates = [
    ...(await store.findRecordsByField(PENDING_SMS, "status", "pending")),
    ...(await store.findRecordsByField(PENDING_SMS, "status", "processing")),
  ];
  let succeeded = 0;
  let failed = 0;
  let claimed = 0;

  for (const candidate of candidates) {
    const leaseToken = randomUUID();
    const record = await store.claimDueRecord(PENDING_SMS, candidate.id, leaseToken, STALE_LEASE_MS);
    if (!record) continue; // another worker beat us to it, or not due yet
    claimed++;

    const attempts = (record.attempts || 0) + 1;

    // Stale-lease recovery: if a previous worker crashed AFTER handing a
    // message to Twilio but BEFORE we could persist "sent", sendAttemptedAt
    // is stamped on the record. Twilio has no client-side idempotency key,
    // so we cannot safely re-send — a second attempt would deliver the
    // message twice. Flip the row to sent_unknown and require operator
    // review. This is the terminal state for the dual-failure path; the
    // record never re-enters the retry loop on its own.
    if (record.sendAttemptedAt) {
      await store.updateRecord(PENDING_SMS, record.id, {
        status: "sent_unknown",
        attempts,
        lastError: "worker crashed after sendSMS call; refusing to resend",
        leaseToken: null,
      });
      console.error(
        `[SMS Retry] SENT_UNKNOWN ${record.id} to=${record.to} — prior attempt reached sendSMS ` +
        `but did not confirm persistence. Manual review required to confirm delivery.`
      );
      continue;
    }

    // Mark that we're about to call Twilio. If the process dies between the
    // sendSMS line and the success-persist below, the next poll's
    // stale-lease reclaim will see sendAttemptedAt and refuse to retry.
    try {
      await store.updateRecord(PENDING_SMS, record.id, {
        sendAttemptedAt: new Date().toISOString(),
        currentAttempt: attempts,
      });
    } catch (markErr) {
      // If we can't even write the pre-send marker, don't call Twilio —
      // a successful send we can't persist is a duplicate waiting to happen.
      console.error(
        `[SMS Retry] Failed to stamp pre-send marker on ${record.id}: ${markErr.message}. ` +
        `Releasing lease without calling Twilio.`
      );
      await store.updateRecord(PENDING_SMS, record.id, {
        status: "pending",
        leaseToken: null,
      }).catch(() => {});
      continue;
    }

    let sid;
    try {
      sid = await sendSMS(record.to, record.body, record.fromNumber || undefined);
    } catch (err) {
      // Send failed: clear the pre-send marker since Twilio did NOT accept
      // the message, then either reschedule or fail per the attempt cap.
      if (attempts >= MAX_ATTEMPTS) {
        await store.updateRecord(PENDING_SMS, record.id, {
          status: "failed",
          attempts,
          lastError: err.message,
          failedAt: new Date().toISOString(),
          leaseToken: null,
          sendAttemptedAt: null,
        });
        failed++;
        console.error(
          `[SMS Retry] GIVING UP on ${record.id} to=${record.to} after ${attempts} attempts: ${err.message}`
        );
      } else {
        const backoffMin = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)];
        const next = new Date(Date.now() + backoffMin * 60 * 1000).toISOString();
        await store.updateRecord(PENDING_SMS, record.id, {
          status: "pending",
          attempts,
          lastError: err.message,
          nextAttemptAt: next,
          leaseToken: null,
          sendAttemptedAt: null,
        });
        console.warn(
          `[SMS Retry] Attempt ${attempts} failed for ${record.id}: ${err.message}. Next in ${backoffMin}m.`
        );
      }
      continue;
    }

    // Twilio accepted the message. From here on a persist failure must NOT
    // cause a re-send. Any exception below is logged CRITICAL; the row
    // keeps sendAttemptedAt set so stale-lease reclaim routes it to
    // sent_unknown instead of back to Twilio.
    try {
      await store.updateRecord(PENDING_SMS, record.id, {
        status: "sent",
        attempts,
        sentSid: sid,
        sentAt: new Date().toISOString(),
        leaseToken: null,
      });
      succeeded++;
      console.log(`[SMS Retry] Delivered ${record.id} after ${attempts} attempt(s).`);
    } catch (persistErr) {
      console.error(
        `[SMS Retry] CRITICAL: sendSMS succeeded (sid=${sid}) for ${record.id} to=${record.to} ` +
        `but persist failed: ${persistErr.message}. Row retained with sendAttemptedAt set — ` +
        `will transition to sent_unknown on next poll (no re-send).`
      );
    }
  }

  return { processed: claimed, succeeded, failed };
}

module.exports = { enqueue, sendWithFallback, processPending, PENDING_SMS, MAX_ATTEMPTS };
