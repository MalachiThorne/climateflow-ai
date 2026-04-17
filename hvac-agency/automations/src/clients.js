const { randomBytes } = require("crypto");
const store = require("./store");

const CLIENTS = "clients";

function generateOnboardingTokenNonce() {
  return randomBytes(16).toString("hex");
}

async function getClient(businessId) {
  return store.findRecordByField(CLIENTS, "id", businessId);
}

async function getClientByPhone(twilioNumber) {
  return store.findRecordByField(CLIENTS, "twilioNumber", twilioNumber);
}

async function addClient(client) {
  const withNonce = {
    ...client,
    onboardingTokenNonce: client.onboardingTokenNonce || generateOnboardingTokenNonce(),
  };
  return store.addRecord(CLIENTS, withNonce);
}

// Rotate the onboarding-token nonce. Every outstanding signed URL that was
// bound to the prior nonce is invalidated on the next request. Returns the
// new nonce so the caller can mint a fresh link in the same transaction.
async function rotateOnboardingTokenNonce(businessId) {
  const nonce = generateOnboardingTokenNonce();
  const updated = await store.updateRecord(CLIENTS, businessId, {
    onboardingTokenNonce: nonce,
    onboardingTokenRotatedAt: new Date().toISOString(),
  });
  if (!updated) return null;
  return nonce;
}

async function listClients() {
  return store.readCollection(CLIENTS);
}

async function createSampleClient() {
  const existing = await store.findRecordByField(CLIENTS, "id", "demo");
  if (existing) return existing;

  return addClient({
    id: "demo",
    name: "Portland Comfort HVAC",
    ownerName: "Mike Johnson",
    serviceArea: "Portland, OR metro area",
    services: [
      "AC repair & installation",
      "Furnace repair & installation",
      "Heat pump service",
      "Ductwork",
      "Maintenance plans",
    ],
    hours: "Mon-Fri 8am-6pm, Emergency service 24/7",
    twilioNumber: "+19712659340",
    googleReviewLink: "https://g.page/r/portland-comfort-hvac/review",
    financingAvailable: true,
    legacyAllFeatures: true,
    pricing: [
      "Diagnostic / service call: $99 (waived if you book the repair)",
      "AC repair: typically $200-$800 depending on parts",
      "Furnace repair: typically $250-$900",
      "Full AC install: $5,500-$9,500",
      "Full furnace install: $4,500-$8,500",
      "Heat pump install: $9,000-$16,000",
      "Annual maintenance plan: $189/year (both systems)",
    ].join("\n"),
  });
}

module.exports = {
  getClient,
  getClientByPhone,
  addClient,
  listClients,
  createSampleClient,
  rotateOnboardingTokenNonce,
};
