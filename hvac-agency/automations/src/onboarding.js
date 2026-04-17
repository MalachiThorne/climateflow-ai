// Onboarding state + rendering. One `onboarding` record per client tracks which
// steps have been completed. Routes live in server.js; this module owns the
// record shape and the HTML for each step.
const store = require("./store");

const ONBOARDING = "onboarding";
const ONBOARDING_TESTS = "onboarding_tests";

// Window during which a call originated from TWILIO_TEST_CALLER_NUMBER is
// credited to the active forwarding test for a given business. Twilio may take a
// few seconds to route, and the owner's carrier can add latency on top of that.
// Two minutes gives plenty of slack without creating a meaningful window for
// false positives (the test caller number is a dedicated Twilio DID that nothing
// else should be dialing our clients from).
const FORWARDING_TEST_WINDOW_MS = 2 * 60 * 1000;
// Hard ceiling on forwarding-test originations per business per rolling 24h.
// Without this, a compromised owner link (or a misconfigured auto-retry loop
// in the UI) could burn outbound-call minutes on our account. The 2-minute
// window reuse inside startForwardingTest already blocks trivial spam, but
// that lets a caller still trigger ~720 distinct tests a day.
const FORWARDING_TEST_DAILY_CAP = 20;
const FORWARDING_TEST_CAP_WINDOW_MS = 24 * 60 * 60 * 1000;

