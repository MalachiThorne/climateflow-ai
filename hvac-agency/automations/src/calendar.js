const { randomBytes } = require("crypto");
const { google } = require("googleapis");
const config = require("./config");
const store = require("./store");
const { encryptTokens, decryptTokens } = require("./tokenCrypto");

const TOKENS = "calendar_tokens";
const OAUTH_STATES = "calendar_oauth_states";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function createOAuth2Client() {
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );
}

// Generates a random state nonce and persists the businessId binding.
// The state is what Google echoes back; consumeOAuthState() validates + deletes it
// so the same nonce can't be replayed and an attacker can't substitute a different
// businessId via the state parameter.
async function getAuthUrl(businessId) {
  const state = randomBytes(32).toString("hex");
  await store.addRecord(OAUTH_STATES, {
    id: state,
    businessId,
    expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
  });

  const oauth2Client = createOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/calendar"],
    state,
  });
}

// Atomic consume: DELETE RETURNING guarantees only one caller wins the race,
// even with concurrent OAuth callbacks. Stale / missing / expired states all
// return null.
async function consumeOAuthState(state) {
  if (typeof state !== "string" || state.length !== 64) return null;
  const record = await store.deleteRecord(OAUTH_STATES, state);
  if (!record || !record.businessId) return null;
  if (record.expiresAt && record.expiresAt < Date.now()) return null;
  return record.businessId;
}

async function handleOAuthCallback(code, businessId) {
  const oauth2Client = createOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  const encrypted = encryptTokens(tokens);

  const existing = await store.findRecordByField(TOKENS, "businessId", businessId);
  if (existing) {
    await store.updateRecord(TOKENS, existing.id, { tokens: encrypted });
  } else {
    await store.addRecord(TOKENS, { businessId, tokens: encrypted });
  }

  return tokens;
}

async function getAuthenticatedClient(businessId) {
  const record = await store.findRecordByField(TOKENS, "businessId", businessId);
  if (!record) return null;

  const plainTokens = decryptTokens(record.tokens);
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials(plainTokens);

  oauth2Client.on("tokens", async (newTokens) => {
    const merged = encryptTokens({ ...plainTokens, ...newTokens });
    await store.updateRecord(TOKENS, record.id, { tokens: merged });
  });

  return oauth2Client;
}

// Returns a UTC Date for a given local clock time in the business's timezone
function localToUTC(dateStr, hour, timezone) {
  // Build a candidate UTC instant, then measure the TZ offset at that moment
  const candidate = new Date(`${dateStr}T${String(hour).padStart(2, "0")}:00:00Z`);
  const localStr = new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(candidate);
  // "sv-SE" locale formats as "YYYY-MM-DD HH:MM:SS" — treat as UTC to get the offset
  const diff = candidate - new Date(localStr.replace(" ", "T") + "Z");
  return new Date(candidate.getTime() + diff);
}

async function getAvailableSlots(businessId, dateStr) {
  const auth = await getAuthenticatedClient(businessId);
  if (!auth) return { error: "Calendar not connected" };

  const business = await store.findRecordByField("clients", "id", businessId);
  const timezone = business?.timezone || "America/Los_Angeles";

  const calendar = google.calendar({ version: "v3", auth });
  const startOfDay = localToUTC(dateStr, 8, timezone);
  const endOfDay = localToUTC(dateStr, 18, timezone);

  const { data } = await calendar.freebusy.query({
    requestBody: {
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
      items: [{ id: "primary" }],
    },
  });

  const busySlots = data.calendars.primary.busy || [];

  const slots = [];
  for (let hour = 8; hour < 18; hour++) {
    const slotStart = localToUTC(dateStr, hour, timezone);
    const slotEnd = localToUTC(dateStr, hour + 1, timezone);

    const isBusy = busySlots.some((busy) => {
      const busyStart = new Date(busy.start);
      const busyEnd = new Date(busy.end);
      return slotStart < busyEnd && slotEnd > busyStart;
    });

    if (!isBusy) {
      slots.push({
        start: slotStart.toISOString(),
        end: slotEnd.toISOString(),
        label: `${hour >= 13 ? hour - 12 : hour}:00 ${hour >= 12 ? "PM" : "AM"}`,
      });
    }
  }

  return { slots };
}

async function bookAppointment(businessId, { customerName, customerPhone, date, time, serviceType, address }) {
  const auth = await getAuthenticatedClient(businessId);
  if (!auth) return { error: "Calendar not connected" };

  const business = await store.findRecordByField("clients", "id", businessId);
  const timezone = business?.timezone || "America/Los_Angeles";

  const calendar = google.calendar({ version: "v3", auth });

  const [hours, minutes] = time.split(":").map(Number);
  const startTime = localToUTC(date, hours, timezone);
  if (minutes) startTime.setMinutes(startTime.getMinutes() + minutes);
  const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);

  const event = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: `HVAC Service — ${serviceType || "Appointment"}`,
      description: [
        `Customer: ${customerName}`,
        `Phone: ${customerPhone}`,
        `Service: ${serviceType || "TBD"}`,
        `Address: ${address || "TBD"}`,
        "",
        "Booked automatically by ClimateFlow AI",
      ].join("\n"),
      location: address || "",
      start: { dateTime: startTime.toISOString(), timeZone: timezone },
      end: { dateTime: endTime.toISOString(), timeZone: timezone },
      reminders: {
        useDefault: false,
        overrides: [
          { method: "popup", minutes: 60 },
          { method: "popup", minutes: 15 },
        ],
      },
    },
  });

  await store.addRecord("bookings", {
    businessId,
    customerName,
    customerPhone,
    date,
    time,
    serviceType,
    address,
    calendarEventId: event.data.id,
    status: "confirmed",
  });

  return {
    success: true,
    eventId: event.data.id,
    start: startTime.toISOString(),
    end: endTime.toISOString(),
  };
}

async function isCalendarConnected(businessId) {
  return !!(await store.findRecordByField(TOKENS, "businessId", businessId));
}

module.exports = {
  getAuthUrl,
  consumeOAuthState,
  handleOAuthCallback,
  getAvailableSlots,
  bookAppointment,
  isCalendarConnected,
};
