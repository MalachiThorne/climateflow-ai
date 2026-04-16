const { chat, chatWithTools, buildLeadQualificationPrompt } = require("../ai");
const { sendSMS } = require("../sms");
const { getAvailableSlots, bookAppointment, isCalendarConnected } = require("../calendar");
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

  const lead = await store.addRecord(LEADS, {
    phone: callerPhone,
    businessId: business.id,
    status: "new",
    source: "missed_call",
  });

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
      if (!(await isCalendarConnected(business.id))) {
        result = { error: "Calendar not connected. Tell the customer you'll confirm the time shortly and someone will call back to confirm." };
      } else {
        result = await getAvailableSlots(business.id, toolCall.input.date);
      }
    } else if (toolCall.name === "book_appointment") {
      if (!(await isCalendarConnected(business.id))) {
        result = { error: "Calendar not connected. Tell the customer the appointment request has been received and someone will call to confirm." };
      } else {
        result = await bookAppointment(business.id, {
          customerName: toolCall.input.customer_name,
          customerPhone: callerPhone,
          date: toolCall.input.date,
          time: toolCall.input.time,
          serviceType: toolCall.input.service_type,
          address: toolCall.input.address || "",
        });
        if (result.success) {
          const lead = await store.findRecord(LEADS, (l) => l.phone === callerPhone && l.businessId === business.id);
          if (lead) await store.updateRecord(LEADS, lead.id, { status: "booked" });
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
  const conversation = await store.findRecord(CONVERSATIONS, (c) => c.phone === callerPhone && c.businessId === business.id);

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

  const calendarConnected = await isCalendarConnected(business.id);
  const useTools = calendarConnected ||
    /schedul|appoint|book|available|when can|time slot/i.test(messageBody);

  let finalText;

  if (useTools) {
    let response = await chatWithTools(systemPrompt, messageBody, history.slice(0, -1));
    let { toolResults, textMessage } = await processToolCalls(response, callerPhone, business);

    while (response.stop_reason === "tool_use" && toolResults.length > 0) {
      const continueMessages = [
        ...history,
        { role: "assistant", content: response.content },
        { role: "user", content: toolResults },
      ];

      response = await chatWithTools(systemPrompt, "", continueMessages);
      const next = await processToolCalls(response, callerPhone, business);
      toolResults = next.toolResults;
      textMessage = next.textMessage || textMessage;
    }

    finalText = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n") || textMessage;
  } else {
    finalText = await chat(systemPrompt, messageBody, history.slice(0, -1));
  }

  conversation.messages.push({
    role: "assistant",
    content: finalText,
    timestamp: new Date().toISOString(),
  });

  await store.updateRecord(CONVERSATIONS, conversation.id, { messages: conversation.messages });
  await sendSMS(callerPhone, finalText);

  const isQualified =
    conversation.messages.length >= 4 &&
    conversation.messages.some((m) => m.content.toLowerCase().includes("address") || m.content.toLowerCase().includes("schedule") || m.content.toLowerCase().includes("appointment"));

  if (isQualified) {
    const lead = await store.findRecord(LEADS, (l) => l.phone === callerPhone && l.businessId === business.id);
    if (lead && lead.status === "new") {
      await store.updateRecord(LEADS, lead.id, { status: "qualified" });
    }
  }

  console.log(`[Lead Rescue] Replied to ${callerPhone}: ${finalText.substring(0, 80)}...`);
  return finalText;
}

module.exports = { handleMissedCall, handleIncomingSMS };
