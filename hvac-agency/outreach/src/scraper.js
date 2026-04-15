const fs = require("fs");
const path = require("path");
const { createObjectCsvWriter } = require("csv-writer");

const OUTPUT_DIR = path.resolve(__dirname, "../data");
const LEADS_FILE = path.join(OUTPUT_DIR, "hvac_leads.csv");

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const csvWriter = createObjectCsvWriter({
  path: LEADS_FILE,
  header: [
    { id: "companyName", title: "Company Name" },
    { id: "ownerName", title: "Owner Name" },
    { id: "email", title: "Email" },
    { id: "phone", title: "Phone" },
    { id: "website", title: "Website" },
    { id: "city", title: "City" },
    { id: "state", title: "State" },
    { id: "googleRating", title: "Google Rating" },
    { id: "reviewCount", title: "Review Count" },
    { id: "source", title: "Source" },
    { id: "scrapedAt", title: "Scraped At" },
  ],
  append: fs.existsSync(LEADS_FILE),
});

async function scrapeGoogleMaps(query, location) {
  // Uses SerpAPI, Outscraper, or similar service in production.
  // For now, this is a structured template that accepts data from any source.
  console.log(`[Scraper] Would search Google Maps for: "${query}" in "${location}"`);
  console.log(`[Scraper] In production, use SerpAPI ($50/mo) or Outscraper API`);
  console.log(`[Scraper] For now, import leads manually via CSV or use import-leads.js`);
  return [];
}

async function importFromCSV(inputFile) {
  const csv = require("csv-parser");
  const leads = [];

  return new Promise((resolve, reject) => {
    fs.createReadStream(inputFile)
      .pipe(csv())
      .on("data", (row) => {
        leads.push({
          companyName: row["Company Name"] || row.companyName || "",
          ownerName: row["Owner Name"] || row.ownerName || "",
          email: row["Email"] || row.email || "",
          phone: row["Phone"] || row.phone || "",
          website: row["Website"] || row.website || "",
          city: row["City"] || row.city || "",
          state: row["State"] || row.state || "",
          googleRating: row["Google Rating"] || row.googleRating || "",
          reviewCount: row["Review Count"] || row.reviewCount || "",
          source: "csv_import",
          scrapedAt: new Date().toISOString(),
        });
      })
      .on("end", () => {
        console.log(`[Scraper] Imported ${leads.length} leads from ${inputFile}`);
        resolve(leads);
      })
      .on("error", reject);
  });
}

async function saveLeads(leads) {
  await csvWriter.writeRecords(leads);
  console.log(`[Scraper] Saved ${leads.length} leads to ${LEADS_FILE}`);
}

async function scrapeAndSave(cities, states) {
  const allLeads = [];

  for (const state of states) {
    for (const city of cities) {
      const query = `HVAC companies in ${city}, ${state}`;
      const leads = await scrapeGoogleMaps(query, `${city}, ${state}`);
      allLeads.push(...leads);
    }
  }

  if (allLeads.length > 0) {
    await saveLeads(allLeads);
  }

  return allLeads;
}

module.exports = { scrapeGoogleMaps, importFromCSV, saveLeads, scrapeAndSave };
