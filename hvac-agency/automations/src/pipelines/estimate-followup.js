const { chat, buildEstimateFollowUpPrompt } = require("../ai");
const { sendSMS } = require("../sms");
const store = require("../store");

const ESTIMATES = "estimates";
const ESTIMATE_CONVERSATIONS = "estimate_conversations";

const FOLLOW_UP_SCHEDULE = [
  { daysAfter: 1, type: "initial" },
  { daysAfter: 3, type: "check_in" },
  { daysAfter: 7, type: "final" },
];

async function addEstimate(estimate, business) {
  const entry = await store.addRecord(ESTIMATES, {
    customerName: estimate.customerName,
    customerPhone: estimate.customerPhone,
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
  const openEstimates = await store.findRecords(
    ESTIMATES,
    (e) => e.businessId === business.id && e.status === "open" && new Date(e.nextFollowUp) <= now
  );

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

    const existingConvo = await store.findRecord(
      ESTIMATE_CONVERSATIONS,
      (c) => c.estimateId === estimate.id
    );
    const history = existingConvo ? existingConvo.messages : [];

    const response = await chat(
      systemPrompt,
      context,
      history.map((m) => ({ role: m.role, content: m.content }))
    );

    await sendSMS(estimate.customerPhone, response);

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
  const estimate = await store.findRecord(
    ESTIMATES,
    (e) => e.customerPhone === phone && e.businessId === business.id && e.status === "open"
  );

  if (!estimate) return null;

  const conversation = await store.findRecord(
    ESTIMATE_CONVERSATIONS,
    (c) => c.estimateId === estimate.id
  );

  const history = conversation ? conversation.messages : [];
  history.push({ role: "user", content: messageBody, timestamp: new Date().toISOString() });

  const systemPrompt = buildEstimateFollowUpPrompt(business);
  const response = await chat(
    systemPrompt,
    messageBody,
    history.slice(0, -1).map((m) => ({ role: m.role, content: m.content }))
  );

  history.push({ role: "assistant", content: response, timestamp: new Date().toISOString() });

  if (conversation) {
    await store.updateRecord(ESTIMATE_CONVERSATIONS, conversation.id, { messages: history });
  }

  await sendSMS(phone, response);

  const accepted = messageBody.toLowerCase().match(/yes|accept|go ahead|let's do it|book it|schedule/);
  const declined = messageBody.toLowerCase().match(/no thanks|not interested|stop|cancel|too expensive/);

  if (accepted) {
    await store.updateRecord(ESTIMATES, estimate.id, { status: "accepted" });
    console.log(`[Estimate Follow-Up] ${estimate.customerName} ACCEPTED estimate!`);
  } else if (declined) {
    await store.updateRecord(ESTIMATES, estimate.id, { status: "declined" });
    console.log(`[Estimate Follow-Up] ${estimate.customerName} declined estimate`);
  }

  return response;
}

module.exports = { addEstimate, processFollowUps, handleEstimateReply };
