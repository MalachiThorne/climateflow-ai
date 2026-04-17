const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
const config = require("./config");
const { isSuppressed } = require("./suppression");

const LOG_FILE = path.resolve(__dirname, "../data/send_log.json");

function buildUnsubscribeHeader() {
  // RFC 2369 + RFC 8058: Gmail/Yahoo prefer both mailto and https, with
  // List-Unsubscribe-Post enabling true one-click. Mailto alone is CAN-SPAM-compliant,
  // but one-click reduces spam complaints dramatically — wire up the URL if you have it.
  const parts = [`<mailto:${config.compliance.unsubscribeMailto}?subject=unsubscribe>`];
  if (config.compliance.unsubscribeUrl) {
    parts.unshift(`<${config.compliance.unsubscribeUrl}>`);
  }
  return parts.join(", ");
}

function buildTextFooter() {
  return [
    "",
    "---",
    `${config.compliance.senderName}`,
    `${config.compliance.physicalAddress}`,
    "",
    `To opt out, reply with "unsubscribe" or email ${config.compliance.unsubscribeMailto}.`,
    config.compliance.unsubscribeUrl
      ? `Or one-click: ${config.compliance.unsubscribeUrl}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildHtmlFooter() {
  const url = config.compliance.unsubscribeUrl;
  const mailto = config.compliance.unsubscribeMailto;
  const oneClick = url
    ? `<a href="${url}" style="color:#999;">Unsubscribe</a> &middot; `
    : "";
  return `
    <hr style="border:0;border-top:1px solid #eee;margin:24px 0 12px 0;" />
    <p style="font-size:12px;color:#999;margin:0 0 6px 0;">
      ${escapeHtml(config.compliance.senderName)}<br/>
      ${escapeHtml(config.compliance.physicalAddress)}
    </p>
    <p style="font-size:12px;color:#999;margin:0;">
      ${oneClick}<a href="mailto:${mailto}?subject=unsubscribe" style="color:#999;">Email to opt out</a>
    </p>
  `;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getTransporter() {
  return nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: false,
    auth: {
      user: config.smtp.user,
      pass: config.smtp.pass,
    },
  });
}

function readLog() {
  if (!fs.existsSync(LOG_FILE)) return [];
  return JSON.parse(fs.readFileSync(LOG_FILE, "utf-8"));
}

function writeLog(entries) {
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LOG_FILE, JSON.stringify(entries, null, 2));
}

function hasBeenSent(email, templateKey) {
  const log = readLog();
  return log.some((entry) => entry.email === email && entry.templateKey === templateKey);
}

function todaySendCount() {
  const log = readLog();
  const today = new Date().toISOString().split("T")[0];
  return log.filter((entry) => entry.sentAt.startsWith(today)).length;
}

async function sendEmail(to, subject, body, templateKey) {
  // isSuppressed throws on a corrupted suppression file — propagate so the caller
  // (campaign.js) halts the run instead of sending to an opted-out address.
  if (await isSuppressed(to)) {
    console.log(`[Sender] Skipping ${to} — on suppression list (opt-out/bounce).`);
    return { suppressed: true };
  }

  if (hasBeenSent(to, templateKey)) {
    console.log(`[Sender] Skipping ${to} — already sent ${templateKey}`);
    return { skipped: true };
  }

  if (todaySendCount() >= config.outreach.dailySendLimit) {
    console.log(`[Sender] Daily limit reached (${config.outreach.dailySendLimit})`);
    return { limitReached: true };
  }

  const transporter = getTransporter();

  const textWithFooter = `${body}\n${buildTextFooter()}`;

  const htmlBody = body
    .split("\n\n")
    .map((p) => `<p style="margin: 0 0 16px 0; line-height: 1.6;">${p}</p>`)
    .join("");

  const info = await transporter.sendMail({
    from: `"${config.smtp.fromName}" <${config.smtp.fromEmail}>`,
    to,
    subject,
    text: textWithFooter,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
        ${htmlBody}
        ${buildHtmlFooter()}
      </div>
    `,
    headers: {
      "List-Unsubscribe": buildUnsubscribeHeader(),
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      "Precedence": "bulk",
    },
  });

  const logEntry = {
    email: to,
    subject,
    templateKey,
    messageId: info.messageId,
    sentAt: new Date().toISOString(),
  };

  const log = readLog();
  log.push(logEntry);
  writeLog(log);

  console.log(`[Sender] Sent "${subject}" to ${to}`);
  return { sent: true, messageId: info.messageId };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { sendEmail, hasBeenSent, todaySendCount, sleep };