// Escape user-controlled strings flowing into HTML text nodes and double-quoted
// attribute values. Same escaper we use in email.js — consistent shape here so a
// future extractor can share it.
function h(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Curated service list. Owners can also add custom entries via the "other" field.
const COMMON_SERVICES = [
  "AC repair",
  "AC installation",
  "Furnace repair",
  "Furnace installation",
  "Heat pump service",
  "Heat pump installation",
  "Ductwork",
  "Indoor air quality",
  "Maintenance plans",
  "Thermostat install",
];

const DEFAULT_EMERGENCY = "No heat in winter, no AC in summer, gas smell, water leak";
const DEFAULT_HOURS = "Mon-Fri 8am-6pm";

async function getOrCreateState(businessId) {
  let state = await store.findRecordByField(ONBOARDING, "businessId", businessId);
  if (!state) {
    state = await store.addRecord(ONBOARDING, {
      businessId,
      profileComplete: false,
      forwardingVerified: false,
      calendarConnected: false,
      reviewSourceConnected: false,
      estimateIngestionConnected: false,
      completedAt: null,
    });
  }
  return state;
}

async function updateState(businessId, updates) {
  const state = await getOrCreateState(businessId);
  return store.updateRecord(ONBOARDING, state.id, updates);
}

// Bundles the fields the profile form needs — client record + onboarding state.
async function loadProfileContext(businessId) {
  const client = await store.findRecordByField("clients", "id", businessId);
  if (!client) return null;
  const state = await getOrCreateState(businessId);
  return { client, state };
}

function renderProfilePage(client, state, queryString) {
  const services = Array.isArray(client.services) ? client.services : [];
  const checkedSet = new Set(services);
  const customServices = services.filter((s) => !COMMON_SERVICES.includes(s));
  const emergencyHoursOn = /24\/7|24hr|24 hour|emergency/i.test(String(client.hours || ""));
  const weekdayHours = String(client.hours || DEFAULT_HOURS).replace(/,?\s*(emergency|24\/7)[^,]*$/i, "").trim() || DEFAULT_HOURS;

  const savedFlag = queryString.includes("saved=1");

  const serviceRows = COMMON_SERVICES.map((s) => {
    const checked = checkedSet.has(s) ? "checked" : "";
    return `<label class="chip"><input type="checkbox" name="services[]" value="${h(s)}" ${checked}><span>${h(s)}</span></label>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Finish setup — ${h(client.name)}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:#070c18;color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;padding:40px 20px}
.wrap{max-width:720px;margin:0 auto}
h1{font-size:26px;font-weight:800;margin-bottom:8px}
.sub{color:#94a3b8;font-size:15px;line-height:1.55;margin-bottom:32px}
.card{background:#0d1526;border:1px solid #1e3a5f;border-radius:12px;padding:28px 32px;margin-bottom:20px}
.section-title{font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#475569;margin-bottom:16px;padding-bottom:10px;border-bottom:1px solid #1e3a5f}
.field{margin-bottom:18px}
.field label{display:block;font-size:13px;font-weight:500;color:#94a3b8;margin-bottom:6px}
.field input[type=text],.field input[type=url],.field input[type=tel],.field textarea{
  width:100%;background:#0a1020;border:1px solid #1e3a5f;border-radius:8px;
  padding:11px 14px;font-size:15px;color:#f1f5f9;outline:none;font-family:inherit;
}
.field textarea{min-height:90px;resize:vertical;line-height:1.5}
.field input:focus,.field textarea:focus{border-color:#0ea5e9}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{cursor:pointer;user-select:none}
.chip input{position:absolute;opacity:0;pointer-events:none}
.chip span{display:inline-block;padding:8px 14px;font-size:13px;background:#0a1020;border:1px solid #1e3a5f;border-radius:100px;color:#cbd5e1;transition:all .15s}
.chip input:checked + span{background:rgba(14,165,233,0.12);border-color:#0ea5e9;color:#38bdf8}
.toggle{display:flex;align-items:center;gap:10px;color:#cbd5e1;font-size:14px;cursor:pointer}
.toggle input{width:18px;height:18px;accent-color:#0ea5e9}
.hint{color:#64748b;font-size:12px;line-height:1.5;margin-top:6px}
button{width:100%;background:linear-gradient(135deg,#0ea5e9,#38bdf8);color:#fff;border:none;border-radius:8px;padding:14px;font-size:15px;font-weight:700;cursor:pointer}
button:hover{opacity:0.92}
.banner{background:rgba(52,211,153,0.08);border:1px solid rgba(52,211,153,0.3);color:#6ee7b7;padding:12px 16px;border-radius:8px;margin-bottom:20px;font-size:14px}
.pill{display:inline-block;padding:3px 10px;font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;border-radius:100px}
.pill-ok{background:rgba(52,211,153,0.12);color:#34d399;border:1px solid rgba(52,211,153,0.3)}
.pill-wait{background:rgba(234,179,8,0.12);color:#facc15;border:1px solid rgba(234,179,8,0.3)}
.pill-warn{background:rgba(239,68,68,0.12);color:#f87171;border:1px solid rgba(239,68,68,0.3)}
.pill-neutral{background:#0a1020;color:#94a3b8;border:1px solid #1e3a5f}
.btn-secondary{width:auto;background:#0a1020;border:1px solid #1e3a5f;color:#e2e8f0;padding:10px 16px;font-size:14px;border-radius:8px;cursor:pointer}
.btn-secondary:hover{border-color:#0ea5e9}
.btn-secondary:disabled{opacity:0.5;cursor:not-allowed}
#fwdMsg{color:#94a3b8;font-size:13px;line-height:1.55;margin-top:10px}
#fwdTrouble{display:none;margin-top:14px;padding:12px 14px;background:#0a1020;border:1px solid #1e3a5f;border-radius:8px;color:#cbd5e1;font-size:13px;line-height:1.6}
#fwdTrouble ul{margin:6px 0 0 18px;padding:0}
</style></head>
<body><div class="wrap">
  <h1>Business profile</h1>
  <p class="sub">This is what the AI says when customers call or text. The more accurate this is, the better the AI answers them.</p>

  ${savedFlag ? `<div class="banner">✓ Saved. Your AI is using the updated details on the next customer interaction.</div>` : ""}

  <div class="card" id="fwdCard">
    <div class="section-title" style="display:flex;align-items:center;justify-content:space-between;gap:10px">
      <span>Call forwarding</span>
      <span id="fwdStatus" class="pill ${state.forwardingVerified ? "pill-ok" : "pill-neutral"}">${state.forwardingVerified ? "Verified" : "Not tested"}</span>
    </div>
    <p style="color:#94a3b8;font-size:14px;line-height:1.55;margin-bottom:14px">
      ${h(client.phoneNumber || "Your ClimateFlow number")} is the number the AI answers on. Set up conditional call-forwarding on your business line so missed calls get routed here, then run the test below.
    </p>
    <button type="button" id="fwdTestBtn" class="btn-secondary">${state.forwardingVerified ? "Test again" : "Send test call"}</button>
    <div id="fwdMsg"></div>
    <div id="fwdTrouble">
      <strong style="color:#f1f5f9">Didn't see the test go through?</strong>
      <ul>
        <li>Confirm the test call reached your business line (check voicemail / missed calls on ${h(client.officePhone || "your line")}).</li>
        <li>Verify your conditional forwarding code is set for no-answer / busy — carrier codes vary (often *71, *72, or AT&amp;T's **61*).</li>
        <li>Forwarding destination should be <strong>${h(client.phoneNumber || "your ClimateFlow number")}</strong>.</li>
        <li>Save this page first if you just changed your business line number.</li>
      </ul>
    </div>
  </div>

  <script>
  (function(){
    var q = ${JSON.stringify(queryString || "")};
    var qsSuffix = q ? ("?" + q) : "";
    var btn = document.getElementById("fwdTestBtn");
    var statusEl = document.getElementById("fwdStatus");
    var msg = document.getElementById("fwdMsg");
    var trouble = document.getElementById("fwdTrouble");
    var polling = false;
    var pollUntil = 0;

    function setPill(cls, text) {
      statusEl.className = "pill " + cls;
      statusEl.textContent = text;
    }

    async function poll() {
      if (!polling) return;
      if (Date.now() > pollUntil) {
        polling = false;
        setPill("pill-warn", "Not detected");
        msg.textContent = "We didn't see the forwarded call in 2 minutes.";
        trouble.style.display = "block";
        btn.disabled = false;
        btn.textContent = "Send another test call";
        return;
      }
      try {
        var r = await fetch("/onboarding/${h(client.id)}/forwarding-test/status" + qsSuffix, { credentials: "same-origin" });
        var j = await r.json();
        if (j.status === "verified") {
          polling = false;
          setPill("pill-ok", "Verified");
          msg.innerHTML = "<span style=\\"color:#34d399\\">\u2713 Your forwarding is working. Missed calls will reach the AI.</span>";
          trouble.style.display = "none";
          btn.disabled = false;
          btn.textContent = "Test again";
          return;
        }
      } catch (e) {
        // swallow transient poll errors; keep retrying until timeout
      }
      setTimeout(poll, 4000);
    }

    btn.addEventListener("click", async function(){
      btn.disabled = true;
      msg.textContent = "Calling your business line...";
      setPill("pill-wait", "Test in progress");
      trouble.style.display = "none";
      try {
        var r = await fetch("/onboarding/${h(client.id)}/forwarding-test/start" + qsSuffix, {
          method: "POST",
          credentials: "same-origin",
        });
        var j = await r.json();
        if (!r.ok) {
          setPill("pill-warn", "Error");
          msg.textContent = j.error || "Could not start the test.";
          btn.disabled = false;
          btn.textContent = "Try again";
          return;
        }
        msg.textContent = "Let it ring until your voicemail picks up. We'll detect the forwarded leg automatically.";
        pollUntil = Date.now() + 2 * 60 * 1000;
        polling = true;
        setTimeout(poll, 3000);
      } catch (e) {
        setPill("pill-warn", "Error");
        msg.textContent = "Network error. Try again.";
        btn.disabled = false;
      }
    });
  })();
  </script>

  <form method="POST" action="${h(queryString ? "?" + queryString : "")}">
    <div class="card">
      <div class="section-title">Services you offer</div>
      <div class="chips">${serviceRows}</div>
      <div class="field" style="margin-top:16px">
        <label>Anything else? (one per line)</label>
        <textarea name="customServices" placeholder="Geothermal systems&#10;Zoning controls">${h(customServices.join("\n"))}</textarea>
      </div>
    </div>

    <div class="card">
      <div class="section-title">Hours</div>
      <div class="field">
        <label>Regular hours</label>
        <input type="text" name="weekdayHours" value="${h(weekdayHours)}" placeholder="Mon-Fri 8am-6pm">
      </div>
      <label class="toggle">
        <input type="checkbox" name="emergency24_7" ${emergencyHoursOn ? "checked" : ""}>
        Offer 24/7 emergency service
      </label>
      <div class="field" style="margin-top:18px">
        <label>What counts as an emergency? <span style="color:#475569;font-weight:400">(AI uses this to escalate)</span></label>
        <textarea name="emergencyDefinition" placeholder="${h(DEFAULT_EMERGENCY)}">${h(client.emergencyDefinition || "")}</textarea>
      </div>
    </div>

    <div class="card">
      <div class="section-title">Service area &amp; contact</div>
      <div class="field">
        <label>Service area</label>
        <input type="text" name="serviceArea" value="${h(client.serviceArea || "")}" placeholder="Portland, OR metro area" required>
      </div>
      <div class="field">
        <label>Your existing business line <span style="color:#475569;font-weight:400">(we'll call-forward from here)</span></label>
        <input type="tel" name="officePhone" value="${h(client.officePhone || "")}" placeholder="+15035557890" required>
      </div>
    </div>

    <div class="card">
      <div class="section-title">Pricing &amp; financing</div>
      <div class="field">
        <label>Pricing reference <span style="color:#475569;font-weight:400">(optional — AI quotes ranges only)</span></label>
        <textarea name="pricing" placeholder="Diagnostic / service call: $99 (waived if you book the repair)&#10;AC repair: typically $200-$800&#10;Furnace install: $4,500-$8,500">${h(client.pricing || "")}</textarea>
        <div class="hint">Leave blank and the AI will say a tech needs to see the job before quoting.</div>
      </div>
      <label class="toggle">
        <input type="checkbox" name="financingAvailable" ${client.financingAvailable ? "checked" : ""}>
        Financing / payment plans available
      </label>
    </div>

    <div class="card">
      <div class="section-title">Reviews</div>
      <div class="field">
        <label>Google review link <span style="color:#475569;font-weight:400">(optional)</span></label>
        <input type="url" name="googleReviewLink" value="${h(client.googleReviewLink || "")}" placeholder="https://g.page/r/.../review">
        <div class="hint">We text this to customers after a completed job to ask for a review.</div>
      </div>
    </div>

    <button type="submit">Save profile</button>
  </form>
</div></body></html>`;
}

// Wizard shell. Rendered at GET /onboarding/:businessId — the welcome email
// and /api/signup/verify success redirect both target this URL. Step
// visibility is per-plan: the review source and estimate ingestion rows only
// show when the client actually has those features. `linkBuilder(path)` is
// injected so the caller can add the signed-URL query string it already has.
function renderWizardPage({ client, state, isCalendarConnected, calendarConnectUrl, features, linkBuilder }) {
  const steps = [];
  const phone = client.twilioNumber || client.phoneNumber || "";
  const profileComplete = !!state.profileComplete;
  const forwardingVerified = !!state.forwardingVerified;
  const calendarConnected = !!isCalendarConnected;

  steps.push({
    key: "profile",
    title: "Fill out business profile",
    summary: "Services, hours, emergency definition, pricing — this is what the AI uses when customers call.",
    done: profileComplete,
    href: linkBuilder(`/onboarding/${client.id}/profile`),
    action: profileComplete ? "Edit" : "Start",
  });

  steps.push({
    key: "forwarding",
    title: "Set up call forwarding",
    summary: `Forward missed calls from ${h(client.officePhone || "your business line")} to ${h(phone)}. Run the test from the profile page to confirm.`,
    done: forwardingVerified,
    href: linkBuilder(`/onboarding/${client.id}/profile`) + "#fwdCard",
    action: forwardingVerified ? "Verified" : "Test call forwarding",
  });

  steps.push({
    key: "calendar",
    title: "Connect Google Calendar",
    summary: "Lets the AI book jobs into your schedule without double-booking.",
    done: calendarConnected,
    // /api/calendar/connect has its own "calendar_connect" signed-URL purpose —
    // the wizard's onboarding token can't satisfy it, so the server mints a
    // short-lived one per render and hands it in.
    href: calendarConnectUrl,
    action: calendarConnected ? "Connected" : "Connect",
  });

  if (features?.reviewAutopilot) {
    steps.push({
      key: "reviews",
      title: "Route Google review alerts",
      summary: `In Google Business Profile, add ${h(`support+reviews-${client.id}@climateflow.ai`)} as a forwarding recipient for review notifications.`,
      done: !!state.reviewSourceConnected,
      href: linkBuilder(`/onboarding/${client.id}/profile`),
      action: state.reviewSourceConnected ? "Configured" : "View instructions",
    });
  }

  if (features?.estimateFollowUp) {
    steps.push({
      key: "estimates",
      title: "Start ingesting estimates",
      summary: `BCC ${h(`support+estimates-${client.id}@climateflow.ai`)} on every quote you send. Or paste them in manually.`,
      done: !!state.estimateIngestionConnected,
      href: linkBuilder(`/onboarding/${client.id}/estimates/paste`),
      action: state.estimateIngestionConnected ? "Paste one" : "How it works",
    });
  }

  const completedCount = steps.filter((s) => s.done).length;
  const pct = Math.round((completedCount / steps.length) * 100);

  const stepRows = steps.map((s) => `
<div class="step ${s.done ? "done" : ""}">
  <div class="check">${s.done ? "✓" : ""}</div>
  <div class="body">
    <div class="title">${h(s.title)}</div>
    <div class="summary">${s.summary}</div>
  </div>
  <a class="btn ${s.done ? "btn-muted" : ""}" href="${h(s.href)}">${h(s.action)}</a>
</div>`).join("");

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Finish setting up — ${h(client.name)}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:#070c18;color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;padding:40px 20px}
.wrap{max-width:720px;margin:0 auto}
h1{font-size:28px;font-weight:800;margin-bottom:8px}
.sub{color:#94a3b8;font-size:15px;line-height:1.55;margin-bottom:24px}
.progress{background:#0d1526;border:1px solid #1e3a5f;border-radius:12px;padding:20px 24px;margin-bottom:20px}
.bar{height:8px;background:#0a1020;border-radius:100px;overflow:hidden;margin-top:10px}
.bar-fill{height:100%;background:linear-gradient(90deg,#0ea5e9,#34d399);transition:width .3s}
.step{background:#0d1526;border:1px solid #1e3a5f;border-radius:12px;padding:18px 22px;margin-bottom:12px;display:flex;align-items:center;gap:16px}
.step.done{border-color:rgba(52,211,153,0.3);background:#0b1420}
.check{width:28px;height:28px;border-radius:100px;border:1.5px solid #1e3a5f;display:flex;align-items:center;justify-content:center;color:#34d399;font-weight:700;flex-shrink:0}
.step.done .check{background:rgba(52,211,153,0.15);border-color:#34d399}
.body{flex:1;min-width:0}
.title{font-size:15px;font-weight:600;color:#f1f5f9;margin-bottom:3px}
.summary{font-size:13px;color:#94a3b8;line-height:1.5}
.btn{display:inline-block;background:linear-gradient(135deg,#0ea5e9,#38bdf8);color:#fff;text-decoration:none;padding:9px 16px;font-size:13px;font-weight:600;border-radius:8px;flex-shrink:0}
.btn:hover{opacity:0.92}
.btn-muted{background:#0a1020;border:1px solid #1e3a5f;color:#94a3b8}
.phone-line{font-size:13px;color:#64748b;margin-top:8px}
.phone-line code{color:#38bdf8;font-family:ui-monospace,Menlo,Consolas,monospace}
</style></head>
<body><div class="wrap">
  <h1>Finish setting up ${h(client.name)}</h1>
  <p class="sub">A few quick steps and you're done. Lead Rescue is live on ${h(phone)} right now — the rest unlocks as you finish each step.</p>
  <div class="progress">
    <div style="display:flex;justify-content:space-between;align-items:baseline">
      <div style="font-size:13px;color:#94a3b8">${completedCount} of ${steps.length} complete</div>
      <div style="font-size:13px;color:#38bdf8;font-weight:600">${pct}%</div>
    </div>
    <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>
  </div>
  ${stepRows}
  <p class="phone-line">Questions? Reply to your welcome email or text <code>${h(phone)}</code>. · <a href="${h(linkBuilder(`/dashboard/${client.id}`))}" style="color:#38bdf8;text-decoration:none">View dashboard →</a></p>
</div></body></html>`;
}

// Parse + normalize form submission. Returns {ok, updates, error}.
function parseProfileSubmission(body, normalizePhone) {
  const pickStr = (k, max = 2000) => {
    const v = typeof body[k] === "string" ? body[k].trim() : "";
    return v.length > max ? v.slice(0, max) : v;
  };

  let rawServices = body["services[]"] || body.services || [];
  if (typeof rawServices === "string") rawServices = [rawServices];
  const services = rawServices.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim());

  const customRaw = pickStr("customServices", 500);
  const customServices = customRaw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
  const mergedServices = [...new Set([...services, ...customServices])];

  const weekdayHours = pickStr("weekdayHours", 120) || DEFAULT_HOURS;
  const emergency247 = body.emergency24_7 === "on" || body.emergency24_7 === true;
  const hours = emergency247 ? `${weekdayHours}, Emergency service 24/7` : weekdayHours;

  const emergencyDefinition = pickStr("emergencyDefinition", 500) || DEFAULT_EMERGENCY;

  const serviceArea = pickStr("serviceArea", 200);
  if (!serviceArea) return { ok: false, error: "Service area is required." };

  const officePhoneRaw = pickStr("officePhone", 40);
  const officePhone = normalizePhone(officePhoneRaw);
  if (!officePhone) return { ok: false, error: "Please enter a valid phone number for your existing business line." };

  const pricing = pickStr("pricing", 2000);
  const financingAvailable = body.financingAvailable === "on" || body.financingAvailable === true;

  const googleReviewLink = pickStr("googleReviewLink", 500);
  if (googleReviewLink && !/^https?:\/\//i.test(googleReviewLink)) {
    return { ok: false, error: "Google review link must start with http:// or https://" };
  }

  return {
    ok: true,
    updates: {
      services: mergedServices,
      hours,
      emergencyDefinition,
      serviceArea,
      officePhone,
      pricing: pricing || null,
      financingAvailable,
      googleReviewLink: googleReviewLink || null,
    },
  };
}

// --- Forwarding self-test ---
//
// An "onboarding_tests" record represents one pending forwarding self-test.
// Shape: { businessId, status, callSid, testCallerNumber, startedAt, expiresAt, verifiedAt }
// - status: "pending" while we wait for the forwarded leg, "verified" once the
//   voice webhook saw an inbound call From our test caller, "expired" after the
//   window closes with nothing observed.
// - testCallerNumber: captured at creation time so a later config change can't
//   retroactively invalidate the match rule.
async function startForwardingTest(businessId, originateFn) {
  const client = await store.findRecordByField("clients", "id", businessId);
  if (!client) return { ok: false, error: "not_found" };
  if (!client.officePhone) return { ok: false, error: "no_office_phone" };

  const existing = await store.findRecordsByField(ONBOARDING_TESTS, "businessId", businessId);
  const nowMs = Date.now();
  const active = existing.find((t) => t.status === "pending" && new Date(t.expiresAt).getTime() > nowMs);
  if (active) {
    return { ok: true, test: active, reused: true };
  }

  // Daily cap: count tests (of any status) started within the last 24h. If the
  // owner hits the ceiling they can still retry tomorrow; a verified flag set
  // by any previous success isn't touched, so progress isn't lost.
  const windowStart = nowMs - FORWARDING_TEST_CAP_WINDOW_MS;
  const recent = existing.filter((t) => new Date(t.startedAt).getTime() >= windowStart);
  if (recent.length >= FORWARDING_TEST_DAILY_CAP) {
    return { ok: false, error: "daily_cap_reached" };
  }

  const { callSid, testCallerNumber } = await originateFn(client.officePhone);

  const record = await store.addRecord(ONBOARDING_TESTS, {
    businessId,
    status: "pending",
    callSid,
    testCallerNumber,
    startedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + FORWARDING_TEST_WINDOW_MS).toISOString(),
    verifiedAt: null,
  });
  return { ok: true, test: record, reused: false };
}

// Called from the voice webhook. Credits an inbound call to the active
// forwarding test when the From field looks like either:
//   - our test caller number (carriers that preserve original CLID), or
//   - the client's officePhone (carriers that rewrite CLID to the forwarding
//     number when conditional forwarding fires).
// Requiring a From match on one of these keeps a real customer who happens to
// dial during the 2-minute test window from false-positively "verifying" the
// setup — no normal customer would call from the business's own line.
async function maybeConsumeForwardingTest({ called, from, business }) {
  if (!business || !from) return false;
  const candidates = await store.findRecordsByField(ONBOARDING_TESTS, "businessId", business.id);
  const nowMs = Date.now();
  const clientOfficePhone = business.officePhone || "";
  const active = candidates.find((t) => {
    if (t.status !== "pending") return false;
    if (new Date(t.expiresAt).getTime() <= nowMs) return false;
    if (from === t.testCallerNumber) return true;
    if (clientOfficePhone && from === clientOfficePhone) return true;
    return false;
  });
  if (!active) return false;

  await store.updateRecord(ONBOARDING_TESTS, active.id, {
    status: "verified",
    verifiedAt: new Date(nowMs).toISOString(),
    verifiedCalledNumber: called || null,
    verifiedFrom: from,
  });
  await updateState(business.id, {
    forwardingVerified: true,
    forwardingVerifiedAt: new Date(nowMs).toISOString(),
  });
  return true;
}

// Polled by the UI while the test is in flight. Returns the latest test's
// status plus a flag indicating whether the onboarding record already has
// forwardingVerified: true (which can be true from a prior completed test even
// if no test is currently in flight).
async function getForwardingTestStatus(businessId) {
  const [state, tests] = await Promise.all([
    getOrCreateState(businessId),
    store.findRecordsByField(ONBOARDING_TESTS, "businessId", businessId),
  ]);
  const nowMs = Date.now();
  const latest = tests.reduce((acc, t) => {
    if (!acc) return t;
    return new Date(t.startedAt).getTime() > new Date(acc.startedAt).getTime() ? t : acc;
  }, null);

  if (!latest) {
    return { status: state.forwardingVerified ? "verified" : "unsent", verified: !!state.forwardingVerified };
  }
  if (latest.status === "verified") {
    return { status: "verified", verified: true, verifiedAt: latest.verifiedAt };
  }
  if (latest.status === "pending" && new Date(latest.expiresAt).getTime() > nowMs) {
    return { status: "pending", verified: !!state.forwardingVerified, expiresAt: latest.expiresAt };
  }
  return { status: "expired", verified: !!state.forwardingVerified, expiredAt: latest.expiresAt };
}

module.exports = {
  ONBOARDING,
  ONBOARDING_TESTS,
  FORWARDING_TEST_WINDOW_MS,
  getOrCreateState,
  updateState,
  loadProfileContext,
  renderProfilePage,
  renderWizardPage,
  parseProfileSubmission,
  startForwardingTest,
  maybeConsumeForwardingTest,
  getForwardingTestStatus,
  COMMON_SERVICES,
  DEFAULT_EMERGENCY,
  DEFAULT_HOURS,
};
