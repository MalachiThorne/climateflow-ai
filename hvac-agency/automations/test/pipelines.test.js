// Unit tests for pipeline data-model changes introduced when closing landing-page gaps:
//
//  1. estimate-followup: acceptedAt is written alongside status:"accepted"
//  2. lead-rescue: reviewDue / customerName / serviceType / reviewRequested:false
//     are written when bookAppointment succeeds
//
// Strategy: stub only the I/O boundary (store + sms + calendar + ai) with
// mutable-state wrappers. Modules that destructure their imports at load time
// (e.g. `const { chatWithTools } = require("../ai")`) call through to the
// wrapper, which reads from a shared `stubs` object we can swap per-test.

process.env.NODE_ENV = "test";
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "sk-ant-dummy";
process.env.TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "ACdummy";
process.env.TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "dummy";
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_dummy";

const test = require("node:test");
const assert = require("node:assert/strict");

// ---------------------------------------------------------------------------
// Minimal in-memory store fake
// ---------------------------------------------------------------------------
const records = new Map(); // `${collection}:${id}` -> data
let nextId = 1;

function clearRecords() {
  records.clear();
  nextId = 1;
}

const storeFake = {
  async addRecord(collection, data) {
    const id = String(nextId++);
    const entry = { ...data, id, createdAt: new Date().toISOString() };
    records.set(`${collection}:${id}`, entry);
    return entry;
  },
  async updateRecord(collection, id, patch) {
    const key = `${collection}:${id}`;
    const existing = records.get(key);
    if (!existing) throw new Error(`Record not found: ${key}`);
    const updated = { ...existing, ...patch };
    records.set(key, updated);
    return updated;
  },
  async findRecordByFields(collection, fieldValues) {
    for (const [key, data] of records) {
      if (!key.startsWith(collection + ":")) continue;
      if (Object.entries(fieldValues).every(([k, v]) => data[k] == v)) return data;
    }
    return null;
  },
  async findRecordsByFields(collection, fieldValues) {
    const results = [];
    for (const [key, data] of records) {
      if (!key.startsWith(collection + ":")) continue;
      if (Object.entries(fieldValues).every(([k, v]) => data[k] == v)) results.push(data);
    }
    return results;
  },
  async findRecordByField(collection, field, value) {
    for (const [key, data] of records) {
      if (!key.startsWith(collection + ":")) continue;
      if (data[field] == value) return data;
    }
    return null;
  },
};

// ---------------------------------------------------------------------------
// Mutable stub state — wrappers delegate to these so patching stubs.* between
// tests is picked up even though modules destructure their imports at load time.
// ---------------------------------------------------------------------------
const stubs = {
  chat: async () => "Sounds good, looking forward to it!",
  chatWithTools: async () => ({
    stop_reason: "end_turn",
    content: [{ type: "text", text: "I can help with that." }],
  }),
  isCalendarConnected: async () => false,
  bookAppointment: async () => ({ success: false }),
};

// Patch require cache BEFORE any pipeline requires
require.cache[require.resolve("../src/store")] = {
  id: require.resolve("../src/store"),
  filename: require.resolve("../src/store"),
  loaded: true,
  exports: storeFake,
};

require.cache[require.resolve("../src/aiQuota")] = {
  id: require.resolve("../src/aiQuota"),
  filename: require.resolve("../src/aiQuota"),
  loaded: true,
  exports: {
    checkAndIncrement: async () => ({ allowed: true, count: 1, cap: 50 }),
    QUOTA_FALLBACK_MESSAGE: "Please call us to continue.",
  },
};

require.cache[require.resolve("../src/sms")] = {
  id: require.resolve("../src/sms"),
  filename: require.resolve("../src/sms"),
  loaded: true,
  exports: {
    sendSMS: async () => {},
    scrubAIReply: (text) => text,
  },
};

require.cache[require.resolve("../src/email")] = {
  id: require.resolve("../src/email"),
  filename: require.resolve("../src/email"),
  loaded: true,
  exports: {
    sendEstimateFollowUpEmail: async () => {},
    sendEstimateAcceptedEmail: async () => {},
  },
};

// Wrappers: always call through to the current stubs.* implementation.
require.cache[require.resolve("../src/ai")] = {
  id: require.resolve("../src/ai"),
  filename: require.resolve("../src/ai"),
  loaded: true,
  exports: {
    chat: (...args) => stubs.chat(...args),
    chatWithTools: (...args) => stubs.chatWithTools(...args),
    buildLeadQualificationPrompt: () => "You are a helpful assistant.",
    buildEstimateFollowUpPrompt: () => "You are a helpful assistant.",
  },
};

require.cache[require.resolve("../src/calendar")] = {
  id: require.resolve("../src/calendar"),
  filename: require.resolve("../src/calendar"),
  loaded: true,
  exports: {
    isCalendarConnected: (...args) => stubs.isCalendarConnected(...args),
    getAvailableSlots: async () => ({ slots: ["09:00", "11:00", "14:00"] }),
    bookAppointment: (...args) => stubs.bookAppointment(...args),
  },
};

