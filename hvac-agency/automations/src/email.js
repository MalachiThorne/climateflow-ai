const nodemailer = require("nodemailer");
const config = require("./config");

const transporter = nodemailer.createTransport({
  host: config.email.smtpHost,
  port: config.email.smtpPort,
  secure: config.email.smtpPort === 465,
  auth: {
    user: config.email.smtpUser,
    pass: config.email.smtpPass,
  },
});

// Escape everything that flows from user/customer/AI into an HTML template.
// Covers text-node context; also safe for double-quoted attribute values because
// `&` `<` `>` `"` `'` are all entity-encoded.
function h(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// For href/src attribute values — block non-http(s) schemes to kill javascript:/data: tricks.
function safeUrl(url) {
  if (typeof url !== "string") return "";
  if (!/^https?:\/\//i.test(url)) return "";
  return h(url);
}

// For `tel:` links — only digits and a leading +.
function safeTel(phone) {
  if (typeof phone !== "string") return "";
  const cleaned = phone.replace(/[^\d+]/g, "");
  return h(cleaned);
}

// Plaintext that should render verbatim inside a <p> (preserve newlines via entities).
function text(value) {
  return h(value).replace(/\n/g, "<br>");
}

async function sendWelcomeEmail(ownerEmail, ownerName, businessName, calendarConnectUrl, phoneNumber, billingUrl, wizardUrl) {
  await transporter.sendMail({
    from: `"${config.email.fromName}" <${config.email.fromEmail}>`,
    to: ownerEmail,
    subject: `Welcome to ClimateFlow AI — ${businessName} is live`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0f1e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:600px;margin:40px auto;background:#0d1526;border:1px solid #1e3a5f;border-radius:12px;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#0ea5e9,#38bdf8);padding:32px;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:28px;font-weight:700;">ClimateFlow AI</h1>
      <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:16px;">Your automation is live</p>
    </div>
    <div style="padding:40px;">
      <p style="color:#94a3b8;font-size:16px;margin:0 0 24px;">Hi ${h(ownerName)},</p>
      <p style="color:#e2e8f0;font-size:16px;line-height:1.6;margin:0 0 24px;">
        <strong>${h(businessName)}</strong> is now set up on ClimateFlow AI. Your dedicated phone number is active and ready to capture missed calls, follow up on estimates, and collect reviews automatically.
      </p>

      <div style="background:#0a0f1e;border:1px solid #1e3a5f;border-radius:8px;padding:20px;margin:0 0 24px;">
        <p style="color:#38bdf8;font-size:12px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 12px;">Your dedicated number</p>
        <p style="color:#f1f5f9;font-size:28px;font-weight:700;margin:0;letter-spacing:0.05em;">${h(phoneNumber)}</p>
        <p style="color:#64748b;font-size:13px;margin:8px 0 0;">Keep your existing office number — just forward missed calls here. Setup below.</p>
      </div>

      <div style="background:#0a0f1e;border:1px solid #1e3a5f;border-radius:8px;padding:20px;margin:0 0 32px;">
        <p style="color:#f1f5f9;font-size:15px;font-weight:600;margin:0 0 6px;">Step 1 — Set up call forwarding</p>
        <p style="color:#94a3b8;font-size:13px;line-height:1.5;margin:0 0 16px;">Forward <em>busy</em> and <em>unanswered</em> calls from your office line to <strong style="color:#38bdf8;">${h(phoneNumber)}</strong>. Customers still call your number — we just catch the misses and text them back within 60 seconds.</p>

        <p style="color:#cbd5e1;font-size:13px;font-weight:600;margin:0 0 4px;">AT&amp;T &amp; most landlines</p>
        <p style="color:#94a3b8;font-size:13px;line-height:1.6;margin:0 0 12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">
          Forward on no answer: <span style="color:#f1f5f9;">*92 ${h(phoneNumber)} #</span><br>
          Forward on busy: <span style="color:#f1f5f9;">*90 ${h(phoneNumber)} #</span><br>
          Disable: <span style="color:#f1f5f9;">*93</span> (no answer), <span style="color:#f1f5f9;">*91</span> (busy)
        </p>

        <p style="color:#cbd5e1;font-size:13px;font-weight:600;margin:0 0 4px;">Verizon landline</p>
        <p style="color:#94a3b8;font-size:13px;line-height:1.6;margin:0 0 12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">
          Forward on no answer: <span style="color:#f1f5f9;">*71 ${h(phoneNumber)}</span><br>
          Disable: <span style="color:#f1f5f9;">*73</span>
        </p>

        <p style="color:#cbd5e1;font-size:13px;font-weight:600;margin:0 0 4px;">RingCentral / Nextiva / Vonage / hosted VoIP</p>
        <p style="color:#94a3b8;font-size:13px;line-height:1.6;margin:0 0 12px;">
          Settings → Call Handling → Forwarding → "If unanswered after 4 rings, forward to external number" → paste <strong style="color:#f1f5f9;">${h(phoneNumber)}</strong>
        </p>

        <p style="color:#64748b;font-size:12px;line-height:1.5;margin:16px 0 0;padding-top:12px;border-top:1px solid #1e3a5f;">
          Want texts to come from your <em>real</em> office number instead of ours? Reply to this email and we'll start the carrier paperwork (1–2 weeks, no extra cost).
        </p>
      </div>

      <p style="color:#e2e8f0;font-size:16px;line-height:1.6;margin:0 0 8px;"><strong style="color:#fff;">Step 2 — Finish setup</strong></p>
      <p style="color:#94a3b8;font-size:15px;line-height:1.6;margin:0 0 24px;">
        Your setup checklist has your profile, calendar connection, and forwarding test — all in one place.
      </p>
      <a href="${safeUrl(wizardUrl || calendarConnectUrl)}" style="display:inline-block;background:linear-gradient(135deg,#0ea5e9,#38bdf8);color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;font-size:15px;">
        Open setup checklist →
      </a>
      <p style="color:#64748b;font-size:12px;line-height:1.5;margin:14px 0 0;">
        Or jump straight to <a href="${safeUrl(calendarConnectUrl)}" style="color:#38bdf8;">connect Google Calendar</a>.
      </p>

      <hr style="border:none;border-top:1px solid #1e3a5f;margin:40px 0;">

      <p style="color:#64748b;font-size:13px;line-height:1.6;margin:0;">
        Your 7-day free trial started today. You'll be charged on day 8 unless you cancel.
        ${billingUrl ? `Manage your billing anytime via <a href="${safeUrl(billingUrl)}" style="color:#38bdf8;">this link</a>.` : ""}
      </p>
    </div>
  </div>
</body>
</html>`,
  });
}

async function sendTrialEndingEmail(ownerEmail, ownerName, businessName, daysLeft, billingPortalUrl) {
  const days = Number(daysLeft) || 0;
  await transporter.sendMail({
    from: `"${config.email.fromName}" <${config.email.fromEmail}>`,
    to: ownerEmail,
    subject: `Your ClimateFlow AI trial ends in ${days} days`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0a0f1e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:600px;margin:40px auto;background:#0d1526;border:1px solid #1e3a5f;border-radius:12px;overflow:hidden;">
    <div style="padding:32px 40px 0;">
      <h2 style="color:#f1f5f9;margin:0 0 16px;">Trial ending in ${days} days</h2>
      <p style="color:#94a3b8;font-size:15px;line-height:1.6;margin:0 0 24px;">
        Hi ${h(ownerName)}, your ClimateFlow AI trial for <strong style="color:#f1f5f9;">${h(businessName)}</strong> ends in ${days} days.
        After that, you'll be automatically charged — no action needed if you want to continue.
      </p>
      <p style="color:#94a3b8;font-size:15px;line-height:1.6;margin:0 0 32px;">
        Need to update your payment method or cancel? Use the billing portal below.
      </p>
      <a href="${safeUrl(billingPortalUrl)}" style="display:inline-block;background:linear-gradient(135deg,#0ea5e9,#38bdf8);color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;font-size:15px;margin-bottom:40px;">
        Manage Billing →
      </a>
    </div>
  </div>
</body>
</html>`,
  });
}

async function sendPaymentFailedEmail(ownerEmail, ownerName, businessName, billingPortalUrl) {
  await transporter.sendMail({
    from: `"${config.email.fromName}" <${config.email.fromEmail}>`,
    to: ownerEmail,
    subject: `Action required: payment failed for ${businessName}`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0a0f1e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:600px;margin:40px auto;background:#0d1526;border:1px solid #7f1d1d;border-radius:12px;overflow:hidden;">
    <div style="padding:32px 40px 0;">
      <h2 style="color:#fca5a5;margin:0 0 16px;">Payment failed</h2>
      <p style="color:#94a3b8;font-size:15px;line-height:1.6;margin:0 0 24px;">
        Hi ${h(ownerName)}, we couldn't process the payment for <strong style="color:#f1f5f9;">${h(businessName)}</strong>.
        Stripe will retry automatically over the next 7 days. Your service remains active in the meantime.
      </p>
      <p style="color:#94a3b8;font-size:15px;line-height:1.6;margin:0 0 32px;">
        Please update your payment method to avoid service interruption.
      </p>
      <a href="${safeUrl(billingPortalUrl)}" style="display:inline-block;background:#dc2626;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;font-size:15px;margin-bottom:40px;">
        Update Payment Method →
      </a>
    </div>
  </div>
</body>
</html>`,
  });
}

async function sendEstimateAcceptedEmail(ownerEmail, ownerName, businessName, estimate) {
  const amount = typeof estimate.amount === "number"
    ? `$${estimate.amount.toLocaleString()}`
    : String(estimate.amount ?? "");
  await transporter.sendMail({
    from: `"${config.email.fromName}" <${config.email.fromEmail}>`,
    to: ownerEmail,
    subject: `Estimate accepted: ${estimate.customerName} — ${amount}`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0a0f1e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:600px;margin:40px auto;background:#0d1526;border:1px solid #1e3a5f;border-radius:12px;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#10b981,#34d399);padding:24px 40px;">
      <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700;">Estimate accepted</h1>
    </div>
    <div style="padding:32px 40px;">
      <p style="color:#94a3b8;font-size:15px;margin:0 0 16px;">Hi ${h(ownerName)},</p>
      <p style="color:#e2e8f0;font-size:15px;line-height:1.6;margin:0 0 24px;">
        <strong style="color:#f1f5f9;">${h(estimate.customerName)}</strong> just accepted their estimate for ${h(businessName)}. Reach out to schedule the job.
      </p>
      <div style="background:#0a0f1e;border:1px solid #1e3a5f;border-radius:8px;padding:20px;margin:0 0 24px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="color:#64748b;font-size:13px;padding:4px 0;width:120px;">Customer</td><td style="color:#f1f5f9;font-size:15px;padding:4px 0;">${h(estimate.customerName)}</td></tr>
          <tr><td style="color:#64748b;font-size:13px;padding:4px 0;">Phone</td><td style="color:#f1f5f9;font-size:15px;padding:4px 0;"><a href="tel:${safeTel(estimate.customerPhone)}" style="color:#38bdf8;">${h(estimate.customerPhone)}</a></td></tr>
          <tr><td style="color:#64748b;font-size:13px;padding:4px 0;">Amount</td><td style="color:#34d399;font-size:18px;font-weight:700;padding:4px 0;">${h(amount)}</td></tr>
          <tr><td style="color:#64748b;font-size:13px;padding:4px 0;vertical-align:top;">Work</td><td style="color:#e2e8f0;font-size:14px;line-height:1.5;padding:4px 0;">${text(estimate.description)}</td></tr>
        </table>
      </div>
      <p style="color:#64748b;font-size:13px;line-height:1.6;margin:0;">
        Sent automatically by ClimateFlow AI when the customer replied to confirm.
      </p>
    </div>
  </div>
</body>
</html>`,
  });
}

async function sendEstimateFollowUpEmail(customerEmail, customerName, businessName, message, replyToEmail) {
  await transporter.sendMail({
    from: `"${businessName}" <${config.email.fromEmail}>`,
    to: customerEmail,
    replyTo: replyToEmail || config.email.fromEmail,
    subject: `Following up on your estimate from ${businessName}`,
    text: `Hi ${customerName},\n\n${message}\n\n— ${businessName}`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:32px auto;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:32px;">
    <p style="color:#0f172a;font-size:15px;line-height:1.6;margin:0 0 16px;">Hi ${h(customerName)},</p>
    <p style="color:#334155;font-size:15px;line-height:1.65;margin:0 0 24px;">${text(message)}</p>
    <p style="color:#64748b;font-size:14px;margin:0;">— ${h(businessName)}</p>
  </div>
</body>
</html>`,
  });
}

async function sendVerificationEmail(ownerEmail, ownerName, businessName, verifyUrl) {
  await transporter.sendMail({
    from: `"${config.email.fromName}" <${config.email.fromEmail}>`,
    to: ownerEmail,
    subject: `Verify your email to activate ${businessName}`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0a0f1e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:600px;margin:40px auto;background:#0d1526;border:1px solid #1e3a5f;border-radius:12px;overflow:hidden;">
    <div style="padding:32px 40px;">
      <h2 style="color:#f1f5f9;margin:0 0 16px;">One click to activate</h2>
      <p style="color:#94a3b8;font-size:15px;line-height:1.6;margin:0 0 24px;">
        Hi ${h(ownerName)}, click below to verify your email and finish setting up <strong style="color:#f1f5f9;">${h(businessName)}</strong>. We'll provision your dedicated phone number and send your login details right after.
      </p>
      <a href="${safeUrl(verifyUrl)}" style="display:inline-block;background:linear-gradient(135deg,#0ea5e9,#38bdf8);color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;font-size:15px;margin-bottom:32px;">
        Verify Email →
      </a>
      <p style="color:#64748b;font-size:13px;line-height:1.6;margin:0;">
        This link expires in 24 hours. If you didn't sign up, ignore this email — we won't charge you.
      </p>
    </div>
  </div>
</body>
</html>`,
  });
}

async function sendBillingLinkEmail(ownerEmail, ownerName, businessName, billingUrl) {
  await transporter.sendMail({
    from: `"${config.email.fromName}" <${config.email.fromEmail}>`,
    to: ownerEmail,
    subject: `Your ClimateFlow AI billing portal link`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0a0f1e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:600px;margin:40px auto;background:#0d1526;border:1px solid #1e3a5f;border-radius:12px;overflow:hidden;">
    <div style="padding:32px 40px;">
      <h2 style="color:#f1f5f9;margin:0 0 16px;">Manage your billing</h2>
      <p style="color:#94a3b8;font-size:15px;line-height:1.6;margin:0 0 24px;">
        Hi ${h(ownerName)}, here's a secure link to the billing portal for <strong style="color:#f1f5f9;">${h(businessName)}</strong>. Update payment methods, view invoices, change your plan, or cancel.
      </p>
      <a href="${safeUrl(billingUrl)}" style="display:inline-block;background:linear-gradient(135deg,#0ea5e9,#38bdf8);color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;font-size:15px;margin-bottom:32px;">
        Open Billing Portal →
      </a>
      <p style="color:#64748b;font-size:13px;line-height:1.6;margin:0;">
        This link expires in 30 minutes for your security. Request a new one anytime if it expires.
      </p>
    </div>
  </div>
</body>
</html>`,
  });
}

async function sendWeeklyDigestEmail(ownerEmail, ownerName, businessName, stats) {
  const weekOf = new Date(stats.since).toLocaleDateString("en-US", { month: "long", day: "numeric" });
  const weekEnd = new Date(stats.until).toLocaleDateString("en-US", { month: "long", day: "numeric" });
  const totalActivity = stats.missedCallsRescued + stats.appointmentsBooked +
    stats.estimatesConverted + stats.reviewsResponded;
  const subject = totalActivity > 0
    ? `Your week at ${h(businessName)} — ${stats.appointmentsBooked} booked, ${stats.missedCallsRescued} leads rescued`
    : `Weekly summary for ${h(businessName)} — ${weekOf}`;

  function stat(value, label, color = "#38bdf8") {
    return `
      <div style="text-align:center;padding:16px 12px;background:#070c18;border:1px solid #1e3a5f;border-radius:8px;">
        <div style="font-size:32px;font-weight:800;color:${color};line-height:1;">${value}</div>
        <div style="font-size:12px;color:#64748b;margin-top:4px;line-height:1.3;">${label}</div>
      </div>`;
  }

  await transporter.sendMail({
    from: `"${config.email.fromName}" <${config.email.fromEmail}>`,
    to: ownerEmail,
    subject,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0f1e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:600px;margin:40px auto;background:#0d1526;border:1px solid #1e3a5f;border-radius:12px;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#0ea5e9,#38bdf8);padding:28px 40px;">
      <p style="color:rgba(255,255,255,0.8);font-size:13px;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.08em;">Weekly Summary</p>
      <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700;">${h(businessName)}</h1>
      <p style="color:rgba(255,255,255,0.75);font-size:14px;margin:6px 0 0;">${weekOf} – ${weekEnd}</p>
    </div>

    <div style="padding:32px 40px;">
      <p style="color:#94a3b8;font-size:15px;margin:0 0 24px;">Hi ${h(ownerName)}, here's what your AI system did this week while you were on the job.</p>

      <p style="color:#f1f5f9;font-size:13px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;margin:0 0 12px;">Lead Rescue</p>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:0 0 28px;">
        ${stat(stats.missedCallsRescued, "Missed calls rescued", "#38bdf8")}
        ${stat(stats.leadsQualified, "Leads qualified", "#818cf8")}
        ${stat(stats.appointmentsBooked, "Appointments booked", "#34d399")}
      </div>

      <p style="color:#f1f5f9;font-size:13px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;margin:0 0 12px;">Estimate Follow-Up</p>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:0 0 28px;">
        ${stat(stats.estimatesSent, "Estimates tracked", "#38bdf8")}
        ${stat(stats.estimatesFollowedUp, "Follow-ups sent", "#818cf8")}
        ${stat(stats.estimatesConverted, "Estimates won", "#34d399")}
      </div>

      <p style="color:#f1f5f9;font-size:13px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;margin:0 0 12px;">Review Autopilot</p>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin:0 0 28px;">
        ${stat(stats.reviewRequestsSent, "Review requests sent", "#38bdf8")}
        ${stat(stats.reviewsResponded, "Reviews responded", "#34d399")}
      </div>

      ${stats.revenueProxy > 0 ? `
      <div style="background:rgba(52,211,153,0.08);border:1px solid rgba(52,211,153,0.25);border-radius:10px;padding:20px;margin:0 0 28px;text-align:center;">
        <p style="color:#6ee7b7;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 6px;">Estimated revenue recovered</p>
        <p style="color:#34d399;font-size:36px;font-weight:800;margin:0;">$${stats.revenueProxy.toLocaleString()}</p>
        <p style="color:#64748b;font-size:12px;margin:6px 0 0;">Based on ${stats.appointmentsBooked} booked appointment${stats.appointmentsBooked !== 1 ? "s" : ""} × avg ticket</p>
      </div>` : ""}

      <hr style="border:none;border-top:1px solid #1e3a5f;margin:0 0 20px;">
      <p style="color:#475569;font-size:12px;line-height:1.6;margin:0;">
        Sent automatically every Monday by ClimateFlow AI.
        Questions? Reply to this email.
      </p>
    </div>
  </div>
</body>
</html>`,
  });
}

async function sendCalendarNudgeEmail(ownerEmail, ownerName, businessName, calendarConnectUrl) {
  await transporter.sendMail({
    from: `"${config.email.fromName}" <${config.email.fromEmail}>`,
    to: ownerEmail,
    subject: `One step left to activate ${businessName} — connect your calendar`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0a0f1e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:600px;margin:40px auto;background:#0d1526;border:1px solid #1e3a5f;border-radius:12px;overflow:hidden;">
    <div style="padding:32px 40px;">
      <h2 style="color:#f1f5f9;margin:0 0 16px;">Your AI is live — but can't book yet</h2>
      <p style="color:#94a3b8;font-size:15px;line-height:1.6;margin:0 0 24px;">
        Hi ${h(ownerName)}, <strong style="color:#f1f5f9;">${h(businessName)}</strong> is set up and responding to missed calls.
        But the AI can't book appointments until you connect your Google Calendar — it takes 30 seconds.
      </p>
      <a href="${safeUrl(calendarConnectUrl)}" style="display:inline-block;background:linear-gradient(135deg,#0ea5e9,#38bdf8);color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;font-size:15px;margin-bottom:32px;">
        Connect Google Calendar →
      </a>
      <p style="color:#64748b;font-size:13px;line-height:1.6;margin:0;">
        Without this, the AI will tell callers someone will call them back to confirm. Connect now so it can book the job on the spot.
      </p>
    </div>
  </div>
</body>
</html>`,
  });
}

async function sendMonthlyReportEmail(ownerEmail, ownerName, businessName, stats) {
  const monthName = new Date(stats.since).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const avgDisplay = stats.avgRating !== null ? stats.avgRating.toFixed(1) : "—";
  const stars = stats.avgRating !== null
    ? "★".repeat(Math.round(stats.avgRating)) + "☆".repeat(5 - Math.round(stats.avgRating))
    : "No reviews";

  function bar(count, total, color) {
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
      <span style="color:#64748b;font-size:13px;width:16px;text-align:right;">${count}</span>
      <div style="flex:1;background:#1e3a5f;border-radius:4px;height:8px;overflow:hidden;">
        <div style="width:${pct}%;background:${color};height:100%;border-radius:4px;"></div>
      </div>
    </div>`;
  }

  await transporter.sendMail({
    from: `"${config.email.fromName}" <${config.email.fromEmail}>`,
    to: ownerEmail,
    subject: `${businessName} reputation report — ${monthName}`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0f1e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:600px;margin:40px auto;background:#0d1526;border:1px solid #1e3a5f;border-radius:12px;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#7c3aed,#a78bfa);padding:28px 40px;">
      <p style="color:rgba(255,255,255,0.8);font-size:13px;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.08em;">Monthly Reputation Report</p>
      <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700;">${h(businessName)}</h1>
      <p style="color:rgba(255,255,255,0.75);font-size:14px;margin:6px 0 0;">${monthName}</p>
    </div>

    <div style="padding:32px 40px;">
      <p style="color:#94a3b8;font-size:15px;margin:0 0 28px;">Hi ${h(ownerName)}, here's your online reputation summary for last month.</p>

      <div style="background:#070c18;border:1px solid #1e3a5f;border-radius:10px;padding:24px;margin:0 0 28px;text-align:center;">
        <p style="color:#a78bfa;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 8px;">Average Rating</p>
        <p style="color:#f1f5f9;font-size:48px;font-weight:800;margin:0;line-height:1;">${h(avgDisplay)}</p>
        <p style="color:#fbbf24;font-size:20px;margin:8px 0 4px;letter-spacing:2px;">${h(stars)}</p>
        <p style="color:#64748b;font-size:13px;margin:0;">from ${stats.total} review${stats.total !== 1 ? "s" : ""} this month</p>
      </div>

      ${stats.total > 0 ? `
      <p style="color:#f1f5f9;font-size:13px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;margin:0 0 12px;">Rating Breakdown</p>
      <div style="background:#070c18;border:1px solid #1e3a5f;border-radius:8px;padding:16px 20px;margin:0 0 28px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;"><span style="color:#fbbf24;font-size:13px;width:16px;">5★</span>${bar(stats.byRating[5], stats.total, "#34d399")}</div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;"><span style="color:#fbbf24;font-size:13px;width:16px;">4★</span>${bar(stats.byRating[4], stats.total, "#38bdf8")}</div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;"><span style="color:#fbbf24;font-size:13px;width:16px;">3★</span>${bar(stats.byRating[3], stats.total, "#818cf8")}</div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;"><span style="color:#fbbf24;font-size:13px;width:16px;">2★</span>${bar(stats.byRating[2], stats.total, "#fb923c")}</div>
        <div style="display:flex;align-items:center;gap:8px;"><span style="color:#fbbf24;font-size:13px;width:16px;">1★</span>${bar(stats.byRating[1], stats.total, "#f87171")}</div>
      </div>` : ""}

      <p style="color:#f1f5f9;font-size:13px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;margin:0 0 12px;">Review Autopilot Activity</p>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:0 0 28px;">
        <div style="text-align:center;padding:16px 12px;background:#070c18;border:1px solid #1e3a5f;border-radius:8px;">
          <div style="font-size:32px;font-weight:800;color:#38bdf8;line-height:1;">${stats.requestsSent}</div>
          <div style="font-size:12px;color:#64748b;margin-top:4px;line-height:1.3;">Requests sent</div>
        </div>
        <div style="text-align:center;padding:16px 12px;background:#070c18;border:1px solid #1e3a5f;border-radius:8px;">
          <div style="font-size:32px;font-weight:800;color:#34d399;line-height:1;">${stats.autoResponded}</div>
          <div style="font-size:12px;color:#64748b;margin-top:4px;line-height:1.3;">Auto-responded</div>
        </div>
        <div style="text-align:center;padding:16px 12px;background:#070c18;border:1px solid #1e3a5f;border-radius:8px;">
          <div style="font-size:32px;font-weight:800;color:#fb923c;line-height:1;">${stats.flaggedForApproval}</div>
          <div style="font-size:12px;color:#64748b;margin-top:4px;line-height:1.3;">Flagged for you</div>
        </div>
      </div>

      <hr style="border:none;border-top:1px solid #1e3a5f;margin:0 0 20px;">
      <p style="color:#475569;font-size:12px;line-height:1.6;margin:0;">
        Sent automatically on the 1st of each month by ClimateFlow AI.
        Questions? Reply to this email.
      </p>
    </div>
  </div>
</body>
</html>`,
  });
}

module.exports = {
  sendWelcomeEmail,
  sendTrialEndingEmail,
  sendPaymentFailedEmail,
  sendEstimateAcceptedEmail,
  sendEstimateFollowUpEmail,
  sendVerificationEmail,
  sendBillingLinkEmail,
  sendWeeklyDigestEmail,
  sendCalendarNudgeEmail,
  sendMonthlyReportEmail,
};
