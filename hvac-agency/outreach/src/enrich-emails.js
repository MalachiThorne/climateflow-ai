#!/usr/bin/env node
// Enrich scraped leads with email addresses by crawling their website.
//
// Google Places returns phone + website but never email. This script:
//   1. Reads hvac_leads.csv.
//   2. For each row without an email but with a website, fetches homepage + /contact
//      and extracts email addresses via regex.
//   3. Writes back to the CSV in-place (safely, via temp file).
//
// Tuning notes:
//   - We skip common no-reply/vendor patterns (noreply@, wordpress@, etc.).
//   - Timeout per site is 8s to keep the full run bounded.
//   - Concurrency is capped so we don't hammer small-biz shared hosting.
//
// Usage:
//   node src/enrich-emails.js
//   node src/enrich-emails.js --limit=100
//   node src/enrich-emails.js --concurrency=8

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { URL } = require("url");
const csv = require("csv-parser");
const { createObjectCsvWriter } = require("csv-writer");

const LEADS_FILE = path.resolve(__dirname, "../data/hvac_leads.csv");
const TEMP_FILE = LEADS_FILE + ".tmp";

const args = process.argv.slice(2);
const limit = parseInt((args.find((a) => a.startsWith("--limit=")) || "").split("=")[1] || "0", 10);
const concurrency = parseInt((args.find((a) => a.startsWith("--concurrency=")) || "").split("=")[1] || "5", 10);

// Emails we never want (generic vendor / CMS defaults / no-reply).
const EMAIL_BLOCKLIST = [
  /^noreply@/i,
  /^no-reply@/i,
  /^wordpress@/i,
  /^donotreply@/i,
  /^postmaster@/i,
  /^abuse@/i,
  /^privacy@/i,
  /^webmaster@wix\.com$/i,
  /@sentry\.io$/i,
  /@example\.com$/i,
  /@domain\.com$/i,
  /@yourcompany\./i,
  /\.png$/i,
  /\.jpg$/i,
  /\.jpeg$/i,
];

const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

function fetchUrl(urlStr, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let u;
    try {
      u = new URL(urlStr);
    } catch {
      return resolve("");
    }
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        method: "GET",
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; ClimateFlowBot/1.0; +https://climateflow.ai)",
          Accept: "text/html,application/xhtml+xml",
        },
        timeout: timeoutMs,
      },
      (res) => {
        // Follow one level of redirects.
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, urlStr).toString();
          fetchUrl(next, timeoutMs).then(resolve);
          return;
        }
        if (res.statusCode >= 400) {
          res.resume();
          return resolve("");
        }
        let body = "";
        let bytes = 0;
        res.on("data", (c) => {
          bytes += c.length;
          if (bytes > 500_000) {
            req.destroy();
            return resolve(body);
          }
          body += c.toString("utf8");
        });
        res.on("end", () => resolve(body));
      }
    );
    req.on("error", () => resolve(""));
    req.on("timeout", () => {
      req.destroy();
      resolve("");
    });
    req.end();
  });
}

function extractEmails(html, rootDomain) {
  if (!html) return [];
  const found = new Set();
  // Standard mailto links and plain text emails.
  const matches = html.match(EMAIL_REGEX) || [];
  for (const m of matches) {
    const email = m.toLowerCase();
    if (EMAIL_BLOCKLIST.some((r) => r.test(email))) continue;
    found.add(email);
  }
  // Decode simple obfuscation: "name [at] domain [dot] com"
  const obfusc = html.match(/[A-Z0-9._%+-]+\s*(?:\[at\]|\(at\))\s*[A-Z0-9.-]+\s*(?:\[dot\]|\(dot\))\s*[A-Z]{2,}/gi) || [];
  for (const o of obfusc) {
    const cleaned = o
      .replace(/\s*(?:\[at\]|\(at\))\s*/gi, "@")
      .replace(/\s*(?:\[dot\]|\(dot\))\s*/gi, ".")
      .toLowerCase();
    if (!EMAIL_BLOCKLIST.some((r) => r.test(cleaned))) found.add(cleaned);
  }
  const all = [...found];
  // Prefer emails whose domain matches the site's root (skip gmail/yahoo unless nothing else).
  const onDomain = all.filter((e) => rootDomain && e.endsWith("@" + rootDomain));
  if (onDomain.length > 0) return onDomain;
  return all;
}

function rootDomainOf(urlStr) {
  try {
    const host = new URL(urlStr).hostname.replace(/^www\./, "");
    return host;
  } catch {
    return "";
  }
}

async function enrichRow(row) {
  const website = row["Website"] || row.website;
  if (!website) return null;
  if (row["Email"] || row.email) return null;

  const urlStr = website.startsWith("http") ? website : `https://${website}`;
  const domain = rootDomainOf(urlStr);

  // Try homepage, then common contact pages.
  const candidates = [
    urlStr,
    `${urlStr.replace(/\/$/, "")}/contact`,
    `${urlStr.replace(/\/$/, "")}/contact-us`,
    `${urlStr.replace(/\/$/, "")}/about`,
  ];

  for (const c of candidates) {
    const html = await fetchUrl(c);
    if (!html) continue;
    const emails = extractEmails(html, domain);
    if (emails.length > 0) return emails[0];
  }
  return null;
}

function readRows() {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(LEADS_FILE)
      .pipe(csv())
      .on("data", (r) => rows.push(r))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });
}

async function run() {
  if (!fs.existsSync(LEADS_FILE)) {
    console.error(`[Enrich] No leads file at ${LEADS_FILE}. Run us-pipeline.js first.`);
    process.exit(1);
  }

  const rows = await readRows();
  const needEnrichment = rows.filter((r) => !(r["Email"] || r.email) && (r["Website"] || r.website));
  const toProcess = limit > 0 ? needEnrichment.slice(0, limit) : needEnrichment;

  console.log(`[Enrich] ${rows.length} total leads, ${needEnrichment.length} need emails, processing ${toProcess.length}.`);

  let found = 0;
  let processed = 0;

  async function worker(queue) {
    while (queue.length) {
      const row = queue.shift();
      processed++;
      try {
        const email = await enrichRow(row);
        if (email) {
          row["Email"] = email;
          found++;
          if (found % 10 === 0) {
            console.log(`[Enrich] +${found} emails (${processed}/${toProcess.length} processed)`);
          }
        }
      } catch (err) {
        // swallow per-row errors — shared hosting is flaky
      }
    }
  }

  const queue = [...toProcess];
  const workers = Array.from({ length: concurrency }, () => worker(queue));
  await Promise.all(workers);

  console.log(`[Enrich] Done. Found ${found} emails across ${processed} websites.`);

  // Write CSV atomically.
  const writer = createObjectCsvWriter({
    path: TEMP_FILE,
    header: [
      { id: "Company Name", title: "Company Name" },
      { id: "Owner Name", title: "Owner Name" },
      { id: "Email", title: "Email" },
      { id: "Phone", title: "Phone" },
      { id: "Website", title: "Website" },
      { id: "City", title: "City" },
      { id: "State", title: "State" },
      { id: "Google Rating", title: "Google Rating" },
      { id: "Review Count", title: "Review Count" },
      { id: "Source", title: "Source" },
      { id: "Scraped At", title: "Scraped At" },
    ],
  });
  await writer.writeRecords(rows);
  fs.renameSync(TEMP_FILE, LEADS_FILE);
  console.log(`[Enrich] Wrote ${rows.length} rows back to ${LEADS_FILE}.`);
}

if (require.main === module) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
