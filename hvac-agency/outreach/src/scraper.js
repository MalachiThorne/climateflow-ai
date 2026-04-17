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

module.exports = { importFromCSV, saveLeads };