// Load pipelines after stubs are in place
const { handleEstimateReply } = require("../src/pipelines/estimate-followup");
const { handleIncomingSMS } = require("../src/pipelines/lead-rescue");

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------
const fakeBusiness = {
  id: "biz_1",
  name: "Portland HVAC",
  ownerName: "Mike",
  ownerEmail: "mike@example.com",
  ownerPhone: null,
  twilioNumber: "+15550009999",
};

async function seedEstimate(overrides = {}) {
  clearRecords();
  return storeFake.addRecord("estimates", {
    customerName: "Jane Smith",
    customerPhone: "+15550001111",
    customerEmail: null,
    amount: 1200,
    description: "Furnace replacement",
    businessId: "biz_1",
    status: "open",
    followUpCount: 0,
    nextFollowUp: new Date(Date.now() - 1000).toISOString(),
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// acceptedAt tests
// ---------------------------------------------------------------------------

test("handleEstimateReply writes acceptedAt when customer accepts", async () => {
  const estimate = await seedEstimate();
  await handleEstimateReply("+15550001111", "yes", fakeBusiness);

  const updated = records.get(`estimates:${estimate.id}`);
  assert.ok(updated, "estimate record should exist");
  assert.equal(updated.status, "accepted");
  assert.ok(updated.acceptedAt, "acceptedAt should be set");

  const parsed = new Date(updated.acceptedAt);
  assert.ok(!isNaN(parsed.getTime()), "acceptedAt must be a valid ISO date");
  assert.ok(Date.now() - parsed.getTime() < 5000, "acceptedAt should be recent");
});

test("handleEstimateReply does NOT write acceptedAt when customer declines", async () => {
  await seedEstimate();
  await handleEstimateReply("+15550001111", "no thanks", fakeBusiness);

  const updated = [...records.values()].find((r) => r.customerPhone === "+15550001111");
  assert.equal(updated.status, "declined");
  assert.ok(!updated.acceptedAt, "acceptedAt should not be set on a declined estimate");
});

test("handleEstimateReply does NOT write acceptedAt for a neutral reply", async () => {
  await seedEstimate();
  await handleEstimateReply("+15550001111", "Can you tell me more?", fakeBusiness);

  const updated = [...records.values()].find((r) => r.customerPhone === "+15550001111");
  assert.equal(updated.status, "open", "status should remain open");
  assert.ok(!updated.acceptedAt, "acceptedAt should not be set for non-accepted estimate");
});

// ---------------------------------------------------------------------------
// reviewDue / booking tests
// ---------------------------------------------------------------------------

test("booking a lead stores reviewDue 24h in the future and reviewRequested:false", async () => {
  clearRecords();

  // Seed a lead (status "new") and an existing conversation
  const lead = await storeFake.addRecord("leads", {
    phone: "+15550002222",
    businessId: "biz_1",
    status: "new",
    source: "missed_call",
  });
  await storeFake.addRecord("lead_conversations", {
    leadId: lead.id,
    phone: "+15550002222",
    businessId: "biz_1",
    messages: [{ role: "assistant", content: "Hi! How can I help?", timestamp: new Date().toISOString() }],
  });

  // Tomorrow's date in YYYY-MM-DD format
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  // First chatWithTools call returns a book_appointment tool use; second ends the loop
  let callCount = 0;
  stubs.chatWithTools = async () => {
    callCount++;
    if (callCount === 1) {
      return {
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "tool_1",
            name: "book_appointment",
            input: {
              customer_name: "Bob Jones",
              date: tomorrowStr,
              time: "10:00",
              service_type: "AC tune-up",
              address: "123 Main St",
            },
          },
        ],
      };
    }
    return { stop_reason: "end_turn", content: [{ type: "text", text: "You're all booked!" }] };
  };
  stubs.isCalendarConnected = async () => true;
  stubs.bookAppointment = async () => ({ success: true, eventId: "evt_123" });

  await handleIncomingSMS("+15550002222", "Please book me tomorrow at 10 for AC tune-up", fakeBusiness);

  const updatedLead = records.get(`leads:${lead.id}`);
  assert.ok(updatedLead, "lead record should exist");
  assert.equal(updatedLead.status, "booked");
  assert.equal(updatedLead.customerName, "Bob Jones");
  assert.equal(updatedLead.serviceType, "AC tune-up");
  assert.strictEqual(updatedLead.reviewRequested, false);
  assert.ok(updatedLead.reviewDue, "reviewDue should be set");

  const due = new Date(updatedLead.reviewDue);
  assert.ok(!isNaN(due.getTime()), "reviewDue must be a valid date");

  const diffMs = due.getTime() - Date.now();
  const H24 = 24 * 60 * 60 * 1000;
  assert.ok(
    diffMs > H24 - 60_000 && diffMs < H24 + 60_000,
    `reviewDue should be ~24h from now, got ${Math.round(diffMs / 1000)}s`
  );

  // Restore stubs to safe defaults for subsequent tests
  stubs.isCalendarConnected = async () => false;
  stubs.bookAppointment = async () => ({ success: false });
  stubs.chatWithTools = async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "I can help." }] });
});
