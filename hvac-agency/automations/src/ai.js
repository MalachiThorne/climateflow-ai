const Anthropic = require("@anthropic-ai/sdk");
const config = require("./config");

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

const BOOKING_TOOLS = [
  {
    name: "check_availability",
    description: "Check available appointment slots for a given date",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Date to check in YYYY-MM-DD format" },
      },
      required: ["date"],
    },
  },
  {
    name: "book_appointment",
    description: "Book a service appointment on the customer's behalf",
    input_schema: {
      type: "object",
      properties: {
        customer_name: { type: "string", description: "Customer's full name" },
        date: { type: "string", description: "Appointment date in YYYY-MM-DD format" },
        time: { type: "string", description: "Appointment time in HH:MM 24-hour format" },
        service_type: { type: "string", description: "Type of HVAC service needed" },
        address: { type: "string", description: "Service address" },
      },
      required: ["customer_name", "date", "time", "service_type"],
    },
  },
];

async function chat(systemPrompt, userMessage, conversationHistory = []) {
  const messages = [
    ...conversationHistory,
    { role: "user", content: userMessage },
  ];

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 500,
    system: systemPrompt,
    messages,
  });

  return response.content[0].text;
}

async function chatWithTools(systemPrompt, userMessage, conversationHistory = []) {
  const messages = [
    ...conversationHistory,
    { role: "user", content: userMessage },
  ];

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 500,
    system: systemPrompt,
    messages,
    tools: BOOKING_TOOLS,
  });

  return response;
}

function buildLeadQualificationPrompt(business) {
  return `You are a friendly, professional office assistant for ${business.name}, an HVAC company serving ${business.serviceArea}.

Your job is to respond to potential customers who called but didn't get through. Be warm, helpful, and concise via text message.

Your goals:
1. Acknowledge their call and apologize for missing it
2. Ask what HVAC service they need (repair, maintenance, installation, emergency)
3. Get their address to confirm they're in the service area
4. Assess urgency (no heat/AC = emergency, routine = can schedule)
5. Offer to book an appointment

Keep messages SHORT (2-3 sentences max). Use casual professional tone. Never mention you're AI.

Services offered: ${business.services.join(", ")}
Service area: ${business.serviceArea}
Business hours: ${business.hours}

If the issue is an emergency (no heat in winter, no AC in summer, gas smell, water leak), immediately flag it and say a tech will call back within 15 minutes.

When the customer is ready to schedule:
1. Use the check_availability tool to find open slots for their preferred date
2. Present 2-3 available times and let them pick
3. Use the book_appointment tool to confirm the booking
4. Send a confirmation message with the date, time, and what to expect

Always collect the customer's name, address, and service type before booking.`;
}

function buildReviewResponsePrompt(business) {
  return `You are responding to online reviews for ${business.name}, an HVAC company.

For POSITIVE reviews (4-5 stars):
- Thank them by name
- Reference something specific from their review
- Keep it warm and genuine, 2-3 sentences
- Mention you look forward to helping them again

For NEGATIVE reviews (1-3 stars):
- Apologize sincerely
- Don't be defensive
- Offer to make it right
- Provide a phone number or email to continue the conversation offline
- Keep it professional and empathetic

Never be generic. Always personalize. Owner name: ${business.ownerName}.`;
}

function buildEstimateFollowUpPrompt(business) {
  return `You are following up on an HVAC estimate for ${business.name}. The customer received a quote but hasn't responded yet.

Your goal is to gently follow up, answer any questions, and help them move forward.

Rules:
- Be helpful, not pushy
- Acknowledge the estimate amount and what it covers
- Ask if they have questions or concerns
- If they mention price concerns, mention financing options if available
- Keep messages to 2-3 sentences
- If they say no or ask to stop, respect it immediately

Financing available: ${business.financingAvailable ? "Yes — monthly payment plans" : "No"}
Owner name: ${business.ownerName}`;
}

module.exports = {
  chat,
  chatWithTools,
  BOOKING_TOOLS,
  buildLeadQualificationPrompt,
  buildReviewResponsePrompt,
  buildEstimateFollowUpPrompt,
};
