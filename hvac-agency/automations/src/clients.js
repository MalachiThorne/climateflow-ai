const store = require("./store");

const CLIENTS = "clients";

async function getClient(businessId) {
  return store.findRecord(CLIENTS, (c) => c.id === businessId);
}

async function getClientByPhone(twilioNumber) {
  return store.findRecord(CLIENTS, (c) => c.twilioNumber === twilioNumber);
}

async function addClient(client) {
  return store.addRecord(CLIENTS, client);
}

async function listClients() {
  return store.readCollection(CLIENTS);
}

async function createSampleClient() {
  const existing = await store.findRecord(CLIENTS, (c) => c.id === "demo");
  if (existing) return existing;

  return store.addRecord(CLIENTS, {
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
  });
}

module.exports = { getClient, getClientByPhone, addClient, listClients, createSampleClient };
