const { chat, buildReviewResponsePrompt } = require("../ai");
const { sendSMS } = require("../sms");
const store = require("../store");

const REVIEWS = "reviews";
const REVIEW_REQUESTS = "review_requests";

async function requestReview(customerPhone, customerName, jobType, business) {
  const message =
    `Hi ${customerName}! Thank you for choosing ${business.name} for your ${jobType} today. ` +
    `We'd really appreciate it if you could leave us a quick review — it helps other homeowners find reliable HVAC service. ` +
    `Here's the link: ${business.googleReviewLink}\n\nThank you! — ${business.ownerName}`;

  await sendSMS(customerPhone, message, business.twilioNumber);

  await store.addRecord(REVIEW_REQUESTS, {
    phone: customerPhone,
    customerName,
    jobType,
    businessId: business.id,
    status: "sent",
  });

  console.log(`[Review Autopilot] Sent review request to ${customerName} (${customerPhone})`);
}

async function respondToReview(review, business) {
  const systemPrompt = buildReviewResponsePrompt(business);

  // Review text is attacker-controlled. Pass source: "review" so chat() fences
  // the entire user turn and warns the model not to treat contents as instructions.
  // The rest of the string is server-built metadata, which the fence wraps along
  // with the text — acceptable since the warning still applies to the whole block.
  const userMessage =
    `Review from ${review.authorName} (${review.rating} stars):\n"${review.text}"\n\n` +
    `Write a response from the business owner.`;

  if (review.rating <= 3) {
    const stored = await store.addRecord(REVIEWS, {
      ...review,
      businessId: business.id,
      status: "pending_owner_approval",
      suggestedResponse: null,
    });

    const suggestedResponse = await chat(systemPrompt, userMessage, [], { source: "review" });

    await store.updateRecord(REVIEWS, stored.id, { suggestedResponse });

    console.log(`[Review Autopilot] Negative review from ${review.authorName} — flagged for owner approval`);
    return { action: "flagged", suggestedResponse };
  }

  const response = await chat(systemPrompt, userMessage, [], { source: "review" });

  await store.addRecord(REVIEWS, {
    ...review,
    businessId: business.id,
    status: "responded",
    response,
  });

  console.log(`[Review Autopilot] Auto-responded to ${review.rating}-star review from ${review.authorName}`);
  return { action: "responded", response };
}

async function sendFollowUpReviewRequest(customerPhone, customerName, business) {
  const existing = await store.findRecordByFields(REVIEW_REQUESTS, {
    phone: customerPhone,
    businessId: business.id,
  });

  if (!existing || existing.status !== "sent") return;

  const message =
    `Hi ${customerName}, just a quick follow-up from ${business.name}. ` +
    `If you have 30 seconds, we'd love to hear how your service went: ${business.googleReviewLink}\n` +
    `No worries if not — thanks again for choosing us!`;

  await sendSMS(customerPhone, message, business.twilioNumber);
  await store.updateRecord(REVIEW_REQUESTS, existing.id, { status: "follow_up_sent" });

  console.log(`[Review Autopilot] Follow-up review request sent to ${customerName}`);
}

module.exports = { requestReview, respondToReview, sendFollowUpReviewRequest };
