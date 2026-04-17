#!/usr/bin/env node
// US-wide HVAC lead pipeline builder.
//
// Strategy:
//   1. Iterate over ~100 major US metros (see ./data/us-metros.js).
//   2. For each metro, run a Google Places Text Search for "HVAC contractor <city>".
//      - Google Places has a 60-result cap per query (3 pages of 20).
//   3. For each unique place, call Place Details to get phone + website + rating.
//   4. Dedupe by place_id and phone, append to CSV.
//
// Requires GOOGLE_PLACES_API_KEY in outreach/.env.
// Cost estimate at Google list price: Text Search $32/1k + Details $17/1k.
// Default mode runs 1 query/metro and only calls Details for places with a
// website — drops a full pass from ~$70 to ~$15. Use --aggressive for the
// prior behavior (3 queries + Details on every result).
//
// Usage:
//   node src/us-pipeline.js                 # full run, all metros
//   node src/us-pipeline.js --metros=20     # first 20 metros only
//   node src/us-pipeline.js --state=TX      # single state filter
//   node src/us-pipeline.js --resume        # skip metros already processed
//   node src/us-pipeline.js --dry-run       # show what would happen
//   node src/us-pipeline.js --aggressive    # legacy 3-query + full Details mode

const fs = require("fs");
const path = require("path");
const https = require("https");
const { createObjectCsvWriter } = require("csv-writer");
const metros = require("./data/us-metros");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const DATA_DIR = path.resolve(__dirname, "../data");
const LEADS_FILE = path.join(DATA_DIR, "hvac_leads.csv");
const PROGRESS_FILE = path.join(DATA_DIR, "pipeline_progress.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const resume = args.includes("--resume");
const aggressive = args.includes("--aggressive");
const metrosLimit = parseInt((args.find((a) => a.startsWith("--metros=")) || "").split("=")[1] || "0", 10);
const stateFilter = (args.find((a) => a.startsWith("--state=")) || "").split("=")[1];

const MIN_RESULTS_BEFORE_FALLBACK = 30;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`Bad JSON from ${url}: ${e.message}`));
          }
        });
      })
      .on("error", reject);
  });
}

async function textSearch(query, location, radius) {
  // Google Places Text Search returns up to 60 results across 3 pages.
  const base = "https://maps.googleapis.com/maps/api/place/textsearch/json";
  const first = `${base}?query=${encodeURIComponent(query)}&location=${location.lat},${location.lng}&radius=${radius}&key=${API_KEY}`;
  const results = [];
  let url = first;
  for (let page = 0; page < 3; page++) {
    const data = await fetchJson(url);
    if (data.status && data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      throw new Error(`Places API error: ${data.status} ${data.error_message || ""}`);
    }
    if (data.results) results.push(...data.results);
    if (!data.next_page_token) break;
    // next_page_token needs a ~2s delay before it becomes valid.
    await sleep(2200);
    url = `${base}?pagetoken=${data.next_page_token}&key=${API_KEY}`;
  }
  return results;
}

