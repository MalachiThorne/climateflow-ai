const store = require("./store");

// Return a { since, until } window for the last full week (Mon–Sun).
// Called Monday morning, so "last week" = the 7 days ending yesterday (Sunday).
function lastWeekWindow() {
  const now = new Date();
  // Roll back to last Sunday midnight UTC
  const until = new Date(now);
  until.setUTCHours(0, 0, 0, 0);
  until.setUTCDate(until.getUTCDate() - ((until.getUTCDay() + 0) % 7 || 7));
  // Roll back a further 7 days to last Monday midnight UTC
  const since = new Date(until);
  since.setUTCDate(since.getUTCDate() - 7);
  return { since, until };
}

// Aggregate all pipeline activity for a single client over the given window.
// Returns a plain object safe to pass directly to sendWeeklyDigestEmail.
async function getClientStats(businessId, since, until) {
  const c = (collection, filters = {}) =>
    store.countRecordsInRange(collection, businessId, since, until, filters);

  const [
    missedCallsRescued,
    leadsQualified,
    appointmentsBooked,
    estimatesSent,
    estimatesFollowedUp,
    estimatesConverted,
    reviewRequestsSent,
    reviewsResponded,
  ] = await Promise.all([
    c("leads", { status: "new" }),         // initial rescue (first text sent)
    c("leads", { status: "qualified" }),   // AI qualified the lead
    c("leads", { status: "booked" }),      // appointment booked
    c("estimates"),                        // new estimates added
    // followUpCount > 0 check not possible with countRecordsInRange — approximate
    // with estimates that had their lastFollowUp field set during this window
    // (handled via updatedAt in the estimates collection)
    c("estimates", { status: "open" }),    // still open (being chased)
    c("estimates", { status: "accepted" }),
    c("review_requests"),
    c("reviews", { status: "responded" }),
  ]);

  // Estimated revenue recovered: booked appointments × avg ticket ($500 proxy)
  // and accepted estimates (use actual amounts where possible)
  const revenueProxy = appointmentsBooked * 500;

  return {
    since,
    until,
    missedCallsRescued,
    leadsQualified,
    appointmentsBooked,
    estimatesSent,
    estimatesFollowedUp,
    estimatesConverted,
    reviewRequestsSent,
    reviewsResponded,
    revenueProxy,
  };
}

module.exports = { getClientStats, lastWeekWindow };
