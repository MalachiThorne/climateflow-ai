const { chat, buildLeadQualificationPrompt } = require("../ai");
const { sendSMS } = require("../sms");
const store = require("../store");

const CONVERSATIONS = "lead_conversations";
const LEADS = "leads";

async function handleMissedCall(callerPhone, business) {
  const systemPrompt = buildLeadQualificationPrompt(business);

  const initialMessage = await chat(
    systemPrompt,
    `A customer just called from ${callerPhone} and we missed the call. Send the first text message to them.`
  );

  await sendSMS(callerPhone, initialMessage);

  const lead = store.addRecord(LEADS, {
    phone: callerPhone,
    businessId: business.id,
    status: "new",
    source: "missed_call",
  });

  store.addRecord(CONVERSATIONS, {
    leadId: lead.id,
    phone: callerPhone,
    businessId: business.id,
    messages: [{ role: "assistant", content: initialMessage, timestamp: new Date().toISOString() }],
  });

  console.log(`[Lead Rescue] Responded to missed call from ${callerPhone} for ${business.name}`);
  return lead;
}

async function handleIncomingSMS(callerPhone, messageBody, business) {
  const conversation = store.findRecord(CONVERSATIONS, (c) => c.phone === callerPhone && c.businessId === business.id);

  if (!conversation) {
    return handleMissedCall(callerPhone, business);
  }

  conversation.messages.push({
    role: "user",
    content: messageBody,
    timestamp: new Date().toISOString(),
  });

  const systemPrompt = buildLeadQualificationPrompt(business);
  const history = conversation.messages.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }));

  const response = await chat(systemPrompt, messageBody, history.slice(0, -1));

  conversation.messages.push({
    role: "assistant",
    content: response,
    timestamp: new Date().toISOString(),
  });

  store.updateRecord(CONVERSATIONS, conversation.id, { messages: conversation.messages });
  await sendSMS(callerPhone, response);

  const isQualified =
    conversation.messages.length >= 4 &&
    conversation.messages.some((m) => m.content.toLowerCase().includes("address") || m.content.toLowerCase().includes("schedule") || m.content.toLowerCase().includes("appointment"));

  if (isQualified) {
    store.updateRecord(LEADS, conversation.leadId, { status: "qualified" });
  }

  console.log(`[Lead Rescue] Replied to ${callerPhone}: ${response.substring(0, 80)}...`);
  return response;
}

module.exports = { handleMissedCall, handleIncomingSMS };
