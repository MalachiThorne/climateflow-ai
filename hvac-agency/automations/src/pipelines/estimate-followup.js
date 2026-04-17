const { chat, buildEstimateFollowUpPrompt, extractEstimateFromEmail } = require("../ai");
const { sendSMS, scrubAIReply } = require("../sms");
const { sendWithFallback } = require("../smsRetry");
const { sendEstimateFollowUpEmail, sendEstimateAcceptedEmail } = require("../email");
const store = require("../store");
const aiQuota = require("../aiQuota");

const ESTIMATES = "estimates";
const ESTIMATE_CONVERSATIONS = "estimate_conversations";
const PROCESSED_ESTIMATE_EMAILS = "processed_estimate_emails";
const ESTIMATE_REVIEW_QUEUE = "estimate_review_queue";
const MAX_HISTORY_MESSAGES = 20;

// Normalize phones to E.164 for the follow-up pipeline — matches the scheme
// used elsewhere in the codebase (server.js normalizePhone). Kept local here to
// avoid a circular dependency; any change to the canonical form should stay in
// sync with the server helper.
function normalizePhoneE164(raw) {
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

const FOLLOW_UP_SCHEDULE = [
  { daysAfter: 1, type: "initial" },
  { daysAfter: 3, type: "check_in" },
  { daysAfter: 7, type: "final" },
];

async function addEstimate(estimate, business) {
  const entry = await store.addRecord(ESTIMATES, {
    customerName: estimate.customerName,
    customerPhone: estimate.customerPhone,
    customerEmail: estimate.customerEmail || null,
    amount: estimate.amount,
    description: estimate.description,
    businessId: business.id,
    status: "open",
    followUpCount: 0,
    nextFollowUp: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });

  console.log(`[Estimate Follow-Up] Added estimate for ${estimate.customerName}: $${estimate.amount}`);
  return entry;
}

async function processFollowUps(business) {
  const now = new Date();
  const candidates = await store.findRecordsByFields(ESTIMATES, {
    businessId: business.id,
    status: "open",
  });
  const openEstimates = candidates.filter((e) => new Date(e.nextFollowUp) <= now);

  const results = [];

  for (const estimate of openEstimates) {
    const scheduleEntry = FOLLOW_UP_SCHEDULE[estimate.followUpCount];
    if (!scheduleEntry) {
      await store.updateRecord(ESTIMATES, estimate.id, { status: "expired" });
      console.log(`[Estimate Follow-Up] Estimate for ${estimate.customerName} expired after all follow-ups`);
      continue;
    }

    const systemPrompt = buildEstimateFollowUpPrompt(business);
    const context =
      `Customer: ${estimate.customerName}\n` +
      `Estimate: $${estimate.amount} for ${estimate.description}\n` +
      `Follow-up #${estimate.followUpCount + 1} (${scheduleEntry.type})\n` +
      `Days since estimate: ${scheduleEntry.daysAfter}\n\n` +
      `Write a follow-up text message.`;

    const existingConvo = await store.findRecordByField(
      ESTIMATE_CONVERSATIONS,
      "estimateId",
      estimate.id
    );
    const history = existingConvo ? existingConvo.messages : [];

    // Outbound, AI-authored follow-up — context is server-built and trusted, but
    // any prior user replies in history ARE untrusted, so fence them.
    const response = await chat(
      systemPrompt,
      context,
      history.slice(-MAX_HISTORY_MESSAGES).map((m) => ({ role: m.role, content: m.content })),
      { source: "customer" }
    );

    await sendWithFallback(
      estimate.customerPhone,
      scrubAIReply(response, business.twilioNumber),
      business.twilioNumber,
      `estimate-followup:outbound:${estimate.id}`
    );

    if (estimate.customerEmail) {
      try {
        await sendEstimateFollowUpEmail(
          estimate.customerEmail,
          estimate.customerName,
          business.name,
          response,
          business.ownerEmail
        );
      } catch (err) {
        console.error(`[Estimate Follow-Up] Email to ${estimate.customerEmail} failed:`, err.message);
      }
    }

    const messages = [...history, { role: "assistant", content: response, timestamp: now.toISOString() }];

    if (existingConvo) {
      await store.updateRecord(ESTIMATE_CONVERSATIONS, existingConvo.id, { messages });
    } else {
      await store.addRecord(ESTIMATE_CONVERSATIONS, {
        estimateId: estimate.id,
        phone: estimate.customerPhone,
        businessId: business.id,
        messages,
      });
    }

    const nextIdx = estimate.followUpCount + 1;
    const nextSchedule = FOLLOW_UP_SCHEDULE[nextIdx];
    // After the last scheduled follow-up, expire immediately instead of leaving
    // nextFollowUp = null (which `new Date(null) <= now` would still re-pick).
    const update = {
      followUpCount: nextIdx,
      lastFollowUp: now.toISOString(),
    };
    if (nextSchedule) {
      update.nextFollowUp = new Date(Date.now() + nextSchedule.daysAfter * 24 * 60 * 60 * 1000).toISOString();
    } else {
      update.status = "expired";
      update.nextFollowUp = null;
    }

    await store.updateRecord(ESTIMATES, estimate.id, update);

    console.log(`[Estimate Follow-Up] Sent follow-up #${nextIdx} to ${estimate.customerName}`);
    results.push({ estimateId: estimate.id, customerName: estimate.customerName, message: response });
  }

  return results;
}

async function handleEstimateReply(phone, messageBody, business) {
  const estimate = await store.findRecordByFields(ESTIMATES, {
    customerPhone: phone,
    businessId: business.id,
    status: "open",
  });

  if (!estimate) return null;

  const conversation = await store.findRecordByField(
    ESTIMATE_CONVERSATIONS,
    "estimateId",
    estimate.id
  );

  const history = conversation ? conversation.messages : [];
  history.push({ role: "user", content: messageBody, timestamp: new Date().toISOString() });

  // Per-phone-per-day cap — same defense as lead-rescue. Over quota, send static
  // fallback so accept/decline detection below still runs.
  const quota = await aiQuota.checkAndIncrement(phone, business.id);
  let response;
  if (!quota.allowed) {
    console.warn(`[Estimate Follow-Up] AI quota exceeded for ${phone} @ ${business.id} (${quota.count}/${quota.cap}) — sending fallback`);
    response = aiQuota.QUOTA_FALLBACK_MESSAGE;
  } else {
    const systemPrompt = buildEstimateFollowUpPrompt(business);
    response = await chat(
      systemPrompt,
      messageBody,
      history.slice(0, -1).slice(-MAX_HISTORY_MESSAGES).map((m) => ({ role: m.role, content: m.content })),
      { source: "customer" }
    );
  }

  history.push({ role: "assistant", content: response, timestamp: new Date().toISOString() });

  if (conversation) {
    await store.updateRecord(ESTIMATE_CONVERSATIONS, conversation.id, { messages: history });
  }

  await sendWithFallback(
    phone,
    scrubAIReply(response, business.twilioNumber),
    business.twilioNumber,
    `estimate-followup:reply:${estimate.id}`
  );

  // Two-tier match: unambiguous phrases can appear anywhere; single words like
  // "stop" or "yes" must be the entire trimmed message (otherwise "stop by Thursday"
  // or "yesterday" would flip the status). Trailing punctuation is tolerated.
  const lowered = messageBody.toLowerCase();
  const trimmed = lowered.trim();
  const acceptedPhrase = /\b(sounds good|let'?s do it|book it|book the job|schedule it|go ahead|sign me up|yes please|that works for me|let'?s schedule|i'?m in)\b/;
  const acceptedStandalone = /^(yes|yeah|yep|yup|sure|ok|okay|okie|accept|accepted|approve|approved|confirm|confirmed)[.!]?$/;
  const declinedPhrase = /\b(not interested|no thanks|no thank you|too expensive|can'?t afford|please cancel|please stop|stop texting|stop messaging|don'?t contact)\b/;
  const declinedStandalone = /^(no|nope|nah|pass|cancel|cancelled|decline|declined|stop|unsubscribe)[.!]?$/;

  const accepted = acceptedPhrase.test(trimmed) || acceptedStandalone.test(trimmed);
  const declined = declinedPhrase.test(trimmed) || declinedStandalone.test(trimmed);

  if (accepted) {
    await store.updateRecord(ESTIMATES, estimate.id, { status: "accepted", acceptedAt: new Date().toISOString() });
    console.log(`[Estimate Follow-Up] ${estimate.customerName} ACCEPTED estimate!`);
    if (business.ownerEmail) {
      try {
        await sendEstimateAcceptedEmail(business.ownerEmail, business.ownerName, business.name, estimate);
      } catch (err) {
        console.error(`[Estimate Follow-Up] Owner alert email failed:`, err.message);
      }
    }
    if (business.ownerPhone) {
      const amount = typeof estimate.amount === "number" ? `$${estimate.amount.toLocaleString()}` : "";
      const msg = `[ClimateFlow] Estimate accepted! ${estimate.customerName}${amount ? ` — ${amount}` : ""}. Call to schedule: ${estimate.customerPhone}`;
      sendSMS(business.ownerPhone, msg, business.twilioNumber)
        .catch((err) => console.error(`[Estimate Follow-Up] Owner alert SMS failed:`, err.message));
    }
  } else if (declined) {
    await store.updateRecord(ESTIMATES, estimate.id, { status: "declined" });
    console.log(`[Estimate Follow-Up] ${estimate.customerName} declined estimate`);
  }

  return response;
}

// Entry point for the Gmail ingest. Called once per email routed to
// `support+estimates-<businessId>@`. Low-confidence extractions and parses that
// fail validation (missing phone, zero amount) are queued for manual owner
// review via the paste form — we never kick off the AI follow-up cadence on
// shaky data, since that would spam real customers.
async function ingestEstimateEmail({ businessId, messageId, subject, body, fromHeader }) {
  const already = await store.findRecordByField(PROCESSED_ESTIMATE_EMAILS, "messageId", messageId);
  if (already) return { skipped: "already_processed" };

  const business = await store.findRecordByField("clients", "id", businessId);
  if (!business) {
    await store.addRecord(PROCESSED_ESTIMATE_EMAILS, { messageId, businessId, status: "no_business" });
    return { skipped: "no_business" };
  }
  if (business.suspended) {
    await store.addRecord(PROCESSED_ESTIMATE_EMAILS, { messageId, businessId, status: "suspended" });
    return { skipped: "suspended" };
  }

  let extracted;
  try {
    extracted = await extractEstimateFromEmail({ subject, body });
  } catch (err) {
    console.error(`[Estimate Email] Extraction failed for ${messageId}: ${err.message}`);
    throw err;
  }

  const normalizedPhone = normalizePhoneE164(extracted.customerPhone);
  const fieldsOk = extracted.confidence === "high"
    && !!normalizedPhone
    && extracted.amount > 0
    && !!extracted.description;

  if (!fieldsOk) {
    await store.addRecord(ESTIMATE_REVIEW_QUEUE, {
      businessId,
      source: "email",
      messageId,
      emailSubject: subject || null,
      emailFrom: fromHeader || null,
      extracted: {
        customerName: extracted.customerName,
        customerPhone: extracted.customerPhone,
        customerEmail: extracted.customerEmail,
        amount: extracted.amount,
        description: extracted.description,
        confidence: extracted.confidence,
      },
      rawBody: typeof body === "string" ? body.slice(0, 8000) : "",
      status: "pending_owner_review",
    });
    await store.addRecord(PROCESSED_ESTIMATE_EMAILS, { messageId, businessId, status: "queued_for_review" });
    console.log(`[Estimate Email] Queued for owner review: ${business.name} (confidence=${extracted.confidence})`);
    return { action: "queued_for_review" };
  }

  const created = await addEstimate(
    {
      customerName: extracted.customerName,
      customerPhone: normalizedPhone,
      customerEmail: extracted.customerEmail || null,
      amount: extracted.amount,
      description: extracted.description,
    },
    business
  );
  await store.addRecord(PROCESSED_ESTIMATE_EMAILS, {
    messageId,
    businessId,
    status: "processed",
    estimateId: created.id,
  });
  return { action: "added", estimateId: created.id };
}

// Promotes a queued estimate (or an owner-submitted paste) into the real
// estimates collection and starts the follow-up cadence. Validates fields here
// so a malformed paste can't reach the SMS pipeline — the queue / paste form
// is the owner's last line of defense, but we re-check anyway.
async function approveQueuedEstimate(queueId, overrides, business) {
  const queued = await store.findRecordByField(ESTIMATE_REVIEW_QUEUE, "id", queueId);
  if (!queued || queued.businessId !== business.id) return { ok: false, error: "not_found" };
  if (queued.status !== "pending_owner_review") return { ok: false, error: "not_pending" };

  const merged = { ...(queued.extracted || {}), ...(overrides || {}) };
  const phone = normalizePhoneE164(merged.customerPhone);
  if (!phone) return { ok: false, error: "invalid_phone" };
  const amount = Number(merged.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "invalid_amount" };
  const description = typeof merged.description === "string" ? merged.description.trim() : "";
  if (!description) return { ok: false, error: "missing_description" };
  const customerName = typeof merged.customerName === "string" && merged.customerName.trim() ? merged.customerName.trim() : "Customer";

  const created = await addEstimate(
    {
      customerName,
      customerPhone: phone,
      customerEmail: merged.customerEmail || null,
      amount,
      description,
    },
    business
  );
  await store.updateRecord(ESTIMATE_REVIEW_QUEUE, queueId, {
    status: "approved",
    approvedAt: new Date().toISOString(),
    estimateId: created.id,
  });
  return { ok: true, estimateId: created.id };
}

async function rejectQueuedEstimate(queueId, business, reason = "") {
  const queued = await store.findRecordByField(ESTIMATE_REVIEW_QUEUE, "id", queueId);
  if (!queued || queued.businessId !== business.id) return { ok: false, error: "not_found" };
  if (queued.status !== "pending_owner_review") return { ok: false, error: "not_pending" };
  await store.updateRecord(ESTIMATE_REVIEW_QUEUE, queueId, {
    status: "rejected",
    rejectedAt: new Date().toISOString(),
    rejectReason: reason || null,
  });
  return { ok: true };
}

async function listPendingQueue(businessId) {
  const all = await store.findRecordsByField(ESTIMATE_REVIEW_QUEUE, "businessId", businessId);
  return all.filter((q) => q.status === "pending_owner_review");
}

// Used by the owner's manual paste form. Same validation shape as the queued
// path — phone required, amount > 0, description non-empty.
async function createEstimateFromPaste(fields, business) {
  const phone = normalizePhoneE164(fields.customerPhone);
  if (!phone) return { ok: false, error: "invalid_phone" };
  const amount = Number(fields.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "invalid_amount" };
  const description = typeof fields.description === "string" ? fields.description.trim() : "";
  if (!description) return { ok: false, error: "missing_description" };
  const customerName = typeof fields.customerName === "string" && fields.customerName.trim() ? fields.customerName.trim() : "Customer";
  const customerEmail = typeof fields.customerEmail === "string" && fields.customerEmail.trim() ? fields.customerEmail.trim() : null;

  const created = await addEstimate(
    { customerName, customerPhone: phone, customerEmail, amount, description },
    business
  );
  return { ok: true, estimateId: created.id };
}

module.exports = {
  addEstimate,
  processFollowUps,
  handleEstimateReply,
  ingestEstimateEmail,
  approveQueuedEstimate,
  rejectQueuedEstimate,
  listPendingQueue,
  createEstimateFromPaste,
  PROCESSED_ESTIMATE_EMAILS,
  ESTIMATE_REVIEW_QUEUE,
};
