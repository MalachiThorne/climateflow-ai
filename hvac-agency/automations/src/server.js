const express = require("express");
const cron = require("node-cron");
const config = require("./config");
const { getClientByPhone, listClients, createSampleClient } = require("./clients");
const { handleMissedCall, handleIncomingSMS } = require("./pipelines/lead-rescue");
const { requestReview, respondToReview } = require("./pipelines/review-autopilot");
const { addEstimate, processFollowUps, handleEstimateReply } = require("./pipelines/estimate-followup");
const { checkForNewReviews } = require("./review-monitor");
const { getAuthUrl, handleOAuthCallback, getAvailableSlots, bookAppointment, isCalendarConnected } = require("./calendar");
const { provisionPhoneNumber } = require("./sms");
const { addClient } = require("./clients");
const store = require("./store");

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// --- LEAD RESCUE ---

app.post("/webhooks/voice/status", async (req, res) => {
  try {
    const { Called, From, CallStatus } = req.body;
    if (CallStatus === "no-answer" || CallStatus === "busy" || CallStatus === "failed") {
      const business = await getClientByPhone(Called);
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

app.post("/webhooks/sms", async (req, res) => {
  try {
    const { To, From, Body } = req.body;
    const business = await getClientByPhone(To);
    if (!business) {
      console.warn(`[SMS] No business found for number ${To}`);
      res.sendStatus(404);
      return;
    }

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

app.post("/api/review/request", async (req, res) => {
  try {
    const { customerPhone, customerName, jobType, businessId } = req.body;
    const business = await store.findRecord("clients", (c) => c.id === businessId);
    if (!business) return res.status(404).json({ error: "Business not found" });

    await requestReview(customerPhone, customerName, jobType, business);
    res.json({ success: true });
  } catch (err) {
    console.error("[Review Request] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/review/incoming", async (req, res) => {
  try {
    const { authorName, rating, text, platform, businessId } = req.body;
    const business = await store.findRecord("clients", (c) => c.id === businessId);
    if (!business) return res.status(404).json({ error: "Business not found" });

    const result = await respondToReview({ authorName, rating, text, platform }, business);
    res.json(result);
  } catch (err) {
    console.error("[Review Incoming] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- ESTIMATE FOLLOW-UP ---

app.post("/api/estimate", async (req, res) => {
  try {
    const { customerName, customerPhone, amount, description, businessId } = req.body;
    const business = await store.findRecord("clients", (c) => c.id === businessId);
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

// --- CLIENT ONBOARDING ---

app.post("/api/onboard", async (req, res) => {
  try {
    const {
      businessName, ownerName, serviceArea, services, hours,
      googleReviewLink, financingAvailable, areaCode,
    } = req.body;

    if (!businessName || !ownerName || !serviceArea) {
      return res.status(400).json({ error: "businessName, ownerName, and serviceArea are required" });
    }

    const phone = await provisionPhoneNumber(areaCode || "503");

    const client = await addClient({
      name: businessName,
      ownerName,
      serviceArea,
      services: services || ["AC repair", "Furnace repair", "Heat pump service", "Maintenance plans"],
      hours: hours || "Mon-Fri 8am-6pm, Emergency service 24/7",
      twilioNumber: phone.phoneNumber,
      twilioSid: phone.sid,
      googleReviewLink: googleReviewLink || "",
      financingAvailable: financingAvailable || false,
    });

    const calendarConnectUrl = `${config.server.webhookBaseUrl}/api/calendar/connect/${client.id}`;

    console.log(`[Onboard] New client: ${businessName} — ${phone.phoneNumber}`);

    res.json({
      success: true,
      client: {
        id: client.id,
        name: client.name,
        phoneNumber: phone.phoneNumber,
      },
      nextSteps: {
        calendarConnect: calendarConnectUrl,
        webhooksSms: `${config.server.webhookBaseUrl}/webhooks/sms`,
        dashboard: `${config.server.webhookBaseUrl}/api/dashboard/${client.id}`,
      },
    });
  } catch (err) {
    console.error("[Onboard] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/clients", async (req, res) => {
  try {
    const clients = await store.readCollection("clients");
    res.json(clients.map((c) => ({
      id: c.id,
      name: c.name,
      ownerName: c.ownerName,
      phoneNumber: c.twilioNumber,
      serviceArea: c.serviceArea,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- CALENDAR INTEGRATION ---

app.get("/api/calendar/connect/:businessId", (req, res) => {
  const url = getAuthUrl(req.params.businessId);
  res.redirect(url);
});

app.get("/api/calendar/callback", async (req, res) => {
  try {
    const { code, state: businessId } = req.query;
    if (!code || !businessId) return res.status(400).send("Missing code or business ID");

    await handleOAuthCallback(code, businessId);
    res.send(`<h1>Calendar Connected!</h1><p>Google Calendar is now linked for your business. You can close this window.</p>`);
  } catch (err) {
    console.error("[Calendar OAuth] Error:", err.message);
    res.status(500).send("Failed to connect calendar. Please try again.");
  }
});

app.get("/api/calendar/status/:businessId", async (req, res) => {
  res.json({ connected: await isCalendarConnected(req.params.businessId) });
});

app.get("/api/calendar/availability/:businessId", async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: "Date parameter required (YYYY-MM-DD)" });

    const result = await getAvailableSlots(req.params.businessId, date);
    res.json(result);
  } catch (err) {
    console.error("[Calendar Availability] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/calendar/book", async (req, res) => {
  try {
    const { businessId, customerName, customerPhone, date, time, serviceType, address } = req.body;
    const result = await bookAppointment(businessId, { customerName, customerPhone, date, time, serviceType, address });
    res.json(result);
  } catch (err) {
    console.error("[Calendar Book] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- DASHBOARD / REPORTING ---

app.get("/api/dashboard/:businessId", async (req, res) => {
  try {
    const { businessId } = req.params;

    const [leads, estimates, reviews, reviewRequests, bookings] = await Promise.all([
      store.findRecords("leads", (l) => l.businessId === businessId),
      store.findRecords("estimates", (e) => e.businessId === businessId),
      store.findRecords("reviews", (r) => r.businessId === businessId),
      store.findRecords("review_requests", (r) => r.businessId === businessId),
      store.findRecords("bookings", (b) => b.businessId === businessId),
    ]);

    res.json({
      leads: {
        total: leads.length,
        new: leads.filter((l) => l.status === "new").length,
        qualified: leads.filter((l) => l.status === "qualified").length,
        booked: leads.filter((l) => l.status === "booked").length,
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
      bookings: {
        total: bookings.length,
        confirmed: bookings.filter((b) => b.status === "confirmed").length,
      },
      calendar: {
        connected: await isCalendarConnected(businessId),
      },
    });
  } catch (err) {
    console.error("[Dashboard] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- CRON JOBS ---

cron.schedule("0 9-18 * * 1-6", async () => {
  console.log("[Cron] Processing estimate follow-ups...");
  const clients = await listClients();
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

// Check for new Google reviews every 30 minutes
cron.schedule("*/30 * * * *", async () => {
  console.log("[Cron] Checking for new reviews...");
  const clients = await listClients();
  for (const client of clients) {
    try {
      const results = await checkForNewReviews(client, respondToReview);
      if (results.length > 0) {
        console.log(`[Cron] Processed ${results.length} new reviews for ${client.name}`);
      }
    } catch (err) {
      console.error(`[Cron] Error checking reviews for ${client.name}:`, err.message);
    }
  }
});

// --- STARTUP ---

async function start() {
  await store.init();
  await createSampleClient();

  app.listen(config.server.port, () => {
    console.log(`\n=== ClimateFlow AI Automation Server ===`);
    console.log(`Running on port ${config.server.port}`);
    console.log(`Webhooks: ${config.server.webhookBaseUrl}/webhooks/sms`);
    console.log(`Dashboard: http://localhost:${config.server.port}/api/dashboard/demo`);
    console.log(`========================================\n`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
