const store = require("./store");

const AI_USAGE = "ai_usage";
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAILY_CAP = 20;

// Caps how many AI-generated replies a single phone can burn for a single business
// per calendar day (UTC). Defends against prompt-injection / looping / adversarial
// customers driving up Anthropic + Twilio spend. A miss is cheap; each call is one
// atomic upsert.
//
// Returns { allowed, count, cap }. When `allowed` is false, caller should send a
// static fallback SMS instead of invoking the model.
async function checkAndIncrement(phone, businessId, cap = DEFAULT_DAILY_CAP) {
  if (!phone || !businessId) return { allowed: true, count: 0, cap };
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const id = `${businessId}:${phone}:${day}`;
  const record = await store.incrementCounter(AI_USAGE, id, {
    phone,
    businessId,
    day,
    expiresAt: Date.now() + 2 * DAY_MS, // swept by the hourly cleanup cron
  });
  const count = record.count || 0;
  return { allowed: count <= cap, count, cap };
}

const QUOTA_FALLBACK_MESSAGE =
  "Thanks for reaching out! A team member will follow up with you directly shortly.";

module.exports = { checkAndIncrement, QUOTA_FALLBACK_MESSAGE };
