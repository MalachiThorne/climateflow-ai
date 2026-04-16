// Feature labels — kept in sync with config.stripe.plans[*].features
const FEATURES = {
  LEAD_RESCUE: "Lead Rescue",
  REVIEW_AUTOPILOT: "Review Autopilot",
  ESTIMATE_FOLLOWUP: "Estimate Follow-Up",
};

const ALL_FEATURES = Object.values(FEATURES);

// Fail-closed: if a client has no planFeatures, they get nothing.
// `legacyAllFeatures: true` on a record explicitly opts it into the full bundle
// (used by the seeded demo client and admin-onboarded clients).
function hasFeature(business, feature) {
  if (!business) return false;
  if (business.legacyAllFeatures) return true;
  if (!Array.isArray(business.planFeatures)) return false;
  return business.planFeatures.includes(feature);
}

module.exports = { FEATURES, ALL_FEATURES, hasFeature };