async function placeDetails(placeId) {
  const fields = [
    "name",
    "formatted_phone_number",
    "international_phone_number",
    "website",
    "rating",
    "user_ratings_total",
    "formatted_address",
    "business_status",
    "url",
  ].join(",");
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${fields}&key=${API_KEY}`;
  const data = await fetchJson(url);
  if (data.status !== "OK") return null;
  return data.result;
}

function extractCityState(address) {
  // "123 Main St, Dallas, TX 75201, USA" → { city: "Dallas", state: "TX" }
  if (!address) return { city: "", state: "" };
  const parts = address.split(",").map((s) => s.trim());
  if (parts.length < 3) return { city: "", state: "" };
  const stateZip = parts[parts.length - 2];
  const m = stateZip.match(/^([A-Z]{2})\s+\d{5}/);
  return { city: parts[parts.length - 3], state: m ? m[1] : "" };
}

function loadProgress() {
  if (!fs.existsSync(PROGRESS_FILE)) return { completedMetros: [], stats: {} };
  return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"));
}

function saveProgress(p) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2));
}

function loadExistingLeads() {
  // Dedupe by place_id (in Source column as "google:<id>") and phone.
  const seen = { placeIds: new Set(), phones: new Set() };
  if (!fs.existsSync(LEADS_FILE)) return seen;
  const content = fs.readFileSync(LEADS_FILE, "utf8");
  const lines = content.split("\n").slice(1);
  for (const line of lines) {
    if (!line.trim()) continue;
    // Simple CSV split (won't handle escaped commas inside quotes perfectly — OK for dedup keys).
    const cols = line.split(",");
    const phone = (cols[3] || "").replace(/[^0-9]/g, "");
    const source = (cols[9] || "").trim();
    if (source.startsWith("google:")) seen.placeIds.add(source.slice(7));
    if (phone) seen.phones.add(phone);
  }
  return seen;
}

async function run() {
  if (!API_KEY) {
    console.error("[Pipeline] ERROR: GOOGLE_PLACES_API_KEY is not set in outreach/.env");
    console.error("[Pipeline] Get one at https://console.cloud.google.com/ → APIs & Services → Places API.");
    console.error("[Pipeline] Enable both 'Places API' and 'Places API (New)'. Free tier: $200/mo credit.");
    process.exit(1);
  }

  const progress = resume ? loadProgress() : { completedMetros: [], stats: {} };
  const seen = loadExistingLeads();
  let targets = metros;
  if (stateFilter) targets = targets.filter((m) => m.state === stateFilter.toUpperCase());
  if (metrosLimit > 0) targets = targets.slice(0, metrosLimit);

  const writer = createObjectCsvWriter({
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

  console.log(`\n=== ClimateFlow AI — US Pipeline Build ===`);
  console.log(`Metros to process: ${targets.length}`);
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`Cost profile: ${aggressive ? "AGGRESSIVE (3 queries + Details on all)" : `ECONOMY (1 query, fallback <${MIN_RESULTS_BEFORE_FALLBACK}, Details only when website present)`}`);
  console.log(`Resume: ${resume ? "yes" : "no"}`);
  console.log(`Existing leads: ${seen.placeIds.size} google-sourced, ${seen.phones.size} by phone`);
  console.log(`==========================================\n`);

  let totalNew = 0;
  for (const metro of targets) {
    const tag = `${metro.city}, ${metro.state}`;
    if (resume && progress.completedMetros.includes(tag)) {
      console.log(`[Pipeline] Skipping ${tag} (already processed)`);
      continue;
    }

    console.log(`\n[Pipeline] ${tag} — searching...`);
    try {
      const primaryQuery = `HVAC contractor ${metro.city} ${metro.state}`;
      const fallbackQueries = [
        `heating and air conditioning ${metro.city} ${metro.state}`,
        `air conditioning repair ${metro.city} ${metro.state}`,
      ];

      const placeIdsThisMetro = new Set();
      // Cache the Text Search payload per place — lets us skip Details when
      // we already know there's no website to enrich.
      const searchPayload = new Map();

      const absorb = (results) => {
        for (const r of results) {
          placeIdsThisMetro.add(r.place_id);
          if (!searchPayload.has(r.place_id)) searchPayload.set(r.place_id, r);
        }
      };

      if (dryRun) {
        console.log(`  [DRY] Would query: "${primaryQuery}"`);
        if (aggressive) {
          for (const q of fallbackQueries) console.log(`  [DRY] Would query (aggressive): "${q}"`);
        } else {
          console.log(`  [DRY] Would fall back to 2 more queries only if <${MIN_RESULTS_BEFORE_FALLBACK} results`);
        }
      } else {
        absorb(await textSearch(primaryQuery, metro, metro.radius));

        const needsFallback = aggressive || placeIdsThisMetro.size < MIN_RESULTS_BEFORE_FALLBACK;
        if (needsFallback) {
          const reason = aggressive ? "aggressive mode" : `only ${placeIdsThisMetro.size} results`;
          console.log(`[Pipeline] ${tag} — running fallback queries (${reason})`);
          for (const q of fallbackQueries) {
            absorb(await textSearch(q, metro, metro.radius));
          }
        }
      }

      console.log(`[Pipeline] ${tag} — ${placeIdsThisMetro.size} unique places`);

      const newLeads = [];
      let detailsCalls = 0;
      let detailsSkipped = 0;
      for (const placeId of placeIdsThisMetro) {
        if (seen.placeIds.has(placeId)) continue;
        if (dryRun) continue;

        const textHit = searchPayload.get(placeId);
        const hasWebsite = Boolean(textHit && textHit.website);
        const shouldCallDetails = aggressive || hasWebsite;

        let d;
        if (shouldCallDetails) {
          d = await placeDetails(placeId);
          detailsCalls += 1;
          if (!d) continue;
          if (d.business_status && d.business_status !== "OPERATIONAL") continue;
          await sleep(120); // gentle pacing on Place Details
        } else {
          detailsSkipped += 1;
          // No website → Details call adds no enrichable data. Use Text
          // Search payload directly; phone stays blank (call path only).
          d = {
            name: textHit.name,
            formatted_phone_number: "",
            website: "",
            rating: textHit.rating,
            user_ratings_total: textHit.user_ratings_total,
            formatted_address: textHit.formatted_address,
            business_status: textHit.business_status,
          };
          if (d.business_status && d.business_status !== "OPERATIONAL") continue;
        }

        const phoneDigits = (d.formatted_phone_number || "").replace(/[^0-9]/g, "");
        if (phoneDigits && seen.phones.has(phoneDigits)) continue;

        const { city, state } = extractCityState(d.formatted_address);
        newLeads.push({
          companyName: d.name || "",
          ownerName: "",
          email: "",
          phone: d.formatted_phone_number || "",
          website: d.website || "",
          city: city || metro.city,
          state: state || metro.state,
          googleRating: d.rating || "",
          reviewCount: d.user_ratings_total || "",
          source: `google:${placeId}`,
          scrapedAt: new Date().toISOString(),
        });

        seen.placeIds.add(placeId);
        if (phoneDigits) seen.phones.add(phoneDigits);
      }

      if (newLeads.length > 0 && !dryRun) {
        await writer.writeRecords(newLeads);
      }
      totalNew += newLeads.length;
      progress.completedMetros.push(tag);
      progress.stats[tag] = newLeads.length;
      saveProgress(progress);
      const detailSummary = dryRun ? "" : ` [Details called: ${detailsCalls}, skipped: ${detailsSkipped}]`;
      console.log(`[Pipeline] ${tag} — wrote ${newLeads.length} new leads (running total: ${totalNew})${detailSummary}`);
    } catch (err) {
      console.error(`[Pipeline] ERROR in ${tag}: ${err.message}`);
      // Don't mark complete — allow --resume to retry this metro.
    }
  }

  console.log(`\n=== Pipeline Build Complete ===`);
  console.log(`New leads added: ${totalNew}`);
  console.log(`Total metros processed: ${progress.completedMetros.length}`);
  console.log(`Output: ${LEADS_FILE}`);
  console.log(`================================\n`);
}

if (require.main === module) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { run };
