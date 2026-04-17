const { chat, chatWithTools, buildLeadQualificationPrompt } = require("../ai");
const { sendSMS, scrubAIReply } = require("../sms");
const { sendWithFallback } = require("../smsRetry");
const { getAvailableSlots, bookAppointment, isCalendarConnected } = require("../calendar");
const store = require("../store");
const aiQuota = require("../aiQuota");

const CONVERSATIONS = "lead_conversations";
const LEADS = "leads";
const MAX_TOOL_ITERATIONS = 5;
const MAX_HISTORY_MESSAGES = 20;
const MAX_BOOKING_DAYS_AHEAD = 90;
const URL_LIKE = /\bhttps?:\/\/|www\.|\.(com|net|org|io|co|app|gg|link|xyz|biz)\b/i;

// Validate tool inputs from the model before calling any stateful action. A prompt-
// injected customer could otherwise coax the model into booking with bogus data or
// smuggling URLs into the name/address fields.
function validateDate(dateStr) {
  if (typeof dateStr !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return "date must be in YYYY-MM-DD format";
  }
  const parsed = new Date(`${dateStr}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "date is not a valid calendar date";
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const maxDate = new Date(today);
  maxDate.setUTCDate(maxDate.getUTCDate() + MAX_BOOKING_DAYS_AHEAD);
  if (parsed < today) return "date is in the past";
  if (parsed > maxDate) return `date is more than ${MAX_BOOKING_DAYS_AHEAD} days ahead`;
  return null;
}

function validateTime(timeStr) {
  if (typeof timeStr !== "string" || !/^\d{1,2}:\d{2}$/.test(timeStr)) {
    return "time must be in HH:MM 24-hour format";
  }
  const [h, m] = timeStr.split(":").map(Number);
  if (h < 8 || h >= 18) return "time must be between 08:00 and 18:00";
  if (m < 0 || m >= 60) return "minutes out of range";
  return null;
}

function validateFreeText(value, fieldName, { min = 0, max = 300 }) {
  const str = typeof value === "string" ? value.trim() : "";
  if (str.length < min) return `${fieldName} is too short`;
  if (str.length > max) return `${fieldName} is too long`;
  if (URL_LIKE.test(str)) return `${fieldName} must not contain links`;
  return null;
}

async function handleMissedCall(callerPhone, business) {
  const systemPrompt = buildLeadQualificationPrompt(business);

  // Trusted source — the string below is server-authored, not user input.
  const initialMessage = await chat(
    systemPrompt,
    `A customer just called from ${callerPhone} and we missed the call. Send the first text message to them.`
  );

  // Persist lead FIRST so state survives an SMS provider outage. If the send fails,
  // smsRetry queues it and a cron drains the queue — the lead is not lost.
  const lead = await store.addRecord(LEADS, {
    phone: callerPhone,
    businessId: business.id,
    status: "new",
    source: "missed_call",
  });

  await sendWithFallback(
    callerPhone,
    scrubAIReply(initialMessage, business.twilioNumber),
    business.twilioNumber,
    `lead-rescue:initial:${lead.id}`
  );

  await store.addRecord(CONVERSATIONS, {
    leadId: lead.id,
    phone: callerPhone,
    businessId: business.id,
    messages: [{ role: "assistant", content: initialMessage, timestamp: new Date().toISOString() }],
  });

  console.log(`[Lead Rescue] Responded to missed call from ${callerPhone} for ${business.name}`);
  return lead;
}

async function processToolCalls(response, callerPhone, business) {
  const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");
  const textBlocks = response.content.filter((b) => b.type === "text");
  const toolResults = [];

  for (const toolCall of toolUseBlocks) {
    let result;

    if (toolCall.name === "check_availability") {
      const dateErr = validateDate(toolCall.input?.date);
      if (dateErr) {
        result = { error: `Invalid tool input: ${dateErr}. Ask the customer for their preferred date again.` };
      } else if (!(await isCalendarConnected(business.id))) {
        result = { error: "Calendar not connected. Tell the customer you'll confirm the time shortly and someone will call back to confirm." };
      } else {
        result = await getAvailableSlots(business.id, toolCall.input.date);
      }
    } else if (toolCall.name === "book_appointment") {
      const input = toolCall.input || {};
      const firstError =
        validateFreeText(input.customer_name, "customer_name", { min: 1, max: 100 }) ||
        validateDate(input.date) ||
        validateTime(input.time) ||
        validateFreeText(input.service_type, "service_type", { min: 1, max: 200 }) ||
        (input.address ? validateFreeText(input.address, "address", { min: 0, max: 300 }) : null);

      if (firstError) {
        result = { error: `Invalid tool input: ${firstError}. Ask the customer to clarify.` };
      } else if (!(await isCalendarConnected(business.id))) {
        result = { error: "Calendar not connected. Tell the customer the appointment request has been received and someone will call to confirm." };
      } else {
        result = await bookAppointment(business.id, {
          customerName: input.customer_name.trim(),
          customerPhone: callerPhone, // server-bound, never from AI
          date: input.date,
          time: input.time,
          serviceType: input.service_type.trim(),
          address: (input.address || "").trim(),
        });
        if (result.success) {
          const lead = await store.findRecordByFields(LEADS, { phone: callerPhone, businessId: business.id });
          if (lead) await store.updateRecord(LEADS, lead.id, {
            status: "booked",
            reviewDue: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            customerName: input.customer_name.trim(),
            serviceType: input.service_type.trim(),
            reviewRequested: false,
          });

          // Real-time alert to the owner if they provided a mobile number at signup.
          if (business.ownerPhone) {
            const alertMsg = `[ClimateFlow] Job booked! ${input.customer_name.trim()} — ${input.service_type.trim()} on ${input.date} at ${input.time}. Caller: ${callerPhone}`;
            sendSMS(business.ownerPhone, alertMsg, business.twilioNumber)
              .catch((err) => console.error(`[Lead Rescue] Owner alert SMS failed: ${err.message}`));
          }
        }
      }
    }

    toolResults.push({
      type: "tool_result",
      tool_use_id: toolCall.id,
      content: JSON.stringify(result),
    });
  }

  return { toolResults, textMessage: textBlocks.map((b) => b.text).join("\n") };
}

async function handleIncomingSMS(callerPhone, messageBody, business) {
  const conversation = await store.findRecordByFields(CONVERSATIONS, {
    phone: callerPhone,
    businessId: business.id,
  });

  if (!conversation) {
    return handleMissedCall(callerPhone, business);
  }

  conversation.messages.push({
    role: "user",
    content: messageBody,
    timestamp: new Date().toISOString(),
  });

  // Per-phone-per-day cap: prevents an adversary from burning unlimited model /
  // SMS spend on a single business via a prompt-injection or flood attack.
  const quota = await aiQuota.checkAndIncrement(callerPhone, business.id);
  if (!quota.allowed) {
    console.warn(`[Lead Rescue] AI quota exceeded for ${callerPhone} @ ${business.id} (${quota.count}/${quota.cap}) — sending fallback`);
    await store.updateRecord(CONVERSATIONS, conversation.id, { messages: conversation.messages });
    await sendWithFallback(callerPhone, aiQuota.QUOTA_FALLBACK_MESSAGE, business.twilioNumber, `lead-rescue:quota-fallback:${conversation.id}`);
    return aiQuota.QUOTA_FALLBACK_MESSAGE;
  }

  const systemPrompt = buildLeadQualificationPrompt(business);
  // Cap history to avoid token blowout on long conversations
  const history = conversation.messages
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    }));

  const calendarConnected = await isCalendarConnected(business.id);
  const useTools = calendarConnected ||
    /schedul|appoint|book|available|when can|time slot/i.test(messageBody);

  let finalText;

  if (useTools) {
    let response = await chatWithTools(systemPrompt, messageBody, history.slice(0, -1), { source: "customer" });
    let { toolResults, textMessage } = await processToolCalls(response, callerPhone, business);

    let iterations = 0;
    let loopExhausted = false;
    while (response.stop_reason === "tool_use" && toolResults.length > 0) {
      if (iterations >= MAX_TOOL_ITERATIONS) {
        loopExhausted = true;
        break;
      }
      iterations++;
      const continueMessages = [
        ...history,
        { role: "assistant", content: response.content },
        { role: "user", content: toolResults },
      ];

      // Pass source: "customer" so earlier user-role string turns (the original
      // customer SMS) get re-fenced. tool_result arrays are skipped by the fence
      // logic, so the tool protocol stays intact.
      response = await chatWithTools(systemPrompt, "", continueMessages, { source: "customer" });
      const next = await processToolCalls(response, callerPhone, business);
      toolResults = next.toolResults;
      textMessage = next.textMessage || textMessage;
    }

    if (loopExhausted) {
      // The model is stuck in a tool_use ping-pong (e.g. repeatedly querying slots
      // without committing to a booking, or confused by a prompt injection). Don't
      // send partial model output to the customer — it reads as incoherent and may
      // leak internal tool chatter. Bail to a human-handoff message and flag the
      // lead so the owner knows to call back.
      console.warn(`[Lead Rescue] Tool-use loop exhausted for ${callerPhone} @ ${business.id} — handing off to owner.`);
      finalText =
        "Thanks — I want to make sure we get this right. Someone from " +
        `${business.name} will give you a call back shortly.`;
      const lead = await store.findRecordByFields(LEADS, { phone: callerPhone, businessId: business.id });
      if (lead) {
        await store.updateRecord(LEADS, lead.id, {
          status: "needs_human_followup",
          handoffReason: "tool_loop_exhausted",
          handoffAt: new Date().toISOString(),
        });
      }
      if (business.ownerPhone) {
        const alertMsg = `[ClimateFlow] Lead needs a callback — ${callerPhone} got stuck in our booking flow. Check dashboard.`;
        sendSMS(business.ownerPhone, alertMsg, business.twilioNumber)
          .catch((err) => console.error(`[Lead Rescue] Handoff owner-alert SMS failed: ${err.message}`));
      }
    } else {
      finalText = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n") || textMessage;
    }
  } else {
    finalText = await chat(systemPrompt, messageBody, history.slice(0, -1), { source: "customer" });
  }

  conversation.messages.push({
    role: "assistant",
    content: finalText,
    timestamp: new Date().toISOString(),
  });

  await store.updateRecord(CONVERSATIONS, conversation.id, { messages: conversation.messages });
  await sendWithFallback(callerPhone, scrubAIReply(finalText, business.twilioNumber), business.twilioNumber, `lead-rescue:reply:${conversation.id}`);

  // Only qualify based on what the *customer* said, not the AI's own messages
  const userMessages = conversation.messages.filter((m) => m.role === "user");
  const isQualified =
    userMessages.length >= 2 &&
    userMessages.some((m) =>
      m.content.toLowerCase().includes("address") ||
      m.content.toLowerCase().includes("schedule") ||
      m.content.toLowerCase().includes("appointment")
    );

  if (isQualified) {
    const lead = await store.findRecordByFields(LEADS, { phone: callerPhone, businessId: business.id });
    if (lead && lead.status === "new") {
      await store.updateRecord(LEADS, lead.id, { status: "qualified" });
    }
  }

  console.log(`[Lead Rescue] Replied to ${callerPhone}: ${finalText.substring(0, 80)}...`);
  return finalText;
}

module.exports = { handleMissedCall, handleIncomingSMS };
