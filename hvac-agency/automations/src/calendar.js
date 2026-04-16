const { google } = require("googleapis");
const config = require("./config");
const store = require("./store");

const TOKENS = "calendar_tokens";

function createOAuth2Client() {
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );
}

function getAuthUrl(businessId) {
  const oauth2Client = createOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/calendar"],
    state: businessId,
  });
}

async function handleOAuthCallback(code, businessId) {
  const oauth2Client = createOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);

  const existing = await store.findRecord(TOKENS, (t) => t.businessId === businessId);
  if (existing) {
    await store.updateRecord(TOKENS, existing.id, { tokens });
  } else {
    await store.addRecord(TOKENS, { businessId, tokens });
  }

  return tokens;
}

async function getAuthenticatedClient(businessId) {
  const record = await store.findRecord(TOKENS, (t) => t.businessId === businessId);
  if (!record) return null;

  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials(record.tokens);

  oauth2Client.on("tokens", async (newTokens) => {
    const updated = { ...record.tokens, ...newTokens };
    await store.updateRecord(TOKENS, record.id, { tokens: updated });
  });

  return oauth2Client;
}

async function getAvailableSlots(businessId, dateStr) {
  const auth = await getAuthenticatedClient(businessId);
  if (!auth) return { error: "Calendar not connected" };

  const calendar = google.calendar({ version: "v3", auth });
  const date = new Date(dateStr);
  const startOfDay = new Date(date);
  startOfDay.setHours(8, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(18, 0, 0, 0);

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
    const slotStart = new Date(date);
    slotStart.setHours(hour, 0, 0, 0);
    const slotEnd = new Date(date);
    slotEnd.setHours(hour + 1, 0, 0, 0);

    const isBusy = busySlots.some((busy) => {
      const busyStart = new Date(busy.start);
      const busyEnd = new Date(busy.end);
      return slotStart < busyEnd && slotEnd > busyStart;
    });

    if (!isBusy) {
      slots.push({
        start: slotStart.toISOString(),
        end: slotEnd.toISOString(),
        label: `${hour > 12 ? hour - 12 : hour}:00 ${hour >= 12 ? "PM" : "AM"}`,
      });
    }
  }

  return { slots };
}

async function bookAppointment(businessId, { customerName, customerPhone, date, time, serviceType, address }) {
  const auth = await getAuthenticatedClient(businessId);
  if (!auth) return { error: "Calendar not connected" };

  const calendar = google.calendar({ version: "v3", auth });

  const [hours, minutes] = time.split(":").map(Number);
  const startTime = new Date(date);
  startTime.setHours(hours, minutes || 0, 0, 0);
  const endTime = new Date(startTime);
  endTime.setHours(endTime.getHours() + 1);

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
      start: { dateTime: startTime.toISOString() },
      end: { dateTime: endTime.toISOString() },
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
  return !!(await store.findRecord(TOKENS, (t) => t.businessId === businessId));
}

module.exports = {
  getAuthUrl,
  handleOAuthCallback,
  getAvailableSlots,
  bookAppointment,
  isCalendarConnected,
};
