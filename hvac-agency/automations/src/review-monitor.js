const { google } = require("googleapis");
const store = require("./store");

async function fetchGoogleReviews(auth, accountId, locationId) {
  const mybusiness = google.mybusinessaccountmanagement({ version: "v1", auth });

  const { data } = await google.mybusinessbusinessinformation({ version: "v1", auth })
    .locations.get({ name: `locations/${locationId}`, readMask: "name" });

  const reviewsApi = google.mybusiness({ version: "v4", auth });
  const response = await reviewsApi.accounts.locations.reviews.list({
    parent: `accounts/${accountId}/locations/${locationId}`,
    pageSize: 50,
    orderBy: "updateTime desc",
  });

  return response.data.reviews || [];
}

async function checkForNewReviews(business, respondToReview) {
  if (!business.googleAccountId || !business.googleLocationId) return [];

  const tokenRecord = await store.findRecord("calendar_tokens", (t) => t.businessId === business.id);
  if (!tokenRecord) return [];

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials(tokenRecord.tokens);

  try {
    const reviews = await fetchGoogleReviews(
      oauth2Client,
      business.googleAccountId,
      business.googleLocationId
    );

    const processedIds = await store.findRecords("processed_reviews", (r) => r.businessId === business.id);
    const processedSet = new Set(processedIds.map((r) => r.reviewId));

    const newReviews = reviews.filter((r) => !processedSet.has(r.reviewId));
    const results = [];

    for (const review of newReviews) {
      const result = await respondToReview(
        {
          authorName: review.reviewer?.displayName || "Customer",
          rating: review.starRating === "FIVE" ? 5 : review.starRating === "FOUR" ? 4 :
            review.starRating === "THREE" ? 3 : review.starRating === "TWO" ? 2 : 1,
          text: review.comment || "",
          platform: "google",
        },
        business
      );

      await store.addRecord("processed_reviews", {
        reviewId: review.reviewId,
        businessId: business.id,
        platform: "google",
      });

      results.push(result);
    }

    return results;
  } catch (err) {
    console.error(`[Review Monitor] Error fetching reviews for ${business.name}:`, err.message);
    return [];
  }
}

module.exports = { checkForNewReviews };
