const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const { generateEmail } = require("./email-generator");
const { sendEmail, sleep, todaySendCount } = require("./sender");
const config = require("./config");

const LEADS_FILE = path.resolve(__dirname, "../data/hvac_leads.csv");

function loadLeads() {
  return new Promise((resolve, reject) => {
    const leads = [];
    if (!fs.existsSync(LEADS_FILE)) {
      console.error(`[Campaign] No leads file found at ${LEADS_FILE}`);
      console.error(`[Campaign] Import leads first: node src/import-leads.js <csv_file>`);
      resolve([]);
      return;
    }

    fs.createReadStream(LEADS_FILE)
      .pipe(csv())
      .on("data", (row) => leads.push(row))
      .on("end", () => resolve(leads))
      .on("error", reject);
  });
}

async function runCampaign(templateKey, options = {}) {
  const { dryRun = false, limit } = options;

  console.log(`\n=== ClimateFlow AI Outreach Campaign ===`);
  console.log(`Template: ${templateKey}`);
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`Daily limit: ${config.outreach.dailySendLimit}`);
  console.log(`Sent today: ${todaySendCount()}`);
  console.log(`========================================\n`);

  const leads = await loadLeads();
  if (leads.length === 0) return;

  const toProcess = limit ? leads.slice(0, limit) : leads;
  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const lead of toProcess) {
    if (!lead["Email"] && !lead.email) {
      console.log(`[Campaign] Skipping ${lead["Company Name"] || lead.companyName} — no email`);
      skipped++;
      continue;
    }

    const email = lead["Email"] || lead.email;
    const leadData = {
      companyName: lead["Company Name"] || lead.companyName,
      ownerName: lead["Owner Name"] || lead.ownerName,
      city: lead["City"] || lead.city,
      state: lead["State"] || lead.state,
      googleRating: lead["Google Rating"] || lead.googleRating,
      reviewCount: lead["Review Count"] || lead.reviewCount,
      website: lead["Website"] || lead.website,
    };

    try {
      console.log(`\n[Campaign] Generating email for ${leadData.companyName}...`);
      const { subject, body } = await generateEmail(leadData, templateKey);

      if (dryRun) {
        console.log(`[DRY RUN] To: ${email}`);
        console.log(`[DRY RUN] Subject: ${subject}`);
        console.log(`[DRY RUN] Body:\n${body}\n`);
        sent++;
      } else {
        const result = await sendEmail(email, subject, body, templateKey);
        if (result.sent) sent++;
        if (result.skipped || result.suppressed) skipped++;
        if (result.limitReached) {
          console.log(`[Campaign] Daily limit reached. Stopping.`);
          break;
        }
      }

      await sleep(dryRun ? 100 : config.outreach.delayBetweenEmails);
    } catch (err) {
      console.error(`[Campaign] Error for ${leadData.companyName}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\n=== Campaign Complete ===`);
  console.log(`Sent: ${sent} | Skipped: ${skipped} | Errors: ${errors}`);
  console.log(`========================\n`);
}

const args = process.argv.slice(2);
const templateKey = args[0] || "cold_intro";
const dryRun = args.includes("--dry-run");
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : undefined;

if (require.main === module) {
  runCampaign(templateKey, { dryRun, limit }).catch(console.error);
}

module.exports = { runCampaign };
