// HTML renderers for the estimate paste form and the owner review queue.
// Pages are rendered server-side; no session auth — access is gated by the
// signed-URL middleware on the routes that call these.
function h(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SHARED_CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:#070c18;color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;padding:40px 20px}
.wrap{max-width:820px;margin:0 auto}
h1{font-size:26px;font-weight:800;margin-bottom:8px}
.sub{color:#94a3b8;font-size:15px;line-height:1.55;margin-bottom:28px}
.card{background:#0d1526;border:1px solid #1e3a5f;border-radius:12px;padding:24px 28px;margin-bottom:16px}
.section-title{font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#475569;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid #1e3a5f}
.field{margin-bottom:14px}
.field label{display:block;font-size:13px;font-weight:500;color:#94a3b8;margin-bottom:6px}
.field input,.field textarea{width:100%;background:#0a1020;border:1px solid #1e3a5f;border-radius:8px;padding:10px 13px;font-size:14px;color:#f1f5f9;outline:none;font-family:inherit}
.field textarea{min-height:80px;resize:vertical;line-height:1.5}
.field input:focus,.field textarea:focus{border-color:#0ea5e9}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
button{background:linear-gradient(135deg,#0ea5e9,#38bdf8);color:#fff;border:none;border-radius:8px;padding:12px 18px;font-size:14px;font-weight:700;cursor:pointer}
button.secondary{background:#0a1020;border:1px solid #1e3a5f;color:#e2e8f0;font-weight:500}
button.danger{background:transparent;border:1px solid rgba(239,68,68,0.4);color:#f87171;font-weight:500}
button:hover{opacity:0.92}
.banner{background:rgba(52,211,153,0.08);border:1px solid rgba(52,211,153,0.3);color:#6ee7b7;padding:11px 14px;border-radius:8px;margin-bottom:16px;font-size:14px}
.banner.err{background:rgba(239,68,68,0.08);border-color:rgba(239,68,68,0.3);color:#fca5a5}
.meta{font-size:12px;color:#64748b;line-height:1.6;margin-bottom:10px}
.queue-item{background:#0a1020;border:1px solid #1e3a5f;border-radius:10px;padding:16px 18px;margin-bottom:12px}
.queue-actions{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
.raw{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:#94a3b8;background:#070c18;border:1px solid #1e3a5f;border-radius:6px;padding:10px 12px;max-height:180px;overflow:auto;white-space:pre-wrap;word-break:break-word}
.nav{display:flex;gap:14px;font-size:13px;color:#64748b;margin-bottom:24px}
.nav a{color:#38bdf8;text-decoration:none}
.nav a:hover{text-decoration:underline}
`;

function renderPastePage(client, state, queryString, flash) {
  const reviewQueueHref = `/onboarding/${h(client.id)}/estimates/queue${queryString ? "?" + queryString : ""}`;
  const profileHref = `/onboarding/${h(client.id)}/profile${queryString ? "?" + queryString : ""}`;
  const banner = flash?.saved
    ? `<div class="banner">✓ Estimate added. Follow-ups start 24 hours after the estimate date.</div>`
    : flash?.error
      ? `<div class="banner err">${h(flash.error)}</div>`
      : "";

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Add estimate — ${h(client.name)}</title>
<style>${SHARED_CSS}</style></head>
<body><div class="wrap">
  <div class="nav">
    <a href="${h(profileHref)}">← Profile</a>
    <a href="${h(reviewQueueHref)}">Review queue</a>
  </div>
  <h1>Add an estimate</h1>
  <p class="sub">BCC <code>support+estimates-${h(client.id)}@climateflow.ai</code> on your quotes and we'll ingest them automatically. This form is for estimates you didn't email — paste the details and we'll start the follow-up cadence.</p>
  ${banner}
  <form method="POST" action="${h(queryString ? "?" + queryString : "")}">
    <div class="card">
      <div class="section-title">Customer</div>
      <div class="row2">
        <div class="field"><label>Name</label><input name="customerName" required placeholder="Jane Doe"></div>
        <div class="field"><label>Phone</label><input name="customerPhone" required placeholder="+15035551234" inputmode="tel"></div>
      </div>
      <div class="field"><label>Email (optional)</label><input name="customerEmail" type="email" placeholder="jane@example.com"></div>
    </div>
    <div class="card">
      <div class="section-title">Estimate</div>
      <div class="field"><label>Total amount ($)</label><input name="amount" required type="number" min="1" step="0.01" placeholder="4500"></div>
      <div class="field"><label>What's being quoted</label><textarea name="description" required placeholder="2.5-ton AC system replacement, includes labor and permit"></textarea></div>
    </div>
    <button type="submit">Add estimate and start follow-ups</button>
  </form>
</div></body></html>`;
}

function renderQueuePage(client, queueItems, queryString, flash) {
  const pasteHref = `/onboarding/${h(client.id)}/estimates/paste${queryString ? "?" + queryString : ""}`;
  const profileHref = `/onboarding/${h(client.id)}/profile${queryString ? "?" + queryString : ""}`;
  const banner = flash?.saved
    ? `<div class="banner">✓ ${h(flash.saved)}</div>`
    : flash?.error
      ? `<div class="banner err">${h(flash.error)}</div>`
      : "";

  const rows = queueItems.length === 0
    ? `<div class="card" style="text-align:center;color:#64748b">Nothing in the queue. Low-confidence email parses will show up here for your review.</div>`
    : queueItems.map((q) => {
        const extracted = q.extracted || {};
        return `
<div class="queue-item">
  <div class="meta">
    From: <code>${h(q.emailFrom || "unknown")}</code> · Subject: ${h(q.emailSubject || "(none)")} · Confidence: <strong>${h(extracted.confidence || "low")}</strong>
  </div>
  <form method="POST" action="/onboarding/${h(client.id)}/estimates/queue/${h(q.id)}/approve${queryString ? "?" + queryString : ""}">
    <div class="row2">
      <div class="field"><label>Customer name</label><input name="customerName" value="${h(extracted.customerName || "")}" required></div>
      <div class="field"><label>Phone</label><input name="customerPhone" value="${h(extracted.customerPhone || "")}" required inputmode="tel"></div>
    </div>
    <div class="row2">
      <div class="field"><label>Email</label><input name="customerEmail" value="${h(extracted.customerEmail || "")}" type="email"></div>
      <div class="field"><label>Amount ($)</label><input name="amount" value="${h(extracted.amount || "")}" type="number" min="1" step="0.01" required></div>
    </div>
    <div class="field"><label>Description</label><textarea name="description" required>${h(extracted.description || "")}</textarea></div>
    ${q.rawBody ? `<details style="margin-bottom:10px"><summary style="cursor:pointer;color:#64748b;font-size:12px">View raw email body</summary><div class="raw" style="margin-top:8px">${h(q.rawBody)}</div></details>` : ""}
    <div class="queue-actions">
      <button type="submit">Approve &amp; start follow-ups</button>
      <button type="submit" class="danger" formaction="/onboarding/${h(client.id)}/estimates/queue/${h(q.id)}/reject${queryString ? "?" + queryString : ""}" formnovalidate>Dismiss</button>
    </div>
  </form>
</div>`;
      }).join("");

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Estimate review queue — ${h(client.name)}</title>
<style>${SHARED_CSS}</style></head>
<body><div class="wrap">
  <div class="nav">
    <a href="${h(profileHref)}">← Profile</a>
    <a href="${h(pasteHref)}">Add estimate manually</a>
  </div>
  <h1>Estimate review queue</h1>
  <p class="sub">Emails we ingested but couldn't fully parse. Edit the fields if needed, then approve to kick off the follow-up cadence — or dismiss if it isn't an estimate.</p>
  ${banner}
  ${rows}
</div></body></html>`;
}

module.exports = { renderPastePage, renderQueuePage };
