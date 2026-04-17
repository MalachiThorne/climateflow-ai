// Owner dashboard. One HTML page summarizing the last 7 days of pipeline
// activity plus setup status — rendered at GET /dashboard/:businessId behind a
// signed URL (same "onboarding" purpose as the wizard so a single token gates
// the whole owner-facing surface). Per-plan feature gating hides rows for
// features the client isn't paying for.
function h(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderDashboardPage({
  client,
  stats,
  calendarConnected,
  calendarConnectUrl,
  forwardingVerified,
  profileComplete,
  pendingQueueCount,
  features,
  linkBuilder,
}) {
  const phone = client.twilioNumber || client.phoneNumber || "";

  // Lead cards use the additive model: a booked lead is also a qualified lead
  // is also a rescued lead. Stats are computed this way in the route so the
  // three numbers don't mysteriously fail to sum.
  const leadCards = features.leadRescue
    ? [
        { label: "Missed calls rescued", value: stats.missedCallsRescued, hint: "Customers the AI texted back after a missed call." },
        { label: "Leads qualified", value: stats.leadsQualified, hint: "Rescued calls where the AI captured job details." },
        { label: "Appointments booked", value: stats.appointmentsBooked, hint: "Qualified leads placed on your calendar." },
      ]
    : [];

  const estimateCards = features.estimateFollowUp
    ? [
        { label: "New estimates", value: stats.estimatesAdded, hint: "Quotes added this week — by email BCC or paste." },
        { label: "Open right now", value: stats.openEstimatesTotal, hint: "All open quotes being followed up with (not just this week)." },
        { label: "Accepted this week", value: stats.estimatesAccepted, hint: "Quotes the customer replied YES to." },
      ]
    : [];

  const reviewCards = features.reviewAutopilot
    ? [
        { label: "Review requests sent", value: stats.reviewRequestsSent, hint: "Texts sent 24h after a completed job." },
        { label: "Reviews responded to", value: stats.reviewsResponded, hint: "Public reviews the AI answered on your behalf." },
      ]
    : [];

  const renderCard = (c) => `
<div class="stat">
  <div class="stat-num">${h(c.value ?? 0)}</div>
  <div class="stat-label">${h(c.label)}</div>
  <div class="stat-hint">${h(c.hint)}</div>
</div>`;

  const section = (title, cards) =>
    cards.length === 0
      ? ""
      : `<div class="section-title">${h(title)}</div><div class="stats">${cards.map(renderCard).join("")}</div>`;

  const setupItems = [];
  setupItems.push({
    label: "Business profile",
    ok: profileComplete,
    okText: "Complete",
    warnText: "Needs your details",
    href: linkBuilder(`/onboarding/${client.id}/profile`),
  });
  setupItems.push({
    label: "Call forwarding",
    ok: forwardingVerified,
    okText: "Verified",
    warnText: "Not tested",
    href: linkBuilder(`/onboarding/${client.id}/profile`) + "#fwdCard",
  });
  setupItems.push({
    label: "Google Calendar",
    ok: calendarConnected,
    okText: "Connected",
    warnText: "Not connected",
    // calendarConnectUrl is a fully-formed absolute URL minted server-side
    // with the calendar_connect purpose — the onboarding token on this page
    // can't satisfy that route, so we mint a fresh short-lived one per load.
    href: calendarConnectUrl,
  });

  const setupRows = setupItems.map((s) => `
<div class="setup-row">
  <div class="setup-label">${h(s.label)}</div>
  <div class="setup-status">
    <span class="pill ${s.ok ? "pill-ok" : "pill-warn"}">${h(s.ok ? s.okText : s.warnText)}</span>
    ${s.ok ? "" : `<a class="setup-link" href="${h(s.href)}">Fix →</a>`}
  </div>
</div>`).join("");

  const queueAlert = features.estimateFollowUp && pendingQueueCount > 0
    ? `<a href="${h(linkBuilder(`/onboarding/${client.id}/estimates/queue`))}" class="queue-alert">
        <strong>${h(pendingQueueCount)}</strong> estimate${pendingQueueCount === 1 ? "" : "s"} waiting for your review →
      </a>`
    : "";

  const wizardHref = linkBuilder(`/onboarding/${client.id}`);
  const profileHref = linkBuilder(`/onboarding/${client.id}/profile`);
  const queueHref = linkBuilder(`/onboarding/${client.id}/estimates/queue`);
  const pasteHref = linkBuilder(`/onboarding/${client.id}/estimates/paste`);

  const hasAnyStats = leadCards.length + estimateCards.length + reviewCards.length > 0;

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard — ${h(client.name)}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:#070c18;color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;padding:40px 20px}
.wrap{max-width:960px;margin:0 auto}
.header{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:12px;margin-bottom:8px}
h1{font-size:26px;font-weight:800}
.window{color:#64748b;font-size:13px}
.sub{color:#94a3b8;font-size:14px;line-height:1.55;margin-bottom:28px}
.sub code{color:#38bdf8;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px}
.section-title{font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#475569;margin:20px 0 12px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:8px}
.stat{background:#0d1526;border:1px solid #1e3a5f;border-radius:12px;padding:20px 22px}
.stat-num{font-size:32px;font-weight:800;color:#f1f5f9;line-height:1;margin-bottom:8px}
.stat-label{font-size:14px;font-weight:600;color:#cbd5e1;margin-bottom:4px}
.stat-hint{font-size:12px;color:#64748b;line-height:1.45}
.setup{background:#0d1526;border:1px solid #1e3a5f;border-radius:12px;padding:20px 24px;margin-bottom:20px}
.setup-row{display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid #1e3a5f}
.setup-row:last-child{border-bottom:none}
.setup-label{font-size:14px;color:#e2e8f0}
.setup-status{display:flex;align-items:center;gap:12px}
.pill{display:inline-block;padding:3px 10px;font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;border-radius:100px}
.pill-ok{background:rgba(52,211,153,0.12);color:#34d399;border:1px solid rgba(52,211,153,0.3)}
.pill-warn{background:rgba(234,179,8,0.12);color:#facc15;border:1px solid rgba(234,179,8,0.3)}
.setup-link{color:#38bdf8;text-decoration:none;font-size:13px;font-weight:600}
.setup-link:hover{text-decoration:underline}
.queue-alert{display:block;background:rgba(234,179,8,0.08);border:1px solid rgba(234,179,8,0.3);color:#facc15;padding:14px 18px;border-radius:10px;text-decoration:none;margin-bottom:20px;font-size:14px}
.queue-alert:hover{background:rgba(234,179,8,0.12)}
.queue-alert strong{color:#fde047;font-weight:700}
.nav{display:flex;flex-wrap:wrap;gap:10px;margin-top:28px;padding-top:24px;border-top:1px solid #1e3a5f}
.nav a{color:#e2e8f0;background:#0a1020;border:1px solid #1e3a5f;padding:8px 14px;border-radius:8px;font-size:13px;text-decoration:none}
.nav a:hover{border-color:#0ea5e9;color:#38bdf8}
.empty{background:#0d1526;border:1px solid #1e3a5f;border-radius:12px;padding:28px;text-align:center;color:#94a3b8;line-height:1.55;margin-bottom:20px}
</style></head>
<body><div class="wrap">
  <div class="header">
    <h1>${h(client.name)}</h1>
    <div class="window">Last 7 days</div>
  </div>
  <p class="sub">Your AI line: <code>${h(phone)}</code></p>

  ${queueAlert}

  <div class="section-title">Setup</div>
  <div class="setup">${setupRows}</div>

  ${hasAnyStats
    ? `${section("Lead Rescue", leadCards)}
       ${section("Estimate Follow-Up", estimateCards)}
       ${section("Review Autopilot", reviewCards)}`
    : `<div class="empty">No features enabled yet. Check your plan in the billing portal.</div>`}

  <div class="nav">
    <a href="${h(wizardHref)}">Setup checklist</a>
    <a href="${h(profileHref)}">Edit profile</a>
    ${features.estimateFollowUp ? `<a href="${h(pasteHref)}">Add estimate</a><a href="${h(queueHref)}">Review queue</a>` : ""}
  </div>
</div></body></html>`;
}

module.exports = { renderDashboardPage };
