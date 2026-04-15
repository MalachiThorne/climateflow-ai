const { importFromCSV, saveLeads } = require("./scraper");

const inputFile = process.argv[2];

if (!inputFile) {
  console.log("Usage: node src/import-leads.js <path-to-csv>");
  console.log("");
  console.log("CSV should have columns: Company Name, Owner Name, Email, Phone, Website, City, State, Google Rating, Review Count");
  console.log("");
  console.log("You can get HVAC leads from:");
  console.log("  - Google Maps scraping (Outscraper.com, ~$0.002/result)");
  console.log("  - Yelp business listings");
  console.log("  - BBB directory");
  console.log("  - Apollo.io / ZoomInfo (paid)");
  console.log("  - Manual search + spreadsheet");
  process.exit(1);
}

importFromCSV(inputFile)
  .then(saveLeads)
  .then(() => console.log("Done!"))
  .catch(console.error);
