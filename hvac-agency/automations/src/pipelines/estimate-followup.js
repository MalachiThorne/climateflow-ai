const { chat, buildEstimateFollowUpPrompt } = require("../ai");
const { sendSMS, scrubAIReply } = require("../sms");
const { sendEstimateFollowUpEmail, sendEstimateAcceptedEmail } = require("../email");
const store = require("../store");
const aiQuota = require("../aiQuota");

const ESTIMATES = "estimates";
const ESTIMATE_CONVERSATIONS = "estimate_conversations";
const MAX_HISTORY_MESSAGES = 20;

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

    await sendSMS(estimate.customerPhone, scrubAIReply(response, business.twilioNumber), business.twilioNumber);

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
    const nextFollowUp = nextSchedule
      ? new Date(Date.now() + nextSchedule.daysAfter * 24 * 60 * 60 * 1000).toISOString()
      : null;

    await store.updateRecord(ESTIMATES, estimate.id, {
      followUpCount: nextIdx,
      nextFollowUp,
      lastFollowUp: now.toISOString(),
    });

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

  await sendSMS(phone, scrubAIReply(response, business.twilioNumber), business.twilioNumber);

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
    await store.updateRecord(ESTIMATES, estimate.id, { status: "accepted" });
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

module.exports = { addEstimate, processFollowUps, handleEstimateReply };
