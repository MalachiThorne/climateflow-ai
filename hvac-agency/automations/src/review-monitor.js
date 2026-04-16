const { google } = require("googleapis");
const store = require("./store");
const { decryptTokens } = require("./tokenCrypto");

// Fetches recent reviews via the Business Profile Reviews API (v1)
async function fetchGoogleReviews(auth, locationId) {
  const reviewsApi = google.mybusinessreviews({ version: "v1", auth });
  const response = await reviewsApi.locations.reviews.list({
    parent: `locations/${locationId}`,
    pageSize: 50,
    orderBy: "updateTime desc",
  });
  return response.data.reviews || [];
}

async function checkForNewReviews(business, respondToReview) {
  if (!business.googleLocationId) return [];

  const tokenRecord = await store.findRecordByField("calendar_tokens", "businessId", business.id);
  if (!tokenRecord) return [];

  const plainTokens = decryptTokens(tokenRecord.tokens);
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials(plainTokens);

  try {
    const reviews = await fetchGoogleReviews(oauth2Client, business.googleLocationId);

    const processedRecords = await store.findRecordsByField("processed_reviews", "businessId", business.id);
    const processedSet = new Set(processedRecords.map((r) => r.reviewId));

    const newReviews = reviews.filter((r) => !processedSet.has(r.name));
    const results = [];

    for (const review of newReviews) {
      const starMap = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
      const result = await respondToReview(
        {
          authorName: review.reviewer?.displayName || "Customer",
          rating: starMap[review.starRating] || 3,
          text: review.comment || "",
          platform: "google",
        },
        business
      );

      await store.addRecord("processed_reviews", {
        reviewId: review.name,
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
