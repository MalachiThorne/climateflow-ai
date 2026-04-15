const express = require("express");
const cron = require("node-cron");
const config = require("./config");
const { getClientByPhone, listClients, createSampleClient } = require("./clients");
const { handleMissedCall, handleIncomingSMS } = require("./pipelines/lead-rescue");
const { requestReview, respondToReview } = require("./pipelines/review-autopilot");
const { addEstimate, processFollowUps, handleEstimateReply } = require("./pipelines/estimate-followup");
const store = require("./store");

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// --- LEAD RESCUE ---

// Twilio webhook: missed call (voice status callback)
app.post("/webhooks/voice/status", async (req, res) => {
  try {
    const { Called, From, CallStatus } = req.body;
    if (CallStatus === "no-answer" || CallStatus === "busy" || CallStatus === "failed") {
      const business = getClientByPhone(Called);
      if (business) {
        await handleMissedCall(From, business);
      }
    }
    res.sendStatus(200);
  } catch (err) {
    console.error("[Voice Status] Error:", err.message);
    res.sendStatus(500);
  }
});

// Twilio webhook: incoming SMS
app.post("/webhooks/sms", async (req, res) => {
  try {
    const { To, From, Body } = req.body;
    const business = getClientByPhone(To);
    if (!business) {
      console.warn(`[SMS] No business found for number ${To}`);
      res.sendStatus(404);
      return;
    }

    // Check if this is an estimate-related reply
    const estimateReply = await handleEstimateReply(From, Body, business);
    if (!estimateReply) {
      await handleIncomingSMS(From, Body, business);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("[SMS] Error:", err.message);
    res.sendStatus(500);
  }
});

// --- REVIEW AUTOPILOT ---

// Trigger review request after a job is completed
app.post("/api/review/request", async (req, res) => {
  try {
    const { customerPhone, customerName, jobType, businessId } = req.body;
    const business = store.findRecord("clients", (c) => c.id === businessId);
    if (!business) return res.status(404).json({ error: "Business not found" });

    await requestReview(customerPhone, customerName, jobType, business);
    res.json({ success: true });
  } catch (err) {
    console.error("[Review Request] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Process a new review (webhook from Google/Yelp monitoring service)
app.post("/api/review/incoming", async (req, res) => {
  try {
    const { authorName, rating, text, platform, businessId } = req.body;
    const business = store.findRecord("clients", (c) => c.id === businessId);
    if (!business) return res.status(404).json({ error: "Business not found" });

    const result = await respondToReview({ authorName, rating, text, platform }, business);
    res.json(result);
  } catch (err) {
    console.error("[Review Incoming] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- ESTIMATE FOLLOW-UP ---

// Add a new estimate to track
app.post("/api/estimate", async (req, res) => {
  try {
    const { customerName, customerPhone, amount, description, businessId } = req.body;
    const business = store.findRecord("clients", (c) => c.id === businessId);
    if (!business) return res.status(404).json({ error: "Business not found" });

    const entry = await addEstimate(
      { customerName, customerPhone, amount, description },
      business
    );
    res.json(entry);
  } catch (err) {
    console.error("[Add Estimate] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- DASHBOARD / REPORTING ---

app.get("/api/dashboard/:businessId", (req, res) => {
  const { businessId } = req.params;

  const leads = store.findRecords("leads", (l) => l.businessId === businessId);
  const estimates = store.findRecords("estimates", (e) => e.businessId === businessId);
  const reviews = store.findRecords("reviews", (r) => r.businessId === businessId);
  const reviewRequests = store.findRecords("review_requests", (r) => r.businessId === businessId);

  res.json({
    leads: {
      total: leads.length,
      new: leads.filter((l) => l.status === "new").length,
      qualified: leads.filter((l) => l.status === "qualified").length,
    },
    estimates: {
      total: estimates.length,
      open: estimates.filter((e) => e.status === "open").length,
      accepted: estimates.filter((e) => e.status === "accepted").length,
      declined: estimates.filter((e) => e.status === "declined").length,
      expired: estimates.filter((e) => e.status === "expired").length,
    },
    reviews: {
      responded: reviews.filter((r) => r.status === "responded").length,
      pendingApproval: reviews.filter((r) => r.status === "pending_owner_approval").length,
      requestsSent: reviewRequests.length,
    },
  });
});

// --- CRON JOBS ---

// Process estimate follow-ups every hour during business hours
cron.schedule("0 9-18 * * 1-6", async () => {
  console.log("[Cron] Processing estimate follow-ups...");
  const clients = listClients();
  for (const client of clients) {
    try {
      const results = await processFollowUps(client);
      if (results.length > 0) {
        console.log(`[Cron] Sent ${results.length} follow-ups for ${client.name}`);
      }
    } catch (err) {
      console.error(`[Cron] Error processing follow-ups for ${client.name}:`, err.message);
    }
  }
});

// --- STARTUP ---

createSampleClient();

app.listen(config.server.port, () => {
  console.log(`\n=== ClimateFlow AI Automation Server ===`);
  console.log(`Running on port ${config.server.port}`);
  console.log(`Webhooks: ${config.server.webhookBaseUrl}/webhooks/sms`);
  console.log(`Dashboard: http://localhost:${config.server.port}/api/dashboard/demo`);
  console.log(`========================================\n`);
});
