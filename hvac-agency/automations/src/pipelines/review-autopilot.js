const { chat, buildReviewResponsePrompt, extractReviewFromEmail } = require("../ai");
const { sendSMS } = require("../sms");
const store = require("../store");

const REVIEWS = "reviews";
const REVIEW_REQUESTS = "review_requests";
const PROCESSED_REVIEW_EMAILS = "processed_review_emails";

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

    if (business.ownerPhone) {
      const stars = "★".repeat(review.rating) + "☆".repeat(5 - review.rating);
      const preview = review.text ? review.text.slice(0, 100) + (review.text.length > 100 ? "…" : "") : "";
      const msg = `[ClimateFlow] ${stars} review needs your attention — ${review.authorName}: "${preview}" Reply suggested. Check your dashboard.`;
      sendSMS(business.ownerPhone, msg, business.twilioNumber)
        .catch((err) => console.error(`[Review Autopilot] Owner alert SMS failed:`, err.message));
    }

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

// Entry point for the Gmail ingest. Called once per email routed to
// `support+reviews-<businessId>@`. Extracts structured review fields via
// Claude, dedups on Gmail messageId, and hands off to the standard
// respondToReview pipeline. Low-confidence extractions are stored for manual
// owner review rather than auto-responded to — spam + misrouted emails don't
// warrant an AI-drafted reply.
async function ingestReviewEmail({ businessId, messageId, subject, body, fromHeader }) {
  const already = await store.findRecordByField(PROCESSED_REVIEW_EMAILS, "messageId", messageId);
  if (already) return { skipped: "already_processed" };

  const business = await store.findRecordByField("clients", "id", businessId);
  if (!business) {
    await store.addRecord(PROCESSED_REVIEW_EMAILS, { messageId, businessId, status: "no_business" });
    return { skipped: "no_business" };
  }
  if (business.suspended) {
    await store.addRecord(PROCESSED_REVIEW_EMAILS, { messageId, businessId, status: "suspended" });
    return { skipped: "suspended" };
  }

  let extracted;
  try {
    extracted = await extractReviewFromEmail({ subject, body });
  } catch (err) {
    console.error(`[Review Email] Extraction failed for ${messageId}: ${err.message}`);
    // Do not record as processed — the Gmail cron will leave it UNREAD and
    // retry on the next tick. Transient Anthropic errors shouldn't drop data.
    throw err;
  }

  if (extracted.confidence === "low") {
    await store.addRecord(REVIEWS, {
      businessId,
      authorName: extracted.authorName,
      rating: extracted.rating,
      text: extracted.reviewText,
      platform: "email",
      status: "pending_owner_approval",
      source: "email_low_confidence",
      emailSubject: subject || null,
      emailFrom: fromHeader || null,
      suggestedResponse: null,
    });
    await store.addRecord(PROCESSED_REVIEW_EMAILS, { messageId, businessId, status: "low_confidence" });
    console.log(`[Review Email] Low-confidence extraction for ${business.name} — flagged for owner approval`);
    return { action: "flagged_low_confidence" };
  }

  const result = await respondToReview(
    {
      authorName: extracted.authorName,
      rating: extracted.rating,
      text: extracted.reviewText,
      platform: "email",
    },
    business
  );
  await store.addRecord(PROCESSED_REVIEW_EMAILS, {
    messageId,
    businessId,
    status: "processed",
    rating: extracted.rating,
    action: result.action,
  });
  return { action: result.action, rating: extracted.rating };
}

module.exports = {
  requestReview,
  respondToReview,
  sendFollowUpReviewRequest,
  ingestReviewEmail,
  PROCESSED_REVIEW_EMAILS,
};
