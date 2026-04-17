const store = require("./store");

// Return a { since, until } window for the last full Mon–Sun week.
// "until" is the start of the most recent Monday (exclusive end — covers last Sunday).
// "since" is 7 days before that = start of the previous Monday.
// Safe to call any day of the week: always returns the last COMPLETE Mon–Sun week.
function lastWeekWindow() {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  // Roll back to most recent Monday (day 1). If today is Sunday (0), that's 6 days back.
  const dayOfWeek = now.getUTCDay();
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const until = new Date(now);
  until.setUTCDate(now.getUTCDate() - daysToMonday);
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

// Return { since, until } for the last full calendar month.
// Called on the 1st of the month, so "last month" = the previous calendar month.
function lastMonthWindow() {
  const now = new Date();
  const until = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return { since, until };
}

// Aggregate review reputation stats for the given month window.
async function getMonthlyReputationStats(businessId, since, until) {
  const allReviews = await store.findRecordsByField("reviews", "businessId", businessId);
  const inWindow = allReviews.filter((r) => {
    const created = new Date(r.createdAt);
    return created >= since && created < until;
  });

  const total = inWindow.length;
  const avgRating = total > 0
    ? Math.round((inWindow.reduce((sum, r) => sum + (r.rating || 0), 0) / total) * 10) / 10
    : null;
  const byRating = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of inWindow) {
    const star = Math.round(r.rating);
    if (star >= 1 && star <= 5) byRating[star]++;
  }
  const autoResponded = inWindow.filter((r) => r.status === "responded").length;
  const flaggedForApproval = inWindow.filter((r) => r.status === "pending_owner_approval").length;
  const requestsSent = await store.countRecordsInRange("review_requests", businessId, since, until);

  return { since, until, total, avgRating, byRating, autoResponded, flaggedForApproval, requestsSent };
}

module.exports = { getClientStats, lastWeekWindow, lastMonthWindow, getMonthlyReputationStats };
